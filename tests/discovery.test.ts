import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Route } from 'playwright';
import { discoverRefero, isReferoLibrary, resolveReferoEntry } from '../src/discovery.ts';
import type { DiscoveryEvent, DiscoverySettings } from '../src/types.ts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chromium', executablePath: process.env.FOLIO_TEST_BROWSER_PATH }); });
after(async () => { await browser?.close(); });

const settings: DiscoverySettings = {
  navigationTimeoutMs: 2000, settleTimeoutMs: 2000, plateauChecks: 3,
  maxScrollSteps: 30, maxDurationMs: 15000, minDelayMs: 30,
};
const origin = 'https://styles.refero.design';
const cards = (ids: string[]) => ids.map(id => `<a href="/style/${id}" style="display:block;height:60px"><h3>Design ${id}</h3></a>`).join('');
const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

function routedBrowser(handler: (route: Route) => Promise<void>): Browser {
  return new Proxy(browser, {
    get(target, property) {
      if (property === 'newContext') return async (...args: Parameters<Browser['newContext']>) => {
        const context = await target.newContext(...args);
        await context.route('**/*', handler);
        return context;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function events(testBrowser: Browser, url = `${origin}/`, overrides: Partial<DiscoverySettings> = {}): Promise<DiscoveryEvent[]> {
  const result: DiscoveryEvent[] = [];
  for await (const event of discoverRefero({ browser: testBrowser, seed: { url, kind: 'library' }, settings: { ...settings, ...overrides } })) result.push(event);
  return result;
}

function ending(result: DiscoveryEvent[]): Extract<DiscoveryEvent, { type: 'end' }> {
  const last = result.at(-1);
  assert.ok(last?.type === 'end', 'Discovery must finish with an end event');
  return last;
}

test('Refero adapter recognizes only bounded public collection routes', () => {
  assert.equal(isReferoLibrary(`${origin}/`), true);
  assert.equal(isReferoLibrary(`${origin}/design-styles/ecommerce-websites`), true);
  assert.equal(isReferoLibrary(`${origin}/ai-agents/design-resources`), true);
  assert.equal(isReferoLibrary(`${origin}/design-md-examples`), true);
  for (const value of ['javascript:alert(1)', 'file:///tmp/test', 'https://refero.design/', `${origin}/style/id`, `${origin}/account`, 'https://styles.refero.design.evil.test/', 'https://name:password@styles.refero.design/']) assert.equal(isReferoLibrary(value), false, value);
});

test('infinite scrolling accumulates 20 then 40 entries and verifies an explicit end', async () => {
  const first = Array.from({ length: 20 }, (_, index) => `first-${index}`);
  const second = Array.from({ length: 20 }, (_, index) => `second-${index}`);
  const testBrowser = routedBrowser(async route => {
    await route.fulfill({ contentType: 'text/html', body: html(`<main id="list">${cards(first)}</main><div id="loader" role="progressbar" style="display:none">Loading</div>
      <script>
      let loaded = false;
      addEventListener('scroll', () => {
        if (loaded || scrollY + innerHeight < document.documentElement.scrollHeight - 10) return;
        loaded = true; document.querySelector('#loader').style.display='block';
        setTimeout(() => { document.querySelector('#list').insertAdjacentHTML('beforeend', ${JSON.stringify(cards(second))});
          document.querySelector('#loader').remove(); document.body.insertAdjacentHTML('beforeend', '<p>No more designs</p>'); }, 100);
      });
      </script>`) });
  });
  const result = await events(testBrowser);
  assert.equal(result.filter(event => event.type === 'entry').length, 40);
  assert.equal(ending(result).reason, 'explicit_end');
  assert.equal(browser.contexts().length, 0);
});

test('virtualized listing keeps identities removed from the DOM and reports an observed plateau', async () => {
  const testBrowser = routedBrowser(async route => {
    await route.fulfill({ contentType: 'text/html', body: html(`<main id="list" style="min-height:2000px">${cards(['first-a', 'first-b'])}</main>
      <script>let changed=false;addEventListener('scroll',()=>{if(!changed && scrollY>0){changed=true;document.querySelector('#list').innerHTML=${JSON.stringify(cards(['second-a', 'second-b']))};}});</script>`) });
  });
  const result = await events(testBrowser);
  assert.deepEqual(result.filter(event => event.type === 'entry').map(event => event.entry.id), ['first-a', 'first-b', 'second-a', 'second-b']);
  assert.equal(ending(result).reason, 'observed_plateau');
});

test('a category stays scoped while the root follows explicit supported collection links', async () => {
  const requested: string[] = [];
  const category = '/design-styles/ecommerce-websites';
  const sibling = '/design-styles/minimal-websites';
  const testBrowser = routedBrowser(async route => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const body = path === '/' ? `${cards(['shared'])}<a href="${category}">Ecommerce websites</a><a href="/pricing">Pricing</a><p>No more designs</p>`
      : `${cards(['shared', 'category-only'])}<a href="${sibling}">Other category</a><p>No more designs</p>`;
    await route.fulfill({ contentType: 'text/html', body: html(body) });
  });
  const scoped = await events(testBrowser, `${origin}${category}`);
  assert.deepEqual(requested, [category]);
  assert.equal(scoped.filter(event => event.type === 'entry').length, 2);
  requested.length = 0;
  const broad = await events(testBrowser);
  assert.deepEqual(requested, ['/', category, sibling]);
  assert.equal(broad.filter(event => event.type === 'entry').length, 2);
});

test('visible load-more controls are handled without private API cursors', async () => {
  const testBrowser = routedBrowser(async route => {
    await route.fulfill({ contentType: 'text/html', body: html(`<main>${cards(['first'])}</main><button onclick="document.querySelector('main').insertAdjacentHTML('beforeend', '${cards(['second']).replaceAll('"', '&quot;')}');this.remove();document.body.insertAdjacentHTML('beforeend','<p>No more styles</p>')">Load more</button>`) });
  });
  const result = await events(testBrowser);
  assert.deepEqual(result.filter(event => event.type === 'entry').map(event => event.entry.id), ['first', 'second']);
  assert.equal(ending(result).reason, 'explicit_end');
});

test('resource indexes traverse collection links and a failed collection does not discard later work', async () => {
  const requested: string[] = [];
  const testBrowser = routedBrowser(async route => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path === '/design-styles/broken') { await route.fulfill({ status: 500, body: 'Unavailable' }); return; }
    const body = path === '/ai-agents/design-resources'
      ? '<a href="/design-styles/broken">Broken</a><a href="/design-styles/working">Working</a><p>No more designs</p>'
      : `${cards(['working-design'])}<p>No more designs</p>`;
    await route.fulfill({ contentType: 'text/html', body: html(body) });
  });
  const result = await events(testBrowser, `${origin}/ai-agents/design-resources`);
  assert.deepEqual(requested, ['/ai-agents/design-resources', '/design-styles/broken', '/design-styles/working']);
  assert.deepEqual(result.filter(event => event.type === 'entry').map(event => event.entry.id), ['working-design']);
  assert.equal(ending(result).reason, 'incomplete');
  assert.match(ending(result).error || '', /500/);
});

test('HTTP and loading errors cannot become successful plateaus', async () => {
  const denied = routedBrowser(async route => { await route.fulfill({ status: 403, contentType: 'text/html', body: 'Denied' }); });
  const deniedEvents = await events(denied);
  assert.equal(ending(deniedEvents).reason, 'incomplete');
  assert.match(ending(deniedEvents).error || '', /403/);
  const failedLoad = routedBrowser(async route => {
    if (new URL(route.request().url()).pathname === '/api/load') { await route.fulfill({ status: 500, body: 'Failed' }); return; }
    await route.fulfill({ contentType: 'text/html', body: html(`${cards(['first'])}<button onclick="fetch('/api/load')">Load more</button>`) });
  });
  const failedEvents = await events(failedLoad);
  assert.equal(ending(failedEvents).reason, 'incomplete');
  assert.match(ending(failedEvents).error || '', /500/);
});

test('canceled detail and explicitly marked prefetches do not fail listing discovery', async () => {
  const canceled: string[] = [];
  const testBrowser = routedBrowser(async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/') {
      canceled.push(url.pathname);
      await route.abort('aborted');
      return;
    }
    await route.fulfill({ contentType: 'text/html', body: html(`${cards(['first'])}<p>No more designs</p><script>
      fetch('/style/first?_rsc=fixture').catch(()=>{});
      fetch('/purpose-prefetch', {headers:{Purpose:'prefetch'}}).catch(()=>{});
      fetch('/router-prefetch', {headers:{'Next-Router-Prefetch':'1'}}).catch(()=>{});
      fetch('/segment-prefetch', {headers:{'Next-Router-Segment-Prefetch':'/_tree'}}).catch(()=>{});
    </script>`) });
  });
  const result = await events(testBrowser);
  assert.deepEqual(result.filter(event => event.type === 'entry').map(event => event.entry.id), ['first']);
  assert.equal(ending(result).reason, 'explicit_end');
  assert.deepEqual(canceled.sort(), ['/purpose-prefetch', '/router-prefetch', '/segment-prefetch', '/style/first']);
});

test('limits remain incomplete and consumer work is excluded from the discovery time budget', async () => {
  const testBrowser = routedBrowser(async route => { await route.fulfill({ contentType: 'text/html', body: html(`${cards(['first', 'second'])}<p>No more designs</p>`) }); });
  const limited = await events(testBrowser, `${origin}/`, { maxEntries: 1 });
  assert.equal(limited.filter(event => event.type === 'entry').length, 1);
  assert.equal(ending(limited).reason, 'incomplete');
  const result: DiscoveryEvent[] = [];
  for await (const event of discoverRefero({ browser: testBrowser, seed: { url: `${origin}/`, kind: 'library' }, settings: { ...settings, maxDurationMs: 1000 } })) {
    result.push(event);
    if (event.type === 'entry') await new Promise(resolve => setTimeout(resolve, 600));
  }
  assert.equal(ending(result).reason, 'explicit_end');
});

test('resolver waits for hydration, ignores marketing/social links, and preserves source evidence', async () => {
  const testBrowser = routedBrowser(async route => {
    if (new URL(route.request().url()).hostname === 'images.refero.design') {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200"/>' }); return;
    }
    await route.fulfill({ contentType: 'text/html', body: html(`<header><a href="https://refero.design/?utm_source=styles">Open Refero</a></header><main><h1>Loading...</h1><div id="metadata"></div><h2>Color Palette</h2><a href="/design-styles/minimal-websites">Minimal</a><img src="https://images.refero.design/preview.svg" width="1000" height="1200" alt="Screenshot of ElevenLabs"></main><footer><a href="https://x.com/refero">https://x.com/refero</a></footer>
      <script>setTimeout(()=>{document.querySelector('h1').textContent='ElevenLabs';document.querySelector('#metadata').innerHTML='<a href="https://elevenlabs.io/">https://elevenlabs.io</a>';},100);</script>`) });
  });
  const result = await resolveReferoEntry({ browser: testBrowser, entryUrl: `${origin}/style/elevenlabs`, settings });
  assert.equal(result.originalUrl, 'https://elevenlabs.io/');
  assert.equal(result.title, 'ElevenLabs');
  assert.deepEqual(result.sourceLabels, ['Minimal']);
  assert.equal(result.previewUrl, 'https://images.refero.design/preview.svg');
  assert.equal(result.metadata.resolutionMethod, 'explicit-url');
  assert.equal(browser.contexts().length, 0);
});

test('resolver accepts a deliberate Visit site link and rejects unsafe or ambiguous originals', async () => {
  const visit = routedBrowser(async route => { await route.fulfill({ contentType: 'text/html', body: html('<main><h1>Example</h1><a href="https://example.com/product">Visit site</a><h2>Color Palette</h2></main>') }); });
  assert.equal((await resolveReferoEntry({ browser: visit, entryUrl: `${origin}/style/example`, settings })).originalUrl, 'https://example.com/product');
  const ambiguous = routedBrowser(async route => { await route.fulfill({ contentType: 'text/html', body: html('<main><h1>Example</h1><a href="https://example.com/a">https://example.com/a</a><a href="https://example.com/b">https://example.com/b</a><h2>Color Palette</h2></main>') }); });
  await assert.rejects(resolveReferoEntry({ browser: ambiguous, entryUrl: `${origin}/style/example`, settings }), /multiple equally plausible/);
  await assert.rejects(resolveReferoEntry({ browser: visit, entryUrl: 'javascript:alert(1)', settings }), /Unsupported/);
  const unsafe = routedBrowser(async route => { await route.fulfill({ contentType: 'text/html', body: html('<main><h1>Example</h1><a href="javascript:alert(1)">Visit site</a><h2>Color Palette</h2></main>') }); });
  await assert.rejects(resolveReferoEntry({ browser: unsafe, entryUrl: `${origin}/style/example`, settings: { ...settings, settleTimeoutMs: 250 } }), /No settled, explicit/);
});
