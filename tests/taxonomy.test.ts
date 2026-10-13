import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TAXONOMY, TAXONOMY_VERSION, TAXONOMY_AXES, normalizeLabel, validateLabelRelations, taxonomyDocument } from '../src/taxonomy.ts';
import { SELECTED_SOURCE, SELECTED_AESTHETICS, SELECTED_SUBSTYLES, SELECTED_COLLECTIONS, SELECTED_FAMILIES } from '../src/selected-taxonomy.ts';
import { validateScopedLabels } from '../src/quality.ts';
import type { ReferenceSubject } from '../src/references.ts';
import type { Label, TaxonomyAxis } from '../src/types.ts';

const subject:ReferenceSubject={id:'subject',siteId:'site',pageId:'page',captureId:'capture',parentId:'section',scope:'section',profileId:'desktop',viewport:'desktop',
  regionId:'region',title:'Fixture',frames:[],evidence:[],captureIssues:[]};
const claim=(axis:TaxonomyAxis,label:string,role?:'primary'|'secondary')=>({axis,label,evidenceIds:['frame'],confidence:'high' as const,note:'Contract fixture',...(role?{role}:{})});
const output=(claims:ReturnType<typeof claim>[])=>({labels:[...TAXONOMY_AXES.filter(a=>!['experience','page_purpose','industry','audience'].includes(a) && !claims.some(c=>c.axis===a)).map(a=>claim(a,'unknown')),...claims]});

test('runtime I.1 retains the selected identities, families and provisional substyles',()=>{
  assert.equal(SELECTED_AESTHETICS.length,60);assert.equal(SELECTED_SUBSTYLES.length,36);assert.equal(SELECTED_COLLECTIONS.length,3);assert.equal(SELECTED_FAMILIES.length,11);
  assert.equal(TAXONOMY.visual_style.length,61);assert.equal(TAXONOMY.aesthetic_substyle.length,37);
  assert.equal(TAXONOMY_AXES.length,21);assert.equal(TAXONOMY_VERSION,'3.0.0-I.1');
  assert.deepEqual(SELECTED_AESTHETICS.map(a=>a.id),SELECTED_SOURCE.aesthetics.map(a=>a.stable_id));
  assert.equal(SELECTED_FAMILIES.flatMap(f=>f.aestheticIds).length,60);
  for(const a of SELECTED_AESTHETICS) {
    assert.ok(a.definition && a.supportingTraits.length && a.counterexamples.length && a.confusingNeighbors.length);
    assert.ok(a.confusingNeighbors.every(n=>SELECTED_AESTHETICS.some(other=>other.label===n)));
    assert.equal(normalizeLabel('visual_style',a.displayName),a.label);
  }
  assert.ok(SELECTED_SUBSTYLES.every(s=>s.status==='candidate' && SELECTED_AESTHETICS.some(a=>a.label===s.parentLabel)));
  assert.ok(taxonomyDocument().referenceApproval.includes('No concepts'));
});

test('aliases normalize deliberately; broad families and related searches cannot become specific aesthetics',()=>{
  for(const alias of ['Minimal','minimalist',' minimalistic ','Minimalism'])assert.equal(normalizeLabel('visual_style',alias),'minimalism');
  assert.equal(normalizeLabel('visual_style','Frutiger Metro'),'vectordelia');
  assert.equal(normalizeLabel('visual_style','Neobrutalist'),'neobrutalism');
  assert.equal(normalizeLabel('visual_style','Brutalist'),'web-brutalism');
  assert.equal(normalizeLabel('appearance','Clean'),'clean');assert.equal(normalizeLabel('visual_style','Clean'),'clean');
  for(const broad of ['retro','futuristic','playful','organic','geometric','industrial','cinematic','flat','Memphis Lite','Slushwave'])assert.equal(normalizeLabel('visual_style',broad),undefined);
  assert.equal(normalizeLabel('experience_mode','cinematic'),'cinematic');
  assert.equal(normalizeLabel('surface_treatment','flat'),'flat');
  const original=JSON.parse(readFileSync(new URL('../docs/aesthetics/selection-i1/UI_TAXONOMY_I1_MCP_EN.json',import.meta.url),'utf8'));
  assert.equal(original.aesthetics.find((a:any)=>a.id==='A40').canonical_name,'Frutiger Metro','Supplied source snapshot is not rewritten');
});

test('mixed aesthetics have one primary, preserve independent clean appearance and reject ambiguous roles',()=>{
  const labels=validateScopedLabels(output([claim('visual_style','minimalistic','primary'),claim('visual_style','editorial','secondary'),claim('appearance','clean')]),subject,new Set(['frame']));
  assert.equal(labels.find(l=>l.axis==='visual_style' && l.role==='primary')?.conceptId,'style:minimalism');
  assert.equal(labels.find(l=>l.axis==='visual_style' && l.role==='secondary')?.label,'editorial');
  assert.equal(labels.find(l=>l.axis==='appearance')?.label,'clean');
  assert.throws(()=>validateScopedLabels(output([claim('visual_style','minimalism'),claim('visual_style','editorial')]),subject,new Set(['frame'])),/one primary/);
  assert.throws(()=>validateScopedLabels(output([claim('visual_style','minimalism','primary'),claim('visual_style','editorial','primary')]),subject,new Set(['frame'])),/one primary/);
  assert.throws(()=>validateScopedLabels(output([claim('appearance','clean','primary')]),subject,new Set(['frame'])),/Only supported aesthetics/);
  assert.throws(()=>validateScopedLabels(output([claim('visual_style','unknown'),claim('visual_style','minimalism')]),subject,new Set(['frame'])),/Unknown cannot/);
});

test('substyle needs its own frame and an explicitly evidenced parent within the same scope',()=>{
  assert.throws(()=>validateScopedLabels(output([claim('aesthetic_substyle','newsprint')]),subject,new Set(['frame'])),/parent aesthetic/);
  const labels=validateScopedLabels(output([claim('visual_style','editorial'),claim('aesthetic_substyle','newsprint')]),subject,new Set(['frame']));
  assert.equal(labels.find(l=>l.axis==='aesthetic_substyle')?.conceptId,'sub:newsprint');
  const contextual=[{...claim('visual_style','editorial'),regionId:'other',provenance:'model' as const},{...claim('aesthetic_substyle','newsprint'),regionId:'region',provenance:'model' as const}] as Label[];
  assert.throws(()=>validateLabelRelations(contextual,[],new Set(['frame'])),/parent aesthetic/);
  const unsupported=output([claim('visual_style','editorial'),{...claim('aesthetic_substyle','newsprint'),evidenceIds:[]}]);
  assert.throws(()=>validateScopedLabels(unsupported,subject,new Set(['frame'])),/inspected frame/);
  assert.throws(()=>validateScopedLabels(output([claim('visual_style','minimalism'),claim('appearance','clean'),claim('aesthetic_substyle','refined-tech')]),subject,new Set(['frame'])),/parent aesthetic/);
});

test('static visual facets never establish motion, platform or cultural membership',()=>{
  for(const [axis,label] of [['behavior','parallax'],['platform_provenance','liquid-glass'],['cross_collection','afrofuturism'],['contextual_influence','gothic']] as const)
    assert.throws(()=>validateScopedLabels(output([claim(axis,label)]),subject,new Set(['frame'])),/observed|contextual/);
  const observed={...subject,evidence:[{id:'state',regionId:'region',kind:'observed-interaction-state',value:{pattern:'parallax'}}]};
  const valid=output([{...claim('behavior','parallax'),evidenceIds:['frame','state']}]);
  assert.equal(validateScopedLabels(valid,observed,new Set(['frame'])).find(l=>l.axis==='behavior')?.label,'parallax');
  const context={...subject,evidence:[{id:'copy',regionId:'region',kind:'region-dom',value:{text:'Artist describes the work as Afrofuturism.'}}]};
  assert.equal(validateScopedLabels(output([{...claim('cross_collection','afrofuturism'),evidenceIds:['frame','copy']}]),context,new Set(['frame'])).find(l=>l.axis==='cross_collection')?.label,'afrofuturism');
  assert.throws(()=>validateScopedLabels(output([{...claim('cross_collection','afrofuturism'),evidenceIds:['copy']}]),context,new Set(['frame'])),/inspected frame/);
});
