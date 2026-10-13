import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {parseConfig} from '../src/config.ts';
import {captureViewport} from '../src/capture.ts';
import {runPairedFixture} from './support/paired-capture.ts';
import {Store} from '../src/store.ts';

const body='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · Studio</title><style>body{margin:0;background:#f7f5f2;color:#222}section{height:500px;padding:48px;box-sizing:border-box}</style><main><section><h1>404. A different direction.</h1><p>This page has moved. Explore our work.</p><a href="/home">Back home</a></section></main>';
test('intentional 404 references are capturable while undeclared errors and access challenges remain blocked',async t=>{
  const output=await mkdtemp(join(tmpdir(),'folio-designed-404-'));t.after(()=>rm(output,{recursive:true,force:true,maxRetries:3}));
  const browser=await chromium.launch({channel:'chromium',headless:true});t.after(()=>browser.close());
  const create=browser.newContext.bind(browser);browser.newContext=async options=>{const context=await create(options);await context.route('**/*',route=>route.fulfill({status:route.request().url().includes('/challenge')?403:404,contentType:'text/html',body}));return context;};
  const config=parseConfig({sources:['https://design.test/404'],profiles:[{id:'desktop',width:1440,height:1000,dpr:2,isMobile:false,hasTouch:false}],capture:{mediaTimeoutMs:300,settleTimeoutMs:400,cleanupTimeoutMs:500,explorationTimeoutMs:5000}});
  const options={browser,profile:config.profiles[0],settings:config.capture,outputDir:output};
  const intended=await captureViewport({...options,url:'https://design.test/404',expectedHttpStatus:404});assert.equal(intended.status,'complete',JSON.stringify(intended.warnings));assert.ok(intended.regions.some(region=>region.frames.length));assert.equal(intended.environment.expectedHttpStatus,404);
  const missing=await captureViewport({...options,url:'https://design.test/missing'});assert.equal(missing.status,'failed');assert.equal(missing.regions.length,0);
  const challenge=await captureViewport({...options,url:'https://design.test/challenge',expectedHttpStatus:404});assert.equal(challenge.status,'blocked');assert.equal(challenge.regions.length,0);
});

test('404 gallery provenance survives site traversal, and expected error status is restricted to the original reference',async t=>{
  const output=await mkdtemp(join(tmpdir(),'folio-404-pipeline-'));t.after(()=>rm(output,{recursive:true,force:true,maxRetries:3}));
  const config=parseConfig({output,sources:[{url:'https://www.404s.design/',kind:'library'}],collection:{originalMode:'site',maxPages:3,maxDepth:1},profiles:[{id:'desktop',width:1440,height:1000,dpr:2,isMobile:false,hasTouch:false}],capture:{maxAttempts:1,mediaTimeoutMs:300,settleTimeoutMs:400,cleanupTimeoutMs:500,explorationTimeoutMs:5000},discovery:{maxEntries:1,navigationTimeoutMs:3000,settleTimeoutMs:1000,minDelayMs:30,maxScrollSteps:10}});
  await runPairedFixture(config,{limit:2,log:()=>{},launchBrowser:async()=>{
    const browser=await chromium.launch({channel:'chromium',headless:true});const create=browser.newContext.bind(browser);
    browser.newContext=async options=>{const context=await create(options);await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.hostname==='www.404s.design')return route.fulfill({contentType:'text/html',body:url.pathname==='/'?'<a href="/sites/studio">Studio</a><p>No more results</p>':'<main><h1>Studio</h1><a href="https://design.test/404">Visit site</a></main>'});
      return route.fulfill({status:404,contentType:'text/html',body});
    });return context;};return browser;
  }});
  const store=new Store(output);try{
    const error=store.latestCaptures().find(capture=>capture.manifest?.requestedUrl==='https://design.test/404')!;assert.ok(error);assert.equal(error.status,'complete');assert.equal(error.manifest!.provenance[0].expectedHttpStatus,404);
    const child=store.latestCaptures().find(capture=>capture.manifest?.requestedUrl==='https://design.test/home')!;assert.ok(child);assert.equal(child.status,'failed');assert.equal(child.manifest!.provenance[0].expectedHttpStatus,undefined);
  }finally{store.close();}
});
