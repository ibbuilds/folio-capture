import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { exportCatalog } from '../src/report.ts';
import type { Store, CaptureRecord } from '../src/store.ts';
import type { CaptureProfile, Classification, Label, PageManifest, Region, TaxonomyAxis, ViewportCapture } from '../src/types.ts';
import { referenceSubjects, subjectImageId, type ReferenceRecord } from '../src/references.ts';
import { TAXONOMY_VERSION, TAXONOMY_FINGERPRINT } from '../src/taxonomy.ts';
import { SCOPED_PROMPT_VERSION } from '../src/quality.ts';

const desktop: CaptureProfile = { id: 'desktop', width: 1440, height: 1000, dpr: 2, isMobile: false, hasTouch: false };
const mobile: CaptureProfile = { id: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true };
const bounds = { x: 0, y: 0, width: 500, height: 500 };
const label = (axis: TaxonomyAxis, value: string, regionId: string | null, provenance: Label['provenance'] = 'model'): Label => ({ axis, label: value, regionId, evidenceIds: ['fixture'], provenance, confidence: 'high', note: 'Fixture evidence </script><script>globalThis.injected=1</script>' });
function region(id: string, order: number, title: string): Region {
  return { id, order, title, method: 'semantic', boundaryConfidence: 'high', bounds, captureBounds: bounds, evidenceIds: ['fixture'], frames: [1, 2].map(part => ({ path: `desktop/${id}-${part}.png`, thumbnail: `desktop/${id}-${part}-thumb.webp`, width: 1000, height: 1000, sha256: 'abc', bounds, scrollY: 0, kind: 'static' })) };
}
function variant(profile: CaptureProfile, regions: Region[]): ViewportCapture {
  return { profile, regions, status: 'complete', requestedUrl: 'https://example.test/', finalUrl: 'https://example.test/', title: 'Fixture', capturedAt: '2026-10-12T00:00:00Z', pageHeight: 1000, evidence: [], warnings: [], interventions: [], coverage: [], stoppingReason: 'fixture', environment: {} };
}
function capture(id: string, title: string, variants: ViewportCapture[], labels: Label[], url = `https://${id}.example.test/`): CaptureRecord {
  const manifest: PageManifest = { schemaVersion: 1, captureId: `${id}-capture`, pageId: id, captureSignature: 'fixture', requestedUrl: url, title, capturedAt: '2026-10-12T00:00:00Z', status: 'complete', reviewStatus: 'unreviewed', provenance: [], variants };
  const classification: Classification = { schemaVersion: 1, taxonomyVersion: 'fixture', promptVersion: 'fixture', captureId: manifest.captureId, status: 'enriched', runner: 'fixture', model: 'fixture', createdAt: manifest.capturedAt, cacheKey: 'fixture', labels, sourceLabels: [], observedFlows: [], warnings: [] };
  return { id: manifest.captureId, pageId: id, signature: 'fixture', directory: `captures/${id}/${manifest.captureId}`, stagingDirectory: null, status: 'complete', createdAt: manifest.capturedAt, manifest, classification };
}
function fixtures(): CaptureRecord[] {
  return [
    capture('first', 'First Atlas </script><script>globalThis.injected=1</script>', [variant(desktop, [region('features', 2, 'Capabilities'), region('hero', 1, 'Introduction')]), variant(mobile, [region('mobile-hero', 1, 'Mobile introduction')])], [
      label('industry', 'software', null), label('page_purpose', 'landing', null), label('section_purpose', 'hero', 'hero'), label('visual_style', 'editorial', 'hero'), label('composition', 'two-column', 'hero'), label('typography', 'serif', 'hero'),
      label('section_purpose', 'features', 'features'), label('visual_style', 'minimal', 'features'), label('composition', 'grid', 'features'), label('visual_style', 'playful', 'features', 'source'),
      label('section_purpose', 'hero', 'mobile-hero'), label('visual_style', 'editorial', 'mobile-hero'), label('color_palette', 'unknown', 'hero'),
    ]),
    capture('second', 'Second Atlas', [variant(desktop, [region('second-hero', 1, 'Primary introduction')])], [label('industry', 'finance', null), label('page_purpose', 'home', null), label('section_purpose', 'hero', 'second-hero'), label('visual_style', 'minimal', 'second-hero'), label('composition', 'centered', 'second-hero')]),
  ];
}
function fixtureStore(output: string, records = fixtures()): Store {
  return { output, exportReferences:()=>[],exportCaptures: () => records, pages: () => records.map(record => ({ id: record.pageId, url: record.manifest!.requestedUrl, provenance: [], latestCaptureId: record.id })), jobs: () => [] } as unknown as Store;
}

test('current decisions replace preliminary labels without leaking section aesthetics between viewports or from parents',async t=>{
  const output=await mkdtemp(join(tmpdir(),'folio-scoped-report-'));
  t.after(()=>rm(output,{recursive:true,force:true}));
  const captured=capture('scoped','Scoped page',[variant(desktop,[region('hero',0,'Hero'),region('other',1,'Pending')]),variant(mobile,[region('hero',0,'Mobile hero')])],[label('visual_style','playful','hero'),label('visual_style','minimal','other')]);
  const records:ReferenceRecord[]=referenceSubjects(captured.manifest!).map(subject=>{
    const inspectedImages=subject.frames.map(f=>subjectImageId(subject,f));
    const page=subject.scope==='page';
    return {schemaVersion:2,subject,directory:captured.directory,sourceUrl:captured.manifest!.requestedUrl,
      quality:{schemaVersion:2,subjectId:subject.id,cacheKey:'fixture',rubricVersion:'fixture',verdict:subject.regionId==='other'?'pending':'accepted',assessedAt:'fixture',experimental:true,reasons:[],model:'fixture',reasoning:'fixture',reportedModels:[],inspectedImages},
      classification:subject.regionId==='other'?undefined:{taxonomyVersion:TAXONOMY_VERSION,taxonomyFingerprint:TAXONOMY_FINGERPRINT,promptVersion:SCOPED_PROMPT_VERSION,cacheKey:'fixture',model:'fixture',classifiedAt:'fixture',inspectedImages,
        labels:[label(page?'appearance':'composition',page?'clean':subject.profileId==='desktop'?'grid':'centered',subject.regionId??null)]}};
  });
  const store=fixtureStore(output,[captured]);store.exportReferences=()=>records;
  const index=await exportCatalog(store);
  assert.equal(index.schemaVersion,2);
  const desktopHero=index.sectionIndex.find(r=>r.regionId==='hero'&&r.profileId==='desktop')!;
  const mobileHero=index.sectionIndex.find(r=>r.regionId==='hero'&&r.profileId==='mobile')!;
  assert.deepEqual(desktopHero.labels.map(l=>l.label),['grid']);
  assert.deepEqual(mobileHero.labels.map(l=>l.label),['centered']);
  assert.deepEqual(index.sectionIndex.find(r=>r.regionId==='other')!.labels,[],'Pending subject never falls back to old enriched labels');
  assert.deepEqual(index.referenceCategoryIndexes['composition:grid'],[records.find(r=>r.subject.regionId==='hero'&&r.subject.profileId==='desktop')!.subject.id]);
  assert.equal(Object.keys(index.regionCategoryIndexes).some(k=>k==='appearance:clean'),false);
  assert(index.referenceCategoryIndexes['appearance:clean'].every(id=>records.find(r=>r.subject.id===id)?.subject.scope==='page'));
  assert(index.pages[0].classification.endsWith('references.v2.json'));
  const html=await readFile(join(output,'report.html'),'utf8');
  assert(html.includes('references.v2.json'));assert(!html.includes('playful'));assert(!html.includes('Appearance: clean'));
  assert(html.includes('Assessment pending'));
  records.find(r=>r.subject.regionId==='hero'&&r.subject.profileId==='mobile')!.quality.verdict='rejected';
  records.find(r=>r.subject.regionId==='other')!.quality.verdict='repair';
  await exportCatalog(store);
  const updated=await readFile(join(output,'report.html'),'utf8');assert(updated.includes('Quality: rejected'));assert(updated.includes('Capture repair required'));
});

test('catalog indexes exact regions, separates page context, and excludes unknown categories', async () => {
  const output = await mkdtemp(join(tmpdir(), 'folio-report-'));
  try {
    const index = await exportCatalog(fixtureStore(output));
    assert.equal(index.sectionIndex.length, 4);
    const hero = index.sectionIndex.find(section => section.regionId === 'hero')!;
    assert.equal(hero.profileId, 'desktop');
    assert.ok(hero.parentContext.some(item => item.axis === 'industry' && item.label === 'software'));
    assert.equal(hero.labels.some(item => item.axis === 'industry'), false);
    assert.equal(hero.labels.some(item => item.label === 'minimal'), false);
    assert.deepEqual(hero.frames.map(frame => frame.order), [1, 2]);
    assert.ok(hero.frames[1].image.endsWith('hero-2.png'));
    assert.deepEqual(index.categoryIndexes['visual_style:minimal'], ['first', 'second']);
    assert.deepEqual(index.regionCategoryIndexes['visual_style:minimal'], ['first-capture:desktop:features', 'second-capture:desktop:second-hero']);
    assert.equal(Object.keys(index.categoryIndexes).some(key => key.endsWith(':unknown')), false);
    assert.equal(Object.keys(index.regionCategoryIndexes).some(key => key.endsWith(':unknown')), false);
    assert.equal(index.facets.color_palette.includes('unknown'), false);
    assert.deepEqual(index.facets.viewport, ['desktop', 'mobile']);
    assert.equal(Object.keys(index.facets).length, 14);
    const saved = JSON.parse(await readFile(join(output, '.folio/index.json'), 'utf8'));
    assert.equal(saved.sectionIndex.length, 4);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('report escapes captured strings, disables unsafe source hrefs, and rejects escaping artifact paths', async () => {
  const output = await mkdtemp(join(tmpdir(), 'folio-report-'));
  try {
    const records = fixtures();
    records[0].manifest!.requestedUrl = 'javascript:alert("unsafe")';
    records[0].manifest!.variants[0].regions[0].frames[0].path = '../../../../outside.png';
    await exportCatalog(fixtureStore(output, records));
    const html = await readFile(join(output, 'report.html'), 'utf8');
    assert.equal((html.match(/<script>/g) ?? []).length, 1, 'Only the static report script can be executable');
    assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;globalThis.injected=1&lt;/script&gt;'));
    assert.equal(/href="javascript:/i.test(html), false);
    assert.ok(html.includes('invalid source URL'));
    assert.ok(html.includes('Image unavailable: invalid artifact path.'));
    assert.ok(html.includes('Source · unverified'));
    assert.ok(html.includes('model · high confidence'));
    assert.equal(/<script[^>]+src=/i.test(html), false);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('HTML facets conjunct on the same region, inherit page labels, filter viewports, and tokenize search', async () => {
  const output = await mkdtemp(join(tmpdir(), 'folio-report-'));
  const browser = await chromium.launch({ headless: true, channel: 'chromium', executablePath: process.env.FOLIO_TEST_BROWSER_PATH });
  try {
    await exportCatalog(fixtureStore(output));
    const html = await readFile(join(output, 'report.html'), 'utf8');
    const page = await browser.newPage();
    const requested: string[] = [];
    await page.route('**/*', async route => {
      requested.push(route.request().url());
      if (new URL(route.request().url()).pathname === '/report.html') await route.fulfill({ contentType: 'text/html', body: html });
      else await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' });
    });
    await page.goto('http://folio.test/report.html');
    const visible = () => page.locator('[data-region-ref]:not([hidden])');
    assert.equal(await visible().count(), 4);
    assert.equal(await page.locator('[data-facet]:visible').count(),4,'Default controls stay limited to aesthetic, composition, section, and viewport');
    assert.equal(await page.locator('.advanced').getAttribute('open'),null);
    assert.equal(await page.evaluate('globalThis.injected'), undefined);
    await page.locator('#facet-section_purpose').selectOption('hero');
    await page.locator('#facet-visual_style').selectOption('minimal');
    assert.equal(await visible().count(), 1, 'Minimal feature styling cannot turn another region into a minimal hero');
    assert.equal(await visible().getAttribute('data-region-ref'), 'second-capture:desktop:second-hero');
    assert.equal(await page.locator('#pages article:not([hidden])').count(), 1);
    assert.equal(await page.locator('.variant:not([hidden])').count(), 1);
    await page.locator('.advanced > summary').click();
    await page.locator('#facet-industry').selectOption('software');
    assert.equal(await visible().count(), 0);
    assert.equal(await page.locator('#no-matches').isVisible(), true);
    await page.locator('#reset-filters').click();
    await page.locator('#facet-industry').selectOption('software');
    await page.locator('#facet-viewport').selectOption('mobile');
    assert.equal(await visible().count(), 1);
    assert.equal(await visible().getAttribute('data-region-ref'), 'first-capture:mobile:mobile-hero');
    await page.locator('#reset-filters').click();
    await page.locator('#filter').fill('hero   second atlas');
    assert.equal(await visible().count(), 1, 'All separate search tokens should match, regardless of order');
    assert.equal(await visible().getAttribute('data-region-ref'), 'second-capture:desktop:second-hero');
    assert.equal(await page.locator('[data-facet]').count(), 14);
    assert.ok(requested.every(url => new URL(url).hostname === 'folio.test'), 'Report assets must remain local');
  } finally { await browser.close(); await rm(output, { recursive: true, force: true }); }
});
