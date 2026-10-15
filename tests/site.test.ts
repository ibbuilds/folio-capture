import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium,type Browser } from 'playwright';
import { discoverSite,siteLink } from '../src/site.ts';
import { Store } from '../src/store.ts';
import { parseConfig } from '../src/config.ts';
import { sitemapLocations } from '../src/navigation.ts';

test('site identity preserves hash-router pages but deduplicates ordinary section anchors',()=>{
  assert.equal(siteLink('/#/pricing','https://site.test/'),'https://site.test/#/pricing');
  assert.equal(siteLink('/#!/products','https://site.test/'),'https://site.test/#!/products');
  assert.equal(siteLink('/#testimonials','https://site.test/'),'https://site.test/');
});

test('sitemap parsing accepts real XML and content parameters, never HTML or external entities',()=>{
  assert.deepEqual(sitemapLocations('<?xml version="1.0"?><urlset><url><loc>https://site.test/pricing?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://site.test/about]]></loc></url></urlset>'),{index:false,urls:['https://site.test/pricing?a=1&b=2','https://site.test/about']});
  assert.equal(sitemapLocations('<html><loc>https://wrong.test/</loc></html>'),undefined);
  assert.equal(sitemapLocations('<!DOCTYPE xml SYSTEM "file:///private"><urlset/>'),undefined);
  assert.deepEqual(sitemapLocations('<?xml version="1.0"?><?xml-stylesheet href="/style.xsl"?><!----><ns0:urlset><ns0:url><ns0:loc>https://site.test/?a=1&#38;b=2</ns0:loc></ns0:url></ns0:urlset>'),{index:false,urls:['https://site.test/?a=1&b=2']});
});

test('navigation disclosures and nested public sitemaps discover every scoped page without invoking product actions',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-expanded-navigation-')),store=new Store(root),browser=await chromium.launch({channel:'chromium'});
  t.after(async()=>{store.close();await browser.close();assert(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true,maxRetries:4});});
  const requested:string[]=[];
  const routed=new Proxy(browser,{get(target,key){if(key==='newContext')return async()=>{
    const context=await target.newContext();await context.route('**/*',route=>{
      const path=new URL(route.request().url()).pathname;requested.push(path);
      const body=path==='/sitemap.xml'?'<sitemapindex><sitemap><loc>https://expanded.test/pages.xml</loc></sitemap></sitemapindex>':path==='/pages.xml'?'<urlset><url><loc>https://expanded.test/about</loc></url><url><loc>https://other.test/private</loc></url><url><loc>https://expanded.test/file.pdf</loc></url></urlset>':path==='/'?`<header><button aria-expanded="false" aria-controls="menu" onclick="document.querySelector('#menu').innerHTML='<a href=/pricing>Pricing</a>';this.setAttribute('aria-expanded','true')">Products</button><nav id="menu"></nav><button aria-expanded="false" aria-controls="signup" onclick="fetch('/unwanted-action')">Sign up</button></header><main><h1>Home</h1><a href="/contact">Contact</a></main>`:`<main><h1>${path}</h1></main>`;
      return route.fulfill({contentType:path.endsWith('.xml')?'application/xml':'text/html',body});
    });return context;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const config=parseConfig({sources:[{url:'https://expanded.test/',kind:'site',maxPages:4,maxDepth:1}],discovery:{settleTimeoutMs:500,minDelayMs:20}}),captured:string[]=[];
  await discoverSite(store,routed,config.sources[0],config.discovery,async url=>{captured.push(url);});
  assert.deepEqual(new Set(captured),new Set(['https://expanded.test/','https://expanded.test/pricing','https://expanded.test/contact','https://expanded.test/about']));
  assert(!requested.includes('/unwanted-action'));assert(!requested.includes('/file.pdf'));
  assert.equal(store.jobs('site-discovery')[0].stoppingReason,'navigation_graph_exhausted');
  assert.equal(store.jobs('site-page').find(job=>job.payload.url.endsWith('/about'))!.payload.via,'sitemap');
  assert.equal(store.jobs('site-page')[0].result.sitemap.documents.length,2);
});

test('page limits retain excluded destinations and entry screens remain explicit exploration boundaries',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-site-boundaries-')),store=new Store(root),browser=await chromium.launch({channel:'chromium'});
  t.after(async()=>{store.close();await browser.close();assert(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true,maxRetries:4});});
  const routed=new Proxy(browser,{get(target,key){if(key==='newContext')return async()=>{
    const context=await target.newContext();await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main><h1>Your device</h1><button>Continue</button><a href="/about">About</a><a href="/pricing">Pricing</a></main>'}));return context;
  };const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const config=parseConfig({sources:[{url:'https://boundary.test/',kind:'site',maxPages:1}],discovery:{settleTimeoutMs:500,minDelayMs:20}}),captured:string[]=[];
  await discoverSite(store,routed,config.sources[0],config.discovery,async url=>{captured.push(url);});
  assert.deepEqual(captured,['https://boundary.test/']);
  assert.equal(store.jobs('site-page')[0].stoppingReason,'interaction_boundary');
  assert.equal(store.jobs('site-page')[0].result.boundary.kind,'device-selection');
  assert.equal(store.jobs('site-excluded').length,2);assert(store.jobs('site-excluded').every(job=>job.status==='incomplete'&&job.stoppingReason==='page_limit'));
  assert.equal(store.jobs('site-discovery')[0].status,'incomplete');
});

test('mobile-only navigation is observed before capture and its destinations stay in the same registry',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-responsive-navigation-')),store=new Store(root),browser=await chromium.launch({channel:'chromium'});
  t.after(async()=>{store.close();await browser.close();assert(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true,maxRetries:4});});
  const routed=new Proxy(browser,{get(target,key){if(key==='newContext')return async()=>{
    const context=await target.newContext();await context.route('**/*',route=>{
      const home=new URL(route.request().url()).pathname==='/';
      return route.fulfill({contentType:'text/html',body:home?`<header id="nav"></header><main><h1>Responsive homepage</h1></main><script>addEventListener('resize',()=>{if(innerWidth>=600||document.querySelector('button'))return;const button=document.createElement('button');button.setAttribute('aria-label','Menu');button.textContent='Menu';button.onclick=()=>{const link=document.createElement('a');link.href='/mobile-page';link.textContent='Mobile page';button.after(link)};document.querySelector('#nav').append(button)})</script>`:'<main><h1>Mobile destination</h1></main>'});
    });return context;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const config=parseConfig({sources:[{url:'https://responsive.test/',kind:'site',maxPages:2}],discovery:{settleTimeoutMs:500,minDelayMs:20,maxScrollSteps:1}}),captured:string[]=[];
  await discoverSite(store,routed,config.sources[0],config.discovery,async url=>{
    if(url==='https://responsive.test/')assert(store.jobs('site-page').some(job=>job.payload.url==='https://responsive.test/mobile-page'));
    captured.push(url);
  });
  assert.deepEqual(new Set(captured),new Set(['https://responsive.test/','https://responsive.test/mobile-page']));
  assert.equal(store.jobs('site-page').length,2);assert.equal(store.jobs('site-discovery')[0].stoppingReason,'navigation_graph_exhausted');
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
