import type { Browser, BrowserContext, Page, Request } from 'playwright';
import type { DiscoveredEntry, DiscoveryEvent, DiscoveryOptions, DiscoverySettings, ResolvedReference } from './types.ts';
import { guardNuisances } from './nuisance.ts';
import { sweepCleanup } from './cleanup.ts';
import { parseConfig } from './config.ts';
import type { Intervention } from './types.ts';

export type ReferoDiscoveryOptions = DiscoveryOptions & {
  /** Persist the entire newly observed batch synchronously, before any entry is yielded. */
  onDiscovered?: (entries: DiscoveredEntry[]) => void;
};

class DiscoveryBatchError extends Error {}

const HOST = 'styles.refero.design';
const EXPLICIT_END = /^(?:you(?:'|’)ve reached the end[.!]?|no more (?:designs|styles|results)[.!]?|all (?:designs|styles) loaded[.!]?|end of results[.!]?|no (?:designs|styles|results) found[.!]?)$/i;
const SOCIAL_HOSTS = new Set(['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'youtu.be']);

function httpUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Deliberately bounded: Refero's public Styles collections, not every Refero route. */
export function isReferoLibrary(value: string): boolean {
  const safe = httpUrl(value);
  if (!safe) return false;
  const url = new URL(safe);
  if (url.hostname !== HOST) return false;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return path === '/' || /^\/design-styles\/[^/]+$/.test(path)
    || path === '/ai-agents/design-resources' || path === '/design-md-examples';
}

function abortError(): Error { return new DOMException('Discovery aborted', 'AbortError'); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }

function bindAbort(context: BrowserContext, signal?: AbortSignal): () => void {
  const abort = () => { void context.close().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return () => signal?.removeEventListener('abort', abort);
}

type ListingSnapshot = {
  entries: Array<{ detailUrl: string; title: string }>;
  collections: string[];
  height: number;
  scrollTop: number;
  clientHeight: number;
  loading: boolean;
  explicitEnd: boolean;
};

async function listingSnapshot(page: Page): Promise<ListingSnapshot> {
  return page.evaluate((endPattern) => {
    const dom = { visible(element: Element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    } };
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')];
    const cards = anchors.filter(anchor => {
      try { const url = new URL(anchor.href); return url.hostname === location.hostname && /^\/style\/[^/]+\/?$/.test(url.pathname); }
      catch { return false; }
    });
    const entries = cards.map(anchor => ({
      detailUrl: anchor.href,
      title: (anchor.querySelector('h1,h2,h3,[data-title]')?.textContent
        || anchor.querySelector('img')?.getAttribute('alt')?.replace(/^screenshot of\s+/i, '')
        || anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
    const collections = anchors.filter(anchor => dom.visible(anchor)).map(anchor => anchor.href);
    let scroller: Element = document.scrollingElement || document.documentElement;
    for (let ancestor = cards[0]?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 2) {
        scroller = ancestor;
        break;
      }
    }
    const end = new RegExp(endPattern, 'i');
    const explicitEnd = [...document.querySelectorAll('[data-end-of-list],[data-has-more="false"],p,[role="status"]')]
      .some(element => dom.visible(element) && (element.hasAttribute('data-end-of-list')
        || element.getAttribute('data-has-more') === 'false' || end.test((element.textContent || '').trim())));
    return {
      entries, collections, height: scroller.scrollHeight, scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      loading: [...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-loading="true"]')].some(element => dom.visible(element)),
      explicitEnd,
    };
  }, EXPLICIT_END.source);
}

function snapshotKey(snapshot: ListingSnapshot): string {
  return JSON.stringify([snapshot.entries.map(entry => entry.detailUrl).sort(), snapshot.height, snapshot.loading]);
}

async function settleListing(
  page: Page, settings: DiscoverySettings, pending: Set<Request>, failures: string[],
  timeoutMs: number, signal?: AbortSignal,
): Promise<ListingSnapshot> {
  const started = Date.now();
  let previous = '';
  let stable = 0;
  while (Date.now() - started < timeoutMs) {
    checkAbort(signal);
    if (failures.length) throw new Error(failures[0]);
    const snapshot = await listingSnapshot(page);
    const key = snapshotKey(snapshot);
    stable = key === previous && !snapshot.loading && pending.size === 0 ? stable + 1 : 0;
    previous = key;
    if (stable >= 2) return snapshot;
    await page.waitForTimeout(Math.max(50, settings.minDelayMs));
  }
  throw new Error('Listing did not settle before its timeout');
}

async function advanceListing(page: Page): Promise<void> {
  const next = page.locator('button, [role="button"], a[rel="next"]');
  for (let index = 0, length = await next.count(); index < length; index++) {
    const control = next.nth(index);
    if (!await control.isVisible()) continue;
    const label = (await control.getAttribute('aria-label') || await control.innerText()).trim();
    const rel = await control.getAttribute('rel');
    if (rel !== 'next' && !/^(?:load more|show more|more (?:designs|styles)|next(?: page)?)$/i.test(label)) continue;
    if (!await control.isEnabled() || await control.getAttribute('aria-disabled') === 'true') continue;
    const href = await control.getAttribute('href');
    if (href && !isReferoLibrary(new URL(href, page.url()).href)) continue;
    await control.click();
    return;
  }
  await page.evaluate(() => {
    const firstCard = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(anchor => /\/style\/[^/]+\/?$/.test(new URL(anchor.href).pathname));
    for (let ancestor = firstCard?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 2) {
        ancestor.scrollTo({ top: ancestor.scrollHeight, behavior: 'instant' });
        return;
      }
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
}

/** Yields each discovered identity once. Consumer capture time is excluded from the discovery budget. */
export async function* discoverRefero(options: ReferoDiscoveryOptions): AsyncGenerator<DiscoveryEvent> {
  const { browser, seed, settings, signal } = options;
  if (!isReferoLibrary(seed.url)) throw new Error(`Unsupported Refero library URL: ${seed.url}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const unbind = bindAbort(context, signal);
  const collections = [new URL(seed.url).href];
  const queued = new Set(collections);
  const seen = new Set<string>();
  const seedPath = new URL(seed.url).pathname.replace(/\/+$/, '') || '/';
  const expandCollections = seedPath === '/' || seedPath === '/ai-agents/design-resources' || seedPath === '/design-md-examples';
  const collectionErrors: string[] = [];
  let activeMs = 0;
  let activeStarted = Date.now();
  let allExplicit = true;
  let steps = 0;
  let lastListing = seed.url;
  const interventions:Intervention[]=[];
  const remaining = () => settings.maxDurationMs - activeMs - (Date.now() - activeStarted);
  const budget = (configured: number) => {
    checkAbort(signal);
    if (remaining() <= 0) throw new Error('Discovery duration limit reached');
    return Math.max(1, Math.min(configured, remaining()));
  };
  try {
    await guardNuisances(context,interventions);
    const page = await context.newPage();
    page.setDefaultTimeout(settings.settleTimeoutMs);
    for (let collectionIndex = 0; collectionIndex < collections.length; collectionIndex++) {
      const listingUrl = collections[collectionIndex];
      lastListing = listingUrl;
      options.onProgress?.(`Discovering Refero collection: ${listingUrl}`);
      const pending = new Set<Request>();
      const failures: string[] = [];
      const relevant = (request: Request) => {
        try {
          const url = new URL(request.url());
          if (!['fetch', 'xhr'].includes(request.resourceType()) || url.hostname !== HOST) return false;
          // Next.js prefetches detail routes as their cards enter the viewport. Their
          // cancellation says nothing about whether listing pagination succeeded.
          if (/^\/style\/[^/]+\/?$/.test(url.pathname)) return false;
          const headers = request.headers();
          if (/prefetch/i.test(headers.purpose ?? '') || /prefetch/i.test(headers['sec-purpose'] ?? '')
            || headers['next-router-prefetch'] !== undefined || headers['next-router-segment-prefetch'] !== undefined) return false;
          return true;
        }
        catch { return false; }
      };
      const onRequest = (request: Request) => { if (relevant(request)) pending.add(request); };
      const onFinished = (request: Request) => { pending.delete(request); };
      const onFailed = (request: Request) => {
        pending.delete(request);
        if (relevant(request)) failures.push(`Listing request failed: ${request.url()}`);
      };
      const onResponse = (response: import('playwright').Response) => {
        if (relevant(response.request()) && response.status() >= 400) failures.push(`Listing request returned HTTP ${response.status()}: ${response.url()}`);
      };
      page.on('request', onRequest).on('requestfinished', onFinished).on('requestfailed', onFailed).on('response', onResponse);
      try {
        const response = await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: budget(settings.navigationTimeoutMs) });
        if (response && response.status() >= 400) throw new Error(`Listing returned HTTP ${response.status()}`);
        if (!isReferoLibrary(page.url())) throw new Error(`Listing redirected outside its supported scope: ${page.url()}`);
        const resourceIndex = /\/(?:ai-agents\/design-resources|design-md-examples)\/?$/.test(new URL(listingUrl).pathname);
        await page.waitForFunction(({ endPattern, resourceIndex }) => {
          if ([...document.querySelectorAll<HTMLAnchorElement>('a[href]')].some(anchor => /\/style\/[^/]+\/?$/.test(new URL(anchor.href).pathname))) return true;
          if (resourceIndex && [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].some(anchor => /\/design-styles\/[^/]+\/?$/.test(new URL(anchor.href).pathname))) return true;
          return [...document.querySelectorAll('p,[role="status"],[data-end-of-list]')].some(element => element.hasAttribute('data-end-of-list') || new RegExp(endPattern, 'i').test((element.textContent || '').trim()));
        }, { endPattern: EXPLICIT_END.source, resourceIndex }, { timeout: budget(settings.settleTimeoutMs) });
        let plateau = 0;
        let previousHeight = -1;
        while (true) {
          const cleaned=await sweepCleanup(page,{...(options.cleanupSettings??parseConfig({sources:[seed.url]}).capture),cleanupTimeoutMs:budget(settings.settleTimeoutMs)},interventions);
          if(cleaned.unresolved.length)throw new Error(`Unresolved discovery obstruction: ${cleaned.unresolved.join('; ')}`);
          const snapshot = await settleListing(page, settings, pending, failures, budget(settings.settleTimeoutMs), signal);
          const batch: DiscoveredEntry[] = [];
          const batchIdentities = new Set<string>();
          const available = settings.maxEntries === undefined ? Infinity : Math.max(0, settings.maxEntries - seen.size);
          const discoveredAt = new Date().toISOString();
          let truncated = false;
          for (const raw of snapshot.entries) {
            const parsed = new URL(raw.detailUrl);
            parsed.search = '';
            parsed.hash = '';
            parsed.pathname = parsed.pathname.replace(/\/+$/, '');
            const detailUrl = parsed.href;
            if (seen.has(detailUrl) || batchIdentities.has(detailUrl)) continue;
            if (batch.length >= available) { truncated = true; break; }
            batchIdentities.add(detailUrl);
            batch.push({
              id: parsed.pathname.split('/').pop()!, seedUrl: seed.url, listingUrl,
              detailUrl, title: raw.title, discoveredAt,
            });
          }
          if (expandCollections) {
            for (const value of snapshot.collections) {
              if (!isReferoLibrary(value)) continue;
              const parsed = new URL(value);
              parsed.search = '';
              parsed.hash = '';
              parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
              if (!queued.has(parsed.href)) { queued.add(parsed.href); collections.push(parsed.href); }
            }
          }
          if (batch.length) {
            try { options.onDiscovered?.(batch); }
            catch (error) {
              throw new DiscoveryBatchError(`Could not persist discovered entries: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
            for (const entry of batch) seen.add(entry.detailUrl);
            for (const entry of batch) {
              checkAbort(signal);
              activeMs += Date.now() - activeStarted;
              yield { type: 'entry', entry };
              activeStarted = Date.now();
            }
          }
          if (truncated) throw new Error('Discovery entry limit reached');
          if (snapshot.explicitEnd) break;
          const atBottom = snapshot.scrollTop + snapshot.clientHeight >= snapshot.height - 4;
          plateau = batch.length === 0 && atBottom && snapshot.height === previousHeight ? plateau + 1 : 0;
          previousHeight = snapshot.height;
          if (plateau >= Math.max(3, settings.plateauChecks)) { allExplicit = false; break; }
          if (settings.maxEntries !== undefined && seen.size >= settings.maxEntries) throw new Error('Discovery entry limit reached without a verified end');
          if (steps >= settings.maxScrollSteps) throw new Error('Discovery scroll-step limit reached');
          steps++;
          budget(settings.settleTimeoutMs);
          await advanceListing(page);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (signal?.aborted || error instanceof DiscoveryBatchError || /limit reached/.test(message)) throw error;
        collectionErrors.push(`${listingUrl}: ${message}`);
      } finally {
        page.off('request', onRequest).off('requestfinished', onFinished).off('requestfailed', onFailed).off('response', onResponse);
      }
    }
    yield { type: 'end', reason: collectionErrors.length ? 'incomplete' : allExplicit ? 'explicit_end' : 'observed_plateau',
      ...(collectionErrors.length ? { error: collectionErrors.join('; ') } : {}), collections, discovered: seen.size, interventions };
  } catch (error) {
    yield { type: 'end', reason: 'incomplete', error: `${lastListing}: ${signal?.aborted ? 'Discovery aborted' : error instanceof Error ? error.message : String(error)}`, collections, discovered: seen.size };
  } finally {
    unbind();
    await context.close().catch(() => undefined);
  }
}

type DetailSnapshot = {
  title: string;
  labels: string[];
  images: Array<{ src: string; alt: string; area: number }>;
  links: Array<{ href: string; text: string; label: string; inMetadata: boolean }>;
};

async function detailSnapshot(page: Page): Promise<DetailSnapshot> {
  return page.evaluate(() => {
    const dom = { visible(element: Element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    } };
    const h1 = [...document.querySelectorAll('h1')].find(element => dom.visible(element));
    const firstSection = [...document.querySelectorAll('h2')].find(element => h1 && Boolean(h1.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter(anchor => dom.visible(anchor) && !anchor.closest('header,nav,footer'))
      .map(anchor => ({
        href: anchor.href, text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        label: anchor.getAttribute('aria-label') || '',
        inMetadata: Boolean(h1 && h1.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (!firstSection || Boolean(anchor.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING)),
      }));
    const labels = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/design-styles/"],[data-style-tag]')]
      .filter(element => dom.visible(element) && !element.closest('header,nav,footer'))
      .map(element => (element.textContent || '').replace(/\s+/g, ' ').trim()).filter(label => label && label.length < 100);
    const images = [...document.images].filter(image => dom.visible(image)).map(image => ({
      src: image.currentSrc || image.src, alt: image.alt,
      area: image.naturalWidth * image.naturalHeight || image.width * image.height,
    }));
    return { title: (h1?.textContent || '').replace(/\s+/g, ' ').trim(), labels, links, images };
  });
}

function chooseOriginal(snapshot: DetailSnapshot): { url: string; method: string; text: string } | undefined {
  const candidates: Array<{ url: string; method: string; text: string; score: number }> = [];
  for (const link of snapshot.links) {
    const safe = httpUrl(link.href);
    if (!safe) continue;
    const host = new URL(safe).hostname.replace(/^www\./, '');
    if (host === 'refero.design' || host.endsWith('.refero.design') || SOCIAL_HOSTS.has(host)) continue;
    let explicitUrl = false;
    const text = link.text.trim();
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) {
      const displayed = httpUrl(text.startsWith('www.') ? `https://${text}` : text);
      explicitUrl = displayed !== undefined && new URL(displayed).hostname.replace(/^www\./, '') === host;
    }
    const visit = /^(?:(?:visit|view|open|go to)\s+(?:the\s+)?(?:original\s+|live\s+)?(?:site|website)|visit original|original (?:site|website))\s*[↗→]?$/i.test(link.label || text);
    if (!explicitUrl && !visit) continue;
    candidates.push({ url: safe, method: explicitUrl ? 'explicit-url' : 'explicit-visit-link', text: link.label || text, score: (link.inMetadata ? 10 : 0) + (explicitUrl ? 2 : 1) });
  }
  if (!candidates.length) return undefined;
  const highest = Math.max(...candidates.map(candidate => candidate.score));
  const best = [...new Map(candidates.filter(candidate => candidate.score === highest).map(candidate => [candidate.url, candidate])).values()];
  if (best.length > 1) throw new Error('Reference contains multiple equally plausible original-source links');
  return best[0];
}

export async function resolveReferoEntry(options: {
  browser: Browser; entryUrl: string; settings: DiscoverySettings; signal?: AbortSignal; cleanupSettings?: DiscoveryOptions['cleanupSettings'];
}): Promise<ResolvedReference> {
  const { browser, entryUrl, settings, signal } = options;
  const safe = httpUrl(entryUrl);
  if (!safe || new URL(safe).hostname !== HOST || !/^\/style\/[^/]+\/?$/.test(new URL(safe).pathname)) throw new Error(`Unsupported Refero detail URL: ${entryUrl}`);
  checkAbort(signal);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const unbind = bindAbort(context, signal);
  try {
    const interventions:Intervention[]=[];
    await guardNuisances(context,interventions);
    const page = await context.newPage();
    const response = await page.goto(safe, { waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs });
    if (response && response.status() >= 400) throw new Error(`Reference returned HTTP ${response.status()}`);
    if (new URL(page.url()).hostname !== HOST || !/^\/style\/[^/]+\/?$/.test(new URL(page.url()).pathname)) throw new Error('Reference redirected outside its supported detail scope');
    const started = Date.now();
    const cleaned=await sweepCleanup(page,{...(options.cleanupSettings??parseConfig({sources:[entryUrl]}).capture),cleanupTimeoutMs:settings.settleTimeoutMs},interventions);
    if(cleaned.unresolved.length)throw new Error(`Unresolved reference obstruction: ${cleaned.unresolved.join('; ')}`);
    let previous = '';
    while (Date.now() - started < settings.settleTimeoutMs) {
      checkAbort(signal);
      const snapshot = await detailSnapshot(page);
      const source = chooseOriginal(snapshot);
      if (snapshot.title && !/^(loading|please wait)[.…\s]*$/i.test(snapshot.title) && source) {
        const key = JSON.stringify([snapshot.title, source.url, snapshot.labels]);
        if (key === previous) {
          const preview = snapshot.images.filter(image => /^screenshot of\s+/i.test(image.alt)).sort((left, right) => right.area - left.area)[0];
          return {
            originalUrl: source.url, title: snapshot.title, sourceLabels: [...new Set(snapshot.labels)],
            previewUrl: preview ? httpUrl(preview.src, page.url()) : undefined,
            metadata: { provider: 'refero-styles', detailUrl: page.url(), requestedDetailUrl: entryUrl,
              resolvedAt: new Date().toISOString(), resolutionMethod: source.method, linkText: source.text, followed:[entryUrl], interventions },
          };
        }
        previous = key;
      } else { previous = ''; }
      await page.waitForTimeout(Math.max(50, settings.minDelayMs));
    }
    throw new Error('No settled, explicit original-source link was found on the reference detail');
  } finally {
    unbind();
    await context.close().catch(() => undefined);
  }
}
