import type { Page, Request } from 'playwright';
import type { ReferoDiscoveryOptions, resolveReferoEntry } from './discovery.ts';
import type { DiscoveredEntry, DiscoveryEvent, Intervention } from './types.ts';
import type { GallerySpec } from './library-specs.ts';
import { galleryHost, galleryListing } from './library-specs.ts';
import { canonicalUrl, delay, errorMessage, idFor, now, publicUrl } from './utils.ts';
import { parseConfig } from './config.ts';
import { sweepCleanup } from './cleanup.ts';
import { AD_CONTAINERS, guardNuisances, isAdvertisingUrl, isTelemetryUrl } from './nuisance.ts';

type ObservedCard = {
  url: string;
  title: string;
  originalUrl?: string;
  previewUrl?: string;
  labels: string[];
};
type GalleryState = {
  entries: Map<string, ObservedCard>;
  collect: (node: Node) => void;
  card: () => Element | undefined;
};
declare global {
  interface Window {
    __folioGallery?: GalleryState;
  }
}
class GalleryPersistenceError extends Error {}
/** Only requests that can load this listing establish completion or a loading failure. */
export function isGalleryLoadingRequest(request: Request, page: Page, spec: GallerySpec): boolean {
  if (
    !['document', 'fetch', 'xhr', 'script'].includes(request.resourceType()) ||
    isAdvertisingUrl(request.url()) ||
    isTelemetryUrl(request.url())
  )
    return false;
  try {
    if (request.frame() !== page.mainFrame()) return false;
  } catch {
    /* Worker requests have no frame. */
  }
  if (request.isNavigationRequest()) return true;
  // Next's HEAD probe checks the already-rendered document; it carries no listing content.
  if (request.method() === 'HEAD' && canonicalUrl(request.url()) === canonicalUrl(page.url()))
    return false;
  const url = new URL(request.url()),
    headers = request.headers();
  return (
    !spec.ignoredRequests?.some(
      (rule) =>
        url.hostname.replace(/^www\./, '') === rule.host &&
        (!rule.method || request.method() === rule.method) &&
        new RegExp(rule.paths).test(url.pathname),
    ) &&
    !(
      galleryHost(spec, url.href) &&
      new RegExp(spec.details).test(url.pathname) &&
      (spec.prefetchDetails || url.searchParams.has('_rsc'))
    ) &&
    !/prefetch/i.test(headers.purpose || headers['sec-purpose'] || '') &&
    !headers['next-router-prefetch'] &&
    !headers['next-router-segment-prefetch']
  );
}
const END_PATTERN =
  '^(?:no more (?:results|websites|designs|sections|items|shots)|all (?:results|websites|designs|sections|items) loaded|end of (?:results|collection)|you(?:’|\x27)ve reached the end|no results found)[.!]?$';
const SOCIAL_HOSTS =
  /(^|\.)(?:twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|pinterest\.com|t\.me|youtube\.com|youtu\.be|dribbble\.com|behance\.net)$/;

function safeOriginal(spec: GallerySpec, value: string): string | undefined {
  try {
    const parsed = new URL(publicUrl(value));
    if (
      (parsed.hostname === 'figma.com' || parsed.hostname.endsWith('.figma.com')) &&
      /^\/(?:design|file|proto|community)(?:\/|$)/.test(parsed.pathname)
    )
      return undefined;
    const knownReferrers = new Set(
      spec.hosts
        .flatMap((host) => [host, host.replace(/[^a-z0-9]/g, ''), host.split('.')[0]!])
        .concat(spec.id === 'recent' ? ['godly'] : []),
    );
    for (const key of ['ref', 'via']) {
      if (knownReferrers.has(parsed.searchParams.get(key)?.toLowerCase() || ''))
        parsed.searchParams.delete(key);
    }
    const url = parsed.href;
    return !galleryHost(spec, url) &&
      !isAdvertisingUrl(url) &&
      !SOCIAL_HOSTS.test(new URL(url).hostname)
      ? canonicalUrl(url)
      : undefined;
  } catch {
    return undefined;
  }
}

async function observeCards(page: Page, spec: GallerySpec): Promise<void> {
  await page.addInitScript(
    ({ spec, adContainers }) => {
      const entries = new Map<string, ObservedCard>();
      const details = new RegExp(spec.details);
      const host = (url: URL) => spec.hosts.includes(url.hostname.replace(/^www\./, ''));
      const dom = {
        anchors(node: Node): HTMLAnchorElement[] {
          if (!(node instanceof Element)) return [];
          return [
            ...(node instanceof HTMLAnchorElement ? [node] : []),
            ...node.querySelectorAll<HTMLAnchorElement>('a[href]'),
          ];
        },
        sponsored(anchor: HTMLAnchorElement): boolean {
          if (
            anchor.closest(adContainers) ||
            (anchor.closest('header,nav,footer') &&
              !(spec.entrySelector && anchor.matches(spec.entrySelector)))
          )
            return true;
          const label = anchor.getAttribute('aria-label') || '';
          return /^(?:advertisement|sponsored)(?:\b|:)/i.test(label);
        },
        collect(node: Node) {
          for (const anchor of dom.anchors(node)) {
            let url: URL;
            try {
              url = new URL(anchor.href);
            } catch {
              continue;
            }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
              continue;
            const internal =
              host(url) &&
              details.test(url.pathname) &&
              (!spec.entrySelector || anchor.matches(spec.entrySelector));
            const direct =
              !host(url) && Boolean(spec.directSelector && anchor.matches(spec.directSelector));
            if (!internal && !direct) continue;
            if (dom.sponsored(anchor)) {
              entries.delete(url.href);
              continue;
            }
            const container =
              anchor.closest('article,[role="listitem"],.w-dyn-item,button') ||
              anchor.parentElement;
            const title = (
              (direct ? container?.querySelector('h1,h2,h3,h4')?.textContent : '') ||
              anchor.getAttribute('aria-label') ||
              anchor.getAttribute('title') ||
              anchor.textContent ||
              container?.querySelector('h1,h2,h3,h4')?.textContent ||
              anchor.querySelector('img')?.alt ||
              ''
            )
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200);
            const image = anchor.querySelector('img') || container?.querySelector('img');
            const labels = [
              ...(container?.querySelectorAll('[data-source-label],.tag,.tag-label') || []),
            ]
              .map((e) => (e.textContent || '').trim())
              .filter(Boolean);
            const identity = direct
              ? `${location.href.split('#')[0]}#folio-reference=${encodeURIComponent([url.href, title, image?.src || ''].join('\n'))}`
              : url.href;
            entries.set(identity, {
              url: identity,
              title: title || entries.get(identity)?.title || '',
              ...(direct ? { originalUrl: url.href } : {}),
              previewUrl: image?.currentSrc || image?.src,
              labels,
            });
          }
        },
        card() {
          return [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((a) => {
            try {
              const u = new URL(a.href);
              return (
                !dom.sponsored(a) &&
                ((host(u) &&
                  details.test(u.pathname) &&
                  (!spec.entrySelector || a.matches(spec.entrySelector))) ||
                  (!!spec.directSelector && a.matches(spec.directSelector)))
              );
            } catch {
              return false;
            }
          });
        },
      };
      window.__folioGallery = { entries, collect: dom.collect, card: dom.card };
      new MutationObserver((changes) => {
        for (const change of changes) {
          dom.collect(change.target);
          for (const node of [...change.addedNodes, ...change.removedNodes]) dom.collect(node);
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeFilter: ['href', 'aria-label', 'data-sponsored', 'class'],
      });
      document.addEventListener('DOMContentLoaded', () => dom.collect(document.documentElement));
    },
    { spec, adContainers: AD_CONTAINERS },
  );
}

function withinPagination(spec: GallerySpec, listing: string, candidate: string): boolean {
  if (!galleryListing(spec, candidate)) return false;
  const path = (value: string) =>
    new URL(value).pathname.replace(/\/page\/[0-9]+\/?$/, '').replace(/\/$/, '') || '/';
  const current = path(listing),
    next = path(candidate);
  return (
    current === next ||
    (!!spec.paginationRoots?.includes(current) && !!spec.paginationRoots.includes(next))
  );
}

async function snapshot(page: Page, spec: GallerySpec) {
  return page.evaluate(
    ({ spec, endPattern }) => {
      const dom = {
        visible(e: Element) {
          const r = e.getBoundingClientRect(),
            s = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        },
      };
      window.__folioGallery?.collect(document.documentElement);
      let scroller = document.scrollingElement || document.documentElement;
      for (let p = window.__folioGallery?.card()?.parentElement; p; p = p.parentElement) {
        if (
          /(auto|scroll)/.test(getComputedStyle(p).overflowY) &&
          p.scrollHeight > p.clientHeight + 2
        ) {
          scroller = p;
          break;
        }
      }
      const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')];
      const next = anchors
        .filter(
          (a) =>
            dom.visible(a) &&
            (a.rel.split(/\s+/).includes('next') ||
              a.matches(
                '.w-pagination-next,.next.page-numbers,.pagination a[href],nav[aria-label*="agination"] a[href],[data-pagination] a[href]',
              ) ||
              /^(?:next(?: page)?|older(?: posts| websites)?)(?:\s*[→»›])?$/i.test(
                a.getAttribute('aria-label') || a.textContent?.trim() || '',
              )),
        )
        .map((a) => a.href);
      return {
        entries: [...(window.__folioGallery?.entries.values() || [])],
        collections: spec.collections
          ? anchors
              .filter((a) => new RegExp(spec.collections!).test(new URL(a.href).pathname))
              .map((a) => a.href)
          : [],
        next,
        height: scroller.scrollHeight,
        bottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4,
        loading: [
          ...document.querySelectorAll(
            '[aria-busy="true"],[role="progressbar"],[data-loading="true"]',
          ),
        ].some(dom.visible),
        explicit: [
          ...document.querySelectorAll(
            '[data-end-of-list],[data-has-more="false"],p,[role="status"]',
          ),
        ].some(
          (e) =>
            dom.visible(e) &&
            (e.hasAttribute('data-end-of-list') ||
              e.getAttribute('data-has-more') === 'false' ||
              new RegExp(endPattern, 'i').test(e.textContent?.trim() || '')),
        ),
        gate: /verify (?:that )?you are human|checking your browser|access denied|security verification|just a moment/i.test(
          `${document.title} ${document.body.innerText.slice(0, 1200)}`,
        ),
      };
    },
    { spec, endPattern: END_PATTERN },
  );
}

async function advance(page: Page): Promise<boolean> {
  const buttons = page.locator('button,[role="button"]');
  for (let i = 0, count = await buttons.count(); i < count; i++) {
    const button = buttons.nth(i);
    if (
      await button.evaluate(
        (el, ads) => !!el.closest(`header,nav,footer,aside,form,${ads}`),
        AD_CONTAINERS,
      )
    )
      continue;
    const label = (
      (await button.getAttribute('aria-label')) ||
      (await button.textContent()) ||
      ''
    ).trim();
    if (
      !/^(?:load|show|view) more(?: (?:results|websites|designs|sections|items|shots))?$/i.test(
        label,
      )
    )
      continue;
    if (
      !(await button.isVisible()) ||
      !(await button.isEnabled()) ||
      (await button.getAttribute('aria-disabled')) === 'true'
    )
      continue;
    await button.click({ timeout: 5000 });
    return true;
  }
  await page.evaluate(() => {
    for (let p = window.__folioGallery?.card()?.parentElement; p; p = p.parentElement)
      if (
        /(auto|scroll)/.test(getComputedStyle(p).overflowY) &&
        p.scrollHeight > p.clientHeight + 2
      ) {
        p.scrollTo({ top: p.scrollHeight, behavior: 'instant' });
        return;
      }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  return false;
}

export async function* discoverGallery(
  spec: GallerySpec,
  options: ReferoDiscoveryOptions,
): AsyncGenerator<DiscoveryEvent> {
  if (!galleryListing(spec, options.seed.url))
    throw new Error(`Unsupported ${spec.id} collection URL`);
  const { browser, seed, settings, signal } = options;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  });
  const interventions: Intervention[] = [],
    warnings: string[] = [],
    errors: string[] = [];
  const collections = [canonicalUrl(seed.url)],
    queued = new Set(collections),
    seen = new Set<string>();
  const started = Date.now();
  let consumerMs = 0,
    allExplicit = true,
    page: Page | undefined,
    listing = seed.url;
  const abort = () => {
    void context.close().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  const cleanupSettings = options.cleanupSettings || parseConfig({ sources: [seed.url] }).capture;
  const remaining = () => settings.maxDurationMs - (Date.now() - started - consumerMs);
  const persist = (cards: ObservedCard[]): DiscoveredEntry[] => {
    const batch: DiscoveredEntry[] = [];
    const batchIdentities = new Set<string>();
    for (const card of cards) {
      const detailUrl = canonicalUrl(card.url);
      if (
        seen.has(detailUrl) ||
        batchIdentities.has(detailUrl) ||
        (settings.maxEntries && seen.size + batch.length >= settings.maxEntries)
      )
        continue;
      const originalUrl = card.originalUrl ? safeOriginal(spec, card.originalUrl) : undefined;
      batchIdentities.add(detailUrl);
      batch.push({
        id: idFor(detailUrl),
        seedUrl: seed.url,
        listingUrl: listing,
        detailUrl,
        title: card.title,
        discoveredAt: now(),
        originalUrl: originalUrl || card.originalUrl,
        previewUrl: card.previewUrl,
        sourceLabels: card.labels,
      });
    }
    try {
      options.onDiscovered?.(batch);
    } catch (error) {
      throw new GalleryPersistenceError(
        `Cannot persist ${spec.id} entries: ${errorMessage(error)}`,
      );
    }
    for (const entry of batch) seen.add(entry.detailUrl);
    return batch;
  };
  try {
    await guardNuisances(context, interventions);
    page = await context.newPage();
    await observeCards(page, spec);
    for (let index = 0; index < collections.length; index++) {
      listing = collections[index]!;
      options.onProgress?.(`Discover ${spec.id}: ${listing}`);
      const pending = new Set<Request>(),
        failures: string[] = [];
      const relevant = (request: Request) => isGalleryLoadingRequest(request, page!, spec);
      const requested = (r: Request) => {
        if (relevant(r)) pending.add(r);
      };
      const finished = (r: Request) => {
        pending.delete(r);
      };
      const failed = (r: Request) => {
        pending.delete(r);
        if (relevant(r)) failures.push(`Listing request failed: ${r.url()}`);
      };
      const responseFailed = (r: import('playwright').Response) => {
        if (relevant(r.request()) && r.status() >= 400)
          failures.push(`Listing HTTP ${r.status()}: ${r.url()}`);
      };
      page
        .on('request', requested)
        .on('requestfinished', finished)
        .on('requestfailed', failed)
        .on('response', responseFailed);
      try {
        signal?.throwIfAborted();
        const response = await page.goto(listing, {
          waitUntil: 'domcontentloaded',
          timeout: Math.max(1, Math.min(settings.navigationTimeoutMs, remaining())),
        });
        if (response && response.status() >= 400)
          throw new Error(`Listing HTTP ${response.status()}: ${listing}`);
        if (!galleryListing(spec, page.url()))
          throw new Error(`Unsupported ${spec.id} collection redirect: ${page.url()}`);
        let plateau = 0,
          previousHeight = -1,
          observed = false,
          ended = false;
        for (let step = 0; step < settings.maxScrollSteps; step++) {
          signal?.throwIfAborted();
          if (remaining() <= 0) throw new Error('Discovery duration limit reached');
          const cleanup = await sweepCleanup(
            page,
            {
              ...cleanupSettings,
              cleanupTimeoutMs: Math.min(
                cleanupSettings.cleanupTimeoutMs,
                settings.settleTimeoutMs,
                Math.max(1, remaining()),
              ),
            },
            interventions,
          );
          warnings.push(...cleanup.warnings);
          if (cleanup.unresolved.length)
            throw new Error(`Unresolved discovery obstruction: ${cleanup.unresolved.join('; ')}`);
          const settleStarted = Date.now();
          let previous = '',
            quietSince = Date.now(),
            settled: Awaited<ReturnType<typeof snapshot>> | undefined;
          while (Date.now() - settleStarted < Math.min(settings.settleTimeoutMs, remaining())) {
            signal?.throwIfAborted();
            if (failures.length) throw new Error(failures[0]);
            const current = await snapshot(page, spec);
            if (current.gate) throw new Error('Access gate prevents library discovery');
            const key = JSON.stringify([current.entries, current.height, current.loading]);
            if (key !== previous || current.loading || pending.size) quietSince = Date.now();
            previous = key;
            if (
              !current.loading &&
              !pending.size &&
              Date.now() - quietSince >= Math.min(500, settings.settleTimeoutMs / 3)
            ) {
              settled = current;
              break;
            }
            await delay(Math.min(100, Math.max(1, remaining())), signal);
          }
          if (!settled)
            throw new Error(
              `Listing did not settle before its timeout${
                pending.size
                  ? `; pending content: ${[...pending]
                      .map((request) => request.url())
                      .slice(0, 5)
                      .join(', ')}`
                  : ''
              }`,
            );
          const batch = persist(settled.entries);
          observed ||= Boolean(settled.entries.length);
          for (const entry of batch) {
            const before = Date.now();
            yield { type: 'entry', entry };
            consumerMs += Date.now() - before;
          }
          const expand = spec.expandFrom?.includes(
            new URL(seed.url).pathname.replace(/\/$/, '') || '/',
          );
          for (const url of [
            ...settled.next.filter((url) => withinPagination(spec, listing, url)),
            ...(expand ? settled.collections : []),
          ]) {
            if (!galleryListing(spec, url)) continue;
            const candidate = canonicalUrl(url);
            if (!queued.has(candidate)) {
              queued.add(candidate);
              collections.push(candidate);
            }
          }
          if (settings.maxEntries && seen.size >= settings.maxEntries)
            throw new Error('Discovery entry limit reached without verified exhaustion');
          if (settled.explicit) {
            ended = true;
            break;
          }
          plateau =
            settled.bottom && !batch.length && settled.height === previousHeight ? plateau + 1 : 0;
          previousHeight = settled.height;
          if (plateau >= Math.max(3, settings.plateauChecks)) {
            allExplicit = false;
            ended = true;
            break;
          }
          await advance(page);
          await delay(settings.minDelayMs, signal);
        }
        if (!observed) {
          const last = await snapshot(page, spec);
          const resourceIndex =
            spec.indexPaths?.includes(new URL(listing).pathname.replace(/\/$/, '') || '/') &&
            last.collections.some((url) => galleryListing(spec, url));
          if (!last.explicit && !resourceIndex)
            throw new Error(`Unsupported ${spec.id} structure: no reference identities found`);
        }
        if (!ended) throw new Error('Discovery scroll-step limit reached');
      } catch (error) {
        if (signal?.aborted || error instanceof GalleryPersistenceError) throw error;
        if (page && galleryListing(spec, page.url()))
          for (const entry of persist(
            (await snapshot(page, spec).catch(() => undefined))?.entries || [],
          )) {
            const before = Date.now();
            yield { type: 'entry', entry };
            consumerMs += Date.now() - before;
          }
        errors.push(`${listing}: ${errorMessage(error)}`);
        if (/duration limit|entry limit|scroll-step limit/.test(errorMessage(error))) break;
      } finally {
        page
          .off('request', requested)
          .off('requestfinished', finished)
          .off('requestfailed', failed)
          .off('response', responseFailed);
      }
    }
    yield {
      type: 'end',
      reason: errors.length ? 'incomplete' : allExplicit ? 'explicit_end' : 'observed_plateau',
      error: errors.length ? errors.join('; ') : undefined,
      collections,
      discovered: seen.size,
      interventions,
      warnings: [...new Set(warnings)],
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    await context.close().catch(() => undefined);
  }
}

export async function resolveGallery(
  spec: GallerySpec,
  options: Parameters<typeof resolveReferoEntry>[0] & { entry?: DiscoveredEntry },
): ReturnType<typeof resolveReferoEntry> {
  const { browser, entryUrl, settings, signal, entry } = options;
  if (
    entry?.originalUrl &&
    entry.detailUrl === entryUrl &&
    galleryListing(spec, entry.listingUrl) &&
    galleryHost(spec, entryUrl)
  ) {
    const originalUrl = safeOriginal(spec, entry.originalUrl);
    if (!originalUrl) throw new Error('Unsafe original-source link in library entry');
    return {
      originalUrl,
      title: entry.title,
      sourceLabels: entry.sourceLabels || [],
      previewUrl: entry.previewUrl,
      metadata: {
        adapter: spec.id,
        detailUrl: entryUrl,
        resolutionMethod: 'explicit-listing-source',
      },
    };
  }
  if (!galleryHost(spec, entryUrl) || !new RegExp(spec.details).test(new URL(entryUrl).pathname))
    throw new Error(`Unsupported ${spec.id} detail URL`);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  });
  const interventions: Intervention[] = [],
    followed = new Set<string>();
  const abort = () => {
    void context.close().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await guardNuisances(context, interventions);
    const page = await context.newPage();
    let requested = entryUrl;
    for (let depth = 0; depth < 3; depth++) {
      if (followed.has(requested)) throw new Error('Original-source resolution loop');
      followed.add(requested);
      signal?.throwIfAborted();
      const response = await page.goto(requested, {
        waitUntil: 'domcontentloaded',
        timeout: settings.navigationTimeoutMs,
      });
      if (response && response.status() >= 400)
        throw new Error(`Detail HTTP ${response.status()}: ${requested}`);
      const intermediate = spec.intermediates?.find(
        (step) =>
          step.hosts.includes(new URL(page.url()).hostname.replace(/^www\./, '')) &&
          new RegExp(step.paths).test(new URL(page.url()).pathname),
      );
      if (
        !intermediate &&
        (!galleryHost(spec, page.url()) ||
          !new RegExp(`(?:${spec.details})|(?:${spec.relatedDetails || '(?!)'})`).test(
            new URL(page.url()).pathname,
          ))
      )
        throw new Error(`Unsupported ${spec.id} detail redirect: ${page.url()}`);
      const cleanup = await sweepCleanup(
        page,
        {
          ...(options.cleanupSettings || parseConfig({ sources: [entryUrl] }).capture),
          cleanupTimeoutMs: settings.settleTimeoutMs,
        },
        interventions,
      );
      if (cleanup.unresolved.length)
        throw new Error(`Unresolved reference obstruction: ${cleanup.unresolved.join('; ')}`);
      const started = Date.now();
      let prior = '',
        original: string | undefined,
        title = '',
        labels: string[] = [],
        previewUrl: string | undefined,
        related: string | undefined;
      while (Date.now() - started < settings.settleTimeoutMs) {
        signal?.throwIfAborted();
        const evidence = await page.evaluate(
          ({ spec, adContainers }) => {
            const h1 = document.querySelector('h1'),
              h2 = [...document.querySelectorAll('h2')].find(
                (e) => h1 && h1.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING,
              );
            const title = (h1?.textContent || document.title).trim();
            return {
              title,
              links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
                .filter((a) => !a.closest(`nav,footer,${adContainers}`))
                .map((a) => ({
                  url: a.href,
                  text: (
                    a.getAttribute('aria-label') ||
                    a.textContent?.trim() ||
                    a.getAttribute('title') ||
                    a.querySelector('img')?.alt ||
                    ''
                  ).trim(),
                  primary: !!spec.originalSelector && a.matches(spec.originalSelector),
                  related:
                    (!spec.relatedSelector || a.matches(spec.relatedSelector)) &&
                    (!spec.relatedText ||
                      new RegExp(spec.relatedText, 'i').test(
                        (a.getAttribute('aria-label') || a.textContent || '').trim(),
                      )),
                  intermediary:
                    spec.intermediates?.some(
                      (step) =>
                        a.matches(step.selector) &&
                        step.hosts.includes(new URL(a.href).hostname.replace(/^www\./, '')) &&
                        new RegExp(step.paths).test(new URL(a.href).pathname),
                    ) || false,
                  inTitle: !!h1 && h1.contains(a),
                  nearTitle:
                    !!h1 &&
                    (h1.contains(a) ||
                      !h2 ||
                      !!(a.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING)),
                })),
              labels: [...document.querySelectorAll('[data-source-label],.tag,.tag-label')]
                .filter((e) => !e.closest('header,nav,footer'))
                .map((e) => e.textContent?.trim() || '')
                .filter(Boolean),
              preview: [...document.images].find(
                (i) => !i.closest('header,nav,footer') && i.naturalWidth >= 300,
              )?.currentSrc,
            };
          },
          { spec, adContainers: AD_CONTAINERS },
        );
        const candidates: Array<{ url: string; score: number }> = [];
        for (const link of evidence.links) {
          const url = safeOriginal(spec, link.url);
          if (!url) continue;
          const text = link.text
            .replace(/\s+/g, ' ')
            .replace(/[↗→]+$/, '')
            .trim();
          const explicit =
            /^(?:(?:visit|view|open|launch)(?: (?:the|original))?(?: (?:live|original|source))?(?: (?:site|website|page|error page))?|(?:live (?:site|website)|go to source|app store|show preview|live preview|preview template))$/i.test(
              text,
            );
          const domainText = text
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/$/, '');
          const domain = new URL(url).hostname.replace(/^www\./, '');
          const displayedUrl = domainText === domain || domainText.startsWith(`${domain}/`);
          const named = text.toLowerCase() === evidence.title.toLowerCase() && link.inTitle;
          if (link.intermediary) {
            related = link.url;
            continue;
          }
          if (intermediate && !/^(?:show preview|live preview|preview template)$/i.test(text))
            continue;
          if (
            !explicit &&
            !(displayedUrl && (link.nearTitle || spec.allowDisplayedUrl)) &&
            !named &&
            !link.primary
          )
            continue;
          candidates.push({
            url,
            score:
              (link.primary ? 200 : 0) +
              (link.nearTitle ? 20 : 0) +
              (explicit ? 100 : displayedUrl ? 40 : 5),
          });
        }
        if (candidates.length) {
          const highest = Math.max(...candidates.map((c) => c.score)),
            best = [...new Set(candidates.filter((c) => c.score === highest).map((c) => c.url))];
          if (best.length !== 1) throw new Error('Ambiguous original-source links');
          const key = JSON.stringify([best[0], evidence.title, evidence.labels]);
          if (key === prior) {
            original = best[0];
            title = evidence.title;
            labels = evidence.labels;
            previewUrl = evidence.preview;
            break;
          }
          prior = key;
        }
        if (spec.relatedDetails)
          related ||= evidence.links.find(
            (l) =>
              l.related &&
              !followed.has(l.url) &&
              galleryHost(spec, l.url) &&
              new RegExp(spec.relatedDetails!).test(new URL(l.url).pathname),
          )?.url;
        await delay(Math.min(100, settings.minDelayMs), signal);
      }
      if (original)
        return {
          originalUrl: original,
          title,
          sourceLabels: [...new Set([...(entry?.sourceLabels || []), ...labels])],
          previewUrl: previewUrl || entry?.previewUrl,
          metadata: {
            adapter: spec.id,
            detailUrl: page.url(),
            requestedDetailUrl: entryUrl,
            followed: [...followed],
            resolutionMethod: 'explicit-original-link',
            interventions,
          },
        };
      if (!related) throw new Error('Missing original-source link after detail hydration');
      requested = related;
    }
    throw new Error('Missing original-source link within the resolution depth limit');
  } finally {
    signal?.removeEventListener('abort', abort);
    await context.close().catch(() => undefined);
  }
}
