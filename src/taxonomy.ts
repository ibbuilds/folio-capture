import type { TaxonomyAxis, Label, EvidenceItem } from './types.ts';
import { SELECTED_AESTHETICS, SELECTED_SUBSTYLES, SELECTED_COLLECTIONS, SELECTED_SOURCE, SELECTED_SOURCE_HASH, SELECTED_FAMILIES } from './selected-taxonomy.ts';

export const TAXONOMY_VERSION = '3.0.0-I.1';
export const CLASSIFIER_PROMPT_VERSION = '3.0.0';

export type TaxonomyDefinition = { label: string; definition: string; aliases: string[]; supportingTraits: string[]; counterexamples: string[]; confusingNeighbors: string[]; id?:string; displayName?:string; familyId?:string; parentLabel?:string; relatedSearchTerms?:string[]; status?:string; evidenceRequirement?:string };
const entries = (values: Record<string, string>): TaxonomyDefinition[] =>
  Object.entries(values).map(([label, definition]) => ({ label, definition, aliases: [], supportingTraits: [definition], counterexamples: ['A source tag alone does not establish this concept.'], confusingNeighbors: [] }));

/** Labels describe the captured evidence, not the unseen product or brand. */
export const TAXONOMY: Record<TaxonomyAxis, TaxonomyDefinition[]> = {
  experience: entries({
    marketing: 'Promotes a product, service, organization, or event.',
    'product-ui': 'An interactive software interface or its visible interface state.',
    commerce: 'Browsing or purchasing goods and services.',
    editorial: 'Articles, news, publications, or other reading experiences.',
    portfolio: 'Showcases an individual or studio and their work.',
    documentation: 'Instructions or reference material for using a product.',
    mixed: 'Several supported experience types materially coexist.',
    unknown: 'The supplied evidence does not establish an experience type.',
  }),
  page_purpose: entries({
    home: 'The site or product entry page; source URL alone is insufficient.',
    landing: 'A focused promotion with a primary conversion goal.',
    product: 'Explains a particular product or product feature.',
    pricing: 'Explains plans, costs, or purchasing options.',
    about: 'Explains the organization, people, or background.',
    contact: 'Provides ways to contact or inquire.',
    listing: 'A collection of selectable items or references.',
    detail: 'Information about one item from a collection.',
    article: 'A publication, story, or long-form editorial page.',
    dashboard: 'An overview of operational information or activity.',
    authentication: 'Sign-in, registration, or account recovery.',
    onboarding: 'A visible introductory setup step; does not establish the complete flow.',
    settings: 'User or application configuration.',
    checkout: 'A visible purchasing step; does not establish the complete flow.',
    documentation: 'A guide, reference, or documentation page.',
    unknown: 'The supplied evidence does not establish the page purpose.',
  }),
  section_purpose: entries({
    navigation: 'Links and controls for moving within the site or product.',
    hero: 'The page introduction and main proposition.',
    features: 'Product capabilities, benefits, or feature explanations.',
    process: 'How something works or a sequence of explanatory steps.',
    pricing: 'Plans, prices, or purchasing options.',
    testimonials: 'Visible attributed customer statements about their experience; logos alone are not testimonials.',
    'social-proof': 'Testimonials, customer logos, endorsements, or review evidence.',
    metrics: 'Quantified results or prominent statistical evidence.',
    comparison: 'Explicit comparison of alternatives.',
    gallery: 'A collection primarily presented through imagery.',
    faq: 'Questions and their answers.',
    cta: 'A focused invitation to perform a primary action.',
    form: 'Visible fields for entering information.',
    content: 'Editorial or explanatory content without a more specific supported function.',
    listing: 'A collection of navigable items.',
    'data-display': 'Tables, charts, or other application data.',
    controls: 'Application actions, filters, or settings controls.',
    footer: 'The concluding site information and secondary navigation.',
    unknown: 'The supplied evidence does not establish this region’s purpose.',
  }),
  composition: entries({
    'single-column': 'One primary content column.',
    'two-column': 'Two visible parallel content columns.',
    'multi-column': 'Three or more visible parallel columns.',
    grid: 'Repeated items arranged in rows and columns.',
    'text-media-split': 'Text and a substantial visual occupy separate areas.',
    sidebar: 'A persistent secondary column accompanies primary content.',
    centered: 'A primary group is centered within the region.',
    asymmetric: 'Visually unequal regions intentionally establish the hierarchy.',
    'full-bleed-media': 'A substantial visual extends across the region.',
    'layered-media': 'Visuals intentionally overlap one another or text.',
    unknown: 'The supplied evidence does not establish a composition.',
  }),
  visual_style: [],
  appearance: entries({
    clean: 'Clear hierarchy, controlled alignment, readable typography, and low visual interference; may coexist with dense content or expressive aesthetics.',
    glassmorphism: 'Visibly translucent layered surfaces with background-dependent blur and legible foreground content.',
    neumorphism: 'Continuous surfaces appear extruded or inset through complementary light and dark shading.',
    unknown: 'Insufficient visible evidence of a coherent appearance treatment.',
  }),
  typography: entries({
    'sans-serif': 'Visible sans-serif typography or an explicitly observed declared sans-serif font stack.',
    serif: 'Visible serif typography or an explicitly observed declared serif font stack.',
    monospace: 'Fixed-width typography is visibly significant or explicitly declared in observed styles.',
    display: 'Distinctive headline typography materially shapes the presentation.',
    condensed: 'Visibly narrow letterforms materially shape the typography.',
    'mixed-families': 'Several visibly distinct type families materially shape the hierarchy.',
    'oversized-type': 'Typography dominates relative to its captured composition.',
    'strong-scale-contrast': 'A pronounced size contrast materially separates levels of typography.',
    'all-caps': 'Uppercase typography is a significant visual motif.',
    'small-dense-type': 'Compact small typography materially shapes the captured interface.',
    unknown: 'The supplied evidence does not establish a typographic treatment.',
  }),
  color_palette: entries({
    monochrome: 'One hue or a grayscale range dominates the visible palette.',
    neutral: 'Neutral hues materially dominate the visible palette.',
    warm: 'Warm hues materially dominate the visible palette.',
    cool: 'Cool hues materially dominate the visible palette.',
    pastel: 'Light, low-saturation colors materially shape the visible palette.',
    vibrant: 'Strong saturated colors materially shape the visible palette.',
    muted: 'Low-saturation colors materially shape the visible palette.',
    'high-contrast': 'Pronounced visible light/dark or color contrast materially shapes the palette.',
    dark: 'Dark surfaces materially dominate the visible captured region.',
    light: 'Light surfaces materially dominate the visible captured region.',
    mixed: 'Several materially different palette treatments coexist.',
    unknown: 'The supplied evidence does not establish the visible palette; a background declaration alone is insufficient.',
  }),
  density: entries({
    sparse: 'Few visible information groups and substantial space relative to the captured region.',
    balanced: 'Moderate visible information density relative to the captured region.',
    dense: 'Many tightly organized information groups relative to the captured region.',
    mixed: 'Materially different densities coexist within the region.',
    unknown: 'The supplied evidence does not establish visible information density.',
  }),
  imagery: entries({
    photography: 'Photographic imagery is a material part of the visible composition.',
    illustration: 'Illustrated imagery is a material part of the visible composition.',
    '3d-render': 'Imagery visibly presents rendered three-dimensional forms; does not establish its implementation.',
    'product-ui': 'Screenshots or representations of software interfaces materially shape the imagery.',
    'device-mockup': 'Device frames materially present content or product imagery.',
    'icon-led': 'Icons are the principal visual accompaniment to the content.',
    'type-led': 'Typography is the principal visual medium rather than substantial imagery.',
    'video-frame': 'A visible frame is supported by an observed video element; does not imply motion capture.',
    mixed: 'Several materially different imagery types coexist.',
    none: 'No substantial imagery is visible in the captured region.',
    unknown: 'The supplied evidence does not establish the imagery treatment.',
  }),
  surface_treatment: entries({
    flat: 'Visible surfaces use little or no apparent depth treatment.',
    outlined: 'Pronounced borders materially shape visible surfaces.',
    rounded: 'Rounded shapes materially shape visible surfaces.',
    'soft-shadow': 'Soft shadows materially shape surface depth.',
    'hard-shadow': 'Hard offset shadows materially shape surface depth.',
    translucent: 'Surfaces are visibly translucent or have explicit observed transparent fills.',
    'backdrop-blur': 'An observed backdrop blur materially affects visible surfaces.',
    gradient: 'Visible gradients materially shape surfaces.',
    textured: 'Visible textures materially shape surfaces.',
    layered: 'Overlapping surfaces materially establish depth or hierarchy.',
    unknown: 'The supplied evidence does not establish surface treatment.',
  }),
  industry: entries({
    'software-saas': 'Explicit page content identifies software or a software service.',
    'developer-tools': 'Explicit page content identifies software development tooling.',
    finance: 'Explicit page content identifies finance, banking, payments, or investing.',
    healthcare: 'Explicit page content identifies health or healthcare products/services.',
    education: 'Explicit page content identifies education or learning products/services.',
    retail: 'Explicit page content identifies consumer retail products.',
    'creative-services': 'Explicit page content identifies design, creative, or production services.',
    'media-entertainment': 'Explicit page content identifies media or entertainment.',
    'travel-hospitality': 'Explicit page content identifies travel or hospitality.',
    'real-estate': 'Explicit page content identifies property or real estate.',
    'food-beverage': 'Explicit page content identifies food or beverage.',
    'professional-services': 'Explicit page content identifies business or professional services.',
    nonprofit: 'Explicit page content identifies a nonprofit or public-interest organization.',
    other: 'Explicit page content identifies an industry outside the constrained taxonomy; explain it in the note.',
    unknown: 'The supplied evidence does not establish industry; visual style alone is insufficient.',
  }),
  audience: entries({
    developers: 'Explicit page copy identifies developers as an intended audience.',
    designers: 'Explicit page copy identifies designers as an intended audience.',
    creators: 'Explicit page copy identifies creative/content creators as an intended audience.',
    'business-teams': 'Explicit page copy identifies business teams as an intended audience.',
    enterprise: 'Explicit page copy identifies enterprise organizations as an intended audience.',
    consumers: 'Explicit page copy identifies general individual consumers as an intended audience.',
    students: 'Explicit page copy identifies students as an intended audience.',
    educators: 'Explicit page copy identifies educators as an intended audience.',
    'technical-professionals': 'Explicit page copy identifies a specific technical-professional audience.',
    mixed: 'Several explicitly identified audiences materially coexist.',
    unknown: 'The supplied evidence does not establish intended audience; do not infer it from aesthetic or price.',
  }),
  interaction_pattern: entries({
    'horizontal-scroll': 'Mechanically observed horizontal scroll states in an overflowing container; does not establish a product flow or functioning carousel buttons.',
    'navigation-menu': 'An observed navigation menu or its visible trigger.',
    tabs: 'Observed tab controls with tab semantics or a visible tab structure.',
    'accordion-controls': 'Observed expandable/disclosure controls; does not establish unseen expanded content.',
    search: 'An observed search field or explicit search control.',
    filters: 'Observed controls explicitly used to filter displayed information.',
    sorting: 'Observed controls explicitly used to change ordering.',
    'carousel-controls': 'Observed slide-navigation controls; does not establish their functioning or unseen slides.',
    form: 'Observed fields and input controls.',
    pagination: 'Observed page-navigation controls.',
    modal: 'An actually visible modal/dialog state.',
    toast: 'An actually visible transient notification state.',
    'command-menu': 'An actually visible command-palette/menu state.',
    unknown: 'The supplied evidence does not establish an observed interaction pattern; do not invent flows.',
  }),
  aesthetic_substyle: [], cross_collection: [], visual_anchor: [], experience_mode: [],
  platform_provenance: [], contextual_influence: [], behavior: [],
};

export const TAXONOMY_AXES = Object.keys(TAXONOMY) as TaxonomyAxis[];
export function taxonomyLabels(axis: TaxonomyAxis): string[] {
  return TAXONOMY[axis].map(({ label }) => label);
}
export function isTaxonomyLabel(axis: TaxonomyAxis, label: string): boolean {
  return taxonomyLabels(axis).includes(label);
}

/** An exact metadata mapping remains a source claim, never verified appearance. */
export const SOURCE_LABEL_ALIASES: Record<string, { axis: TaxonomyAxis; label: string }> = {
  'landing page': { axis: 'page_purpose', label: 'landing' },
  'landing pages': { axis: 'page_purpose', label: 'landing' },
  landing: { axis: 'page_purpose', label: 'landing' },
  portfolio: { axis: 'experience', label: 'portfolio' },
  ecommerce: { axis: 'experience', label: 'commerce' },
  'e-commerce': { axis: 'experience', label: 'commerce' },
  dashboard: { axis: 'page_purpose', label: 'dashboard' },
  clean: { axis: 'appearance', label: 'clean' },
  saas: { axis: 'industry', label: 'software-saas' },
  finance: { axis: 'industry', label: 'finance' },
  education: { axis: 'industry', label: 'education' },
  healthcare: { axis: 'industry', label: 'healthcare' },
  'dark palette': { axis: 'color_palette', label: 'dark' },
  'dark-palette': { axis: 'color_palette', label: 'dark' },
  'light palette': { axis: 'color_palette', label: 'light' },
  'light-palette': { axis: 'color_palette', label: 'light' },
  'oversized typography': { axis: 'typography', label: 'oversized-type' },
  'oversized-typography': { axis: 'typography', label: 'oversized-type' },
};

// Versioned distinctions used by both validators and model prompts.
const distinctions: Record<string, { aliases: string[]; traits: string[]; counter: string[]; neighbors: string[] }> = {
  minimal: { aliases: ['minimalist','minimalistic','minimalism'], traits: ['Restrained ornament','Deliberate hierarchy','Limited competing graphic devices'], counter: ['An empty unfinished page','Whitespace with no hierarchy'], neighbors: ['clean','editorial'] },
  clean: { aliases: ['clear'], traits: ['Readable type','Consistent alignment','Clear separation of information'], counter: ['White background with clutter','Low contrast tiny typography'], neighbors: ['minimal','editorial'] },
  brutalist: { aliases: ['brutalism'], traits: ['Raw exposed structure','Confrontational composition','Deliberate rejection of conventional polish'], counter: ['A single bold headline'], neighbors: ['neo-brutalist','industrial'] },
  'neo-brutalist': { aliases: ['neobrutalism','neo-brutalism','neobrutalist'], traits: ['Hard offset shadows','Pronounced outlines','Bold flat colors'], counter: ['Conventional outlined cards alone'], neighbors: ['brutalist','playful'] },
  glassmorphism: { aliases: ['glassy'], traits: ['Translucent layered panels','Background-dependent blur','Apparent depth'], counter: ['Opaque gray panel','A gradient without translucency'], neighbors: ['neumorphism','layered'] },
  neumorphism: { aliases: ['soft-ui'], traits: ['Continuous base material','Paired light and dark shadows','Inset or extruded controls'], counter: ['An ordinary floating card shadow'], neighbors: ['skeuomorphic','glassmorphism'] },
  retro: { aliases: ['vintage'], traits: ['Identifiable historical typographic or graphic conventions','Intentional nostalgic treatment'], counter: ['Merely old publication date','Accidentally broken legacy styling'], neighbors: ['vaporwave','skeuomorphic'] },
  vaporwave: { aliases: ['vapor-wave'], traits: ['Retro-futurist nostalgia','Surreal digital motifs','Pastel/neon with historical computing or classical references'], counter: ['Pink gradient alone','Any futuristic dark interface'], neighbors: ['retro','futuristic','maximalist'] },
  futuristic: { aliases: ['sci-fi'], traits: ['Speculative technological motifs','Coherent advanced-interface visual language'], counter: ['An AI product name','Dark palette alone'], neighbors: ['industrial','vaporwave'] },
};
const axisCounterexamples: Partial<Record<TaxonomyAxis, string>> = {
  experience:'A marketing screenshot depicting an application does not establish that the page itself is an application.',
  page_purpose:'A pricing or about link in navigation does not make the current page a pricing or about page.',
  section_purpose:'Neighboring section headings and navigation destinations do not establish this section function.',
  composition:'Document-wide CSS grid declarations do not establish the visible arrangement in this region.',
  visual_style:'One decorative effect or a library tag does not establish a coherent aesthetic.',
  appearance:'A light background does not establish clarity, glass depth or soft extrusion.',
  typography:'A font in a fallback stack does not prove it rendered; large type does not establish an aesthetic.',
  color_palette:'A small accent color or invisible background declaration does not establish the dominant palette.',
  density:'A sparse screenshot crop does not establish the density of an unseen whole section.',
  imagery:'An invisible media element or an offscreen image does not establish visible imagery treatment.',
  surface_treatment:'A shadow on a tiny icon does not establish the treatment of the principal surfaces.',
  industry:'Brand color, typography, aesthetics and library tags do not establish the product industry.',
  audience:'Price, visual sophistication or technical-looking styling do not establish intended users.',
  interaction_pattern:'A still image of a control does not prove working transitions or an uncaptured flow.',
};
const related: Partial<Record<TaxonomyAxis, string[][]>> = {
  experience:[['marketing','product-ui'],['commerce','marketing'],['editorial','documentation'],['portfolio','marketing']],
  page_purpose:[['home','landing'],['pricing','product-detail'],['about','home'],['dashboard','listing'],['authentication','checkout'],['article','documentation']],
  section_purpose:[['hero','cta'],['features','process'],['pricing','comparison'],['testimonials','social-proof'],['metrics','social-proof'],['gallery','listing'],['faq','content'],['form','controls'],['navigation','footer'],['data-display','content']],
  composition:[['single-column','centered'],['two-column','text-media-split'],['multi-column','grid'],['sidebar','two-column'],['asymmetric','text-media-split'],['full-bleed-media','layered-media']],
  typography:[['sans-serif','serif'],['monospace','sans-serif'],['display','oversized-type'],['condensed','display']],
  color_palette:[['monochrome','neutral'],['dark','light'],['muted','pastel'],['vibrant','high-contrast']],
  density:[['sparse','balanced'],['balanced','dense'],['dense','mixed']],
  imagery:[['photography','3d-render'],['illustration','3d-render'],['product-ui','device-mockup'],['icon-led','type-led'],['video-frame','photography'],['none','unknown']],
  surface_treatment:[['flat','soft-shadow'],['outlined','hard-shadow'],['rounded','layered'],['translucent','backdrop-blur'],['gradient','textured']],
  interaction_pattern:[['tabs','navigation-menu'],['accordion-controls','modal'],['search','filters'],['filters','sorting'],['carousel-controls','horizontal-scroll'],['form','search'],['pagination','carousel-controls'],['toast','modal'],['command-menu','navigation-menu']],
};
for (const [axisName, concepts] of Object.entries(TAXONOMY)) for (const concept of concepts) {
  const axis=axisName as TaxonomyAxis;
  const distinction = distinctions[concept.label];
  if (distinction && (axis==='visual_style'||axis==='appearance')) Object.assign(concept, { aliases: distinction.aliases, supportingTraits: distinction.traits, counterexamples: distinction.counter, confusingNeighbors: distinction.neighbors });
  else {
    concept.counterexamples=[axisCounterexamples[axis]??'A source tag or isolated motif is insufficient.'];
    concept.confusingNeighbors=[...new Set((related[axis]??[]).filter(pair=>pair.includes(concept.label)).flat().filter(label=>label!==concept.label&&concepts.some(c=>c.label===label)))];
    if(!concept.confusingNeighbors.length)concept.confusingNeighbors=['unknown'];
    if(concept.label==='unknown') {
      concept.supportingTraits=['Insufficient direct evidence to support a specific label'];
      concept.counterexamples=['Sufficient direct evidence for a defined label must not be replaced with unknown.'];
      concept.confusingNeighbors=concepts.filter(c=>c.label!=='unknown').map(c=>c.label);
    }
  }
}
// Replace the historical broad style vocabulary. Old saved classifications remain versioned
// and are never silently relabeled as one of these more specific concepts.
const unknown = (axis:string):TaxonomyDefinition => ({label:'unknown',definition:`Insufficient direct evidence for ${axis}.`,aliases:[],
  supportingTraits:['Insufficient inspected evidence'],counterexamples:['Direct support for a specific concept'],confusingNeighbors:[]});
TAXONOMY.visual_style=[...SELECTED_AESTHETICS,unknown('aesthetic')];
TAXONOMY.aesthetic_substyle=[...SELECTED_SUBSTYLES,unknown('substyle')];
TAXONOMY.cross_collection=[...SELECTED_COLLECTIONS,unknown('collection membership')];
const facetAxes:Record<string,TaxonomyAxis>={color:'color_palette',composition:'composition',material:'surface_treatment',
  behavior:'behavior',visual_anchor:'visual_anchor',experience_mode:'experience_mode',provenance:'platform_provenance',contextual_influences:'contextual_influence'};
const facetDefinitions:Record<string,string>={
  neon:'Luminous highly saturated color materially shapes the inspected palette.',
  'earth-tones':'Brown, ochre, olive and other natural earth hues materially organize the palette.',
  'high-saturation':'Strongly saturated colors dominate the inspected palette.',
  'fluid-chromatic':'Flowing multicolor gradients or liquid color fields materially shape the inspected composition.',
  'semi-flat':'Flat surfaces retain restrained depth cues and clear control boundaries.',
  chrome:'Reflective metallic highlights materially shape visible surfaces.',glass:'Translucent glass-like panels materially shape visible depth.',
  'soft-relief':'Continuous surfaces use paired light and dark relief shading.',clay:'Rounded inflated clay-like volumes materially shape visible components.',
  paper:'Visible paper grain, folds, edges or print textures organize surfaces.',grain:'Intentional grain materially shapes the visible texture.',glossy:'Specular highlights materially shape polished surfaces.',
  maximalist:'Deliberate rich layering and variety organize the inspected composition.',layered:'Overlapping visual groups materially organize hierarchy and depth.',
  cybersigilism:'Sharp branching metallic or ink-like cybernetic sigils materially shape visible ornament.',
  'laser-grid':'Luminous geometric perspective grids materially shape the visual environment.',
  stickerbomb:'Dense overlapping sticker-like motifs materially organize visible ornament.',fractal:'Repeated self-similar forms materially organize imagery.',
  halftone:'Visible repeated dots or print-screen patterns materially shape the graphics.',
  'botanical-ornament':'Plant forms materially organize frames, dividers or ornament.',
  cinematic:'Dramatic staged imagery and hierarchy create a film-like presentation; a still does not prove pacing.',
  spatial:'Visible depth and perspective organize a spatial composition; a still does not prove navigation.',
  immersive:'The scene envelops the inspected viewport and uses a coherent environmental presentation.',
  'interactive-art':'Captured context identifies browser-based interactive artwork; a static image alone cannot prove interaction.',
  'game-like':'Visible menus, scenes or controls use a coherent game-like interface vocabulary.',
  glitch:'Visible deliberate media corruption; this label does not establish animation.',
  parallax:'Captured motion evidence establishes differential movement between layers.',
  'scroll-story':'Captured scroll states establish a staged narrative transition.',
  'hover-rich':'Captured hover transitions establish materially changing visual states.',
  procedural:'Direct implementation evidence establishes generative procedural graphics.',
  'audio-reactive':'Captured interaction evidence establishes a visual response to audio.',
  '3d-navigation':'Captured interaction evidence establishes navigation through a 3D environment.',
};
for(const [facet,axis] of Object.entries(facetAxes)) {
  for(const value of SELECTED_SOURCE.facets[facet]??[]) {
    // These selected tokens describe existing dimensions; do not relabel density/type as aesthetics.
    if(facet==='composition' && ['dense','sparse','oversized-type'].includes(value))continue;
    const label=value.toLowerCase().replaceAll(' ','-');
    if(TAXONOMY[axis].some(c=>c.label===label))continue;
    const definition=facetDefinitions[label]??(axis==='platform_provenance'?`Direct captured attribution identifies ${value}; resemblance alone is insufficient.`:
      `Direct captured contextual evidence supports ${value} as an influence; generic motifs alone are insufficient.`);
    TAXONOMY[axis].push({id:`facet:${facet}:${label}`,label,displayName:value,definition,aliases:[value.toLowerCase()],
      supportingTraits:[definition],counterexamples:['A source tag, isolated accent or inferred implementation is insufficient.'],confusingNeighbors:['unknown'],
      evidenceRequirement:['platform_provenance','contextual_influence'].includes(axis)?'Inspected frame plus directly captured contextual evidence.':'Inspected visual evidence; behavioral claims additionally require observed states.'});
  }
  if(!TAXONOMY[axis].some(c=>c.label==='unknown'))TAXONOMY[axis].push(unknown(axis));
}
for(const [alias,claim] of Object.entries(SOURCE_LABEL_ALIASES))if(!TAXONOMY[claim.axis].some(c=>c.label===claim.label))delete SOURCE_LABEL_ALIASES[alias];
for(const axis of ['visual_style','aesthetic_substyle','cross_collection'] as const)for(const c of TAXONOMY[axis]) {
  if(c.label==='unknown')continue;
  for(const alias of [c.label,...c.aliases]) {
    // Keep the established clean appearance source tag separate from a dominant Clean aesthetic.
    if(alias==='clean')continue;
    SOURCE_LABEL_ALIASES[alias]={axis,label:c.label};
  }
}
export const TAXONOMY_FINGERPRINT = `${TAXONOMY_VERSION}:${SELECTED_SOURCE_HASH}`;
export function taxonomyDocument() {return {version:TAXONOMY_VERSION,sourceVersion:'I.1',sourceHash:SELECTED_SOURCE_HASH,
  families:SELECTED_FAMILIES,axes:TAXONOMY,referenceApproval:'No concepts or model classifications certify a reference for publication.'};}
export function normalizeLabel(axis: TaxonomyAxis, input: string): string | undefined {
  const value = input.trim().toLowerCase();
  return TAXONOMY[axis].find(concept => concept.label === value || concept.aliases.includes(value))?.label;
}

/** Relations apply to one inspected subject at a time; never consult parent labels. */
export function validateLabelRelations(labels:Label[], evidence:EvidenceItem[], images:Set<string>):Label[] {
  const scopes=[...new Set(labels.map(l=>l.regionId))];
  for(const regionId of scopes) {
    const scoped=labels.filter(l=>l.regionId===regionId);
    for(const axis of TAXONOMY_AXES) {
      const claims=scoped.filter(l=>l.axis===axis);
      if(new Set(claims.map(l=>l.label)).size!==claims.length)throw new Error('Duplicate taxonomy claim.');
      if(claims.length>1 && claims.some(l=>l.label==='unknown'))throw new Error('Unknown cannot coexist with a supported claim on the same axis.');
    }
    const styles=scoped.filter(l=>l.axis==='visual_style' && l.label!=='unknown');
    if(styles.length===1 && !styles[0].role)styles[0].role='primary';
    if(styles.length && (styles.filter(l=>l.role==='primary').length!==1 || styles.some(l=>!l.role)))throw new Error('Specify one primary aesthetic and explicit secondary roles for mixed aesthetics.');
    for(const claim of scoped) {
      const concept=TAXONOMY[claim.axis].find(c=>c.label===claim.label)!;
      if(claim.role && (claim.axis!=='visual_style' || claim.label==='unknown'))throw new Error('Only supported aesthetics have primary or secondary roles.');
      if(concept.id)claim.conceptId=concept.id;
      if(claim.label==='unknown')continue;
      if(['aesthetic_substyle','cross_collection','visual_anchor','experience_mode','platform_provenance','contextual_influence','behavior'].includes(claim.axis) && !claim.evidenceIds.some(id=>images.has(id)))throw new Error('Selected concepts require an inspected frame.');
      if(claim.axis==='aesthetic_substyle' && !styles.some(l=>l.label===concept.parentLabel))throw new Error('Substyle requires an independently supported parent aesthetic in this subject.');
      const cited=evidence.filter(e=>claim.evidenceIds.includes(e.id));
      if(['cross_collection','platform_provenance','contextual_influence'].includes(claim.axis) || claim.axis==='experience_mode' && claim.label==='interactive-art') {
        const names=[concept.displayName??concept.label,...concept.aliases];
        if(!cited.some(e=>['page-dom','region-dom','captured-attribution','implementation-provenance'].includes(e.kind) && names.some(name=>JSON.stringify(e.value).toLowerCase().includes(name.toLowerCase()))))throw new Error('Contextual membership requires captured attribution or contextual evidence.');
      }
      if(claim.axis==='behavior' && claim.label!=='glitch') {
        const kind=claim.label==='procedural'?'implementation-provenance':'observed-interaction-state';
        if(!cited.some(e=>e.kind===kind && typeof e.value==='object' && e.value!==null && (e.value as Record<string,unknown>).pattern===claim.label))throw new Error('Behavior requires directly observed matching state evidence.');
      }
    }
  }
  return labels;
}
