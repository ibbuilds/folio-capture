import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { Store } from '../src/store.ts';
import { heuristicClassification, enrichClassification } from '../src/classification.ts';
import { atomicJson, inside } from '../src/utils.ts';
import type { PageManifest, EvidenceItem } from '../src/types.ts';

const sourceRoot=resolve('validation-output/live');
const store=new Store(sourceRoot);
const candidates=store.latestCaptures().filter(c=>c.manifest?.variants.some(v=>v.profile.id==='desktop' && v.regions.some(r=>r.frames.length)));
const captured=candidates.find(c=>c.manifest?.requestedUrl==='https://linear.app/') ?? candidates[0];
store.close();
if(!captured?.manifest)throw new Error('Run live capture validation before the classifier smoke test.');
const originalVariant=captured.manifest.variants.find(v=>v.profile.id==='desktop')!;
const contentRegions=originalVariant.regions.filter(r=>r.frames.length && r.title!=='Navigation');
const selected=[contentRegions[0],...contentRegions.filter(r=>r.method!=='viewport-fallback').slice(0,2)].filter((r,i,list)=>r && list.indexOf(r)===i).map(r=>({...r,frames:[r.frames[0]]}));
const root=resolve('validation-output/classifier-smoke');await mkdir(root,{recursive:true});
for(const region of selected)for(const frame of region.frames)for(const asset of [frame.path,frame.thumbnail]){const destination=inside(root,asset);await mkdir(dirname(destination),{recursive:true});await copyFile(inside(inside(sourceRoot,captured.directory),asset),destination);}
const evidence:EvidenceItem[]=originalVariant.evidence.filter(e=>!e.regionId || selected.some(r=>r.id===e.regionId));
const manifest:PageManifest={...captured.manifest,captureId:`smoke-${captured.id}`,status:'incomplete',reviewStatus:'needs-review',variants:[{...originalVariant,regions:selected,evidence,coverage:[],status:'incomplete',warnings:['A three-region sample for classifier verification; this is not a whole-page catalog capture.']} ]};
await atomicJson(join(root,'manifest.json'),manifest);await atomicJson(join(root,'evidence.json'),{items:evidence});
const base=heuristicClassification(manifest,evidence);
const settings={runner:'codex' as const,command:'codex',timeoutMs:180000,maxAttempts:1};
const result=await enrichClassification({manifest,evidence,base,settings,outputDir:root});
await atomicJson(join(root,'classification.json'),result);
console.log(JSON.stringify({status:result.status,model:result.model,axes:[...new Set(result.labels.filter(l=>l.provenance==='model').map(l=>l.axis))],modelLabels:result.labels.filter(l=>l.provenance==='model'),warnings:result.warnings},null,2));
