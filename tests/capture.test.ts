import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { captureViewport } from '../src/capture.ts';
import { documentToViewport, intersectRect, mergeCoverage, pixelCrop, uncoveredRanges } from '../src/geometry.ts';
import type { CaptureSettings, ViewportCapture } from '../src/types.ts';
import { captureFixture } from './fixtures-capture.ts';

const settings: CaptureSettings = {
  navigationTimeoutMs: 5000, mediaTimeoutMs: 1000, settleTimeoutMs: 700, screenshotTimeoutMs: 5000,
  attemptTimeoutMs: 45000, maxAttempts: 2, maxScrollSteps: 40, explorationTimeoutMs: 15000,
  contextPixels: 24, frameOverlap: .15, cleanupPasses: 3, cleanupTimeoutMs: 2000, preserveSelectors: [], dismissSelectors: [],
};

test('viewport and device coordinates safely cover below-fold, fractional and invalid crops', () => {
  const document = { x: 0, y: 1800, width: 800, height: 400 };
  assert.equal(intersectRect(document, { x: 0, y: 0, width: 800, height: 600 }), null);
  const viewport = documentToViewport(document, 0, 1700);
  assert.deepEqual(pixelCrop(viewport, { width: 1600, height: 1200 }, 2), { x: 0, y: 200, width: 1600, height: 800 });
  assert.deepEqual(pixelCrop({ x: -.2, y: 2.4, width: 100.5, height: 3.2 }, { width: 800, height: 600 }, 2), { x: 0, y: 4, width: 201, height: 8 });
  assert.equal(pixelCrop({ x: 0, y: 0, width: Number.NaN, height: 10 }, { width: 10, height: 10 }, 2), null);
  assert.equal(pixelCrop({ x: 0, y: 2000, width: 100, height: 10 }, { width: 800, height: 600 }, 2), null);
  assert.deepEqual(mergeCoverage([{ start: 300, end: 500 }, { start: 0, end: 350 }]), [{ start: 0, end: 500 }]);
  assert.deepEqual(uncoveredRanges(800, [{ start: 0, end: 500 }, { start: 600, end: 800 }]), [{ start: 500, end: 600 }]);
});

test('mobile pages without a viewport declaration never produce fictional CSS-coordinate crops', { timeout: 30000 }, async () => {
  const fixture = await captureFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'folio-no-meta-'));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chromium', ...(process.env.FOLIO_TEST_BROWSER ? { executablePath: process.env.FOLIO_TEST_BROWSER } : {}) });
    const capture = await captureViewport({ browser, url: `${fixture.url}/no-meta`, settings,
      profile: { id: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true }, outputDir: directory });
    assert.equal(capture.status, 'incomplete');
    assert.equal(capture.stoppingReason, 'unsupported_layout_viewport');
    assert.equal(capture.regions.length, 0);
    assert.deepEqual(capture.coverage, []);
    const actual = capture.environment.actualViewport as { innerWidth: number; visualViewport: { scale: number } };
    assert(actual.innerWidth > 390);
    assert(actual.visualViewport.scale < 1);
    assert(capture.overview);
    const encoded = await sharp(await readFile(path.join(directory, capture.overview!))).metadata();
    assert.equal(encoded.width, 780);
  } finally {
    await browser?.close(); await fixture.close();
    const root = path.resolve(os.tmpdir()), target = path.resolve(directory);
    assert(target.startsWith(root + path.sep)); await rm(target, { recursive: true, force: true });
  }
});

test('browser capture fixtures preserve ordered evidence, remove nuisances and expose failures', { timeout: 180000 }, async t => {
  const fixture = await captureFixture();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'folio-capture-fixtures-'));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chromium', ...(process.env.FOLIO_TEST_BROWSER ? { executablePath: process.env.FOLIO_TEST_BROWSER } : {}) });
    const run = async (route: string, override: Partial<CaptureSettings> = {}): Promise<ViewportCapture> => captureViewport({
      browser: browser!, url: `${fixture.url}/${route}`, profile: { id: 'desktop', width: 800, height: 600, dpr: 2, isMobile: false, hasTouch: false },
      settings: { ...settings, ...override }, outputDir: path.join(directory, route || 'normal'),
    });
    const magentaPixels = async (capture: ViewportCapture, route: string) => {
      let count = 0;
      for (const region of capture.regions) for (const frame of region.frames) {
        const { data, info } = await sharp(await readFile(path.join(directory, route || 'normal', frame.path))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 0; i < data.length; i += info.channels) if (data[i] > 245 && data[i + 1] < 10 && data[i + 2] > 245) count++;
      }
      return count;
    };
    await t.test('static page, sticky navigation and lazy media have complete coverage at DPR2', async () => {
      const capture = await run('');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert.equal(capture.stoppingReason, 'page_end');
      assert.equal(capture.regions.find(region => region.selector === '#hero')?.title, 'Editorial hero');
      assert.equal(capture.regions.find(region => region.selector === '#features')?.title, 'Feature comparison');
      assert.deepEqual(uncoveredRanges(capture.pageHeight, capture.coverage), []);
      assert(capture.regions.flatMap(region => region.frames).some(frame => frame.bounds.y > 600));
      for (const region of capture.regions) for (const frame of region.frames) {
        assert.equal(frame.width, 1600);
        assert(frame.height <= 1200);
        assert.match(frame.sha256, /^[a-f0-9]{64}$/);
        assert(capture.evidence.some(item => item.id === region.evidenceIds[0] && item.regionId === region.id));
      }
    });
    await t.test('a narrow mobile profile preserves CSS and image coordinate scale', async () => {
      const capture = await captureViewport({ browser: browser!, url: `${fixture.url}/`,
        profile: { id: 'small-mobile', width: 360, height: 640, dpr: 2, isMobile: true, hasTouch: true },
        settings, outputDir: path.join(directory, 'mobile'), });
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert.deepEqual(uncoveredRanges(capture.pageHeight, capture.coverage), []);
      assert(capture.regions.every(region => region.frames.length && region.frames.every(frame => frame.width === 720 && frame.height <= 1280)));
    });
    await t.test('tablet touch capture records an Android tablet user agent', async () => {
      const capture = await captureViewport({ browser: browser!, url: `${fixture.url}/`,
        profile: { id: 'tablet', width: 768, height: 900, dpr: 2, isMobile: true, hasTouch: true },
        settings, outputDir: path.join(directory, 'tablet') });
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert.match(String(capture.environment.userAgent), /Pixel Tablet/);
      assert.doesNotMatch(String(capture.environment.userAgent), /Mobile|iPad/);
    });
    await t.test('known cookie dialog uses its reject control', async () => {
      const capture = await run('cookie');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.action === 'reject-cookies' && item.method === 'scoped-dismiss-control' && item.verified));
      assert.equal(await magentaPixels(capture, 'cookie'), 0);
    });
    await t.test('known CMP without a reject control invokes and verifies its documented opt-out API', async () => {
      const capture = await run('cookiebot-api');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.action === 'reject-cookies' && item.method === 'known-cmp-reject-api' && item.verified && /verified from provider state/.test(item.note ?? '')));
      assert.equal(await magentaPixels(capture, 'cookiebot-api'), 0);
    });
    await t.test('recurrent newsletter never pollutes reference images', async () => {
      const capture = await run('recurrent');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.action === 'dismiss-recurrent-promotion'));
      assert.equal(await magentaPixels(capture, 'recurrent'), 0);
    });
    await t.test('open-shadow cookie dialog is dismissed', async () => {
      const capture = await run('shadow');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.action === 'reject-cookies'));
      assert.equal(await magentaPixels(capture, 'shadow'), 0);
    });
    await t.test('a nuisance consent iframe cannot leave its opaque host over the page', async () => {
      const capture = await run('iframe');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.action === 'dismiss-cookie' && item.target.startsWith('iframe')));
      assert.equal(await magentaPixels(capture, 'iframe'), 0);
    });
    await t.test('native promotional dialog leaves the top layer through close()', async () => {
      const capture = await run('native');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.method === 'targeted-nuisance-hide'));
      assert(capture.evidence.some(item => item.kind === 'raw-diagnostic'));
      assert.equal(await magentaPixels(capture, 'native'), 0);
    });
    await t.test('unattributed blur, inert state and scroll lock remain flagged instead of rewritten', async () => {
      const capture = await run('residual');
      assert.equal(capture.status, 'incomplete');
      assert(capture.warnings.some(warning => /inert/.test(warning)));
      assert(capture.warnings.some(warning => /blurred/.test(warning)));
      assert(capture.warnings.some(warning => /scroll lock/.test(warning)));
      const state = capture.evidence.find(item => item.kind === 'cleanup-state')?.value as Array<{ after: { main: Array<{ inert: boolean; filter: string }> } }>;
      assert(state[0].after.main[0].inert);
      assert.match(state[0].after.main[0].filter, /blur\(4px\)/);
    });
    await t.test('legitimate preserved product dialog survives', async () => {
      const capture = await run('preserve', { preserveSelectors: ['.legit'] });
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert.equal(capture.interventions.length, 0);
      const first = capture.regions.flatMap(region => region.frames).find(frame => frame.bounds.y < 200 && frame.bounds.y + frame.bounds.height > 120)!;
      const { data } = await sharp(await readFile(path.join(directory, 'preserve', first.path))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert(data.some((value, index) => index % 3 === 0 && value === 255 && data[index + 1] === 34 && data[index + 2] === 0));
    });
    await t.test('broken lazy image remains incomplete instead of complete=true success', async () => {
      const capture = await run('broken');
      assert.equal(capture.status, 'incomplete');
      assert(capture.warnings.some(warning => /Broken image/.test(warning)));
      assert(capture.regions.some(region => region.frames.length));
    });
    await t.test('transient lazy source failures do not taint a later verified image', async () => {
      const capture = await run('swap');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      const evidence = capture.evidence.find(item => item.regionId === capture.regions.find(region => region.selector === '#features')?.id && item.kind === 'region-dom')?.value as { media: Array<{ loaded: boolean; src: string }> };
      assert(evidence.media.some(media => media.loaded && /image\.svg/.test(media.src)));
    });
    await t.test('finite opacity reveals finish before reference screenshots', async () => {
      const capture = await run('reveal', { settleTimeoutMs: 1500 });
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      const hero = capture.regions.find(region => region.selector === '#hero')!;
      const frame = hero.frames.find(frame => frame.bounds.y <= hero.bounds.y + 20 && frame.bounds.y + frame.bounds.height > hero.bounds.y + 20)!;
      const y = Math.round((hero.bounds.y + 20 - frame.bounds.y) * 2);
      const { data } = await sharp(await readFile(path.join(directory, 'reveal', frame.path))).extract({ left: 40, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([...data], [255, 244, 222]);
    });
    await t.test('access gate is preserved and recorded as blocked', async () => {
      const capture = await run('unknown');
      assert.equal(capture.status, 'blocked');
      assert.equal(capture.stoppingReason, 'unresolved_overlay');
      assert.equal(capture.interventions.length, 0);
      assert(capture.overview);
    });
    await t.test('infinite content hits a resumable exploration limit', async () => {
      const capture = await run('infinite', { maxScrollSteps: 6, explorationTimeoutMs: 8000 });
      assert.equal(capture.status, 'incomplete');
      assert.equal(capture.stoppingReason, 'exploration_limit');
    });
    await t.test('internal scrolling content is explicit about uncovered states', async () => {
      const capture = await run('nested');
      assert.equal(capture.status, 'incomplete');
      assert(capture.evidence.some(item => item.kind === 'uncovered-scroll-states'));
    });
    await t.test('public horizontal carousels produce observed frames and restore their initial position', async () => {
      const capture = await run('horizontal');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      const region = capture.regions.find(region => region.selector === '#carousel-section')!;
      const states = capture.evidence.filter(item => item.regionId === region.id && item.kind === 'observed-scroll-state').map(item => item.value as { selector: string; sequence: number; scrollLeft: number; coveredRange: { start: number; end: number }; path: string });
      assert.equal(states.length, 2);
      assert(states.every((state, index) => state.selector === '#carousel' && state.sequence === index && region.frames.some(frame => frame.path === state.path && frame.kind === 'scroll-state')));
      assert.equal(states[0].scrollLeft, 0);
      assert(states[1].scrollLeft > 0);
      const coverage = capture.evidence.find(item => item.regionId === region.id && item.kind === 'observed-scroll-coverage')?.value as { covered: Array<{ start: number; end: number }>; restoredTo: { left: number }; reachedEnd: boolean };
      assert.deepEqual(coverage.covered, [{ start: 0, end: 948 }]);
      assert.equal(coverage.restoredTo.left, 120);
      assert(coverage.reachedEnd);
      assert.deepEqual(uncoveredRanges(capture.pageHeight, capture.coverage), []);
    });
    await t.test('horizontal state budgets are reported as incomplete', async () => {
      const capture = await run('horizontal-budget', { maxScrollSteps: 12 });
      assert.equal(capture.status, 'incomplete');
      const uncovered = capture.evidence.find(item => item.kind === 'uncovered-scroll-states')?.value as Array<{ reason: string }>;
      assert(uncovered.some(item => /horizontal-state-budget/.test(item.reason)));
    });
    await t.test('images outside clipping ancestors do not count as visible broken media', async () => {
      const capture = await run('clipped-media');
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(!capture.warnings.some(warning => /broken\.svg/.test(warning)));
    });
  } finally {
    await browser?.close(); await fixture.close();
    // The unique test directory is resolved inside os.tmpdir before recursive cleanup.
    const root = path.resolve(os.tmpdir()), target = path.resolve(directory);
    assert(target.startsWith(root + path.sep));
    await rm(target, { recursive: true, force: true });
  }
});
