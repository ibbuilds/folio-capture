import { chromium, type Browser } from 'playwright';
import { mkdir, rename, readFile, stat, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { captureViewport } from './capture.ts';
import { discoverRefero, isReferoLibrary, resolveReferoEntry } from './discovery.ts';
import { heuristicClassification, enrichClassification, classificationCacheKey } from './classification.ts';
import { Store, type CaptureRecord, type PageRecord } from './store.ts';
import { exportCatalog } from './report.ts';
import { atomicJson, canonicalUrl, delay, errorMessage, hash, inside, isRelatedDestination, jsonFile, now } from './utils.ts';
import type { Config, EvidenceItem, PageManifest, Source, ViewportCapture, Provenance, Classification, DiscoveredEntry } from './types.ts';

export type RunOptions = { captureOnly?: boolean; refresh?: boolean; retry?: boolean; classifyOnly?: boolean; source?: string; limit?: number; signal?: AbortSignal; log?: (message:string)=>void };
export type RunSummary = { discovered:number; captured:number; reused:number; unresolved:number; blocked:number; failed:number; classified:number; pendingClassification:number; interrupted:boolean };

export async function validateCaptureFiles(root: string, manifest: PageManifest): Promise<boolean> {
  try {
    if (!manifest.variants.length) return false;
    for (const variant of manifest.variants) for (const region of variant.regions) for (const frame of region.frames) {
      const buffer = await readFile(inside(root,frame.path));
      if (createHash('sha256').update(buffer).digest('hex') !== frame.sha256) return false;
      const metadata = await sharp(buffer).metadata();
      if (metadata.width !== frame.width || metadata.height !== frame.height) return false;
      const thumbnail=await sharp(await readFile(inside(root,frame.thumbnail))).metadata();
      if(!thumbnail.width || !thumbnail.height || thumbnail.format!=='webp')return false;
    }
    return manifest.variants.every(v=>v.status !== 'complete' || v.regions.some(r=>r.frames.length));
  } catch { return false; }
}

function combinedStatus(variants: ViewportCapture[]): PageManifest['status'] {
  if (variants.every(v=>v.status==='complete')) return 'complete';
  if (variants.some(v=>v.regions.some(r=>r.frames.length))) return 'incomplete';
  if (variants.some(v=>v.status==='blocked')) return 'blocked';
  return 'failed';
}

function evidenceFor(manifest: PageManifest): EvidenceItem[] {
  const items:EvidenceItem[]=[...manifest.variants.flatMap(v=>v.evidence),...manifest.variants.flatMap(v=>v.regions.flatMap(r=>r.frames.map(f=>({id:`image:${r.id}:${f.sha256}`,regionId:r.id,kind:'image',value:{path:f.path,width:f.width,height:f.height,sha256:f.sha256,bounds:f.bounds,scrollY:f.scrollY}})))),...manifest.provenance.flatMap((p,i)=>p.sourceLabels.map((label,j)=>({id:`manifest:source-label:${i}:${j}`,kind:'source-label',value:label})))];
  return [...new Map(items.map(item=>[item.id,item])).values()];
}

async function recoverPublished(store: Store, log: (message:string)=>void) {
  for (const c of store.captures().filter(c=>c.status==='running')) {
    for (const directory of [c.directory,c.stagingDirectory].filter((d): d is string=>Boolean(d))) {
      try {
        const root = inside(store.output,directory);
        const manifest = await jsonFile<PageManifest>(join(root,'manifest.json'));
        if (manifest.captureId!==c.id || !(await validateCaptureFiles(root,manifest))) continue;
        if (directory!==c.directory) { await mkdir(dirname(inside(store.output,c.directory)),{recursive:true}); await rename(root,inside(store.output,c.directory)); }
        store.publishCapture(manifest,c.directory);
        await atomicJson(join(inside(store.output,c.directory),'evidence.json'),{schemaVersion:1,captureId:c.id,items:evidenceFor(manifest)});
        let classification:Classification;
        try{classification=await jsonFile<Classification>(join(inside(store.output,c.directory),'classification.json'));if(classification.captureId!==c.id)throw new Error('Mismatched classification');}
        catch{classification=heuristicClassification(manifest,evidenceFor(manifest));await atomicJson(join(inside(store.output,c.directory),'classification.json'),classification);}
        store.saveClassification(c.id,classification);
        const job=store.getJob('capture',`${c.pageId}:${c.signature}`);
        if(job)store.finish(job,manifest.status,{captureId:c.id},undefined,'recovered_publication');
        log(`Recovered published capture ${c.id}.`);
        break;
      } catch { /* An unfinished viewport can resume from its job result. */ }
    }
  }
}

export async function runPipeline(config: Config, options: RunOptions = {}): Promise<RunSummary> {
  const log = options.log ?? console.log;
  const summary:RunSummary={discovered:0,captured:0,reused:0,unresolved:0,blocked:0,failed:0,classified:0,pendingClassification:0,interrupted:false};
  const store=new Store(config.output);
  let browser:Browser|undefined;
  let locked=false;
  let classifierUnavailable=false;
  const visited=new Set<string>();
  const captureSignature = (source:Source) => hash({ version:1,playwright:'1.62.1',profiles:config.profiles,capture:{...config.capture,preserveSelectors:[...config.capture.preserveSelectors,...source.preserveSelectors??[]],dismissSelectors:[...config.capture.dismissSelectors,...source.dismissSelectors??[]]} });
  const checkInterrupted=()=>options.signal?.throwIfAborted();

  async function classify(capture:CaptureRecord, force=false) {
    if(!capture.manifest)return;
    const manifest=capture.manifest;
    const outputDir=inside(config.output,capture.directory);
    const evidence=evidenceFor(manifest);
    const key=classificationCacheKey(manifest,evidence,config.classifier);
    let base:Classification;
    if(capture.classification?.cacheKey===key && capture.classification.status==='enriched' && !force)return;
    base=heuristicClassification(manifest,evidence);
    base.cacheKey=key;
    await atomicJson(join(outputDir,'classification.json'),base);
    store.saveClassification(capture.id,base);
    const job=store.job('classification',`${capture.id}:${key}`,{captureId:capture.id});
    if(config.classifier.runner==='none'){store.finish(job,'complete',{captureId:capture.id,mode:'heuristic'});return;}
    if(options.captureOnly || classifierUnavailable){
      if(!options.captureOnly){base.status='pending';await atomicJson(join(outputDir,'classification.json'),base);store.saveClassification(capture.id,base);}
      if(job.status!=='complete')store.finish(job,'pending',undefined,classifierUnavailable?'Classifier unavailable in this run':undefined);
      summary.pendingClassification++;
      return;
    }
    if(['blocked','failed'].includes(job.status) && !options.retry && !force){summary.pendingClassification++;return;}
    for(let attempt=0;attempt<config.classifier.maxAttempts;attempt++){
      checkInterrupted();store.start(job);
      try {
        const enriched=await enrichClassification({manifest,evidence,base,settings:config.classifier,outputDir,signal:options.signal});
        enriched.cacheKey=key;
        await atomicJson(join(outputDir,'classification.json'),enriched);
        store.saveClassification(capture.id,enriched);
        store.finish(job,'complete',{captureId:capture.id});summary.classified++;return;
      }catch(error){
        if(options.signal?.aborted)throw error;
        const message=errorMessage(error);log(`Classification pending: ${message}`);
        if(/auth|quota|usage.?limit|rate.?limit|not found|ENOENT|login|model.*(unavailable|unsupported)|tool/i.test(message)){classifierUnavailable=true;store.finish(job,'blocked',undefined,message);break;}
        store.finish(job,'pending',undefined,message);
        if(attempt+1<config.classifier.maxAttempts)await delay(1000*(attempt+1),options.signal);
      }
    }
    base.status='pending';base.warnings.push('Visual enrichment is pending; deterministic labels remain available.');
    await atomicJson(join(outputDir,'classification.json'),base);store.saveClassification(capture.id,base);summary.pendingClassification++;
  }

  async function processPage(url:string,provenance:Provenance,source:Source){
    checkInterrupted();const page=store.page(url,provenance);const signature=captureSignature(source);const key=`${page.id}:${signature}`;
    if(visited.has(key)){
      const prior=page.latestCaptureId?store.capture(page.latestCaptureId):undefined;
      if(prior?.manifest){
        prior.manifest.provenance=page.provenance;await atomicJson(join(inside(config.output,prior.directory),'manifest.json'),prior.manifest);store.publishCapture(prior.manifest,prior.directory);
        await atomicJson(join(inside(config.output,prior.directory),'evidence.json'),{schemaVersion:1,captureId:prior.id,items:evidenceFor(prior.manifest)});
        if(prior.classification){
          const updated=heuristicClassification(prior.manifest,evidenceFor(prior.manifest));
          const merged={...prior.classification,sourceLabels:updated.sourceLabels,labels:[...prior.classification.labels.filter(l=>l.provenance!=='source'),...updated.labels.filter(l=>l.provenance==='source')],cacheKey:classificationCacheKey(prior.manifest,evidenceFor(prior.manifest),config.classifier)};
          await atomicJson(join(inside(config.output,prior.directory),'classification.json'),merged);store.saveClassification(prior.id,merged);
        }
      }
      return;
    }
    if(options.limit && summary.captured+summary.reused>=options.limit)return;
    visited.add(key);
    const reusable=!options.refresh && store.latestUsable(page.id,signature,config.freshnessDays);
    if(reusable && reusable.manifest && await validateCaptureFiles(inside(config.output,reusable.directory),reusable.manifest)){
      reusable.manifest.provenance=page.provenance;
      await atomicJson(join(inside(config.output,reusable.directory),'manifest.json'),reusable.manifest);
      await atomicJson(join(inside(config.output,reusable.directory),'evidence.json'),{schemaVersion:1,captureId:reusable.id,items:evidenceFor(reusable.manifest)});
      store.publishCapture(reusable.manifest,reusable.directory);
      log(`Reuse ${page.url}`);summary.reused++;await classify(reusable);return;
    }
    const job=store.job('capture',key,{pageId:page.id,url:page.url,source});
    if(['blocked','failed','incomplete'].includes(job.status) && !options.retry && !options.refresh){
      log(`Recorded ${job.status}; use retry or --refresh: ${page.url}`);
      const prior=page.latestCaptureId?store.capture(page.latestCaptureId):undefined;
      if(prior?.manifest?.variants.some(v=>v.regions.some(r=>r.frames.length)))await classify(prior);
      return;
    }
    store.start(job);
    const existing=store.inProgressCapture(page.id,signature);
    const captureId=existing?.id ?? `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
    const directory=existing?.directory ?? `captures/${page.id}/${captureId}`;
    const stagingDirectory=existing?.stagingDirectory ?? `captures/${page.id}/.staging-${captureId}`;
    const root=inside(config.output,stagingDirectory);
    await mkdir(root,{recursive:true});
    if(!existing)store.createCapture(page,signature,directory,stagingDirectory,captureId);
    log(`Capture ${page.url}`);
    const variants:ViewportCapture[]=[];
    const previousAttempt=!options.refresh && page.latestCaptureId ? store.capture(page.latestCaptureId) : undefined;
    for(const profile of config.profiles){
      checkInterrupted();
      const viewportJob=store.job('viewport',`${captureId}:${profile.id}`,{pageId:page.id,captureId,profile:profile.id});
      const existingVariant=viewportJob.result as ViewportCapture|null;
      if(viewportJob.status==='complete' && existingVariant && await validateCaptureFiles(root,{variants:[existingVariant]} as PageManifest)){variants.push(existingVariant);continue;}
      const previousVariant=previousAttempt?.signature===signature && Date.parse(previousAttempt.createdAt)>=Date.now()-config.freshnessDays*86400000 ? previousAttempt.manifest?.variants.find(v=>v.profile.id===profile.id && v.status==='complete') : undefined;
      if(previousVariant && await validateCaptureFiles(inside(config.output,previousAttempt!.directory),{variants:[previousVariant]} as PageManifest)){
        const assets=new Set(previousVariant.regions.flatMap(r=>r.frames.flatMap(f=>[f.path,f.thumbnail])));
        if(previousVariant.overview)assets.add(previousVariant.overview);
        for(const asset of assets){const destination=inside(root,asset);await mkdir(dirname(destination),{recursive:true});await copyFile(inside(inside(config.output,previousAttempt!.directory),asset),destination);}
        const reusedVariant={...previousVariant,environment:{...previousVariant.environment,reusedFromCaptureId:previousAttempt!.id}};
        await atomicJson(join(root,profile.id,'result.json'),reusedVariant);store.finish(viewportJob,'complete',reusedVariant,undefined,'reused_complete_viewport');variants.push(reusedVariant);log(`  ${profile.id}: reuse verified viewport from ${previousAttempt!.id}`);continue;
      }
      let result:ViewportCapture|undefined;
      for(let attempt=0;attempt<config.capture.maxAttempts;attempt++){
        checkInterrupted();store.start(viewportJob);
        const timeout=AbortSignal.timeout(config.capture.attemptTimeoutMs);
        const signal=options.signal ? AbortSignal.any([timeout,options.signal]) : timeout;
        try {
          result=await captureViewport({browser:browser!,url:page.url,profile,settings:{...config.capture,preserveSelectors:[...config.capture.preserveSelectors,...source.preserveSelectors??[]],dismissSelectors:[...config.capture.dismissSelectors,...source.dismissSelectors??[]]},outputDir:root,onProgress:message=>log(`  ${profile.id}: ${message}`),signal});
          if(!isRelatedDestination(page.url,result.finalUrl)){result.status='blocked';result.warnings.push(`Unrelated destination: ${result.finalUrl}`);result.stoppingReason='unrelated_redirect';}
        }catch(error){
          if(options.signal?.aborted)throw error;
          result={profile,status:'failed',requestedUrl:page.url,finalUrl:page.url,title:'',capturedAt:now(),pageHeight:0,regions:[],evidence:[],warnings:[errorMessage(error)],interventions:[],coverage:[],stoppingReason:'attempt_error',environment:{}};
        }
        await atomicJson(join(root,profile.id,'result.json'),result);
        store.finish(viewportJob,result.status,result,result.status==='complete'?undefined:result.warnings.join('; '),result.stoppingReason);
        if(result.status==='complete' || result.status==='blocked')break;
        if(attempt+1<config.capture.maxAttempts)await delay(1000*(attempt+1),options.signal);
      }
      variants.push(result!);
    }
    const status=combinedStatus(variants);
    const manifest:PageManifest={schemaVersion:1,pageId:page.id,captureId,captureSignature:signature,requestedUrl:page.url,title:variants.find(v=>v.title)?.title ?? page.url,capturedAt:now(),status,reviewStatus:status==='complete' && variants.every(v=>!v.interventions.some(i=>i.method.includes('style')||!i.verified))?'unreviewed':'needs-review',provenance:store.page(page.url).provenance,variants};
    await atomicJson(join(root,'evidence.json'),{schemaVersion:1,captureId,items:evidenceFor(manifest)});
    await atomicJson(join(root,'manifest.json'),manifest);
    const base=heuristicClassification(manifest,evidenceFor(manifest));
    await atomicJson(join(root,'classification.json'),base);
    await mkdir(dirname(inside(config.output,directory)),{recursive:true});
    await rename(root,inside(config.output,directory));
    store.publishCapture(manifest,directory);store.saveClassification(captureId,base);
    store.finish(job,status,{captureId},status==='complete'?undefined:variants.flatMap(v=>v.warnings).join('; '));
    summary.captured++;if(status==='blocked')summary.blocked++;if(status==='failed')summary.failed++;
    const saved=store.capture(captureId)!;
    if(variants.some(v=>v.regions.some(r=>r.frames.length)))await classify(saved);
    if(summary.captured===1 || summary.captured%10===0)await exportCatalog(store);
  }

  async function resolveAndCapture(entry:DiscoveredEntry,source:Source){
    const job=store.job('resolve',`${entry.seedUrl}:${entry.id}`,{entry,source});
    if(['failed','blocked','incomplete'].includes(job.status) && !options.retry)return;
    let resolved=job.result;
    if(job.status!=='complete' || options.refresh){
      const previousResolution=resolved;
      for(let attempt=0;attempt<2;attempt++){
        checkInterrupted();store.start(job);
        try{resolved=await resolveReferoEntry({browser:browser!,entryUrl:entry.detailUrl,settings:config.discovery,signal:options.signal});store.finish(job,'complete',resolved);break;}
        catch(error){const message=errorMessage(error);const blocked=/login|paywall|captcha|access|forbidden|403|401|missing original|no original/i.test(message);store.finish(job,blocked?'blocked':'failed',previousResolution ?? undefined,message);if(blocked || attempt===1){summary.unresolved++;log(`Unresolved reference: ${entry.detailUrl} — ${message}`);return;}await delay(1000,options.signal);}
      }
    }
    if(!resolved?.originalUrl){summary.unresolved++;return;}
    await processPage(resolved.originalUrl,{seedUrl:entry.seedUrl,listingUrl:entry.listingUrl,detailUrl:entry.detailUrl,discoveredAt:entry.discoveredAt,sourceLabels:resolved.sourceLabels ?? [],previewUrl:resolved.previewUrl},source);
  }

  try {
    store.acquireLock();locked=true;store.recoverRunning();await recoverPublished(store,log);
    if(options.retry)store.retryFailures();
    if(options.classifyOnly){for(const capture of store.latestCaptures().filter(c=>c.manifest && (!options.source || c.manifest.provenance.some(p=>canonicalUrl(p.seedUrl)===canonicalUrl(options.source!)) || canonicalUrl(c.manifest.requestedUrl)===canonicalUrl(options.source!)) && c.manifest.variants.some(v=>v.regions.some(r=>r.frames.length)))){checkInterrupted();await classify(capture,Boolean(options.refresh));if(options.limit && summary.classified>=options.limit)break;}return summary;}
    browser=await chromium.launch({channel:'chromium',headless:true});
    const sources=options.source ? config.sources.filter(s=>canonicalUrl(s.url)===canonicalUrl(options.source!)) : config.sources;
    if(!sources.length)throw new Error('The selected source is not in sources.yaml.');
    for(const source of sources){
      checkInterrupted();
      if(options.limit && summary.captured+summary.reused>=options.limit)break;
      for(const pendingCapture of store.jobs('capture',['pending']).filter(j=>j.payload.source?.url===source.url)){
        const pendingPage=store.page(pendingCapture.payload.url);
        const origin=pendingPage.provenance.find(p=>p.seedUrl===source.url);
        if(origin)await processPage(pendingPage.url,origin,source);
        if(options.limit && summary.captured+summary.reused>=options.limit)break;
      }
      if(options.limit && summary.captured+summary.reused>=options.limit)break;
      const library=source.kind==='library' || (source.kind==='auto' && isReferoLibrary(source.url));
      if(!library){
        await processPage(source.url,{seedUrl:source.url,discoveredAt:now(),sourceLabels:[]},source);continue;
      }
      const discoveryJob=store.job('discovery',source.url,{source});
      if(!isReferoLibrary(source.url)){store.finish(discoveryJob,'unsupported',undefined,'This library needs a dedicated adapter. Refero Styles is supported in v1.');continue;}
      for(const pending of store.jobs('resolve',['pending']).filter(j=>j.payload.entry?.seedUrl===source.url)){await resolveAndCapture(pending.payload.entry,source);if(options.limit && summary.captured+summary.reused>=options.limit)break;}
      if(options.limit && summary.captured+summary.reused>=options.limit){store.finish(discoveryJob,'incomplete',undefined,'Capture limit reached','capture_limit');break;}
      store.start(discoveryJob);log(`Discover ${source.url}`);
      for await(const event of discoverRefero({browser,seed:source,settings:config.discovery,onProgress:log,signal:options.signal})){
        checkInterrupted();
        if(event.type==='entry'){
          store.job('resolve',`${event.entry.seedUrl}:${event.entry.id}`,{entry:event.entry,source});summary.discovered++;
          await resolveAndCapture(event.entry,source);
          if(options.limit && summary.captured+summary.reused>=options.limit){store.finish(discoveryJob,'incomplete',undefined,'Capture limit reached','capture_limit');break;}
        }else store.finish(discoveryJob,event.reason==='incomplete'?'incomplete':'complete',event,event.error,event.reason);
      }
    }
    return summary;
  }catch(error){
    if(options.signal?.aborted){summary.interrupted=true;log('Interrupted. Saved jobs will resume on the next run.');return summary;}
    throw error;
  }finally{
    try{await browser?.close();}finally{try{if(locked)await exportCatalog(store);}finally{store.close();}}
  }
}
