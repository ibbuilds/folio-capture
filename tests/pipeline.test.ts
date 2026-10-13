import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { runPipeline, validateCaptureFiles } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import { chromium } from 'playwright';
import type { PageManifest } from '../src/types.ts';

test('end-to-end capture resumes, publishes atomically, reuses pixels, and reports all viewport families',async()=>{
  const root=await mkdtemp(join(tmpdir(),'folio-pipeline-'));
  let requests=0;
  const server=createServer((_req,res)=>{
    requests++;
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio fixture</title><style>body{margin:0;background:white}header{height:48px;background:#eee}section{min-height:240px;padding:24px;box-sizing:border-box}h1{font-size:48px}h2{font-size:28px}@media(max-width:800px){h1{font-size:30px}section{min-height:320px}}</style></head><body><header>Folio fixture navigation</header><main><section><h1>Build better ideas</h1><p>Features for teams. Get started.</p></section><section><h2>Our process</h2><p>How it works: collect references and compare.</p></section></main><footer>Footer</footer></body></html>`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/`;
  const config=parseConfig({output:root,sources:[url,{url:'https://unsupported.example/catalog',kind:'library'}],classifier:{runner:'mcp'},capture:{maxAttempts:1,mediaTimeoutMs:500,settleTimeoutMs:1000,cleanupTimeoutMs:800,explorationTimeoutMs:8000,attemptTimeoutMs:20000}},root);
  const abort=new AbortController();
  let inspectedStore:Store|undefined;
  try{
    const interrupted=await runPipeline(config,{signal:abort.signal,log:message=>{if(message.includes('loading'))abort.abort();}});
    assert.equal(interrupted.interrupted,true);
    const first=await runPipeline(config,{log:()=>{}});
    assert.equal(first.captured,1);
    assert.equal(first.incomplete,0);
    assert.equal(first.unsupported,1);
    const store=new Store(root);inspectedStore=store;
    const captures=store.captures();const saved=captures.find(c=>c.manifest)!;
    assert.ok(saved);assert.equal(saved.manifest!.variants.length,6);
    assert.equal(saved.status,'complete',JSON.stringify(saved.manifest!.variants.map(v=>({profile:v.profile.id,warnings:v.warnings}))));
    const coverage=JSON.parse(await readFile(join(root,'coverage.json'),'utf8'));
    assert.equal(coverage.aesthetics.length,60);assert.equal(coverage.substyles.length,36);
    assert.equal(coverage.profiles.length,6);assert.equal(coverage.totals.machineQualified,0);
    assert.ok(['desktop','tablet','mobile'].every(v=>coverage.viewport[v].collected>0));
    assert.equal(coverage.libraryTraversal.find((s:any)=>s.source==='https://unsupported.example/catalog')?.status,'unsupported');
    assert.ok(saved.manifest!.variants.every(v=>v.regions.some(r=>r.frames.length)));
    assert.ok(await validateCaptureFiles(join(root,saved.directory),saved.manifest!));
    assert.ok(store.jobs('viewport').every(j=>j.status!=='running'));
    assert.equal(store.getJob('discovery','https://unsupported.example/catalog')?.status,'unsupported');
    const manifestBefore=await readFile(join(root,saved.directory,'manifest.json'),'utf8');
    assert.equal((JSON.parse(manifestBefore) as PageManifest).captureId,saved.id);
    store.close();inspectedStore=undefined;
    const requestsBefore=requests;
    const second=await runPipeline(config,{log:()=>{}});
    assert.equal(second.reused,1);assert.equal(second.captured,0);assert.equal(requests,requestsBefore);
    const index=JSON.parse(await readFile(join(root,'index.json'),'utf8'));assert.equal(index.pages.length,1);
    assert.equal(index.pages[0].variants.length,6);assert.equal(JSON.parse(await readFile(join(root,'catalog.json'),'utf8')).references.length,0);
    await assert.rejects(readFile(join(root,'report.html'),'utf8')); // Report is explicitly opt-in.
  }finally{inspectedStore?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});

test('a disconnected Chromium is relaunched instead of poisoning later viewport attempts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-browser-recovery-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3}));
  const config=parseConfig({output:root,sources:['https://fixture.test/'],profiles:[{id:'desktop',width:1440,height:1000,dpr:2,isMobile:false,hasTouch:false},{id:'mobile',width:390,height:844,dpr:2,isMobile:true,hasTouch:true}],capture:{maxAttempts:2,mediaTimeoutMs:400,settleTimeoutMs:500,cleanupTimeoutMs:400,explorationTimeoutMs:4000,attemptTimeoutMs:15000}});
  let launches=0;
  const summary=await runPipeline(config,{log:()=>{},launchBrowser:async()=>{
    const owned=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FOLIO_TEST_BROWSER_PATH});
    launches++;
    const original=owned.newContext.bind(owned);
    owned.newContext=async options=>{if(launches===1)await owned.close();const context=await original(options);await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main><section><h1>Reliable recovery</h1><p>Saved fixture</p></section></main>'}));return context;};
    return owned;
  }});
  assert.equal(launches,2);assert.equal(summary.captured,1);assert.equal(summary.failed,0);assert.ok(summary.pendingClassification>0,'MCP workflow stays explicitly pending');
  const store=new Store(root);try{
    assert.ok(store.captures()[0].manifest!.variants.every(v=>v.status==='complete'));
    assert.equal(store.jobs('viewport').find(j=>j.payload.profile==='desktop')!.attempts,2);
    assert.equal(store.jobs('viewport').find(j=>j.payload.profile==='mobile')!.attempts,1);
  }finally{store.close();}
});
