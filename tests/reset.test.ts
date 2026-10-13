import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.ts';
import {resetOutput} from '../src/reset.ts';
import {serveBridgeHttp} from '../src/mcp.ts';
import {parseConfig} from '../src/config.ts';
import {main as cli} from '../src/cli.ts';

async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'folio-reset-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3}));
  const output=join(root,'output'),config=join(root,'sources.yaml');await writeFile(config,'output: ./output\nsources: [https://example.test/]\n');
  const store=new Store(output);const page=store.page('https://old.test/');store.folder(page);store.createCapture(page,'signature','captures/old.test/home/old','.staging/old.test','old');store.job('workflow-history','old-run',{runId:'old'});store.saveAsset('old-hash','captures/old.test/home/old/old.png');store.rememberRedirect(page.id,'https://old.test/alias');store.close();
  for(const name of ['captures','.staging','categories','review','exports','reports']){await mkdir(join(output,name),{recursive:true});await writeFile(join(output,name,'old.json'),'Wrong previous output');}
  for(const name of ['index.json','catalog.json','coverage.json','quarantine.json','file-views.json','quality-evaluation.json','report.html'])await writeFile(join(output,name),'Wrong previous output');
  await writeFile(join(output,'my-notes.txt'),'Keep my notes');return {root,output,config};
}

test('clean resets all collection history, assets and views while preserving sources and unrelated files',async t=>{
  const {output,config}=await fixture(t);await cli(['reset','--config',config]);
  const store=new Store(output);try{
    for(const table of ['jobs','pages','page_urls','page_folders','captures','reference_records','assets'])assert.equal(store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,0,table);
    assert.equal(store.asset('old-hash'),undefined);assert.equal(store.page('https://old.test/').latestCaptureId,null);
  }finally{store.close();}
  await assert.rejects(access(join(output,'captures')));await assert.rejects(access(join(output,'exports')));await assert.rejects(access(join(output,'.folio-reset.json')));
  assert.equal(await readFile(join(output,'my-notes.txt'),'utf8'),'Keep my notes');assert.ok((await readFile(config,'utf8')).includes('sources:'));
  await resetOutput(output,config);
});

test('reset refuses active collectors and unpaired waiting bridges without removing anything',async t=>{
  const {output,config}=await fixture(t);const store=new Store(output);store.acquireLock();
  try{await assert.rejects(resetOutput(output,config),/Another Folio/);}finally{store.close();}
  const server=await serveBridgeHttp(parseConfig({output,sources:['https://example.test/']}),0);
  try{await assert.rejects(resetOutput(output,config),/Stop the Folio engine/);assert.ok(await readFile(join(output,'catalog.json')));}
  finally{await new Promise<void>(accept=>server.close(()=>accept()));}
  await resetOutput(output,config);
});

test('an interrupted reset blocks collection until cleanup is retried successfully',async t=>{
  const {output,config}=await fixture(t);await assert.rejects(resetOutput(output,config,async()=>{throw new Error('Interrupted reset');}),/Interrupted reset/);
  assert.throws(()=>new Store(output),/reset was interrupted/);
  await resetOutput(output,config);const store=new Store(output);try{assert.equal(store.jobs().length,0);assert.equal(store.captures().length,0);}finally{store.close();}
});

test('reset refuses repository/config ancestors and linked roots and preserves external hard-linked assets',async t=>{
  const {root,output,config}=await fixture(t);await assert.rejects(resetOutput(resolve('.'),config),/dedicated output/);await assert.rejects(resetOutput(root,config),/dedicated output/);
  const outside=join(root,'external');await mkdir(outside);await writeFile(join(outside,'keep.txt'),'Outside output');
  const linked=join(root,'linked-output');await symlink(output,linked,process.platform==='win32'?'junction':'dir');
  await assert.rejects(resetOutput(linked,config),/Linked output/);assert.ok(await readFile(join(output,'catalog.json')));
  const {link}=await import('node:fs/promises');await link(join(outside,'keep.txt'),join(output,'captures','shared.png'));await symlink(outside,join(output,'captures','external-link'),process.platform==='win32'?'junction':'dir');
  await resetOutput(output,config);assert.equal(await readFile(join(outside,'keep.txt'),'utf8'),'Outside output');
});
