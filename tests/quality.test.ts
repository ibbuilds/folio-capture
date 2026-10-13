import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { evaluateQuality } from '../src/evaluation.ts';
import { validateStoredCapture } from '../src/pipeline.ts';
import { Store } from '../src/store.ts';
import { parseConfig } from '../src/config.ts';
import { curateCapture, validateQualityPass, validateScopedLabels, CRITERIA, combinePasses } from '../src/quality.ts';
import { exportAccepted, pruneQuarantine } from '../src/catalog.ts';
import { referenceSubjects, subjectImageId } from '../src/references.ts';
import { TAXONOMY, TAXONOMY_VERSION, normalizeLabel } from '../src/taxonomy.ts';
import { buildCoverage } from '../src/coverage.ts';
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
  assert.equal(selected.classification!.labels.find(l=>l.axis==='visual_style')!.label,'minimalism');
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
  assert.equal(await validateStoredCapture(store,store.capture('fixture')!),true,'Pruned rejected frames do not trigger recapture');
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
  assert.equal(normalizeLabel('visual_style','minimalistic'),'minimalism');
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

test('offline evaluation reports precision uncertainty and rejects changed benchmark pixels',async t=>{
  const {store,config}=await setup(t);await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const records=store.references();
  const dataset={schemaVersion:1,datasetVersion:'synthetic-contract-only',frozenAt:'2026-10-12T00:00:00Z',independentReview:true,
    reviewProtocol:'Synthetic contract fixture; this is not an actual human-reviewed aesthetic benchmark.',
    items:records.map(r=>({subjectId:r.subject.id,imageHashes:r.subject.frames.map(f=>f.sha256),aesthetic:'minimal',viewport:r.subject.viewport,
      grade:r.quality.verdict==='accepted'?'excellent':'weak',reviewer:'fixture-only',reviewedAt:'2026-10-11T00:00:00Z',reason:'Synthetic expected label for evaluator mechanics only.'}))};
  const result=evaluateQuality(dataset,records);assert.equal(result.overall.precision.observed,1);assert.ok(result.overall.precision.wilson95![0]<.98);
  assert.equal(result.overall.selectionCoverage,1/6);assert.equal(result.independentSites,1);
  for(const r of records)r.quality.verdict='uncertain';assert.equal(evaluateQuality(dataset,records).overall.precision.observed,null);
  dataset.items[0].imageHashes=['0'.repeat(64)];assert.throws(()=>evaluateQuality(dataset,records),/pixels changed/);
});

test('usage limits disable subsequent curation calls in the same collection run',async t=>{
  const {store,config}=await setup(t);const runtime={unavailable:false};let calls=0;
  await curateCapture(store,'fixture',config,{runtime,runProcess:mockRunner({failure:()=>{calls++;return true;}})});
  assert.equal(runtime.unavailable,true);assert.equal(calls,1);
  await curateCapture(store,'fixture',config,{runtime,runProcess:mockRunner({counter:()=>calls++})});
  assert.equal(calls,1);assert.ok(store.references().every(r=>r.quality.verdict==='pending'));
});

test('coverage separates source claims, current selection, viewport gaps and honest traversal states',async t=>{
  const {store,config,manifest,directory,root}=await setup(t);
  manifest.provenance=[{seedUrl:'https://styles.refero.design/',discoveredAt:new Date().toISOString(),sourceLabels:['Vaporwave','Minimalistic','Newsprint']}];
  store.publishCapture(manifest,directory);
  const discovery=store.job('discovery','https://styles.refero.design/',{});store.finish(discovery,'complete',{},undefined,'plateau');
  for(const [id,status] of [['resolved','complete'],['missing-original','blocked']] as const) {
    const job=store.job('resolve',id,{entry:{id,seedUrl:'https://styles.refero.design/',detailUrl:`https://styles.refero.design/detail/${id}`}});
    store.finish(job,status,status==='complete'?{originalUrl:manifest.requestedUrl}:undefined,status==='blocked'?'Missing original link':undefined);
  }
  await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const catalog=await exportAccepted(store,config.profiles);
  const coverage=JSON.parse(await readFile(join(root,catalog.coverage),'utf8')) as ReturnType<typeof buildCoverage>;
  assert.equal(coverage.aesthetics.length,60);assert.equal(coverage.substyles.length,36);assert.equal(coverage.profiles.length,6);
  assert.equal(coverage.totals.collected,6);assert.equal(coverage.totals.machineQualified,1);
  const minimal=coverage.aesthetics.find(a=>a.label==='minimalism')!;
  assert.equal(minimal.machineQualified,1);assert.equal(minimal.primary,1);assert.equal(minimal.sourceTaggedPages,1);
  assert.equal(minimal.perViewport.desktop,1);assert.equal(minimal.perViewport.tablet,0);assert.equal(minimal.perViewport.mobile,0);
  const vapor=coverage.aesthetics.find(a=>a.label==='vaporwave')!;assert.equal(vapor.sourceTaggedPages,1);assert.equal(vapor.machineQualified,0);
  assert.ok(coverage.gaps.aesthetics.includes('style:vaporwave'));
  assert.equal(coverage.humanReview.tracked,false);assert.equal(minimal.humanReviewed,null);
  assert.equal(coverage.libraryTraversal[0].stoppingReason,'plateau');assert.equal(coverage.libraryTraversal[0].entries.length,2);
  assert.equal(coverage.libraryTraversal[0].entries.find(e=>e.id==='missing-original')?.status,'blocked');
  const taxonomy=JSON.parse(await readFile(join(root,catalog.taxonomy),'utf8'));assert.equal(taxonomy.version,TAXONOMY_VERSION);
  assert.equal(taxonomy.axes.visual_style.length,61);
});

test('taxonomy upgrade retains historical labels, excludes stale exports, and reclassifies saved pixels only',async t=>{
  const {store,config,root,directory}=await setup(t);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const record=store.references().find(r=>r.quality.verdict==='accepted')!;
  record.classification!.taxonomyVersion='2.0.0';record.classification!.labels.find(l=>l.axis==='visual_style')!.label='minimal';
  store.saveReference(record);
  const old=JSON.stringify(record.classification);
  const stale=await exportAccepted(store);assert.equal(stale.references.length,0);assert.equal(stale.counts.classificationPending,1);
  let calls=0;
  await curateCapture(store,'fixture',config,{classifyOnly:true,runProcess:mockRunner({counter:()=>calls++})});
  assert.equal(calls,1,'Quality passes reused; only the stale accepted classification runs');
  const upgraded=store.references().find(r=>r.subject.id===record.subject.id)!;
  assert.equal(upgraded.classification!.taxonomyVersion,TAXONOMY_VERSION);
  assert.equal(JSON.stringify(upgraded.classificationHistory![0]),old);
  assert.equal((await exportAccepted(store)).references.length,1);
  assert.equal(createHash('sha256').update(await readFile(join(root,directory,'desktop-0.png'))).digest('hex'),upgraded.subject.frames[0].sha256);
});

test('failed taxonomy upgrade leaves the reference pending with old classification retained as history',async t=>{
  const {store,config}=await setup(t);await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const record=store.references().find(r=>r.quality.verdict==='accepted')!;
  record.classification!.taxonomyVersion='2.0.0';store.saveReference(record);
  await curateCapture(store,'fixture',config,{classifyOnly:true,runProcess:mockRunner({failure:()=>true})});
  const pending=store.references().find(r=>r.subject.id===record.subject.id)!;
  assert.equal(pending.quality.verdict,'accepted');assert.equal(pending.classification,undefined);
  assert.equal(pending.classificationHistory![0].taxonomyVersion,'2.0.0');
  assert.equal((await exportAccepted(store)).references.length,0);
  assert.equal(buildCoverage(store).totals.classificationPending,1);
});

test('partial classification image coverage cannot enter the current catalog',async t=>{
  const {store,config}=await setup(t);await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const record=store.references().find(r=>r.quality.verdict==='accepted')!;
  record.classification!.inspectedImages=[];store.saveReference(record);
  assert.equal((await exportAccepted(store)).references.length,0);
  assert.equal(buildCoverage(store).totals.classificationPending,1);
  let calls=0;await curateCapture(store,'fixture',config,{classifyOnly:true,runProcess:mockRunner({counter:()=>calls++})});
  assert.equal(calls,1);assert.equal((await exportAccepted(store)).references.length,1);
});

test('mixed aesthetics and numeric substyles share one asset and keep their retrieval scopes',async t=>{
  const {store,config,root}=await setup(t);
  const ordinary=mockRunner();
  const mixed:ClassifierProcessRunner=async(command,args,request)=>{
    const result=await ordinary(command,args,request);
    if(request.prompt.startsWith('Classify')) {
      const value=JSON.parse(result.lastMessage!);
      const style=value.labels.find((l:any)=>l.axis==='visual_style');style.label='pixel-arcade';style.role='primary';
      value.labels.find((l:any)=>l.axis==='aesthetic_substyle').label='8-bit';
      value.labels.push({...style,label:'y2k-futurism',role:'secondary'});
      result.lastMessage=JSON.stringify(value);
    }
    return result;
  };
  await curateCapture(store,'fixture',config,{runProcess:mixed});
  const catalog=await exportAccepted(store);assert.equal(catalog.references.length,1);assert.equal(catalog.references[0].images.length,1);
  const id=catalog.references[0].id;
  for(const category of ['aesthetic/pixel-arcade','aesthetic/y2k-futurism','aesthetic-primary/pixel-arcade','aesthetic-secondary/y2k-futurism','substyle/8-bit']) {
    assert.deepEqual(JSON.parse(await readFile(join(root,catalog.indexes[category]),'utf8')).referenceIds,[id]);
  }
  const coverage=buildCoverage(store);
  assert.equal(coverage.aesthetics.find(a=>a.label==='pixel-arcade')?.primary,1);
  assert.equal(coverage.aesthetics.find(a=>a.label==='y2k-futurism')?.secondary,1);
  assert.equal(coverage.substyles.find(a=>a.label==='8-bit')?.machineQualified,1);
});

test('reassessment and forced refresh retain prior scoped decisions and classifications',async t=>{
  const {store,config}=await setup(t);await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const accepted=store.references().find(r=>r.quality.verdict==='accepted')!;
  const before=JSON.stringify(accepted.quality);
  await curateCapture(store,'fixture',config,{reassess:true,runProcess:mockRunner()});
  const reassessed=store.references().find(r=>r.subject.id===accepted.subject.id)!;
  assert.equal(JSON.stringify(reassessed.qualityHistory![0]),before);
  assert.equal(reassessed.classificationHistory!.length,1);
  await curateCapture(store,'fixture',config,{classifyOnly:true,reclassify:true,runProcess:mockRunner()});
  assert.equal(store.references().find(r=>r.subject.id===accepted.subject.id)!.classificationHistory!.length,2);
});
