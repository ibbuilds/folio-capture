import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Store } from '../src/store.ts';
import { parseConfig } from '../src/config.ts';
import { curateCapture, validateQualityPass, validateScopedLabels, CRITERIA, combinePasses } from '../src/quality.ts';
import { exportAccepted, pruneQuarantine } from '../src/catalog.ts';
import { referenceSubjects, subjectImageId } from '../src/references.ts';
import { TAXONOMY, normalizeLabel } from '../src/taxonomy.ts';
import type { PageManifest, Region } from '../src/types.ts';
import type { ClassifierProcessRunner } from '../src/classification.ts';

async function setup(t:any) {
  const root=await mkdtemp(join(tmpdir(),'folio-quality-'));const store=new Store(root);store.acquireLock();
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true,maxRetries:4});});
  const page=store.page('https://example.test/');const directory=`captures/${page.id}/fixture`;await mkdir(join(root,directory),{recursive:true});
  const variants=[];
  for(const [profileId,width] of [['desktop',1440],['mobile',390]] as const) {
    const regions:Region[]=[];
    for(const [order,title] of ['Excellent','Weak'].entries()) {
      const path=`${profileId}-${order}.png`,thumbnail=`${profileId}-${order}.webp`;
      const bytes=await sharp({create:{width:20,height:20,channels:3,background:order?'#888':'#fff'}}).png().toBuffer();
      await sharp(bytes).toFile(join(root,directory,path));await sharp(bytes).webp().toFile(join(root,directory,thumbnail));
      const bounds={x:0,y:order*200,width,height:200};const id=`${profileId}-${order}`;
      regions.push({id,title,order,selector:`section:nth-of-type(${order+1})`,bounds,captureBounds:bounds,method:'semantic',boundaryConfidence:'high',evidenceIds:[`${id}-dom`],
        frames:[{path,thumbnail,width:20,height:20,sha256:createHash('sha256').update(bytes).digest('hex'),bounds,scrollY:bounds.y,kind:'static'}]});
    }
    variants.push({profile:{id:profileId,width,height:800,dpr:2,isMobile:profileId==='mobile',hasTouch:profileId==='mobile'},status:'complete' as const,
      requestedUrl:page.url,finalUrl:page.url,title:'Whole page',capturedAt:new Date().toISOString(),pageHeight:400,regions,
      evidence:regions.map(r=>({id:`${r.id}-dom`,regionId:r.id,kind:'region-dom',value:{title:r.title,text:r.title}})),warnings:[],interventions:[],coverage:[{start:0,end:400}],stoppingReason:'covered',environment:{}});
  }
  const manifest:PageManifest={schemaVersion:1,pageId:page.id,captureId:'fixture',captureSignature:'sig',requestedUrl:page.url,title:'Whole page',capturedAt:new Date().toISOString(),status:'complete',reviewStatus:'unreviewed',provenance:[],variants};
  store.createCapture(page,'sig',directory,'staging','fixture');store.publishCapture(manifest,directory);
  const config=parseConfig({output:root,sources:[page.url]});
  return {root,store,manifest,config,directory};
}
function pass(id:string,score=9,verdict: 'accept'|'reject'|'uncertain'|'repair'=score>=9?'accept':'reject') {
  return {score,verdict,evidenceIds:[id],reasons:['Fixture criterion judgment; not real aesthetic validation'],weaknesses:score>=9?[]:['Weak hierarchy'],
    criteria:Object.fromEntries(CRITERIA.map(c=>[c,{score,evidenceIds:[id],reason:'Fixture evidence'}]))};
}
function mockRunner(options:{failure?:()=>boolean;counter?:()=>void;allAccept?:boolean}={}):ClassifierProcessRunner {
  return async(_command,args,request)=>{
    options.counter?.();assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('shell_tool'));assert.ok(args.includes('model_reasoning_effort="high"'));
    if(options.failure?.())throw new Error('Simulated usage limit');
    const data=JSON.parse(request.prompt.match(/^EVIDENCE_DATA=(.*)$/m)![1]);
    const id=data.images[0].id;
    let value:unknown;
    if(request.prompt.startsWith('Classify')) {
      const axes=Object.keys(TAXONOMY).filter(a=>data.scope==='page'?a!=='section_purpose':!['experience','page_purpose','industry','audience'].includes(a));
      value={labels:axes.map(axis=>({axis,label:axis==='appearance'?'clean':axis==='visual_style'?'minimalistic':axis==='section_purpose'?'testimonials':'unknown',evidenceIds:[id],confidence:'high',note:'Fixture'}))};
    } else value=pass(id, options.allAccept || data.scope==='section' && data.title==='Excellent' && data.profile==='desktop'?9:6);
    return {stdout:'',stderr:'',lastMessage:JSON.stringify(value),model:'fixture-model'};
  };
}

test('scopes, mixed labels and viewport acceptance preserve images once and reject weak parents',async t=>{
  const {store,config,root,manifest,directory}=await setup(t);
  const original=JSON.stringify(manifest);
  let calls=0;
  await curateCapture(store,'fixture',config,{runProcess:mockRunner({counter:()=>calls++})});
  const records=store.references();assert.equal(records.length,6);
  assert.equal(records.filter(r=>r.quality.verdict==='accepted').length,1);
  const selected=records.find(r=>r.quality.verdict==='accepted')!;
  assert.equal(selected.subject.scope,'section');assert.equal(selected.subject.profileId,'desktop');
  assert.equal(selected.classification!.labels.find(l=>l.axis==='visual_style')!.label,'minimal');
  assert.ok(records.filter(r=>r.subject.scope==='page').every(r=>r.quality.verdict==='rejected'));
  const catalog=await exportAccepted(store);assert.equal(catalog.references.length,1);
  const clean=JSON.parse(await readFile(join(root,catalog.indexes['aesthetic/clean']),'utf8'));
  const testimonials=JSON.parse(await readFile(join(root,catalog.indexes['section/testimonials']),'utf8'));
  assert.deepEqual(clean.referenceIds,testimonials.referenceIds);
  assert.equal(catalog.references[0].images[0].path,`${directory}/desktop-0.png`);
  assert.equal(JSON.stringify(store.capture('fixture')!.manifest),original,'Legacy manifest untouched');
  await curateCapture(store,'fixture',config,{runProcess:mockRunner({counter:()=>calls++})});
  assert.equal(calls,13,'Two quality passes per subject and one accepted enrichment, all cached');
  const result=await pruneQuarantine(store,0);assert.ok(result.removed>0);
  await access(join(root,directory,'desktop-0.png'));
  await assert.rejects(access(join(root,directory,'desktop-1.png')));
  assert.equal((await exportAccepted(store)).references.length,1);
  assert.ok(store.references().some(r=>r.pruned && r.quality.reasons.length && r.subject.frames[0].sha256));
});

test('interrupted critique resumes the saved first pass; model errors never accept',async t=>{
  const {store,config}=await setup(t);let calls=0;
  await curateCapture(store,'fixture',config,{runProcess:mockRunner({failure:()=>++calls===2})});
  assert.equal(store.references().filter(r=>r.quality.verdict==='accepted').length,0);
  assert.equal(store.references().filter(r=>r.quality.assessment).length,1);
  assert.equal(store.references().filter(r=>r.quality.critique).length,0);
  const pending=store.jobs('quality-critique')[0];store.start(pending);assert.equal(store.recoverRunning(),1);
  let resumed=0;await curateCapture(store,'fixture',config,{runProcess:mockRunner({counter:()=>resumed++})});
  assert.equal(resumed,12,'Completed assessment is not repeated');
  assert.equal(store.jobs('quality-critique').every(j=>j.status==='complete'),true);
});

test('capture problems and unsampled frames cannot become negative design judgments or accepted exports',async t=>{
  const {store,config,manifest,directory}=await setup(t);
  manifest.variants[0].warnings.push('Broken image detected');
  manifest.variants[1].regions[0].frames.push(...manifest.variants[1].regions[0].frames);
  store.publishCapture(manifest,directory);config.quality!.maxImages=1;
  await curateCapture(store,'fixture',config,{captureOnly:true});
  assert.equal(store.references().filter(r=>r.quality.verdict==='repair').length,3);
  assert.ok(store.references().some(r=>r.quality.verdict==='uncertain'));
  assert.equal((await exportAccepted(store)).references.length,0);
});

test('quality validators reject invented evidence and contradictory 9–10 claims',()=>{
  assert.throws(()=>validateQualityPass(pass('other'),new Set(['image']),new Set(['image'])));
  assert.throws(()=>validateQualityPass(pass('image',8,'accept'),new Set(['image']),new Set(['image'])));
  const a=pass('image');assert.equal(combinePasses(a,pass('image',6)),'uncertain');
  assert.equal(combinePasses(a,pass('image',6,'repair')),'repair');
  assert.equal(normalizeLabel('visual_style','minimalistic'),'minimal');
  assert.equal(normalizeLabel('appearance','clean'),'clean');
  for(const concepts of Object.values(TAXONOMY))for(const c of concepts){assert.ok(c.definition);assert.ok(c.supportingTraits.length);assert.ok(c.counterexamples.length);assert.ok(Array.isArray(c.aliases));}
});

test('parent labels and foreign section evidence are rejected by scoped classification',async t=>{
  const {manifest}=await setup(t);const subject=referenceSubjects(manifest).find(s=>s.scope==='section')!;
  const id=subjectImageId(subject,subject.frames[0]);
  assert.throws(()=>validateScopedLabels({labels:[{axis:'page_purpose',label:'landing',evidenceIds:[id],confidence:'high',note:''}]},subject,new Set([id])));
  assert.throws(()=>validateScopedLabels({labels:[{axis:'visual_style',label:'invented-aesthetic',evidenceIds:[id],confidence:'high',note:''}]},subject,new Set([id])));
});

test('unassessed captures and assets shared with accepted pages survive quarantine pruning',async t=>{
  const {store,config,root,directory}=await setup(t);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner({allAccept:true})});
  const rejected=store.references().find(r=>r.subject.scope==='section')!;
  rejected.quality.verdict='rejected';store.saveReference(rejected);
  assert.equal((await pruneQuarantine(store,0)).removed,0);
  await access(join(root,directory,rejected.subject.frames[0].path));
});
