import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Route } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPipeline } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import { loadConfig, parseConfig } from '../src/config.ts';
import { libraryAdapter } from '../src/adapters.ts';
import { discoverGallery, resolveGallery } from '../src/gallery.ts';
import { GALLERY_SPECS } from '../src/library-specs.ts';
import { guardNuisances } from '../src/nuisance.ts';
import { sweepCleanup } from '../src/cleanup.ts';
import type { DiscoveryEvent, Intervention, DiscoverySettings } from '../src/types.ts';

let browser: Browser;
before(async () => {
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    executablePath: process.env.FOLIO_TEST_BROWSER_PATH,
  });
});
after(async () => {
  await browser?.close();
});
const settings = {
  navigationTimeoutMs: 2000,
  settleTimeoutMs: 1000,
  plateauChecks: 3,
  maxScrollSteps: 20,
  maxDurationMs: 8000,
  minDelayMs: 20,
};
const html = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
const spec = (id = 'refs-gallery') => GALLERY_SPECS.find((s) => s.id === id)!;
function routed(handler: (route: Route) => Promise<void>): Browser {
  return new Proxy(browser, {
    get(target, key) {
      if (key === 'newContext')
        return async (options: Parameters<Browser['newContext']>[0]) => {
          const context = await target.newContext(options);
          await context.route('**/*', handler);
          return context;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
async function collect(
  body: string,
  options: {
    id?: string;
    seed?: string;
    settings?: Partial<DiscoverySettings>;
    handler?: (route: Route) => Promise<void>;
  } = {},
) {
  const result: DiscoveryEvent[] = [],
    persisted = new Set<string>();
  for await (const event of discoverGallery(spec(options.id), {
    browser: routed(
      options.handler ||
        (async (route) => {
          await route.fulfill({ contentType: 'text/html', body: html(body) });
        }),
    ),
    seed: { url: options.seed || 'https://refs.gallery/', kind: 'library' },
    settings: { ...settings, ...options.settings },
    onDiscovered(entries) {
      for (const entry of entries) persisted.add(entry.id);
    },
  })) {
    if (event.type === 'entry')
      assert.ok(persisted.has(event.entry.id), 'Entries must persist before consumer work');
    result.push(event);
  }
  return result;
}
const entries = (events: DiscoveryEvent[]) =>
  events.filter((e) => e.type === 'entry').map((e) => e.entry);
const ending = (events: DiscoveryEvent[]) => {
  const end = events.at(-1);
  assert.equal(end?.type, 'end');
  return end as Extract<DiscoveryEvent, { type: 'end' }>;
};

test('every default UI collection has a bounded adapter; documentation and unrelated routes do not', async () => {
  const config = await loadConfig();
  assert.equal(config.sources.length, 35);
  for (const source of config.sources) {
    assert.equal(source.kind, 'library');
    assert.ok(libraryAdapter(source.url), source.url);
  }
  for (const url of [
    'https://motion.dev/docs',
    'https://gsap.com/docs/v3/',
    'https://awwwards.com/academy/',
    'https://onepagelove.com/submit',
    'https://a1.gallery/fonts',
    'https://60fps.design/jobs',
  ])
    assert.equal(libraryAdapter(url), undefined, url);
});

test('replaced reference cards and duplicate tracking links retain all identities while ads stay excluded', async () => {
  const result = await collect(
    `<div id="cards"><a href="/projects/first">First</a><a href="/projects/first?utm_source=duplicate">First duplicate</a></div><article data-sponsored="true"><a href="/projects/sponsor">Sponsored</a></article><script>setTimeout(()=>document.querySelector('#cards').innerHTML='<a href="/projects/second">Second</a><p>No more results</p>',100);</script>`,
  );
  assert.deepEqual(
    entries(result)
      .map((e) => new URL(e.detailUrl).pathname)
      .sort(),
    ['/projects/first', '/projects/second'],
  );
  assert.equal(ending(result).reason, 'explicit_end');
});

test('an unsupported secondary collection cannot hide behind an earlier successful collection', async () => {
  const result = await collect('', {
    handler: async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        contentType: 'text/html',
        body: html(
          path === '/'
            ? '<a href="/projects/first">First</a><a href="/collections/unknown">Collection</a><p>No more results</p>'
            : '<main>Changed structure</main>',
        ),
      });
    },
  });
  assert.equal(entries(result).length, 1);
  assert.equal(ending(result).reason, 'incomplete');
  assert.match(ending(result).error || '', /Unsupported.*structure/);
});

test('selected collections follow their pagination but never sibling collections', async () => {
  const visited: string[] = [];
  const result = await collect('', {
    seed: 'https://refs.gallery/collections/minimal',
    handler: async (route) => {
      const url = new URL(route.request().url());
      visited.push(url.href);
      await route.fulfill({
        contentType: 'text/html',
        body: html(
          url.search
            ? '<a href="/projects/second">Second</a><p>No more results</p>'
            : '<a href="/projects/first">First</a><a rel="next" href="?page=2">Next</a><a rel="next" href="/collections/editorial">Another collection</a><p>No more results</p>',
        ),
      });
    },
  });
  assert.equal(entries(result).length, 2);
  assert.ok(visited.every((url) => url.includes('/collections/minimal')));
});

test('load-more controls survive unrelated newsletter forms and reveal the next reference batch', async () => {
  const result = await collect(
    `<a href="/projects/first">First</a><form><button type="button" onclick="throw Error('Do not click')">Show more</button></form><button id="more" onclick="this.outerHTML='<a href=&quot;/projects/second&quot;>Second</a><p>No more results</p>'">Load More</button>`,
  );
  assert.deepEqual(
    entries(result).map((e) => new URL(e.detailUrl).pathname),
    ['/projects/first', '/projects/second'],
  );
  assert.equal(ending(result).reason, 'explicit_end');
});

test('resource indexes traverse actual section collections before resolving their items', async () => {
  const result = await collect('', {
    id: 'one-page-love-sections',
    seed: 'https://onepagelove.com/sections',
    handler: async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        contentType: 'text/html',
        body: html(
          path === '/sections'
            ? '<a href="/section/testimonials">Testimonials</a><p>No more results</p>'
            : '<a class="opl-section-zoom" href="/section/testimonials/new-material/">New Material</a><p>No more sections</p>',
        ),
      });
    },
  });
  assert.equal(entries(result).length, 1);
  assert.equal(entries(result)[0].listingUrl, 'https://onepagelove.com/section/testimonials');
});

test('empty indexes, access gates, endless loading and failing data requests remain incomplete', async () => {
  for (const body of [
    '<h1>No recognizable cards</h1>',
    '<title>Just a moment</title><p>Verify you are human</p>',
    '<a href="/projects/first">First</a><div aria-busy="true" style="height:30px;width:30px">Loading</div>',
  ]) {
    const result = await collect(body, { settings: { settleTimeoutMs: 450 } });
    assert.equal(ending(result).reason, 'incomplete');
  }
  const result = await collect('', {
    handler: async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill(
        url.hostname === 'data.test'
          ? { status: 500, body: 'Failure' }
          : {
              contentType: 'text/html',
              body: html(
                '<a href="/projects/first">First</a><script>fetch("https://data.test/catalog").catch(()=>{})</script>',
              ),
            },
      );
    },
  });
  assert.equal(entries(result).length, 1);
  assert.equal(ending(result).reason, 'incomplete');
  assert.match(ending(result).error || '', /HTTP 500/);
  const emptyIndex = await collect('<h1>Changed index</h1>', {
    id: 'one-page-love-sections',
    seed: 'https://onepagelove.com/sections',
  });
  assert.equal(ending(emptyIndex).reason, 'incomplete');
});

test('a settled scroll plateau is distinct from an explicit end and entry limits', async () => {
  const result = await collect('<a href="/projects/first">First</a>');
  assert.equal(ending(result).reason, 'observed_plateau');
  const limited = await collect(
    '<a href="/projects/first">First</a><a href="/projects/second">Second</a><p>No more results</p>',
    { settings: { maxEntries: 1 } as Partial<DiscoverySettings> },
  );
  assert.equal(entries(limited).length, 1);
  assert.equal(ending(limited).reason, 'incomplete');
});

test('public routes for currently access-restricted providers preserve detail and original identities', async () => {
  for (const [id, seed, path] of [
    ['maxibestof', 'https://maxibestof.one/', '/websites/93426-clay'],
    ['lapa-websites', 'https://www.lapa.ninja/', '/post/clay'],
    ['lapa-elements', 'https://www.lapa.ninja/elements/', '/elements/oggy-story/'],
    ['saaspo-pages', 'https://saaspo.com/', '/pages/portal'],
    ['saaspo-sections', 'https://saaspo.com/sections', '/sections/portal-how-it-works-section'],
  ]) {
    const events = await collect(`<a href="${path}">Reference</a><p>No more results</p>`, {
      id,
      seed,
    });
    assert.equal(ending(events).reason, 'explicit_end', id);
    assert.equal(entries(events).length, 1, id);
    assert.equal(entries(events)[0].detailUrl, new URL(path, seed).href);
    const result = await resolveGallery(spec(id), {
      browser: routed(async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: html('<h1>Reference</h1><a href="https://original.test/">Visit website</a>'),
        }),
      ),
      entryUrl: entries(events)[0].detailUrl,
      settings,
    });
    assert.equal(result.originalUrl, 'https://original.test/', id);
  }
});

test('broad slug routes cannot hide same-origin data-loading failures', async () => {
  const result = await collect('', {
    id: 'minimal-gallery',
    seed: 'https://minimal.gallery/',
    handler: async (route) => {
      await route.fulfill(
        new URL(route.request().url()).pathname === '/catalog'
          ? { status: 500, body: 'Failure' }
          : {
              contentType: 'text/html',
              body: html(
                '<a aria-label="View details for Example" href="/example">Example</a><p>No more results</p><script>fetch("/catalog").catch(()=>{})</script>',
              ),
            },
      );
    },
  });
  assert.equal(entries(result).length, 1);
  assert.equal(ending(result).reason, 'incomplete');
  assert.match(ending(result).error || '', /HTTP 500/);
});

test('a secondary navigation link cannot erase an already observed matching reference card', async () => {
  const result = await collect(
    '<header><a class="WebsiteCard__imageWrapper" href="/website/13655-royal-sites-ireland">Royal Sites Ireland</a><a class="WebsiteCaption__title" href="/website/13655-royal-sites-ireland">Royal Sites Ireland</a></header><p>No more results</p>',
    { id: 'siteinspire', seed: 'https://www.siteinspire.com/' },
  );
  assert.equal(entries(result).length, 1);
  assert.equal(ending(result).reason, 'explicit_end');
});

test('persistence failures stop discovery before yielding and aborted work closes its browser context', async () => {
  const beforeCount = browser.contexts().length;
  const model = routed(async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: html('<a href="/projects/first">First</a><p>No more results</p>'),
    });
  });
  let yielded = 0;
  await assert.rejects(async () => {
    for await (const event of discoverGallery(spec(), {
      browser: model,
      seed: { url: 'https://refs.gallery/', kind: 'library' },
      settings,
      onDiscovered() {
        throw Error('Disk unavailable');
      },
    }))
      if (event.type === 'entry') yielded++;
  }, /Cannot persist/);
  assert.equal(yielded, 0);
  assert.equal(browser.contexts().length, beforeCount);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async () => {
    for await (const _event of discoverGallery(spec(), {
      browser: model,
      seed: { url: 'https://refs.gallery/', kind: 'library' },
      settings,
      signal: controller.signal,
    })) {
      /* Consume */
    }
  });
  assert.equal(browser.contexts().length, beforeCount);
});

test('multiple direct reference cards can share one destination without losing their source identities', async () => {
  const result = await collect(
    '<button><h2>Apple Mac</h2><a class="group/link" href="https://apple.com/">Go to source</a></button><button><h2>Apple iPad</h2><a class="group/link" href="https://apple.com/">Go to source</a></button><p>No more results</p>',
    { id: 'bento-grids', seed: 'https://bentogrids.com/' },
  );
  const found = entries(result);
  assert.equal(found.length, 2);
  assert.notEqual(found[0].id, found[1].id);
  for (const entry of found) {
    const resolved = await resolveGallery(spec('bento-grids'), {
      browser,
      entryUrl: entry.detailUrl,
      entry,
      settings,
    });
    assert.equal(resolved.originalUrl, 'https://apple.com/');
  }
});

test('original controls outrank creator links and unrelated recommended websites', async () => {
  const body =
    '<a title="Visit Tim Van Damme (Max Voltar) Website" href="https://timvandamme.com/?ref=onepagelove">Visit Website</a><h1>Tim Van Damme (Max Voltar)</h1><a href="https://maxvoltar.com/">maxvoltar.com</a><h2>More inspiration</h2><a href="https://other.test/">Launch website</a>';
  const resolved = await resolveGallery(spec('one-page-love'), {
    browser: routed(async (route) => {
      await route.fulfill({ contentType: 'text/html', body: html(body) });
    }),
    entryUrl: 'https://onepagelove.com/tim-van-damme-max-voltar',
    entry: {
      id: 'listing-reference',
      seedUrl: 'https://onepagelove.com/inspiration',
      listingUrl: 'https://onepagelove.com/inspiration',
      detailUrl: 'https://onepagelove.com/tim-van-damme-max-voltar',
      title: 'Tim Van Damme',
      discoveredAt: new Date().toISOString(),
      sourceLabels: ['Typography'],
      previewUrl: 'https://images.test/reference.png',
    },
    settings,
  });
  assert.equal(resolved.originalUrl, 'https://timvandamme.com/');
  assert.deepEqual(resolved.sourceLabels, ['Typography']);
  assert.equal(resolved.previewUrl, 'https://images.test/reference.png');
  const footer = await resolveGallery(spec('footer-design'), {
    browser: routed(async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: html(
          '<h1>Trove</h1><a class="button secondary" href="https://trove.quest/">View Website</a><a href="https://related.test/">Visit Website</a>',
        ),
      });
    }),
    entryUrl: 'https://footer.design/sites/trove',
    settings,
  });
  assert.equal(footer.originalUrl, 'https://trove.quest/');
});

test('section, app and template references follow explicit parent or preview links, preserving every hop', async () => {
  const cases = [
    {
      id: 'one-page-love-sections',
      start: 'https://onepagelove.com/section/social-proof/new-material/',
      middle: 'https://onepagelove.com/new-material',
      original: 'https://newmaterial.test/',
      first:
        '<a href="/authors/creator">Creator</a><a href="/new-material" target="_blank">View full page →</a>',
      second:
        '<h1>New Material</h1><a title="Visit New Material Website" href="https://newmaterial.test/">Visit Website</a>',
    },
    {
      id: 'design-spells',
      start: 'https://designspells.com/spells/example',
      middle: 'https://designspells.com/apps/spotify',
      original: 'https://spotify.test/',
      first: '<h1>Spotify interaction</h1><a href="/apps/spotify">Spotify</a>',
      second:
        '<h1><a target="_blank" href="https://spotify.test/">Spotify</a> spells</h1><a href="/apps/spotify">Spotify</a>',
    },
    {
      id: 'a1-websites',
      start: 'https://a1.gallery/website/meeko',
      middle: 'https://www.framer.com/marketplace/templates/meeko/',
      original: 'https://meeko.framer.website/',
      first:
        '<h1>Meeko</h1><a class="button" href="https://www.framer.com/marketplace/templates/meeko/">Use for free</a>',
      second:
        '<h1>Meeko</h1><a href="https://meeko.framer.website/">Show Preview</a><a href="https://framer.link/copy">Remix for Free</a>',
    },
  ];
  for (const example of cases) {
    const visited: string[] = [];
    const resolved = await resolveGallery(spec(example.id), {
      browser: routed(async (route) => {
        visited.push(route.request().url());
        await route.fulfill({
          contentType: 'text/html',
          body: html(route.request().url() === example.start ? example.first : example.second),
        });
      }),
      entryUrl: example.start,
      settings: { ...settings, settleTimeoutMs: 400 },
    }).catch((error) => {
      throw new Error(`${example.id}: ${visited.join(' → ')}: ${error.message}`, { cause: error });
    });
    assert.equal(resolved.originalUrl, example.original);
    assert.deepEqual(visited, [example.start, example.middle]);
    assert.deepEqual(resolved.metadata.followed, visited);
  }
});

test('analytics and anonymous membership checks do not mask real data-loading failures', async () => {
  for (const [seed, id, url] of [
    ['https://refs.gallery/', 'refs-gallery', 'https://www.google-analytics.com/g/collect'],
    ['https://landing.love/', 'landing-love', 'https://landing.love/api/membership/me/'],
    [
      'https://recent.design/app-store-screenshots',
      'recent-app-screenshots',
      'https://api.recent.design/admin/presence',
    ],
    ['https://refs.gallery/', 'refs-gallery', 'https://panorama.wixapps.net/api/v1/bulklog'],
    ['https://refs.gallery/', 'refs-gallery', 'https://frog.wix.com/bpm'],
    [
      'https://recent.design/app-store-screenshots',
      'recent-app-screenshots',
      'https://api.recent.design/e',
    ],
    [
      'https://www.unsection.com/',
      'unsection',
      'https://www.supafeedback.com/api/announcement-impressions',
    ],
    [
      'https://www.unsection.com/',
      'unsection',
      'https://www.supafeedback.com/api/widget/73x6840flm/changelog-signal',
    ],
  ]) {
    const result = await collect('', {
      seed,
      id,
      handler: async (route) => {
        await route.fulfill(
          route.request().url() === url
            ? { status: 401, body: 'No session' }
            : {
                contentType: 'text/html',
                body: html(
                  `<a href="${id === 'refs-gallery' ? '/projects/first' : id === 'recent-app-screenshots' ? '/i/first' : id === 'unsection' ? '/section/first' : '/sites/first'}">First</a><p>No more results</p><script>fetch('${url}',{method:'${url.endsWith('/e') ? 'POST' : 'GET'}'}).catch(()=>{})</script>`,
                ),
              },
        );
      },
    });
    assert.equal(ending(result).reason, 'explicit_end');
    assert.equal(entries(result).length, 1);
  }
});

test('optional iframe failures and detail prefetches do not prevent listing exhaustion', async () => {
  const result = await collect('', {
    handler: async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill(
        path === '/projects/prefetched' || path === '/widget-data'
          ? { status: 500, body: 'Unavailable' }
          : {
              contentType: 'text/html',
              body: html(
                path === '/widget'
                  ? '<script>fetch("/widget-data").catch(()=>{})</script>'
                  : '<a href="/projects/first">First</a><p>No more results</p><iframe src="/widget"></iframe><script>fetch("/projects/prefetched?_rsc=test").catch(()=>{})</script>',
              ),
            },
      );
    },
  });
  assert.equal(ending(result).reason, 'explicit_end');
  assert.equal(entries(result).length, 1);
});

test('a document HEAD probe is optional while a failing document data fetch remains incomplete', async () => {
  for (const method of ['HEAD', 'GET']) {
    const result = await collect('', {
      handler: async (route) =>
        route.fulfill(
          route.request().resourceType() === 'fetch'
            ? { status: 503, body: 'Unavailable' }
            : {
                contentType: 'text/html',
                body: html(
                  `<a href="/projects/first">First</a><p>No more results</p><script>fetch(location.href,{method:'${method}'}).catch(()=>{})</script>`,
                ),
              },
        ),
    });
    assert.equal(ending(result).reason, method === 'HEAD' ? 'explicit_end' : 'incomplete');
  }
});

test('discovery-only queues recoverable captures without loading original websites or invoking a model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'folio-discovery-only-'));
  const visited: string[] = [];
  const model = routed(async (route) => {
    const url = route.request().url();
    visited.push(url);
    await route.fulfill({
      contentType: 'text/html',
      body: html(
        url.endsWith('/projects/first')
          ? '<h1>First</h1><a href="https://original.test/">Visit Website</a>'
          : '<a href="/projects/first">First</a><p>No more results</p>',
      ),
    });
  });
  const wrapper = new Proxy(model, {
    get(target, key) {
      if (key === 'close') return async () => {};
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    const config = parseConfig({
      output: root,
      sources: [{ url: 'https://refs.gallery/', kind: 'library' }],
      classifier: { runner: 'none' },
      discovery: settings,
    });
    const result = await runPipeline(config, {
      discoverOnly: true,
      launchBrowser: async () => wrapper,
      log: () => {},
    });
    assert.equal(result.captured, 0);
    assert.equal(result.queued, 2);
    assert.ok(visited.every((url) => !url.includes('original.test')));
    const store = new Store(root);
    try {
      assert.equal(store.jobs('capture', ['pending']).length, 2);
      assert.equal(store.jobs('resolve', ['complete']).length, 1);
      assert.equal(store.captures().length, 0);
    } finally {
      store.close();
    }
    await runPipeline(config, {
      discoverOnly: true,
      launchBrowser: async () => wrapper,
      log: () => {},
    });
    const recovered = new Store(root);
    try {
      assert.equal(recovered.jobs('capture', ['pending']).length, 2);
      assert.equal(recovered.jobs('resolve', ['complete']).length, 1);
    } finally {
      recovered.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('replacement ads stay suppressed while intentional sponsored mockups and product dialogs remain visible', async () => {
  const context = await browser.newContext();
  const log: Intervention[] = [];
  try {
    const page = await context.newPage();
    await page.setContent(
      html(
        '<div id="slot" data-ad-slot="banner" style="height:40px">Ad</div><section id="mock"><span>Sponsored by Design Kit</span><img width="20" height="20"><a href="https://company.test/">Company</a></section><dialog id="product" open>Product details</dialog>',
      ),
    );
    const capture = parseConfig({
      sources: ['https://page.test/'],
      capture: { preserveSelectors: ['#product'] },
    }).capture;
    await sweepCleanup(page, capture, log);
    await page.evaluate(() => {
      const node = document.createElement('div');
      node.setAttribute('data-ad-slot', 'banner');
      node.style.height = '40px';
      node.textContent = 'Recurrent ad';
      document.body.append(node);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-ad-slot]').nth(1).isVisible(), false);
    assert.equal(await page.locator('#mock').isVisible(), true);
    assert.equal(await page.locator('#product').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('recurrent wrappers cannot hide protected descendants inside open shadow roots', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html('<div data-ad-slot="banner" style="height:40px">Ad</div>'));
    const settings = parseConfig({
      sources: ['https://page.test/'],
      capture: { preserveSelectors: ['#protected'] },
    }).capture;
    await sweepCleanup(page, settings, []);
    await page.evaluate(() => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-ad-slot', 'banner');
      wrapper.attachShadow({ mode: 'open' }).innerHTML =
        '<section id="protected" style="height:40px">Preserved design</section>';
      document.body.append(wrapper);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#protected').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('known ad-service frames disappear without hiding ordinary embedded product media', async () => {
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.fulfill({ body: 'Frame', contentType: 'text/html' }),
  );
  const log: Intervention[] = [];
  await guardNuisances(context, log);
  try {
    const page = await context.newPage();
    await page.setContent(
      html(
        '<iframe id="ad-frame" src="https://ad.doubleclick.net/banner"></iframe><iframe id="product-frame" src="https://product.test/media"></iframe>',
      ),
    );
    await sweepCleanup(page, parseConfig({ sources: ['https://page.test/'] }).capture, log);
    assert.equal(await page.locator('#ad-frame').isVisible(), false);
    assert.equal(await page.locator('#product-frame').isVisible(), true);
    assert.ok(log.some((item) => item.action === 'block-ad-request'));
  } finally {
    await context.close();
  }
});

test('domain links hydrate correctly while unsafe, concept, ambiguous and unrelated redirects fail', async () => {
  const adapter = libraryAdapter('https://recent.design/websites')!;
  const resolved = await adapter.resolve({
    browser: routed(async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: html(
          '<h1>Example</h1><div id="source"></div><script>setTimeout(()=>document.querySelector("#source").innerHTML=\'<a href="https://original.test/pricing?lang=en&utm_source=recent">original.test</a>\',100)</script>',
        ),
      });
    }),
    entryUrl: 'https://recent.design/i/example',
    settings,
  });
  assert.equal(resolved.originalUrl, 'https://original.test/pricing?lang=en');
  const marketing = await resolveGallery(spec(), {
    browser: routed(async (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: html('<h1>Figma</h1><a href="https://www.figma.com/">Visit website</a>'),
      }),
    ),
    entryUrl: 'https://refs.gallery/projects/figma',
    settings,
  });
  assert.equal(marketing.originalUrl, 'https://www.figma.com/');
  for (const body of [
    '<a href="javascript:alert(1)">Visit website</a>',
    '<a href="https://dribbble.com/concept">Visit website</a>',
    '<a href="https://www.figma.com/design/example">Visit website</a>',
    '<a href="https://a.test/">Visit website</a><a href="https://b.test/">Visit website</a>',
  ])
    await assert.rejects(
      resolveGallery(spec(), {
        browser: routed(async (route) => {
          await route.fulfill({ contentType: 'text/html', body: html(body) });
        }),
        entryUrl: 'https://refs.gallery/projects/example',
        settings: { ...settings, settleTimeoutMs: 350 },
      }),
    );
  const server = createServer((request, response) => {
    if (request.url === '/detail') {
      response.writeHead(302, {
        location: `http://localhost:${(server.address() as AddressInfo).port}/destination`,
      });
      response.end();
    } else {
      response.end('<h1>Unrelated destination</h1>');
    }
  });
  server.listen(0);
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await assert.rejects(
      resolveGallery(
        { id: 'redirect-fixture', hosts: ['127.0.0.1'], listings: '^/$', details: '^/detail$' },
        { browser, entryUrl: `${origin}/detail`, settings },
      ),
      /Unsupported.*redirect/,
    );
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('ads, consent, frames and open shadows are cleaned while protected designs remain intact', async () => {
  const intercepted: string[] = [],
    log: Intervention[] = [];
  const context = await browser.newContext();
  await context.route('**/*', async (route) => {
    intercepted.push(route.request().url());
    await route.fulfill({
      contentType: 'text/html',
      body: '<div data-ad-slot="inner" style="height:50px">Advert</div>',
    });
  });
  await guardNuisances(context, log);
  try {
    const page = await context.newPage();
    await page.setContent(
      html(
        '<div id="ad" data-ad-slot="banner" style="height:40px">Ad</div><section id="design" data-ad-slot="intentional" style="height:80px">Protected example</section><dialog id="product" open>Product controls</dialog><div id="onetrust-banner-sdk" style="position:fixed;inset:0"><button id="onetrust-reject-all-handler" onclick="this.parentElement.remove()">Reject all</button></div><iframe title="Advertisement" src="https://frame.test/"></iframe><div id="host"></div><script>const ad=document.createElement("div");ad.setAttribute("data-ad-slot","shadow");ad.style.height="30px";ad.textContent="Ad";document.querySelector("#host").attachShadow({mode:"open"}).append(ad);fetch("https://pagead2.googlesyndication.com/pagead/ads").catch(()=>{});</script>',
      ),
    );
    const settings = parseConfig({
      sources: ['https://page.test/'],
      capture: { preserveSelectors: ['#design', '#product'] },
    }).capture;
    const result = await sweepCleanup(page, settings, log);
    assert.equal(await page.locator('#ad').isVisible(), false);
    assert.equal(await page.locator('#design').isVisible(), true);
    assert.equal(await page.locator('#product').isVisible(), true);
    assert.equal(await page.locator('#onetrust-banner-sdk').count(), 0);
    assert.equal(await page.locator('#host').locator('[data-ad-slot]').isVisible(), false);
    assert.equal(await page.locator('iframe').isVisible(), false);
    assert.equal(result.unresolved.length, 0);
    assert.ok(log.some((event) => event.action === 'block-ad-request'));
    assert.ok(intercepted.every((url) => !url.includes('googlesyndication')));
  } finally {
    await context.close();
  }
});

test('browser alerts and unsolicited windows cannot stall discovery flow', async () => {
  const context = await browser.newContext(),
    log: Intervention[] = [];
  await guardNuisances(context, log);
  await context.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: html(
        route.request().url() === 'https://page.test/'
          ? '<script>alert("Promotion");window.open("https://promo.test/one");window.open("https://promo.test/two");window.flowReady=true;</script>'
          : '<p>Unsolicited promotion</p>',
      ),
    }),
  );
  try {
    const page = await context.newPage();
    await page.goto('https://page.test/', { waitUntil: 'domcontentloaded', timeout: 3000 });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { flowReady?: boolean }).flowReady),
    );
    for (
      let step = 0;
      step < 40 &&
      (context.pages().length > 1 ||
        log.filter((item) => item.action === 'close-unrequested-window').length < 2);
      step++
    )
      await page.waitForTimeout(50);
    assert.equal(context.pages().length, 1);
    assert.ok(log.some((item) => item.action === 'dismiss-browser-dialog'));
    assert.equal(log.filter((item) => item.action === 'close-unrequested-window').length, 2);
  } finally {
    await context.close();
  }
});
