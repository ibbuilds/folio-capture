import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { canonicalUrl, inside } from '../src/utils.ts';
import { parseConfig } from '../src/config.ts';
import { pageFolder } from '../src/naming.ts';

test('public site folders are readable, Windows-safe and durable across collisions and restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'folio-folders-'));t.after(()=>rm(root,{recursive:true,force:true}));let store=new Store(root);
  try{
    assert.equal(pageFolder('https://linear.app/'),'captures/linear.app/home');
    assert.equal(pageFolder('https://example.com/con'),'captures/example.com/con-page');
    const a=store.page('https://example.com/a-b'),b=store.page('https://example.com/a_b');
    const first=store.folder(a),second=store.folder(b);assert.equal(first,'captures/example.com/a-b');assert.equal(second,`${first}--2`);
    store.close();store=new Store(root);assert.equal(store.folder(a),first);assert.equal(store.folder(b),second);
  }finally{store.close();}
});

test('URLs strip tracking while preserving content state and reject credentials',()=>{
  assert.equal(canonicalUrl('https://example.com/pricing?plan=pro&utm_source=test#annual'),'https://example.com/pricing?plan=pro#annual');
  assert.throws(()=>canonicalUrl('https://user:password@example.com/'));
  assert.throws(()=>canonicalUrl('file:///C:/secret'));
  assert.throws(()=>inside(process.cwd(),'../outside'));
  assert.equal(canonicalUrl('https://example.com/?z=3&a=1&a=2&utm_medium=x'),'https://example.com/?a=1&a=2&z=3');
  assert.notEqual(canonicalUrl('https://example.com/?plan=pro'),canonicalUrl('https://example.com/?plan=free'));
  assert.notEqual(canonicalUrl('https://example.com/#/pricing'),canonicalUrl('https://example.com/#/home'));
});

test('verified destination aliases share page identity and keep all referring sources across restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'folio-aliases-'));let store=new Store(root);
  try {
    const original=store.page('https://example.com/?b=2&a=1',{seedUrl:'https://gallery.test/one',discoveredAt:'2026-01-01',sourceLabels:[]});
    assert.equal(store.page('https://example.com/?a=1&b=2&utm_source=gallery').id,original.id);
    assert.ok(store.rememberRedirect(original.id,'https://www.example.com/product/'));
    const alias=store.page('https://www.example.com/product/',{seedUrl:'https://gallery.test/two',discoveredAt:'2026-01-01',sourceLabels:[]});
    assert.equal(alias.id,original.id);assert.equal(alias.provenance.length,2);
    const third=store.page('https://example.com/old');assert.ok(store.aliasUncapturedPage(third.id,'https://www.example.com/product/'));
    store.close();store=new Store(root);assert.equal(store.page(third.url).id,original.id);
    const distinct=store.page('https://example.com/product/?plan=other');assert.notEqual(distinct.id,original.id);
    assert.equal(store.rememberRedirect(distinct.id,'https://www.example.com/product/'),false);
  } finally {store.close();await rm(root,{recursive:true,force:true});}
});

test('observed discovery batches are durably queued together and roll back partial writes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'folio-discovery-ledger-'));
  const store=new Store(root);
  try{
    const entries=Array.from({length:20},(_,i)=>({key:`reference-${i}`,payload:{detailUrl:`https://styles.refero.design/style/${i}`}}));
    store.queueJobs('resolve',entries);
    assert.equal(store.jobs('resolve',['pending']).length,20);
    const interrupted=store.getJob('resolve','reference-0')!;store.start(interrupted);
    store.queueJobs('resolve',entries);
    assert.equal(store.getJob('resolve','reference-0')?.status,'running','Replaying discovery must not reset an existing job');
    assert.equal(store.jobs('resolve').length,20);
    assert.throws(()=>store.queueJobs('resolve',[{key:'partial-new',payload:{}},{key:'invalid-new',payload:{invalid:1n}}]));
    assert.equal(store.getJob('resolve','partial-new'),undefined);
    assert.equal(store.jobs('resolve').length,20);
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('config defaults cover desktop, tablet, mobile and enforce bounded settings',()=>{
  const config=parseConfig({sources:['https://example.com/']});
  assert.equal(config.freshnessDays,730);assert.equal(config.profiles.length,6);assert.equal(config.classifier.runner,'mcp');
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
    assert.deepEqual(first.jobs('capture',[]),[]);
    assert.deepEqual(first.jobs('capture',['pending','blocked']).map(j=>j.id),[capture.id]);
    assert.deepEqual(first.jobs(undefined,['blocked']).map(j=>j.id),[classification.id]);
    first.releaseLock();second.acquireLock();second.retryFailures(['classification']);assert.equal(second.getJob('classification',a.id)?.status,'pending');
    assert.equal(second.getJob('capture',a.id)?.attempts,1);
  }finally{first.close();second.close();await rm(root,{recursive:true,force:true});}
});
