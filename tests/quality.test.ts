import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, access, stat } from 'node:fs/promises';
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
  const config=parseConfig({output:root,sources:[page.url],classifier:{runner:'codex'}});
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

test('a broken section cannot quarantine its healthy siblings, while legacy unknown warnings stay conservative',async t=>{
  const {store,config,manifest,directory}=await setup(t);
  const variant=manifest.variants[0],broken=variant.regions[1];
  const message=`Section ${broken.id} remained hidden within the configured readiness budget.`;
  variant.status='incomplete';variant.warnings=[message];variant.issues=[{regionId:broken.id,message}];
  variant.coverage=[{start:0,end:200}];broken.frames=[];manifest.status='incomplete';
  store.publishCapture(manifest,directory);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const records=store.references();
  assert.equal(records.find(r=>r.subject.regionId===variant.regions[0].id)!.quality.verdict,'accepted');
  assert.equal(records.find(r=>r.subject.regionId===broken.id)!.quality.verdict,'repair');
  assert.equal(records.find(r=>r.subject.scope==='page'&&r.subject.profileId===variant.profile.id)!.quality.verdict,'repair');
  delete variant.issues;
  assert(referenceSubjects(manifest).find(s=>s.regionId===variant.regions[0].id)!.captureIssues.includes(message),'Unscoped old warnings cannot be declared harmless');
});

test('a complete section with empty viewport evidence is repaired without grading the wrong screenshot',async t=>{
  const {store,config,manifest,directory}=await setup(t);const variant=manifest.variants[0],region=variant.regions[0];
  region.referenceKind='section';variant.evidence.push({id:'wrong-crop-state',regionId:region.id,kind:'capture-state',value:{bounds:region.bounds,dom:{scope:'visible-frame',text:'',headings:[],media:[]}}});
  store.publishCapture(manifest,directory);let calls=0;
  const subject=referenceSubjects(manifest).find(subject=>subject.regionId===region.id)!;
  await curateCapture(store,'fixture',config,{subjectId:subject.id,runProcess:async()=>{calls++;throw new Error('Wrong pixels must never reach a classifier');}});
  assert.equal(calls,0);assert.equal(store.reference(subject.id)!.quality.verdict,'repair');assert.match(store.reference(subject.id)!.quality.reasons.join(' '),/recapture/);
});

test('export detects inconsistent legacy crops through compact evidence checks and preserves prior decisions',async t=>{
  const {store,config,manifest,directory}=await setup(t),variant=manifest.variants[0],region=variant.regions[0];
  region.referenceKind='section';store.publishCapture(manifest,directory);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner({allAccept:true})});
  assert.equal((await exportAccepted(store)).references.length,6);
  const original=store.references().find(record=>record.subject.regionId===region.id)!;
  variant.evidence.push({id:'legacy-wrong-crop',regionId:region.id,kind:'capture-state',value:{bounds:region.bounds,dom:{scope:'visible-frame',text:'',headings:[],media:[]}}});
  store.publishCapture(manifest,directory);
  const checks=store.exportEvidenceChecks();assert(!JSON.stringify(checks).includes('Excellent'),'DOM presence is checked without decoding complete text');
  assert.equal((await exportAccepted(store)).references.length,4,'Only the affected section and its whole-page claim require repair');
  const repaired=store.reference(original.subject.id)!;
  assert.equal(repaired.quality.verdict,'repair');assert.equal(repaired.qualityHistory!.at(-1)!.verdict,'accepted');
  assert.deepEqual(repaired.classificationHistory!.at(-1),original.classification);assert(repaired.subject.evidence.length);
  const mobile=store.references().find(record=>record.subject.profileId==='mobile'&&record.subject.scope==='page')!;
  assert.equal(mobile.quality.verdict,'accepted');
});

test('scoped Codex reviews repair invalid responses within the configured budget and never retry authentication failures',async t=>{
  const {store,config,manifest}=await setup(t);
  const subject=referenceSubjects(manifest).find(s=>s.title==='Excellent'&&s.profileId==='desktop')!;
  const base=mockRunner();let calls=0;
  await curateCapture(store,'fixture',config,{subjectId:subject.id,runProcess:async(...args)=>{
    if(++calls===1)return {stdout:'',stderr:'',lastMessage:'{}'};
    if(calls===2)assert.match(args[2].prompt,/LOCAL_VALIDATION_FEEDBACK/);
    return base(...args);
  }});
  assert.equal(calls,4);assert.equal(store.reference(subject.id)!.quality.verdict,'accepted');
  assert.equal(store.jobs('quality-assessment')[0].attempts,2);
  calls=0;
  await curateCapture(store,'fixture',config,{subjectId:subject.id,reassess:true,runProcess:async()=>{calls++;return {stdout:'',stderr:'',lastMessage:'invalid JSON'};}});
  assert.equal(calls,config.classifier.maxAttempts);assert.equal(store.reference(subject.id)!.quality.verdict,'pending');
  calls=0;
  await curateCapture(store,'fixture',config,{subjectId:subject.id,reassess:true,runProcess:async()=>{calls++;throw new Error('Authentication unavailable; login required');}});
  assert.equal(calls,1);assert.equal(store.reference(subject.id)!.quality.verdict,'pending');
});

test('reclassification moves readable views without invalidating current or historical catalog asset paths',async t=>{
  const {store,config,root}=await setup(t);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const before=await exportAccepted(store),image=before.references[0].images[0];
  const record=store.reference(before.references[0].id)!;
  record.classification!.labels.find(label=>label.axis==='visual_style')!.label=TAXONOMY.visual_style.find(concept=>!['unknown','minimalism'].includes(concept.label))!.label;
  store.saveReference(record);
  const after=await exportAccepted(store);
  assert.equal(after.references[0].images[0].path,image.path);
  assert.notEqual(after.fileViews.publishedImages[image.path],before.fileViews.publishedImages[image.path]);
  const historical=JSON.parse(await readFile(join(root,before.generation,'catalog.json'),'utf8'));
  assert.equal(createHash('sha256').update(await readFile(join(root,historical.references[0].images[0].path))).digest('hex'),image.sha256);
});

test('identical observed states consume one image slot without copying judgments to another subject',async t=>{
  const {store,config,manifest,directory}=await setup(t);
  const region=manifest.variants[0].regions[0];region.frames=Array.from({length:30},()=>({...region.frames[0]}));
  store.publishCapture(manifest,directory);config.quality!.maxImages=1;
  const subject=referenceSubjects(manifest).find(subject=>subject.regionId===region.id)!;
  const base=mockRunner();let deliveries=0;
  await curateCapture(store,'fixture',config,{subjectId:subject.id,runProcess:async(...args)=>{const images=args[1].filter(argument=>argument==='--image');assert.equal(images.length,1);deliveries+=images.length;return base(...args);}});
  assert.equal(deliveries,3);assert.equal(store.reference(subject.id)!.quality.verdict,'accepted');
  assert.equal(store.references().length,1,'Other scopes remain unassessed');
});

test('an accepted page with no qualifying sections has a visible category entry without promoting section decisions',async t=>{
  const {store,config,root}=await setup(t),base=mockRunner({allAccept:true});
  await curateCapture(store,'fixture',config,{runProcess:async(...args)=>{
    const data=JSON.parse(args[2].prompt.match(/^EVIDENCE_DATA=(.*)$/m)![1]);
    if(!args[2].prompt.startsWith('Classify')&&!(data.scope==='page'&&data.profile==='desktop'))return {stdout:'',stderr:'',lastMessage:JSON.stringify(pass(data.images[0].id,6))};
    return base(...args);
  }});
  const catalog=await exportAccepted(store);assert.equal(catalog.references.length,1);assert.equal(catalog.references[0].scope,'page');
  for(const image of catalog.references[0].images){const view=catalog.fileViews.publishedImages[image.path];assert.match(view,/^categories\/minimalism\/.*\/whole-page\//);await access(join(root,view));}
  assert(store.references().filter(record=>record.subject.scope==='section').every(record=>record.quality.verdict==='rejected'));
  assert.equal(Object.keys(catalog.fileViews.publishedImages).length,2,'Only accepted page images are visible; rejected variants stay in internal quarantine');
});

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
  const clean=JSON.parse(await readFile(join(root,catalog.indexes['appearance/clean']),'utf8'));
  const testimonials=JSON.parse(await readFile(join(root,catalog.indexes['section/testimonials']),'utf8'));
  assert.deepEqual(clean.referenceIds,testimonials.referenceIds);
  assert.match(catalog.references[0].images[0].path,/^captures\//,'Catalog paths remain stable when readable categories change');
  assert.match(catalog.fileViews.publishedImages[catalog.references[0].images[0].path],/^categories\/minimalism\//);
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

test('readable category views use hard links and safely preserve user files during updates and pruning',async t=>{
  const {store,config,root}=await setup(t);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner()});
  const catalog=await exportAccepted(store);
  assert.equal(catalog.fileViews.exceptions.length,0);
  const inventory=JSON.parse(await readFile(join(root,'.folio/file-views.json'),'utf8'));
  const image=inventory.files.find((f:any)=>f.path.startsWith('categories/minimalism/')&&f.source)!;
  assert.ok(image);
  assert.equal(inventory.files.filter((f:any)=>f.source===image.source).length,1,'One visible image across all classifications and parent scopes');
  const canonical=await stat(join(root,image.source)),linked=await stat(join(root,image.path));
  assert.equal(linked.ino,canonical.ino);assert.equal(linked.dev,canonical.dev);
  const notePath=image.path.replace(/[^/]+$/,'my-notes.txt');await writeFile(join(root,notePath),'User notes');
  const metadata=image.path.replace(/[^/]+$/,'reference.json');
  const metadataBefore=await stat(join(root,metadata));
  await exportAccepted(store);
  assert.equal((await stat(join(root,metadata))).mtimeMs,metadataBefore.mtimeMs,'Unchanged managed metadata is reused');
  await writeFile(join(root,metadata),'User replacement');
  assert.ok((await exportAccepted(store)).fileViews.exceptions.some(e=>e.path===metadata));
  const selected=store.references().find(r=>r.quality.verdict==='accepted')!;
  selected.quality.verdict='rejected';store.saveReference(selected);
  await pruneQuarantine(store,0);
  await assert.rejects(access(join(root,image.path)));
  assert.equal(await readFile(join(root,notePath),'utf8'),'User notes');
  assert.equal(await readFile(join(root,metadata),'utf8'),'User replacement');
});

test('accepted viewport variants share one section folder and rejected images do not clutter review',async t=>{
  const {store,config,root}=await setup(t);
  await curateCapture(store,'fixture',config,{runProcess:mockRunner({allAccept:true})});
  const catalog=await exportAccepted(store);
  const sections=catalog.references.filter(reference=>reference.scope==='section'&&reference.title==='Excellent');assert.equal(sections.length,2);
  const paths=sections.map(reference=>catalog.fileViews.publishedImages[reference.images[0].path]);
  assert.equal(paths[0].split('/').slice(0,-1).join('/'),paths[1].split('/').slice(0,-1).join('/'),'Desktop and mobile belong to the same section folder');
  const metadata=JSON.parse(await readFile(join(root,paths[0].replace(/[^/]+$/,'reference.json')),'utf8'));
  assert.deepEqual(new Set(metadata.variants.map((variant:any)=>variant.profileId)),new Set(['desktop','mobile']));
  assert.equal(new Set(metadata.variants.flatMap((variant:any)=>variant.images.map((image:any)=>image.path))).size,2);
  for(const record of store.references()){if(record.subject.profileId==='mobile'){record.quality.verdict='rejected';store.saveReference(record);}}
  const changed=await exportAccepted(store);assert(Object.values(changed.fileViews.publishedImages).every(path=>!path.includes('--mobile--')));
  const inventory=JSON.parse(await readFile(join(root,'.folio/file-views.json'),'utf8'));assert(!inventory.files.some((file:any)=>file.path.startsWith('review/')&&file.source));
  assert(store.references().some(record=>record.subject.profileId==='mobile'&&record.quality.verdict==='rejected'),'Quarantine retains decisions; organization does not delete evidence');
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
  config.classifier.runner='mcp';await curateCapture(store,'fixture',config);
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
  for(const category of ['aesthetic/pixel-arcade','aesthetic/y2k-futurism','substyle/8-bit']) {
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

test('export projections preserve authoritative evidence/history when a shared asset needs repair',async t=>{
  const {store,config,root,directory}=await setup(t);await curateCapture(store,'fixture',config,{runProcess:mockRunner({allAccept:true})});
  const record=store.references().find(r=>r.subject.scope==='section' && r.subject.profileId==='desktop' && r.subject.order===0)!;
  record.classificationHistory=[{...record.classification!,taxonomyVersion:'2.0.0'}];record.qualityHistory=[{...record.quality,verdict:'rejected'}];store.saveReference(record);
  const original=JSON.stringify(store.reference(record.subject.id));
  assert.ok(store.exportReferences().every(r=>r.subject.evidence.length===0 && !r.classificationHistory && !r.qualityHistory));
  assert.ok(store.exportCaptures().every(c=>c.manifest!.variants.every(v=>v.evidence.length===0)));
  assert.equal(JSON.stringify(store.reference(record.subject.id)),original,'Projections never modify stored evidence');
  store.capture=()=>{throw new Error('Export must not reload manifests per reference');};
  store.references=()=>{throw new Error('Export must not decode every historical reference');};
  assert.equal((await exportAccepted(store)).references.length,6);
  await writeFile(join(root,directory,record.subject.frames[0].path),'Changed asset');
  const catalog=await exportAccepted(store);assert.equal(catalog.exceptions.length,2,'Page and section share the invalid asset');
  const repaired=store.reference(record.subject.id)!;
  assert.equal(repaired.quality.verdict,'repair');assert.ok(repaired.subject.evidence.length);
  assert.equal(repaired.qualityHistory!.length,1);assert.equal(repaired.classificationHistory!.length,2);
  const quarantine=JSON.parse(await readFile(join(root,'.folio/quarantine.json'),'utf8'));
  assert.ok(quarantine.references.some((r:any)=>r.id===record.subject.id && r.verdict==='repair'));
});
