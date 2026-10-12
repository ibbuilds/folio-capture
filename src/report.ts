import { writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Store } from './store.ts';
import { atomicJson, inside, now } from './utils.ts';
import type { Label, TaxonomyAxis } from './types.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const artifactUrl = (path: string) => path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
const dimensions: Array<{ axis: TaxonomyAxis; title: string; secondary?: boolean }> = [
  { axis: 'visual_style', title: 'Aesthetic / style' }, { axis: 'composition', title: 'Composition' },
  { axis: 'section_purpose', title: 'Section purpose' }, { axis: 'typography', title: 'Typography', secondary: true },
  { axis: 'color_palette', title: 'Palette', secondary: true }, { axis: 'density', title: 'Density', secondary: true },
  { axis: 'imagery', title: 'Imagery', secondary: true }, { axis: 'industry', title: 'Industry', secondary: true },
  { axis: 'page_purpose', title: 'Page purpose', secondary: true }, { axis: 'experience', title: 'Experience', secondary: true },
  { axis: 'surface_treatment', title: 'Surface treatment', secondary: true },
  { axis: 'audience', title: 'Audience', secondary: true }, { axis: 'interaction_pattern', title: 'Interaction pattern', secondary: true },
];
const knownLabel = (label: Label) => label.label.trim().length > 0 && label.label.trim().toLowerCase() !== 'unknown';
const titleFor = (axis: TaxonomyAxis) => dimensions.find(dimension => dimension.axis === axis)?.title ?? axis;

function sourceHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function labelTags(labels: Label[], inherited = false): string {
  return labels.filter(knownLabel).map(label => {
    const source = label.provenance === 'source';
    const tooltip = `${label.provenance} · ${label.confidence} confidence${inherited ? ' · inherited page label' : ''}${source ? ' · library metadata; visually unverified' : ''}${label.note ? ` · ${label.note}` : ''}`;
    return `<span${source ? ' class="source-label"' : ''} title="${escape(tooltip)}">${escape(titleFor(label.axis))}: ${escape(label.label)}${source ? ' <small>Source · unverified</small>' : ''}</span>`;
  }).join('');
}

export async function exportCatalog(store: Store) {
  const pages = store.pages();
  const captures = store.latestCaptures().filter(c => c.manifest);
  const jobs = store.jobs();
  const index = {
    schemaVersion: 1, generatedAt: now(),
    pages: captures.map(c => ({
      pageId: c.pageId, captureId: c.id, url: c.manifest!.requestedUrl, title: c.manifest!.title,
      status: c.status, reviewStatus: c.manifest!.reviewStatus, manifest: `${c.directory}/manifest.json`,
      classification: `${c.directory}/classification.json`, provenance: pages.find(p => p.id === c.pageId)?.provenance ?? c.manifest!.provenance,
      labels: c.classification?.labels ?? [], variants: c.manifest!.variants.map(v => ({
        profile: v.profile.id, status: v.status, regions: [...v.regions].sort((a, b) => a.order - b.order).map(r => ({
          id: r.id, order: r.order, title: r.title, method: r.method,
          frames: r.frames.map((f, frameIndex) => ({ order: frameIndex + 1, image: `${c.directory}/${f.path}`, thumbnail: `${c.directory}/${f.thumbnail}`, width: f.width, height: f.height, sha256: f.sha256, kind: f.kind })),
        })),
      })),
    })),
    sectionIndex: captures.flatMap(c => c.manifest!.variants.flatMap(v => [...v.regions].sort((a, b) => a.order - b.order).map(r => ({
      id: `${c.id}:${v.profile.id}:${r.id}`, pageId: c.pageId, captureId: c.id, url: c.manifest!.requestedUrl,
      profileId: v.profile.id, regionId: r.id, order: r.order, title: r.title, method: r.method,
      boundaryConfidence: r.boundaryConfidence,
      labels: (c.classification?.labels ?? []).filter(label => label.regionId === null || label.regionId === r.id),
      frames: r.frames.map((f, frameIndex) => ({ order: frameIndex + 1, image: `${c.directory}/${f.path}`, thumbnail: `${c.directory}/${f.thumbnail}`, width: f.width, height: f.height, sha256: f.sha256, kind: f.kind })),
    })))),
    categoryIndexes: {} as Record<string, string[]>,
    regionCategoryIndexes: {} as Record<string, string[]>,
    facets: {} as Record<string, string[]>,
    jobs: jobs.map(j => ({ stage: j.stage, key: j.key, status: j.status, attempts: j.attempts, error: j.error, stoppingReason: j.stoppingReason })),
  };
  for (const page of index.pages) for (const label of page.labels.filter(knownLabel)) {
    const key = `${label.axis}:${label.label}`;
    index.categoryIndexes[key] ??= [];
    if (!index.categoryIndexes[key].includes(page.pageId)) index.categoryIndexes[key].push(page.pageId);
  }
  for (const section of index.sectionIndex) for (const label of section.labels.filter(knownLabel)) {
    const key = `${label.axis}:${label.label}`;
    index.regionCategoryIndexes[key] ??= [];
    if (!index.regionCategoryIndexes[key].includes(section.id)) index.regionCategoryIndexes[key].push(section.id);
  }
  for (const dimension of dimensions) index.facets[dimension.axis] = [...new Set(index.sectionIndex.flatMap(section => section.labels.filter(label => label.axis === dimension.axis && knownLabel(label)).map(label => label.label)))].sort((a, b) => a.localeCompare(b));
  index.facets.viewport = [...new Set(index.sectionIndex.map(section => section.profileId))].sort((a, b) => a.localeCompare(b));
  await atomicJson(join(store.output, 'index.json'), index);
  await mkdir(join(store.output, 'reports'), { recursive: true });
  const exceptions = jobs.filter(j => ['failed', 'blocked', 'incomplete', 'unsupported'].includes(j.status));
  const counts = ['pending', 'running', 'complete', 'incomplete', 'blocked', 'failed', 'unsupported'].map(status => `<span><strong>${jobs.filter(j => j.status === status).length}</strong> ${status}</span>`).join('');
  const localHref = (value: string) => {
    try { return artifactUrl(relative(store.output, inside(store.output, value))); }
    catch { return undefined; }
  };
  const facetControl = (axis: string, title: string) => `<label class="facet" for="facet-${escape(axis)}">${escape(title)}<select id="facet-${escape(axis)}" data-facet="${escape(axis)}"><option value="">All</option>${(index.facets[axis] ?? []).map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('')}</select></label>`;
  const controls = dimensions.filter(dimension => !dimension.secondary).map(dimension => facetControl(dimension.axis, dimension.title)).join('') + facetControl('viewport', 'Viewport');
  const secondary = dimensions.filter(dimension => dimension.secondary).map(dimension => facetControl(dimension.axis, dimension.title)).join('');
  const cards = captures.map(c => {
    const m = c.manifest!;
    const labels = c.classification?.labels ?? [];
    const pageLabels = labels.filter(label => label.regionId === null);
    const variants = m.variants.map(v => `<details class="variant" open data-profile="${escape(v.profile.id)}"><summary>${escape(v.profile.id)} · ${v.profile.width}×${v.profile.height} · ${escape(v.status)} · ${v.regions.length} regions</summary>${v.warnings.length ? `<ul class="warnings">${v.warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul>` : ''}<div class="regions">${[...v.regions].sort((a, b) => a.order - b.order).map(r => {
      const relevant = labels.filter(label => label.regionId === null || label.regionId === r.id);
      const facets: Record<string, string[]> = {};
      for (const label of relevant.filter(knownLabel)) { facets[label.axis] ??= []; if (!facets[label.axis].includes(label.label)) facets[label.axis].push(label.label); }
      const search = [m.title, m.requestedUrl, v.profile.id, r.title, ...relevant.filter(knownLabel).flatMap(label => [label.axis, label.label])].join(' ').toLowerCase();
      const tags = labelTags(relevant.filter(label => label.regionId === r.id)) + labelTags(pageLabels, true);
      return `<section data-region-ref="${escape(`${c.id}:${v.profile.id}:${r.id}`)}" data-profile="${escape(v.profile.id)}" data-search="${escape(search)}" data-labels="${escape(JSON.stringify(facets))}"><header><strong>${r.order+1}. ${escape(r.title)}</strong><small>${escape(r.method)} · boundary ${escape(r.boundaryConfidence)}</small><div class="tags region-tags">${tags || '<span>Classification pending / uncertain</span>'}</div></header><div class="frames">${r.frames.map((f, frameIndex) => {
        const image = localHref(`${c.directory}/${f.path}`);
        const thumbnail = localHref(`${c.directory}/${f.thumbnail}`);
        if (image === undefined || thumbnail === undefined) return '<p class="warnings">Image unavailable: invalid artifact path.</p>';
        return `<a href="${escape(image)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(thumbnail)}" alt="${escape(r.title)} — ${escape(v.profile.id)} part ${frameIndex + 1}"><span>Part ${frameIndex + 1} · ${f.width}×${f.height} · ${escape(f.kind)}</span></a>`;
      }).join('')}</div></section>`;
    }).join('')}</div></details>`).join('');
    const source = sourceHref(m.requestedUrl);
    const manifest = localHref(`${c.directory}/manifest.json`);
    const classification = localHref(`${c.directory}/classification.json`);
    return `<article><header class="page-head"><div><h2>${escape(m.title || m.requestedUrl)}</h2>${source ? `<a href="${escape(source)}" target="_blank" rel="noopener">${escape(m.requestedUrl)}</a>` : `<span class="warnings">${escape(m.requestedUrl)} · invalid source URL</span>`}</div><span class="badge ${escape(m.status)}">${escape(m.status)}</span></header><p class="muted">${escape(m.capturedAt)} · ${escape(m.reviewStatus)} · classifier: ${escape(c.classification?.status ?? 'pending')}</p><div class="tags">${labelTags(pageLabels, true) || '<span>Page classification pending / uncertain</span>'}</div><p>${manifest ? `<a href="${escape(manifest)}">Manifest</a>` : 'Manifest unavailable'} · ${classification ? `<a href="${escape(classification)}">Classification</a>` : 'Classification unavailable'} · ${pages.find(p => p.id === c.pageId)?.provenance.length ?? m.provenance.length} discovery path(s)</p>${variants}</article>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio Capture — collection report</title><style>
  :root{font:15px/1.5 system-ui,sans-serif;color:#24252a;background:#f4f4f0;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:32px;margin:0}h2{font-size:22px;margin:0 0 6px}a{color:#25438d;overflow-wrap:anywhere}.muted,small{color:#65676d}small{display:block}.summary{display:flex;gap:20px;flex-wrap:wrap;margin:22px 0}.summary strong{font-size:24px;display:block}input{width:100%;padding:14px;border:1px solid #bbb;border-radius:8px;font:inherit;background:white;margin:8px 0 16px}.filter-panel{padding:18px;border:1px solid #d1d1ca;border-radius:10px;background:#fff;margin:16px 0 28px}.facets{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.facet{display:block;font-size:12px;font-weight:600}.facet select{display:block;width:100%;min-height:38px;margin-top:5px;padding:6px;border:1px solid #bbb;border-radius:5px;background:white;color:inherit;font:14px system-ui}.advanced{margin-top:14px}.advanced .facets{margin-top:12px}.filter-meta{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-top:14px;font-size:13px}.filter-meta p{margin:0}button{font:inherit;cursor:pointer;padding:7px 12px;border:1px solid #aaa;border-radius:6px;background:#f7f7f4}article{background:white;border:1px solid #ddd;border-radius:12px;margin-bottom:28px;padding:24px}.page-head{display:flex;justify-content:space-between;gap:20px}.badge{border-radius:20px;background:#eee;padding:6px 12px;align-self:flex-start}.complete{background:#e5f3e8}.incomplete,.blocked,.failed{background:#ffeed8}.tags{display:flex;gap:6px;flex-wrap:wrap}.tags span{font-size:12px;padding:4px 8px;border:1px solid #ddd;border-radius:4px;overflow-wrap:anywhere}.tags .source-label{border-style:dashed;border-color:#b98937;background:#fff6e3}.source-label small{font-size:10px;color:#8a5a15}.region-tags{margin-top:8px}.variant{border-top:1px solid #ddd;padding-top:14px;margin-top:18px}summary{cursor:pointer;font-weight:600}.regions{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-top:18px}.regions section{min-width:0;border:1px solid #e3e3e3;border-radius:8px;overflow:hidden}.regions header{padding:12px;background:#fafafa}.frames{display:grid;gap:6px}.frames a{display:block;text-decoration:none;background:#f0f0f0}.frames img{display:block;width:100%;height:240px;object-fit:contain;object-position:top;background:#ededed}.frames span{font-size:12px;padding:6px 10px;display:block}.exceptions{background:#fff3e6;border:1px solid #ebd3b6;padding:16px;border-radius:8px}.exceptions li{margin-bottom:10px;overflow-wrap:anywhere}.warnings{font-size:13px;color:#865528}footer{color:#65676d;margin-top:20px}[hidden]{display:none!important}@media(max-width:640px){main{padding:18px}article{padding:16px}.page-head{display:block}.badge{display:inline-block;margin-top:10px}.filter-panel{padding:12px}.facets{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style><main><h1>Folio Capture</h1><p class="muted">Our local collection report · ${escape(index.generatedAt)}. Automated checks do not mean a design has been approved.</p><div class="summary">${counts}</div>${exceptions.length ? `<details class="exceptions"><summary>${exceptions.length} recorded exceptions</summary><ul>${exceptions.map(j => `<li><strong>${escape(j.stage)} / ${escape(j.status)}</strong> — ${escape(j.key)}<br>${escape(j.error ?? j.stoppingReason ?? '')}</li>`).join('')}</ul></details>` : ''}<div class="filter-panel"><label for="filter">Search references by title, URL, section, or classification</label><input id="filter" type="search" placeholder="Try minimal hero or serif editorial"><div class="facets">${controls}</div><details class="advanced"><summary>More filters</summary><div class="facets">${secondary}</div></details><div class="filter-meta"><p id="matching-status" role="status" aria-live="polite"></p><button id="reset-filters" type="button">Reset filters</button></div><p class="muted">Filters must match the same region. Page labels are inherited; dashed labels come from visually unverified library metadata.</p></div><p id="no-matches" hidden>No regions match these filters. Recorded failures and blocked jobs remain listed above.</p><div id="pages">${cards || '<p>No published captures yet. Jobs and exceptions above explain the current state.</p>'}</div><footer>Original images are linked from each thumbnail. Metadata is in <a href="index.json">index.json</a>. Captures are versioned; this report shows the latest published attempt per page.</footer></main><script>
  const textFilter=document.getElementById('filter');
  const facetFilters=Array.from(document.querySelectorAll('[data-facet]'));
  const regionCards=Array.from(document.querySelectorAll('[data-region-ref]'));
  function updateFilters(){
    const tokens=textFilter.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);
    const selected=facetFilters.filter(control=>control.value);
    let matching=0;
    for(const region of regionCards){
      const labels=JSON.parse(region.dataset.labels||'{}');
      const match=tokens.every(token=>(region.dataset.search||'').includes(token))&&selected.every(control=>control.dataset.facet==='viewport'?region.dataset.profile===control.value:(labels[control.dataset.facet]||[]).includes(control.value));
      region.hidden=!match;if(match)matching++;
    }
    for(const variant of document.querySelectorAll('.variant'))variant.hidden=!Array.from(variant.querySelectorAll('[data-region-ref]')).some(region=>!region.hidden);
    for(const page of document.querySelectorAll('#pages article'))page.hidden=!Array.from(page.querySelectorAll('.variant')).some(variant=>!variant.hidden);
    document.getElementById('matching-status').textContent=matching+' of '+regionCards.length+' regions match';
    document.getElementById('no-matches').hidden=matching>0||regionCards.length===0;
  }
  textFilter.addEventListener('input',updateFilters);for(const control of facetFilters)control.addEventListener('change',updateFilters);
  document.getElementById('reset-filters').addEventListener('click',()=>{textFilter.value='';for(const control of facetFilters)control.value='';updateFilters();});
  updateFilters();
  </script></html>`;
  await writeFile(inside(store.output, 'report.html'), html, 'utf8');
  await atomicJson(join(store.output, 'reports', 'run-summary.json'), { generatedAt: now(), pages: index.pages.length, regions: index.sectionIndex.length, jobs: index.jobs, exceptions: exceptions.length });
  return index;
}
