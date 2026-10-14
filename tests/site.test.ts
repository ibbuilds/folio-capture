import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium,type Browser } from 'playwright';
import { discoverSite,siteLink } from '../src/site.ts';
import { Store } from '../src/store.ts';
import { parseConfig } from '../src/config.ts';

test('site identity preserves hash-router pages but deduplicates ordinary section anchors',()=>{
  assert.equal(siteLink('/#/pricing','https://site.test/'),'https://site.test/#/pricing');
  assert.equal(siteLink('/#!/products','https://site.test/'),'https://site.test/#!/products');
  assert.equal(siteLink('/#testimonials','https://site.test/'),'https://site.test/');
});

test('lazy footer pages are discovered before review and a disconnected navigation browser recovers',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-lazy-navigation-')),store=new Store(root);
  let active:Browser|undefined,launches=0;
  t.after(async()=>{store.close();await active?.close();await rm(root,{recursive:true,force:true});});
  const factory=async()=>{
    if(!active?.isConnected()){
      const owned=await chromium.launch({channel:'chromium'});active=owned;launches++;
      const original=owned.newContext.bind(owned);
      owned.newContext=async options=>{
        if(launches===1){await owned.close();throw new Error('Simulated navigation browser interruption');}
        const context=await original(options);
        await context.route('**/*',route=>{
          const path=new URL(route.request().url()).pathname;
          return route.fulfill({contentType:'text/html',body:path==='/'?'<style>body{margin:0;height:2600px}</style><h1>Selected site</h1><a href="/first">First page</a><script>addEventListener("scroll",()=>{if(scrollY>1200&&!document.querySelector("#late")){const link=document.createElement("a");link.id="late";link.href="/late";link.textContent="Lazy footer page";document.body.append(link)}})</script>':`<h1>Public page ${path}</h1>`});
        });return context;
      };
    }return active;
  };
  const config=parseConfig({sources:[{url:'https://lazy.test/',kind:'site'}],discovery:{minDelayMs:20,settleTimeoutMs:500}});
  const pages:string[]=[];
  await discoverSite(store,factory,config.sources[0],config.discovery,async url=>{
    if(url==='https://lazy.test/')assert(store.jobs('site-page').some(j=>j.payload.url==='https://lazy.test/late'),'Late child registered before waiting on the homepage classifier');
    pages.push(url);
  });
  assert.equal(launches,2);assert.deepEqual(pages,['https://lazy.test/','https://lazy.test/first','https://lazy.test/late']);
  assert.equal(store.jobs('site-discovery')[0].stoppingReason,'navigation_graph_exhausted');
});

test('site navigation is persisted before review, resumes after interruption, and honors depth and page limits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'folio-site-order-')),
    store = new Store(root),
    browser = await chromium.launch({ channel: 'chromium' });
  t.after(async () => {
    store.close();
    await browser.close();
    await rm(root, { recursive: true, force: true });
  });
  const origin = 'https://site.test';
  const requested: string[] = [];
  const routed = new Proxy(browser, {
    get(target, key) {
      if (key === 'newContext')
        return async () => {
          const context = await target.newContext();
          await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            requested.push(url.pathname);
            return route.fulfill({
              contentType: 'text/html',
              body: `<main><h1>${url.pathname}</h1><a href="/programs">Programs</a><a href="/updates">Updates</a><a href="/products/a1">Product</a><a href="https://other.test/">Outside</a><a href="/logout">Log out</a></main>`,
            });
          });
          return context;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const config = parseConfig({
    sources: [{ url: origin, kind: 'site', maxDepth: 2, maxPages: 4 }],
    discovery: { settleTimeoutMs: 1000, minDelayMs: 20 },
  });
  const source = config.sources[0];
  await assert.rejects(
    discoverSite(store, routed, source, config.discovery, async () => {
      assert.equal(
        store.jobs('site-page').length,
        4,
        'All direct child pages are already queued before classification',
      );
      assert.equal(
        browser.contexts().length,
        0,
        'Navigation context is closed before the model wait',
      );
      throw new Error('Interrupted classifier');
    }),
    /Interrupted classifier/,
  );
  const captures: string[] = [];
  await discoverSite(store, routed, source, config.discovery, async (url) => {
    captures.push(url);
  });
  assert.equal(new Set(captures).size, 4);
  assert(captures.some((url) => url.endsWith('/products/a1')));
  assert(store.jobs('site-page').every((j) => j.status === 'complete'));
  assert(!requested.includes('/logout'));
  assert.equal(store.jobs('site-discovery')[0].stoppingReason, 'navigation_graph_exhausted');
});
