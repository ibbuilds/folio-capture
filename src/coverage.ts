import { join } from 'node:path';
import type { Store, CaptureRecord } from './store.ts';
import { referenceSubjects, subjectImageId, type ReferenceRecord } from './references.ts';
import { TAXONOMY, TAXONOMY_VERSION, TAXONOMY_FINGERPRINT, normalizeLabel } from './taxonomy.ts';
import { SCOPED_PROMPT_VERSION } from './quality.ts';
import { SELECTED_AESTHETICS, SELECTED_SUBSTYLES, SELECTED_COLLECTIONS, SELECTED_FAMILIES, type SelectedConcept } from './selected-taxonomy.ts';
import { DEFAULT_PROFILES } from './config.ts';
import { atomicJson, now } from './utils.ts';
import type { CaptureProfile, TaxonomyAxis } from './types.ts';
import { internalName } from './output-paths.ts';

export function hasCurrentClassification(record:ReferenceRecord):boolean {
  const c=record.classification;
  return Boolean(c && c.taxonomyVersion===TAXONOMY_VERSION && c.taxonomyFingerprint===TAXONOMY_FINGERPRINT && c.promptVersion===SCOPED_PROMPT_VERSION &&
    record.subject.frames.every(f=>c.inspectedImages.includes(subjectImageId(record.subject,f))) &&
    c.labels.every(l=>TAXONOMY[l.axis]?.some(t=>t.label===l.label)));
}

/** Decision coverage is not an aesthetic accuracy or editorial approval measurement. */
export function buildCoverage(store:Store, profiles:CaptureProfile[]=DEFAULT_PROFILES, usableIds?:Set<string>,snapshot?:{captures:CaptureRecord[];records:ReferenceRecord[]}) {
  const captures=snapshot?.captures??store.exportCaptures();
  const records=snapshot?.records??store.exportReferences();
  const byId=new Map(records.map(r=>[r.subject.id,r]));
  const subjects=captures.flatMap(c=>referenceSubjects(c.manifest!));
  const qualified=records.filter(r=>r.quality.verdict==='accepted' && !r.pruned && hasCurrentClassification(r) && (!usableIds || usableIds.has(r.subject.id)));
  const qualifiedIds=new Set(qualified.map(r=>r.subject.id));
  const buckets=new Map<string,ReferenceRecord[]>();
  for(const record of qualified) {
    const seen=new Set<string>();
    for(const label of record.classification!.labels)if(['model','human'].includes(label.provenance)) {
      const key=`${label.axis}/${label.label}`;if(seen.has(key))continue;seen.add(key);
      if(!buckets.has(key))buckets.set(key,[]);buckets.get(key)!.push(record);
    }
  }
  const tagged=new Map<string,Set<string>>();
  for(const capture of captures)for(const p of capture.manifest!.provenance)for(const raw of p.sourceLabels) {
    for(const axis of ['visual_style','aesthetic_substyle','cross_collection'] as const) {
      const label=normalizeLabel(axis,raw);if(!label || label==='unknown')continue;
      const k=`${axis}/${label}`;if(!tagged.has(k))tagged.set(k,new Set());tagged.get(k)!.add(capture.pageId);
    }
  }
  const rows=(axis:TaxonomyAxis,concepts:SelectedConcept[])=>concepts.map(c=>{
    const matches=buckets.get(`${axis}/${c.label}`)??[];
    const primary=matches.filter(r=>r.classification!.labels.some(l=>l.axis===axis && l.label===c.label && l.role==='primary'));
    const secondary=matches.filter(r=>r.classification!.labels.some(l=>l.axis===axis && l.label===c.label && l.role==='secondary'));
    const perViewport=Object.fromEntries(['desktop','tablet','mobile'].map(v=>[v,matches.filter(r=>r.subject.viewport===v).length]));
    const perProfile=Object.fromEntries(profiles.map(p=>[p.id,matches.filter(r=>r.subject.profileId===p.id).length]));
    return {id:c.id,label:c.label,displayName:c.displayName,familyId:c.familyId,parentLabel:c.parentLabel,status:c.status,
      sourceTaggedPages:tagged.get(`${axis}/${c.label}`)?.size??0,machineQualified:matches.length,
      primary:primary.length,secondary:secondary.length,independentPages:new Set(matches.map(r=>r.subject.pageId)).size,
      independentSites:new Set(matches.map(r=>r.subject.siteId)).size,perViewport,perProfile,
      missingViewports:Object.keys(perViewport).filter(v=>perViewport[v]===0),
      missingProfiles:Object.keys(perProfile).filter(p=>perProfile[p]===0),humanReviewed:null};
  });
  const aesthetics=rows('visual_style',SELECTED_AESTHETICS),substyles=rows('aesthetic_substyle',SELECTED_SUBSTYLES),collections=rows('cross_collection',SELECTED_COLLECTIONS);
  const tallies=(subset:typeof subjects)=>({collected:subset.length,unassessed:subset.filter(s=>!byId.has(s.id)).length,
    machineQualified:subset.filter(s=>qualifiedIds.has(s.id)).length,
    classificationPending:subset.filter(s=>{const r=byId.get(s.id);return r?.quality.verdict==='accepted' && !r.pruned && (!hasCurrentClassification(r) || usableIds && !usableIds.has(s.id));}).length,
    ...Object.fromEntries(['pending','rejected','uncertain','repair'].map(v=>[v,subset.filter(s=>byId.get(s.id)?.quality.verdict===v).length])),
    pruned:subset.filter(s=>byId.get(s.id)?.pruned).length});
  const resolutions=store.jobs('resolve');
  const discovery=store.jobs('discovery').map(j=>({source:j.key,status:j.status,stoppingReason:j.stoppingReason,error:j.error,
    entries:resolutions.filter(r=>r.payload.entry?.seedUrl===j.key).map(r=>({id:r.payload.entry.id,detailUrl:r.payload.entry.detailUrl,
      status:r.status,originalUrl:r.result?.originalUrl??null,error:r.error}))}));
  return {schemaVersion:1,generatedAt:now(),taxonomyVersion:TAXONOMY_VERSION,experimental:true,
    meaning:'Machine-qualified coverage from inspected current classifications, not accuracy, human approval or quotas. Source tags are unverified.',
    humanReview:{tracked:false,counts:null},totals:tallies(subjects),
    viewport:Object.fromEntries(['desktop','tablet','mobile'].map(v=>[v,tallies(subjects.filter(s=>s.viewport===v))])),
    profiles:profiles.map(p=>({profile:p,...tallies(subjects.filter(s=>s.profileId===p.id))})),
    aesthetics,substyles,collections,
    families:SELECTED_FAMILIES.map(f=>({...f,coveredAesthetics:aesthetics.filter(a=>a.familyId===f.id && a.machineQualified>0).length})),
    gaps:{aesthetics:aesthetics.filter(a=>!a.machineQualified).map(a=>a.id),substyles:substyles.filter(a=>!a.machineQualified).map(a=>a.id)},
    libraryTraversal:discovery};
}

export async function exportCoverage(store:Store,profiles:CaptureProfile[]=DEFAULT_PROFILES) {
  const result=buildCoverage(store,profiles);await atomicJson(join(store.output,internalName('coverage.json')),result);return result;
}
