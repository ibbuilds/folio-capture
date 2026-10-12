import { z } from 'zod';
import type { ReferenceRecord } from './references.ts';
import { hash } from './utils.ts';

const benchmarkSchema=z.object({
  schemaVersion:z.literal(1),datasetVersion:z.string().min(1),frozenAt:z.iso.datetime(),
  reviewProtocol:z.string().min(20),independentReview:z.literal(true),
  items:z.array(z.object({subjectId:z.string(),imageHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
    aesthetic:z.string().min(1),viewport:z.enum(['desktop','tablet','mobile']),grade:z.enum(['excellent','borderline','weak']),
    reviewer:z.string().min(1),reviewedAt:z.iso.datetime(),reason:z.string().min(10)}).strict()).min(1),
}).strict();
function proportion(success:number,total:number) {
  if(!total)return {observed:null,wilson95:null};
  const p=success/total,z=1.959963984540054,d=1+z*z/total;
  const center=(p+z*z/(2*total))/d,margin=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return {observed:p,wilson95:[Math.max(0,center-margin),Math.min(1,center+margin)]};
}
/** Offline scoring of frozen human judgments; never manufactures a gold dataset. */
export function evaluateQuality(input:unknown,records:ReferenceRecord[]) {
  const dataset=benchmarkSchema.parse(input);
  if(new Set(dataset.items.map(i=>i.subjectId)).size!==dataset.items.length)throw new Error('Duplicate benchmark subjects');
  if(dataset.items.some(i=>Date.parse(i.reviewedAt)>Date.parse(dataset.frozenAt)))throw new Error('Benchmark labels must be frozen before evaluation');
  const lookup=new Map(records.map(r=>[r.subject.id,r]));
  const rows=dataset.items.map(item=>{
    const record=lookup.get(item.subjectId);if(!record)throw new Error(`Missing saved subject ${item.subjectId}`);
    if(JSON.stringify([...item.imageHashes].sort())!==JSON.stringify(record.subject.frames.map(f=>f.sha256).sort()))throw new Error(`Benchmark pixels changed: ${item.subjectId}`);
    if(record.subject.viewport!==item.viewport)throw new Error(`Benchmark viewport mismatch: ${item.subjectId}`);
    return {...item,siteId:record.subject.siteId,verdict:record.quality.verdict,correctAcceptance:item.grade==='excellent' && record.quality.verdict==='accepted'};
  });
  const summarize=(subset:typeof rows)=>{
    const accepted=subset.filter(r=>r.verdict==='accepted');
    const excellent=subset.filter(r=>r.grade==='excellent');
    return {subjects:subset.length,accepted:accepted.length,precision:proportion(accepted.filter(r=>r.correctAcceptance).length,accepted.length),
      selectionCoverage:subset.length?accepted.length/subset.length:0,
      excellentRecall:excellent.length?excellent.filter(r=>r.verdict==='accepted').length/excellent.length:null,
      pending:subset.filter(r=>r.verdict==='pending').length,uncertain:subset.filter(r=>r.verdict==='uncertain').length,repair:subset.filter(r=>r.verdict==='repair').length};
  };
  const overall=summarize(rows);
  return {schemaVersion:1,datasetVersion:dataset.datasetVersion,datasetHash:hash(dataset),targetObservedPrecision:.98,
    targetMet:overall.precision.observed!==null&&overall.precision.observed>=.98,overall,
    byAesthetic:Object.fromEntries([...new Set(rows.map(r=>r.aesthetic))].map(a=>[a,summarize(rows.filter(r=>r.aesthetic===a))])),
    byViewport:Object.fromEntries(['desktop','tablet','mobile'].map(v=>[v,summarize(rows.filter(r=>r.viewport===v))])),
    independentSites:new Set(rows.map(r=>r.siteId)).size,
    limitations:['Human review independence is declared by the dataset, not proven by code.','Wilson intervals assume independent observations; sections and viewports from one site are correlated.','Observed precision on this set is not a guarantee for other aesthetics or future sources.'],
    rows};
}
