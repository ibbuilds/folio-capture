import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { canonicalUrl, inside } from '../src/utils.ts';
import { parseConfig } from '../src/config.ts';

test('URLs strip tracking while preserving content state and reject credentials',()=>{
  assert.equal(canonicalUrl('https://example.com/pricing?plan=pro&utm_source=test#annual'),'https://example.com/pricing?plan=pro#annual');
  assert.throws(()=>canonicalUrl('https://user:password@example.com/'));
  assert.throws(()=>canonicalUrl('file:///C:/secret'));
  assert.throws(()=>inside(process.cwd(),'../outside'));
});

test('config defaults cover desktop, tablet, mobile and enforce bounded settings',()=>{
  const config=parseConfig({sources:['https://example.com/']});
  assert.equal(config.freshnessDays,730);assert.equal(config.profiles.length,6);assert.equal(config.classifier.runner,'codex');
  assert.ok(config.profiles.some(p=>p.id==='tablet'));assert.ok(config.profiles.some(p=>p.id==='tablet-landscape'));
  assert.throws(()=>parseConfig({sources:['https://example.com/'],capture:{frameOverlap:1}}));
  assert.throws(()=>parseConfig({sources:['https://example.com/'],profiles:[config.profiles[0],config.profiles[0]]}));
});

test('ledger persists separate stages, deduplicates origins, recovers interrupted jobs, and locks concurrent runs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'folio-store-'));
  const first=new Store(root);const second=new Store(root);
  try{
    first.acquireLock();assert.throws(()=>second.acquireLock(),/Another Folio/);
    const origin={seedUrl:'https://styles.refero.design/',detailUrl:'https://styles.refero.design/style/1',discoveredAt:new Date().toISOString(),sourceLabels:['minimalist']};
    const a=first.page('https://example.com/?utm_source=one',origin);
    const b=first.page('https://example.com/',origin);assert.equal(a.id,b.id);assert.equal(b.provenance.length,1);
    assert.equal(first.page(b.url,{...origin,detailUrl:'https://styles.refero.design/style/2'}).provenance.length,2);
    const capture=first.job('capture',a.id,{url:a.url});const classification=first.job('classification',a.id,{captureId:'saved'});
    first.start(capture);first.finish(classification,'blocked',undefined,'quota');
    assert.equal(first.recoverRunning(),1);assert.equal(first.getJob('capture',a.id)?.status,'pending');assert.equal(first.getJob('classification',a.id)?.status,'blocked');
    first.releaseLock();second.acquireLock();second.retryFailures(['classification']);assert.equal(second.getJob('classification',a.id)?.status,'pending');
    assert.equal(second.getJob('capture',a.id)?.attempts,1);
  }finally{first.close();second.close();await rm(root,{recursive:true,force:true});}
});
