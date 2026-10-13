import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const item = z.object({ id:z.string(), stable_id:z.string(), family_id:z.string(), label:z.string(), canonical_name:z.string(), signature:z.string(), boundary_rule:z.string() });
const schema = z.object({
  schema_version:z.literal('I.1'),
  families:z.array(z.object({id:z.string(),label:z.string(),scope:z.string(),style_ids:z.array(z.string()),count:z.number()})).length(11),
  aesthetics:z.array(item).length(60),
  substyles:z.array(z.object({id:z.string(),name:z.string(),parent_style_id:z.string(),status:z.literal('recognized_candidate')})).length(36),
  cross_collections:z.array(z.object({id:z.string(),label:z.string(),rationale:z.string()})).length(3),
  related_search_terms:z.record(z.string(),z.array(z.string())),
  facets:z.record(z.string(),z.array(z.string())),
});
const bytes = readFileSync(new URL('../docs/aesthetics/selection-i1/UI_TAXONOMY_I1_MCP_EN.json',import.meta.url));
export const SELECTED_SOURCE_HASH = createHash('sha256').update(bytes).digest('hex');
export const SELECTED_SOURCE = schema.parse(JSON.parse(bytes.toString('utf8')));
export type SelectedConcept = {
  id:string; label:string; displayName:string; definition:string; aliases:string[];
  supportingTraits:string[]; counterexamples:string[]; confusingNeighbors:string[];
  familyId?:string; parentLabel?:string; relatedSearchTerms?:string[];
  status:'selected'|'candidate'|'collection'|'facet'; evidenceRequirement:string;
};
const slug = (id:string) => id.slice(id.indexOf(':')+1);
const unique = (values:string[]) => [...new Set(values)];
const key = (value:string) => value.trim().toLowerCase();
const extraAliases:Record<string,string[]> = {
  minimalism:['minimal','minimalist','minimalistic'],
  'web-brutalism':['brutalism','brutalist','web brutalist'],
  neobrutalism:['neo-brutalism','neo-brutalist','neobrutalist'],
  vectordelia:['frutiger metro'],
  glassmorphism:['glassy'],neumorphism:['soft ui','soft-ui'],
};
const neighbors = [
  ['minimalism','clean','swiss','editorial','quiet-luxury','utilitarian'],
  ['web-brutalism','neobrutalism','anti-design'],
  ['digital-collage','grunge','acid-rave','constructivism'],
  ['geometric-pop','expressive-illustration','superflat-pop','kawaii','kidcore','wacky-pomo'],
  ['terminal-crt','retro-desktop','pixel-arcade','cassette-futurism','sci-fi-hud'],
  ['y2k-futurism','metalheart','vectorheart','hyperchrome','gen-x-soft-club'],
  ['frutiger-aero','vectordelia','glossy-web-2-0','glassmorphism'],
  ['webcore','scene-myspace','mcbling'],
  ['vaporwave','seapunk','synthwave','utopian-scholastic'],
  ['cyberpunk','biopunk','sci-fi-hud','hyperchrome'],
  ['dreamcore','weirdcore','surreal-digital','liminal-backrooms','silicon-dreams','glitch-corrupted-media'],
  ['warm-organic','global-village-coffeehouse','botanical','art-nouveau','solarpunk'],
  ['skeuomorphic','neumorphism','claymorphism','tactile-3d','glassmorphism'],
  ['art-deco','quiet-luxury','swiss'],['plakatstil','minimalism','swiss'],['op-art','geometric-pop','acid-rave'],
];
export const SELECTED_AESTHETICS:SelectedConcept[] = SELECTED_SOURCE.aesthetics.map(a => {
  const label=slug(a.stable_id);
  const aliases=unique([a.label,a.canonical_name,label.replaceAll('-',' '),...(extraAliases[label]??[])].map(key).filter(v=>v!==label));
  return {id:a.stable_id,label,displayName:a.label,familyId:a.family_id,status:'selected',aliases,
    definition:a.signature,
    supportingTraits:a.signature.split(';').map(v=>v.trim()).filter(Boolean),
    counterexamples:[a.boundary_rule,'A source tag, date, brand, or isolated decorative motif does not establish this aesthetic.'],
    confusingNeighbors:unique(neighbors.filter(group=>group.includes(label)).flat().filter(v=>v!==label)),
    relatedSearchTerms:SELECTED_SOURCE.related_search_terms[a.label]??[],
    evidenceRequirement:'A coherent visual language within this inspected subject and viewport; cite image evidence. No inference from age, source tags, or uninspected frames.'};
});
SELECTED_AESTHETICS.find(a=>a.label==='minimalism')!.definition+=' Complex UI imagery or dense content can coexist with restrained ornament. Polish alone does not disqualify Minimalism.';
SELECTED_AESTHETICS.find(a=>a.label==='utilitarian')!.definition+=' Utility-driven structure can also be sparse; density and monospace alone do not establish this aesthetic.';
SELECTED_AESTHETICS.find(a=>a.label==='tactile-3d')!.definition+=' A static rendered scene can establish material character without proving manipulation or interaction.';
SELECTED_AESTHETICS.find(a=>a.label==='web-brutalism')!.definition+=' Intentional rawness must be supported; basic early HTML or broken CSS alone is insufficient.';
// These notes interpret the selected names for recognition, not instructions to execute.
// They are provisional until the creator supplies independently reviewed UI examples.
const substyleTraits:Record<string,string> = {
  newsprint:'Newspaper-like columns, mastheads, rules and typographic reading hierarchy.',
  'refined-tech':'Polished technical interfaces with precise controls, restrained depth and a consistent engineered visual system.',
  'new-ugly':'Deliberately discordant typography, awkward scale and contradictory graphic choices, organized intentionally.',
  'programmer-art':'Intentionally crude utilitarian graphics and improvised controls used as a consistent expressive language.',
  'zine-cut-and-paste':'Photocopied cutouts, pasted type, paper seams and visibly assembled editorial layers.',
  'pen-and-pixel':'Dense commercial collage with exaggerated metallic lettering, sparkle and composited imagery.',
  cyberdelia:'Psychedelic technological collage, intense distortion and electronic/rave graphic language.',
  'corporate-grunge':'Distressed typography and worn textures consistently combined with commercial identity and interface structure.',
  'indie-sleaze':'Flash photography, rough type and deliberately scrappy nightlife/editorial collage.',
  'memphis-milano':'Playful geometric patterns, clashing colors, squiggles and asymmetric decorative structures.',
  'blob-world':'Soft rounded rendered objects, amorphous volumes and tactile toy-like scenes.',
  'preschool-pop':'Childlike primary shapes, simple educational characters and playful learning-material graphics.',
  'corporate-memphis':'Flat stylized people with exaggerated proportions, modular shapes and a consistent illustrative system.',
  'monochrome-bitmap':'One-bit icons, pixel lettering, sharp window borders and black/white desktop interface grammar.',
  'beveled-desktop':'Classic desktop windows and widgets defined by stepped bevels, gray panels and mechanical control edges.',
  'skinned-player':'Custom media-player shells with integrated transport controls, nonstandard contours and material skins.',
  'pc-98':'Japanese vintage computer graphics with constrained palettes, crisp bitmap glyphs and period desktop/menu conventions.',
  '8-bit':'Consistently coarse pixel grids, limited palettes and tile-based lettering or interface controls.',
  'neo-y2k':'A deliberate reinterpretation of millennium techno geometry, synthetic shine and digital type; publication date cannot establish it.',
  chromecore:'Chrome reflections and metallic interface forms organize a millennium-futurist visual system.',
  'neo-vectorheart':'Reinterpreted angular vector construction, technical diagrams and hard-edged industrial typography.',
  'frutiger-eco':'Glossy optimistic technology combined with explicit ecological imagery and natural environments.',
  'dark-aero':'Translucent glossy Aero-like surfaces and techno-naturalist motifs presented in a dark luminous environment.',
  dorfic:'Sleek glossy techno forms and abstract streamlined orange/white graphic treatments within an Aero-related system.',
  vectorbloom:'Dense flat vector flowers, foliage, curls and ornamental growth organize the composition.',
  'old-web-early-html':'Document-like early-web links, plain controls, separators and simple table/module structure used as a coherent web vernacular.',
  'geocities-diy':'Personal-web backgrounds, badges, animated graphics and heterogeneous handmade modules.',
  'portal-directory':'Dense linked categories, compact modules and directory/search entry points organized as a recognizable web portal.',
  scenecore:'Scene profile modules, emo symbols, bright accents, glitter and personalized social-web layering.',
  mallsoft:'Consumer-space nostalgia with shopping-mall imagery, signage and spacious retail atmospheres.',
  signalwave:'Broadcast fragments, station identifiers, analog signal residue and interrupted commercial-media presentation.',
  cybercore:'A coherent digital-cybernetic treatment of interfaces, circuitry, synthetic surfaces and network-era symbols.',
  lcars:'Rounded segmented instrument panels, colored horizontal bands, capsule shapes and Star Trek LCARS-like data layouts.',
  poolrooms:'Empty tiled aquatic interiors, repetitive pools and disorienting transitional space.',
  'frosted-glass':'Translucent diffused surfaces reveal blurred underlying imagery and visibly layered depth.',
  'spatial-glass':'Glass panels arranged with depth, perspective and spatial separation; a still image cannot prove spatial navigation.',
};
export const SELECTED_SUBSTYLES:SelectedConcept[] = SELECTED_SOURCE.substyles.map(s=>{
  const parent=SELECTED_AESTHETICS.find(a=>a.id===SELECTED_SOURCE.aesthetics.find(a=>a.id===s.parent_style_id)?.stable_id);
  const label=slug(s.id),definition=substyleTraits[label];
  if(!parent || !definition)throw new Error(`Unresolved selected substyle ${s.id}`);
  return {id:s.id,label,displayName:s.name,parentLabel:parent.label,familyId:parent.familyId,status:'candidate',
    definition,aliases:unique([key(s.name),label.replaceAll('-',' ')].filter(v=>v!==label)),supportingTraits:[definition],
    counterexamples:[`A ${parent.displayName} label alone does not establish ${s.name}.`,'One illustration, platform name or source tag is insufficient.'],
    confusingNeighbors:SELECTED_SOURCE.substyles.filter(other=>other.parent_style_id===s.parent_style_id && other.id!==s.id).map(other=>slug(other.id)),
    evidenceRequirement:'Independent inspected UI evidence of the subtype AND an explicitly supported parent aesthetic within this same subject. Candidate label; not human certification.'};
});
export const SELECTED_COLLECTIONS:SelectedConcept[] = SELECTED_SOURCE.cross_collections.map(c=>({
  id:c.id,label:slug(c.id),displayName:c.label,definition:c.rationale,aliases:[key(c.label)],status:'collection',supportingTraits:[c.rationale],
  counterexamples:['Generic visual motifs do not prove cultural membership, attribution, artistic intent or implementation technique.'],confusingNeighbors:['unknown'],
  evidenceRequirement:'Inspected images and directly captured contextual or attribution evidence; source tags and visual resemblance alone are insufficient.',
}));
export const SELECTED_FAMILIES=SELECTED_SOURCE.families.map(f=>({id:f.id,label:f.label,definition:f.scope,
  aestheticIds:f.style_ids.map(id=>SELECTED_SOURCE.aesthetics.find(a=>a.id===id)?.stable_id)}));

const all=[...SELECTED_AESTHETICS,...SELECTED_SUBSTYLES,...SELECTED_COLLECTIONS];
if(new Set(all.map(a=>a.id)).size!==all.length)throw new Error('Duplicate selected concept IDs');
for(const family of SELECTED_SOURCE.families) {
  const members=SELECTED_SOURCE.aesthetics.filter(a=>a.family_id===family.id);
  if(members.length!==family.count || members.length!==family.style_ids.length || members.some(a=>!family.style_ids.includes(a.id)))throw new Error(`Invalid selected family ${family.id}`);
}
for(const group of [SELECTED_AESTHETICS,SELECTED_SUBSTYLES,SELECTED_COLLECTIONS]) {
  const aliases=new Map<string,string>();
  for(const concept of group)for(const alias of [concept.label,...concept.aliases]) {
    if(aliases.has(alias)&&aliases.get(alias)!==concept.label)throw new Error(`Ambiguous alias ${alias}`);
    aliases.set(alias,concept.label);
  }
}
