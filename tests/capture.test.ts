import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { captureViewport } from '../src/capture.ts';
import { sweepCleanup } from '../src/cleanup.ts';
import { documentToViewport, intersectRect, mergeCoverage, pixelCrop, uncoveredRanges } from '../src/geometry.ts';
import type { CaptureSettings, Intervention, ViewportCapture } from '../src/types.ts';
import { captureFixture } from './fixtures-capture.ts';
import { referenceSubjects } from '../src/references.ts';

const settings: CaptureSettings = {
  navigationTimeoutMs: 5000, mediaTimeoutMs: 1000, settleTimeoutMs: 700, screenshotTimeoutMs: 5000,
  attemptTimeoutMs: 45000, maxAttempts: 2, maxScrollSteps: 40, explorationTimeoutMs: 15000,
  contextPixels: 24, frameOverlap: .15, cleanupPasses: 3, cleanupTimeoutMs: 2000, preserveSelectors: [], dismissSelectors: [],
};

test('named page sections survive full-page decoration and nested cards, with one complete PNG per viewport', {timeout:90000},async t=>{
  const fixture=await captureFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'folio-real-sections-'));
  const browser=await chromium.launch({channel:'chromium'});
  try{
    for(const [id,width,height,mobile] of [['desktop',800,600,false],['tablet',768,1024,true],['mobile',390,844,true]] as const)await t.test(id,async()=>{
      const capture=await captureViewport({browser,url:`${fixture.url}/real-sections`,settings:{...settings,contextPixels:64,maxScrollSteps:80,explorationTimeoutMs:30000},profile:{id,width,height,dpr:2,isMobile:mobile,hasTouch:mobile},outputDir:path.join(directory,id)});
      assert.equal(capture.status,'complete',JSON.stringify(capture.warnings));
      assert.deepEqual(capture.regions.map(r=>r.title),['Beyond Humanware','Overview','Company details','Invisible Approach','Our Progress','Scientific Evidence','Driven by People','Footer']);
      assert(capture.regions.every(r=>r.referenceKind==='section'&&r.frames.length===1),'Each real section is one original PNG');
      assert.equal(capture.regions[0].frames[0].height,height*2,'Context does not create an extra hero image');
      assert(!capture.overview,'Successful hero is not saved twice');
      assert.deepEqual(uncoveredRanges(capture.pageHeight,capture.coverage),[]);
      const subjects=referenceSubjects({schemaVersion:1,pageId:'page',captureId:'capture',captureSignature:'fixture',requestedUrl:capture.requestedUrl,title:capture.title,capturedAt:capture.capturedAt,status:'complete',reviewStatus:'unreviewed',provenance:[],variants:[capture]});
      assert.equal(subjects.filter(s=>s.scope==='section').length,8,'Cards and decoration never create separate classification jobs');
    });
  }finally{await browser.close();await fixture.close();const target=path.resolve(directory);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep));await rm(target,{recursive:true,force:true});}
});

test('static page-bottom crops advance without repeating the prior viewport, and floating navigation is preserved outside section crops', {timeout:60000},async t=>{
  const fixture=await captureFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'folio-tail-'));
  const browser=await chromium.launch({channel:'chromium',...(process.env.FOLIO_TEST_BROWSER?{executablePath:process.env.FOLIO_TEST_BROWSER}:{})});
  try{
    for(const route of ['static-tail','floating-navigation'])await t.test(route,async()=>{
      const capture=await captureViewport({browser,url:`${fixture.url}/${route}`,settings:{...settings,contextPixels:0},profile:{id:'desktop',width:800,height:600,dpr:2,isMobile:false,hasTouch:false},outputDir:path.join(directory,route)});
      assert.equal(capture.status,'complete',JSON.stringify(capture.warnings));
      const tail=capture.regions.find(r=>r.selector==='#tail')!,frames=tail.frames;
      assert.equal(frames.length,1,'A static section is one complete image');assert.equal(frames[0].bounds.height,605);
      assert.equal(frames[0].height,1210);assert.deepEqual(mergeCoverage(capture.coverage),[{start:0,end:route==='floating-navigation'?1205:605}]);
      if(route==='floating-navigation'){
        const navigation=capture.evidence.filter(e=>e.kind==='capture-state'&&e.regionId===tail.id).map(e=>(e.value as {navigationOcclusion:number}).navigationOcclusion);
        assert(navigation.every(v=>v===70),'Fixed parent of semantic navigation with a top gap is detected');
        for(const frame of frames){const {data,info}=await sharp(await readFile(path.join(directory,route,frame.path))).removeAlpha().raw().toBuffer({resolveWithObject:true});let magenta=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]>245&&data[i+1]<10&&data[i+2]>245)magenta++;assert.equal(magenta,0,'Magenta navigation is outside section crops');}
        assert(!capture.interventions.some(i=>i.target.toLowerCase().includes('navigation')),'Navigation is not hidden as a nuisance');
      }
    });
  }finally{await browser.close();await fixture.close();const target=path.resolve(directory);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep));await rm(target,{recursive:true,force:true});}
});

test('opaque pinned containers retain honest scroll states and collect DOM evidence at each captured position', {timeout:45000},async()=>{
  const fixture=await captureFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'folio-state-dom-'));
  const browser=await chromium.launch({channel:'chromium',...(process.env.FOLIO_TEST_BROWSER?{executablePath:process.env.FOLIO_TEST_BROWSER}:{})});
  try{
    const capture=await captureViewport({browser,url:`${fixture.url}/scroll-evidence`,settings,profile:{id:'desktop',width:800,height:600,dpr:2,isMobile:false,hasTouch:false},outputDir:directory});
    assert.equal(capture.status,'complete',JSON.stringify(capture.warnings));
    const scene=capture.regions.find(r=>r.selector==='#scene')!;
    assert.equal(scene.title,'Scroll sequence');assert.equal(scene.boundaryConfidence,'low');assert(scene.frames.length>=3);
    assert(scene.frames.every(f=>f.kind==='scroll-state'));
    const evidence=capture.evidence.filter(e=>e.kind==='capture-state'&&e.regionId===scene.id).map(e=>e.value as {dom:{scope:string;text:string}});
    assert(evidence.every(e=>e.dom.scope==='visible-frame'));assert(evidence.some(e=>e.dom.text.includes('Later visible state')),'Top-of-page DOM does not discard late-revealed text');
  }finally{await browser.close();await fixture.close();const target=path.resolve(directory);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep));await rm(target,{recursive:true,force:true});}
});

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

test('cleanup reconciles scan and observer races within existing bounds', { timeout: 60000 }, async t => {
  const fixture = await captureFixture();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chromium', ...(process.env.FOLIO_TEST_BROWSER ? { executablePath: process.env.FOLIO_TEST_BROWSER } : {}) });
    for (const route of ['scan-race', 'observer-race', 'observer-gate-race']) await t.test(route, async () => {
      for (let repeat = 0; repeat < 6; repeat++) {
        const context = await browser!.newContext({ viewport: { width: 800, height: 600 } });
        try {
          const page = await context.newPage();
          await page.goto(`${fixture.url}/${route}`, { waitUntil: 'domcontentloaded' });
          const log: Intervention[] = [];
          const cleanup = await sweepCleanup(page, { ...settings, ...(route.startsWith('observer-') ? { cleanupPasses: 1 } : {}) }, log);
          if (route === 'observer-gate-race') {
            assert.equal(cleanup.unresolved.length, 1, `gate was hidden on repeat ${repeat}`);
            assert(await page.locator('#newsletter-popup').isVisible());
            assert.match(await page.locator('#newsletter-popup').innerText(), /Sign in to continue/);
          } else {
            assert.deepEqual(cleanup.unresolved, [], `known nuisance survived on repeat ${repeat}`);
            assert(await page.locator('#newsletter-popup').isHidden());
            assert(log.some(item => item.verified));
            if (route === 'observer-race') assert(log.some(item => item.action === 'dismiss-recurrent-promotion'));
          }
          assert.equal(await page.evaluate(() => (window as unknown as { raceInjections: number }).raceInjections), route === 'scan-race' ? 1 : 2);
        } finally { await context.close(); }
      }
    });
  } finally { await browser?.close(); await fixture.close(); }
});

test('recurrent newsletter capture stays clean across fresh-context repetitions', { timeout: 90000 }, async () => {
  const fixture = await captureFixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'folio-recurrent-capture-'));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chromium', ...(process.env.FOLIO_TEST_BROWSER ? { executablePath: process.env.FOLIO_TEST_BROWSER } : {}) });
    for (let repeat = 0; repeat < 3; repeat++) {
      const outputDir = path.join(directory, String(repeat));
      const capture = await captureViewport({ browser, url: `${fixture.url}/recurrent`, settings, outputDir,
        profile: { id: 'desktop', width: 800, height: 600, dpr: 2, isMobile: false, hasTouch: false } });
      assert.equal(capture.status, 'complete', JSON.stringify(capture.warnings));
      assert(capture.interventions.some(item => item.action === 'dismiss-recurrent-promotion'));
      let magenta = 0;
      for (const region of capture.regions) for (const frame of region.frames) {
        const { data, info } = await sharp(await readFile(path.join(outputDir, frame.path))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let index = 0; index < data.length; index += info.channels) if (data[index] > 245 && data[index + 1] < 10 && data[index + 2] > 245) magenta++;
      }
      assert.equal(magenta, 0, `newsletter pixels survived repeat ${repeat}`);
    }
  } finally {
    await browser?.close(); await fixture.close();
    const root = path.resolve(os.tmpdir()), target = path.resolve(directory);
    assert(target.startsWith(root + path.sep)); await rm(target, { recursive: true, force: true });
  }
});

test('verified Apple locale chooser closes without selecting a country or touching ordinary country UI', { timeout: 30000 }, async () => {
  const fixture = await captureFixture();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chromium', ...(process.env.FOLIO_TEST_BROWSER ? { executablePath: process.env.FOLIO_TEST_BROWSER } : {}) });
    for (const route of ['apple-locale', 'country-design']) {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
      try {
        const page = await context.newPage();
        await page.goto(`${fixture.url}/${route}`, { waitUntil: 'domcontentloaded' });
        const originalUrl = page.url(), log: Intervention[] = [];
        const cleanup = await sweepCleanup(page, settings, log);
        assert.deepEqual(cleanup.unresolved, []);
        assert.equal(page.url(), originalUrl);
        assert.equal(await page.evaluate(() => !!(window as unknown as { countryChanged?: boolean }).countryChanged), false);
        if (route === 'apple-locale') {
          assert(await page.locator('#ac-localeswitcher').isHidden());
          assert.equal(await page.evaluate(() => !!(window as unknown as { localeClosed?: boolean }).localeClosed), true);
          assert(log.some(item => item.action === 'dismiss-locale' && item.method === 'scoped-dismiss-control' && item.verified));
        } else {
          assert(await page.locator('#country-product-design').isVisible());
          assert.equal(log.length, 0);
        }
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await fixture.close(); }
});

test('ElevenLabs floating Voice chat is hidden without opening it or hiding inline examples', { timeout: 30000 }, async () => {
  const fixture = await captureFixture();
  let browser: Browser | undefined;
  try {
    const html = await (await fetch(`${fixture.url}/eleven-floating`)).text();
    browser = await chromium.launch({ channel: 'chromium', ...(process.env.FOLIO_TEST_BROWSER ? { executablePath: process.env.FOLIO_TEST_BROWSER } : {}) });
    for (const variant of ['known', 'preserved', 'other-host']) {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
      try {
        const url = `https://${variant === 'other-host' ? 'example.test' : 'elevenlabs.io'}/folio-fixture`;
        await context.route('**/*', route => route.request().url() === url ? route.fulfill({ status: 200, contentType: 'text/html', body: html }) : route.abort());
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const log: Intervention[] = [];
        const cleanup = await sweepCleanup(page, { ...settings, preserveSelectors: variant === 'preserved' ? ['#floating-voice'] : [] }, log);
        assert.deepEqual(cleanup.unresolved, []);
        assert(await page.locator('#inline-voice').isVisible());
        assert.equal(await page.evaluate(() => !!(window as unknown as { microphoneOpened?: boolean }).microphoneOpened), false);
        if (variant === 'known') {
          assert(await page.locator('#floating-voice').isHidden());
          assert(log.some(item => item.action === 'dismiss-chat' && item.method === 'targeted-nuisance-hide' && item.verified));
          // A later mutation re-runs recurrence policy without erasing the inline example.
          await page.locator('#inline-voice').evaluate(el => el.setAttribute('style', 'color:blue'));
          assert(await page.locator('#inline-voice').isVisible());
        } else {
          assert(await page.locator('#floating-voice').isVisible());
          assert.equal(log.length, 0);
        }
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await fixture.close(); }
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
        assert.equal(frame.height,Math.round(frame.bounds.height*2));
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
      assert(capture.regions.every(region => region.frames.length && region.frames.every(frame => frame.width === 720 && frame.height === Math.round(frame.bounds.height*2))));
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
      const dom=capture.evidence.find(item=>item.id===hero.evidenceIds[0])!.value as {layout:{bounds:{y:number}}};
      const probe=dom.layout.bounds.y+20;
      const frame = hero.frames.find(frame => frame.bounds.y <= probe && frame.bounds.y + frame.bounds.height > probe)!;
      const y = Math.round((probe - frame.bounds.y) * 2);
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
