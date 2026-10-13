import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Route } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverRecent, resolveRecentEntry, isRecentLibrary, recentListing } from '../src/recent.ts';
import { libraryAdapter, isKnownLibrary } from '../src/adapters.ts';
import { discoverSite, siteLink } from '../src/site.ts';
import { runPairedFixture as runPipeline } from './support/paired-capture.ts';
import { Store } from '../src/store.ts';
import { parseConfig } from '../src/config.ts';
import type { DiscoveryEvent } from '../src/types.ts';
let browser:Browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FOLIO_TEST_BROWSER_PATH});});
after(async()=>{await browser?.close();});
const settings={navigationTimeoutMs:3000,settleTimeoutMs:1000,plateauChecks:3,maxScrollSteps:30,maxDurationMs:10000,minDelayMs:30};
function routed(handler:(route:Route)=>Promise<void>,base=browser):Browser {
  return new Proxy(base,{get(target,key){if(key==='newContext')return async()=>{const context=await target.newContext();await context.route('**/*',handler);return context;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
const html=(body:string)=>`<!doctype html><html><body>${body}</body></html>`;
async function recent(testBrowser:Browser,url='https://recent.design/websites') {
  const result:DiscoveryEvent[]=[];const persisted=new Set<string>();
  for await(const event of discoverRecent({browser:testBrowser,seed:{url,kind:'auto'},settings,onDiscovered:entries=>entries.forEach(e=>{persisted.add(e.id);})})){
    if(event.type==='entry')assert.ok(persisted.has(event.entry.id),'Persisted before yielding');result.push(event);
  }
  return result;
}
test('adapter registry recognizes supported scopes and flags known unsupported libraries',()=>{
  assert.equal(libraryAdapter('https://styles.refero.design/')?.id,'refero-styles');
  assert.equal(libraryAdapter('https://godly.website/')?.id,'recent');
  assert.equal(recentListing('https://godly.website/'),'https://recent.design/websites');
  assert.equal(isRecentLibrary('https://recent.design/app-icons'),false);
  assert.equal(isKnownLibrary('https://recent.design/app-icons'),true);
  assert.equal(libraryAdapter('https://awwwards.com/academy/'),undefined);
});
test('Recent accumulates replaced cards, preserves entries, and records plateau rather than exhaustion',async()=>{
  const events=await recent(routed(async route=>route.fulfill({contentType:'text/html',body:html(`<div id="cards"><a href="/i/first" style="display:block;height:1000px">First</a></div><script>let done=false;addEventListener('scroll',()=>{if(done||scrollY<1)return;done=true;setTimeout(()=>document.querySelector('#cards').innerHTML='<a href="/i/second">Second</a>',35);});</script>`)})));
  assert.equal(events.filter(e=>e.type==='entry').length,2,JSON.stringify(events));assert.equal((events.at(-1) as any).reason,'observed_plateau');
});

test('Recent retains transient cards while delayed replacements settle inside nested scrolling',async()=>{
  const events=await recent(routed(async route=>route.fulfill({contentType:'text/html',body:html(`<div id="scroller" style="height:200px;overflow:auto"><div id="cards"><a href="/i/transient" style="display:block;height:1000px">Transient</a></div></div><script>
    setTimeout(()=>document.querySelector('#cards').innerHTML='<a href="/i/initial" style="display:block;height:1000px">Initial</a>',5);
    document.querySelector('#scroller').addEventListener('scroll',()=>{if(window.done)return;window.done=true;setTimeout(()=>document.querySelector('#cards').innerHTML='<a href="/i/late" style="display:block;height:1000px">Late</a>',300);});
  </script>`)})));
  assert.deepEqual(events.filter(e=>e.type==='entry').map(e=>new URL((e as any).entry.detailUrl).pathname).sort(),['/i/initial','/i/late','/i/transient']);
  assert.equal((events.at(-1) as any).reason,'observed_plateau');
});

test('Recent loading that never settles remains incomplete rather than a successful plateau',async()=>{
  const events=await recent(routed(async route=>route.fulfill({contentType:'text/html',body:html('<a href="/i/test">Test</a><div aria-busy="true" style="width:30px;height:30px">Loading</div>')})));
  assert.equal((events.at(-1) as any).reason,'incomplete');assert.match((events.at(-1) as any).error,/did not settle/);
});
test('Recent follows pagination within selected category without crawling sibling categories',async()=>{
  const visited:string[]=[];
  const events=await recent(routed(async route=>{
    const url=new URL(route.request().url());visited.push(url.href);
    await route.fulfill({contentType:'text/html',body:html(url.search?'<a href="/i/second">Second</a><p>No more websites</p>':'<a href="/i/first">First</a><a rel="next" href="?page=2">Next</a><a href="/websites/commerce">Other category</a><p>No more websites</p>')});
  }),'https://recent.design/websites/saas');
  assert.equal(events.filter(e=>e.type==='entry').length,2);assert.equal(visited.length,2);assert.ok(visited.every(v=>v.includes('/websites/saas')));
});
test('Recent resolves only unambiguous original links; concepts and missing links remain exceptions',async()=>{
  const result=await resolveRecentEntry({browser:routed(async route=>route.fulfill({contentType:'text/html',body:html('<a href="https://original.test/page?utm_source=recent">Visit website</a>')})),entryUrl:'https://recent.design/i/test',settings});
  assert.equal(result.originalUrl,'https://original.test/page');
  for(const body of ['<a href="https://dribbble.com/concept">Visit website</a>','<a href="https://a.test">Visit website</a><a href="https://b.test">Visit website</a>'])await assert.rejects(resolveRecentEntry({browser:routed(async route=>route.fulfill({contentType:'text/html',body:html(body)})),entryUrl:'https://recent.design/i/test',settings}));
});
test('Recent loading failures and unknown structures never count as processed exhaustion',async()=>{
  const events=await recent(routed(async route=>route.request().url().includes('/api/')?route.fulfill({status:500,body:'failure'}):route.fulfill({contentType:'text/html',body:html('<a href="/i/test">Test</a><script>fetch("/api/cards")</script>')})));
  assert.equal((events.at(-1) as any).reason,'incomplete');
  assert.equal(events.filter(e=>e.type==='entry').length,1,'Observed identities survive failed loading');
  const unknown=await recent(routed(async route=>route.fulfill({contentType:'text/html',body:html('New structure')})));
  assert.match((unknown.at(-1) as any).error,/Unsupported/);
});

test('Recent stops before yielding when its observed batch cannot be persisted',async()=>{
  let yielded=0;
  await assert.rejects(async()=>{
    for await(const event of discoverRecent({browser:routed(async route=>route.fulfill({contentType:'text/html',body:html('<a href="/i/test">Test</a><p>No more websites</p>')})),
      seed:{url:'https://recent.design/websites',kind:'library'},settings,onDiscovered:()=>{throw new Error('Fixture SQLite failure');}}))if(event.type==='entry')yielded++;
  },/batch persistence failed/);
  assert.equal(yielded,0);
});
test('site mode deduplicates same-origin links and persists bounded breadth-first traversal',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-site-'));const store=new Store(root);store.acquireLock();t.after(async()=>{store.close();await rm(root,{recursive:true,force:true,maxRetries:3});});
  const captured:string[]=[];
  const fixture=routed(async route=>{const url=new URL(route.request().url());await route.fulfill({contentType:'text/html',body:html(url.pathname==='/'?'<a href="/a">A</a><a href="/b">B</a><a href="/a#anchor">Again</a><a href="https://outside.test/">Outside</a>':'<a href="/deep">Deep</a>')});});
  await discoverSite(store,fixture,{url:'https://site.test/',kind:'site',maxPages:3,maxDepth:2},settings,async url=>{captured.push(url);});
  assert.deepEqual(captured,['https://site.test/','https://site.test/a','https://site.test/b']);
  assert.equal(store.jobs('site-page').length,3);assert.equal(store.jobs('site-discovery')[0].stoppingReason,'scope_limit');
  assert.equal(siteLink('https://outside.test','https://site.test'),undefined);
  assert.equal(siteLink('/logout','https://site.test'),undefined);
  assert.equal(parseConfig({sources:[{url:'https://site.test/',kind:'site'}]}).sources[0].kind,'site');
});

test('normal pipeline captures the supplied library independently and queues its original references',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-library-pipeline-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true,maxRetries:3});});
  const config=parseConfig({output:root,sources:['https://recent.design/websites'],classifier:{runner:'mcp'},
    profiles:[{id:'desktop',width:800,height:600,dpr:2,isMobile:false,hasTouch:false}],
    discovery:settings,capture:{maxAttempts:1,settleTimeoutMs:400,mediaTimeoutMs:400,cleanupTimeoutMs:500,explorationTimeoutMs:4000,attemptTimeoutMs:15000}});
  const summary=await runPipeline(config,{log:()=>{},launchBrowser:async()=>{
    const owned=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FOLIO_TEST_BROWSER_PATH});
    return routed(async route=>{const url=new URL(route.request().url());await route.fulfill({contentType:'text/html',body:html(
      url.hostname==='original.test'?`<main><section><h1>Original product</h1><p>Readable content</p><a href="/pricing">Pricing</a></section></main>`:url.pathname.startsWith('/i/')?'<a href="https://original.test/">Visit website</a>':'<main><section><h1>Website library</h1><a href="/i/test">Test design</a></section></main><p>No more websites</p>')});},owned);
  }});
  assert.equal(summary.captured,3);assert.equal(summary.discovered,1);
  const store=new Store(root);try {
    assert.deepEqual(store.pages().map(p=>p.url).sort(),['https://original.test/','https://original.test/pricing','https://recent.design/websites']);
    const pricing=store.pages().find(p=>p.url.endsWith('/pricing'))!;
    assert.equal(pricing.provenance[0].detailUrl,'https://recent.design/i/test');
    assert.deepEqual(pricing.provenance[0].navigationPath,['https://original.test/','https://original.test/pricing']);
    assert.equal(store.captures().filter(c=>c.manifest).at(-1)!.manifest!.requestedUrl,'https://recent.design/websites','Library shell is captured after original references');
    assert.equal(store.jobs('resolve')[0].status,'complete');
    assert.ok(store.references().every(r=>r.quality.verdict!=='accepted'));
  }finally{store.close();}
});

test('an unknown secondary collection cannot hide behind earlier recognized entries',async()=>{
  const result=await recent(routed(async route=>route.fulfill({contentType:'text/html',body:html(new URL(route.request().url()).pathname==='/websites'?'<a href="/i/first">First</a><a href="/websites/other">Other</a><p>No more websites</p>':'Unrecognized collection structure')})));
  assert.equal((result.at(-1) as any).reason,'incomplete');assert.match((result.at(-1) as any).error,/Unsupported/);
});

test('Recent detail resolution waits for the original link to hydrate',async()=>{
  const result=await resolveRecentEntry({browser:routed(async route=>route.fulfill({contentType:'text/html',body:html(`<p>Loading detail</p><script>setTimeout(()=>document.body.insertAdjacentHTML("beforeend", '<a href="https://original.test/late">Visit website</a>'),100)</script>`)})),entryUrl:'https://recent.design/i/late',settings});
  assert.equal(result.originalUrl,'https://original.test/late');
});
