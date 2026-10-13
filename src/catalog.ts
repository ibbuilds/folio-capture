import { mkdir, rename, rm, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Store } from './store.ts';
import { atomicJson, idFor, inside, now } from './utils.ts';
import { trustedAsset, retainClassification } from './quality.ts';
import type { ReferenceRecord } from './references.ts';
import type { CaptureProfile } from './types.ts';
import { hasCurrentClassification, buildCoverage } from './coverage.ts';
import { taxonomyDocument, TAXONOMY_VERSION } from './taxonomy.ts';

/** Immutable export generations: catalog.json is the single atomic publication point. */
export async function exportAccepted(store:Store,profiles?:CaptureProfile[]) {
  const captures=store.exportCaptures(),captureById=new Map(captures.map(c=>[c.id,c]));
  const records=store.exportReferences();
  const eligible=records.filter(r=>r.quality.verdict==='accepted' && hasCurrentClassification(r) && !r.pruned);
  const references=[];
  const exceptions:Array<{id:string;reason:string}>=[];
  for(const record of eligible) {
    const root=inside(store.output,record.directory);
    try {
      for(const frame of record.subject.frames) {
        const asset=await trustedAsset(root,frame.path);
        if(createHash('sha256').update(await readFile(asset)).digest('hex')!==frame.sha256)throw new Error('Image hash mismatch');
        await trustedAsset(root,frame.thumbnail);
      }
      references.push({id:record.subject.id,parentId:record.subject.parentId,siteId:record.subject.siteId,pageId:record.subject.pageId,
        sectionId:record.subject.sectionId,captureId:record.subject.captureId,scope:record.subject.scope,profileId:record.subject.profileId,
        viewport:record.subject.viewport,finalUrl:captureById.get(record.subject.captureId)?.manifest?.variants.find(v=>v.profile.id===record.subject.profileId)?.finalUrl,title:record.subject.title,order:record.subject.order,url:record.sourceUrl,
        labels:record.classification!.labels,quality:record.quality,taxonomyVersion:record.classification!.taxonomyVersion,
        provenance:captureById.get(record.subject.captureId)?.manifest?.provenance??[],
        images:record.subject.frames.map((f,order)=>({id:idFor([record.subject.captureId,f.path]),order,path:`${record.directory}/${f.path}`,
          thumbnail:`${record.directory}/${f.thumbnail}`,width:f.width,height:f.height,sha256:f.sha256,bounds:f.bounds,scrollY:f.scrollY,kind:f.kind})),
      });
    } catch(error) {
      exceptions.push({id:record.subject.id,reason:String(error)});
      record.quality.verdict='repair';record.quality.reasons=[`Export asset verification failed: ${String(error)}`];
      // Projections omit evidence/history. Repair the authoritative record, preserving both.
      const full=store.reference(record.subject.id);
      if(full){full.quality.verdict='repair';full.quality.reasons=record.quality.reasons;retainClassification(full);delete full.classification;store.saveReference(full);}
      delete record.classification;
      const job=store.getJob('quality',`${record.subject.id}:${record.quality.cacheKey}`);
      if(job)store.finish(job,'complete',{verdict:'repair'},String(error));
    }
  }
  const acceptedIds=new Set(references.map(r=>r.id));
  const graphRecords=eligible.filter(r=>acceptedIds.has(r.subject.id));
  const sites=[...new Map(graphRecords.map(r=>[r.subject.siteId,{id:r.subject.siteId,url:new URL(r.sourceUrl).origin,labels:[],assessment:'unassessed',coverage:'Only collected pages; not an exhaustive site judgment'}])).values()];
  const pages=[...new Map(graphRecords.map(r=>[r.subject.pageId,{id:r.subject.pageId,parentId:r.subject.siteId,url:r.sourceUrl,labels:[],classificationScope:'See independently assessed viewport references'}])).values()];
  const sections=[...new Map(graphRecords.filter(r=>r.subject.sectionId).map(r=>[r.subject.sectionId!,{id:r.subject.sectionId!,parentId:r.subject.pageId,title:r.subject.title,order:r.subject.order,correspondence:'inferred; labels never inherited',labels:[]}])).values()];
  const indexes:Record<string,Set<string>>={};
  const add=(key:string,id:string)=>{indexes[key]??=new Set();indexes[key].add(id);};
  const axes:Record<string,string>={visual_style:'aesthetic',aesthetic_substyle:'substyle',cross_collection:'collection',appearance:'appearance',section_purpose:'section',page_purpose:'page',experience:'experience',composition:'composition'};
  for(const reference of references) {
    add(`viewport/${reference.viewport}`,reference.id);add(`profile/${reference.profileId}`,reference.id);
    for(const label of reference.labels) {
      if(label.label==='unknown' || label.provenance==='source')continue;
      const axis=axes[label.axis]??label.axis;
      if(!/^[a-z0-9][a-z0-9_-]*$/.test(label.label))continue;
      add(`${axis}/${label.label}`,reference.id);
      if(label.axis==='visual_style' && label.role)add(`aesthetic-${label.role}/${label.label}`,reference.id);
      const concept=taxonomyDocument().axes[label.axis].find(c=>c.label===label.label);
      if(label.axis==='visual_style' && concept?.familyId)add(`family/${concept.familyId.toLowerCase()}`,reference.id);
      // Clean is a discovery synonym across aesthetics; it remains an appearance label in metadata.
      if(label.axis==='appearance' && label.label==='clean')add('aesthetic/clean',reference.id);
    }
  }
  const generation=`exports/${Date.now()}-${randomUUID().slice(0,8)}`;
  const staging=inside(store.output,`${generation}.staging`);
  await mkdir(staging,{recursive:true});
  const coverage=buildCoverage(store,profiles,acceptedIds,{captures,records});
  await atomicJson(join(staging,'coverage.json'),coverage);
  await atomicJson(join(staging,'taxonomy.json'),taxonomyDocument());
  for(const [key,ids] of Object.entries(indexes))await atomicJson(join(staging,'indexes',`${key}.json`),{schemaVersion:2,category:key,referenceIds:[...ids]},false);
  const catalog={schemaVersion:2,generatedAt:now(),experimental:true,qualityValidation:'unvalidated',editorialApproval:'unreviewed-candidates',taxonomyVersion:TAXONOMY_VERSION,
    taxonomy:`${generation}/taxonomy.json`,coverage:`${generation}/coverage.json`,assetBase:'.',generation,
    indexSemantics:{'aesthetic/clean':'Combined retrieval of supported Clean aesthetic and clean appearance; exact axes remain in reference labels. Primary/secondary aesthetic indexes contain only aesthetic claims.'},
    sites,pages,sections,references,indexes:Object.fromEntries(Object.keys(indexes).map(key=>[key,`${generation}/indexes/${key}.json`])),
    counts:{accepted:references.length,classificationPending:records.filter(r=>r.quality.verdict==='accepted'&&!r.pruned&&!hasCurrentClassification(r)).length,
      rejected:records.filter(r=>r.quality.verdict==='rejected').length,uncertain:records.filter(r=>r.quality.verdict==='uncertain').length,
      pending:records.filter(r=>r.quality.verdict==='pending').length,repair:records.filter(r=>r.quality.verdict==='repair').length},exceptions};
  await atomicJson(join(staging,'catalog.json'),catalog,false);
  await rename(staging,inside(store.output,generation));
  await atomicJson(join(store.output,'catalog.json'),catalog,false);
  await atomicJson(join(store.output,'coverage.json'),coverage);
  await atomicJson(join(store.output,'quarantine.json'),{schemaVersion:2,policy:'Logical quarantine: assets stored once at their original capture paths.',
    references:store.quarantineInventory()});
  return catalog;
}

/** Explicit, conservative removal. Unassessed, uncertain and shared assets are protected. */
export async function pruneQuarantine(store:Store,olderThanDays:number,profiles?:CaptureProfile[]) {
  if(!Number.isFinite(olderThanDays)||olderThanDays<0)throw new Error('Retention must be a nonnegative number of days.');
  const records=store.references();
  const cutoff=Date.now()-olderThanDays*86400000;
  const candidates=records.filter(r=>r.quality.verdict==='rejected' && Date.parse(r.quality.assessedAt)<=cutoff);
  const candidateIds=new Set(candidates.map(r=>r.subject.id));
  const protectedPaths=new Set<string>();
  const assets=(record:ReferenceRecord)=>record.subject.frames.flatMap(f=>[`${record.directory}/${f.path}`,`${record.directory}/${f.thumbnail}`]);
  for(const record of records)if(!candidateIds.has(record.subject.id))for(const path of assets(record))protectedPaths.add(inside(store.output,path));
  for(const capture of store.captures()) {
    if(!capture.manifest)continue;
    const subjects=records.filter(r=>r.subject.captureId===capture.id);
    for(const variant of capture.manifest.variants)for(const region of variant.regions) {
      if(!subjects.some(r=>r.subject.regionId===region.id))for(const f of region.frames)for(const path of [f.path,f.thumbnail])protectedPaths.add(inside(store.output,`${capture.directory}/${path}`));
    }
  }
  let removed=0;
  for(const record of candidates) {
    const captureRoot=inside(store.output,record.directory);
    const paths=assets(record).filter(path=>{
      const target=inside(store.output,path);inside(captureRoot,relative(captureRoot,target));
      if(!['.png','.webp'].includes(extname(target).toLowerCase()))throw new Error('Pruning is restricted to capture image assets');
      return !protectedPaths.has(target);
    });
    if(!paths.length)continue;
    // Tombstone before removal makes retry safe after interruption; original hashes/reasons remain in SQLite.
    record.pruned={at:record.pruned?.at??now(),paths:[...new Set([...(record.pruned?.paths??[]),...paths])]};
    delete record.classification;store.saveReference(record);
    for(const path of paths) {
      try {await rm(await trustedAsset(store.output,path));removed++;}
      catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    await atomicJson(join(inside(store.output,record.directory),'references.v2.json'),{schemaVersion:2,captureId:record.subject.captureId,references:store.references(record.subject.captureId)});
  }
  await exportAccepted(store,profiles);
  return {removed,retainedShared:protectedPaths.size};
}
