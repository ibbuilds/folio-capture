import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { devices, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import type { CaptureOptions, Rect, Region, ViewportCapture } from './types.ts';
import { documentToViewport, intersectRect, mergeCoverage, uncoveredRanges } from './geometry.ts';
import { sweepCleanup } from './cleanup.ts';
import { guardNuisances } from './nuisance.ts';
import { captureRegionImage, captureCompleteSection, prepareSectionCapture } from './image-capture.ts';
import { imageName, NAMING_VERSION } from './naming.ts';
import { ResolvedDuplicate } from './utils.ts';

type DomRegion = { title: string; selector: string; y: number; end: number; semantic: boolean; sticky: boolean; section?:boolean; value: Record<string, unknown> };
class UnsupportedViewportError extends Error {}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const pageHeight = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight));

async function settle(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let prior: number[] = [], stable = 0;
  while (Date.now() < deadline) {
    const next = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('main > *, section, h1, h2, img')).filter(element => {
        const rect = element.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
      }).slice(0, 60);
      const finiteMotion = document.getAnimations().filter(animation => {
        if (!(animation.effect instanceof KeyframeEffect) || !(animation.effect.target instanceof Element)) return false;
        const target = animation.effect.target, rect = target.getBoundingClientRect();
        const timing = animation.effect.getTiming(), timeline = animation.timeline?.constructor.name;
        return rect.bottom > 0 && rect.top < innerHeight && Number.isFinite(timing.iterations) &&
          timeline !== 'ScrollTimeline' && timeline !== 'ViewTimeline' && (animation.playState === 'running' || animation.pending);
      }).length;
      return [Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0), scrollY, finiteMotion,
        ...elements.flatMap(element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, Number(getComputedStyle(element).opacity) * 100]; })];
    });
    if (next[2] === 0 && next.length === prior.length && next.every((value, i) => Math.abs(value - prior[i]) <= 1)) stable++;
    else stable = 0;
    if (stable >= 3) return true;
    prior = next;
    await pause(Math.min(150, Math.max(25, timeoutMs / 5)));
  }
  return false;
}

/** Wait only for assets affecting the current rendered view, not every offscreen lazy asset. */
async function readyMedia(page: Page, timeoutMs: number): Promise<string[]> {
  return page.evaluate(async budget => {
    const elements: Element[] = [];
    const visit = (root: Document | ShadowRoot) => { for (const el of root.querySelectorAll('*')) { elements.push(el); if (el.shadowRoot) visit(el.shadowRoot); } };
    visit(document);
    const visible = (element: Element) => {
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      if (r.width <= 1 || r.height <= 1 || s.display === 'none' || s.visibility === 'hidden') return false;
      let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right), top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
      let parent: Element | null = element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);
      while (parent) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (/(?:hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, rect.left + parent.clientLeft); right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth); }
        if (/(?:hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, rect.top + parent.clientTop); bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight); }
        parent = parent.parentElement ?? (parent.getRootNode() instanceof ShadowRoot ? (parent.getRootNode() as ShadowRoot).host : null);
      }
      return right > left + 1 && bottom > top + 1;
    };
    const images = elements.filter((el): el is HTMLImageElement => el instanceof HTMLImageElement && visible(el));
    const backgrounds = [...new Set(elements.filter(visible).flatMap(el => {
      const image = getComputedStyle(el).backgroundImage;
      return Array.from(image.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g), match => (match[1] ?? match[2] ?? match[3]).trim());
    }))].slice(0, 80);
    const warnings: string[] = [];
    let fontReady = false;
    const work = async () => {
      await document.fonts.ready;
      fontReady = true;
      for (const font of document.fonts) if (font.status === 'error') warnings.push(`Font failed: ${font.family}`);
      const imageWork = images.map(async img => {
        const source = img.currentSrc || img.src;
        try {
          try { await img.decode(); }
          catch (error) { if ((img.currentSrc || img.src) !== source) await img.decode(); else throw error; }
          if (!img.naturalWidth) warnings.push(`Broken image: ${img.currentSrc || img.src}`);
        } catch {
          if (!img.complete || !img.naturalWidth) warnings.push(`Broken image: ${img.currentSrc || img.src || img.alt || '(empty source)'}`);
        }
      });
      const backgroundWork = backgrounds.map(async src => {
        const img = new Image(); img.src = src;
        try { await img.decode(); } catch { warnings.push(`Broken background: ${src}`); }
      });
      await Promise.all([...imageWork, ...backgroundWork]);
    };
    let timedOut = false;
    await Promise.race([work(), new Promise<void>(resolve => setTimeout(() => { timedOut = true; resolve(); }, budget))]);
    if (!fontReady) warnings.push('Font readiness timed out.');
    if (timedOut) {
      for (const img of images) if (!img.complete || !img.naturalWidth) warnings.push(`Media readiness timed out: ${img.currentSrc || img.src || img.alt}`);
      if (!warnings.length) warnings.push('Background/media decoding timed out.');
    }
    for (const video of elements.filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement && visible(el))) {
      if (video.error) warnings.push(`Video failed: ${video.currentSrc || video.src}`);
      else if (video.readyState < 2 && !video.poster) warnings.push(`Video has no rendered frame: ${video.currentSrc || video.src}`);
    }
    return [...new Set(warnings)];
  }, timeoutMs);
}

async function describe(page: Page): Promise<{ title: string; description: string; text: string; headings: unknown[]; regions: DomRegion[]; height: number }> {
  return page.evaluate(() => {
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight);
    const main = document.querySelector('main, [role="main"]') ?? document.body;
    const all: Element[] = [];
    const visit = (root: Document | ShadowRoot) => { for (const el of root.querySelectorAll('*')) { all.push(el); if (el.shadowRoot) visit(el.shadowRoot); } };
    visit(document);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 40 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const heading = (element: Element) => Array.from(element.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 30).map(h => ({ level: Number(h.tagName[1]), text: ((h as HTMLElement).innerText || h.textContent || '').replace(/\s+/g,' ').trim().slice(0, 300) }));
    const selector = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
        if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children).filter(el => el.tagName === current!.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const semantic='section, article, [role="region"]';
    const ownHeading=(el:Element)=>Array.from(el.querySelectorAll('h1,h2,h3')).find(h=>(h.closest(semantic)===el||!h.closest(semantic))&&(h.textContent??'').trim());
    const substantive=(el:Element)=>Boolean(ownHeading(el)||el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||
      (el.textContent??'').trim().length>30||Array.from(el.querySelectorAll('img,video,canvas,iframe')).some(media=>{const r=media.getBoundingClientRect();return r.width>80&&r.height>80;})||
      (el.getBoundingClientRect().height>innerHeight*2&&Array.from(el.querySelectorAll('*')).some(child=>{const r=child.getBoundingClientRect();return ['sticky','fixed'].includes(getComputedStyle(child).position)&&r.width>=innerWidth*.45&&r.height>100;})));
    const candidates = all.filter(el => el.matches(semantic) && main.contains(el) && visible(el) && el.getBoundingClientRect().width >= innerWidth * .45 && substantive(el));
    const independentChildren=(el:Element)=>candidates.filter(child=>child!==el&&el.contains(child)&&Boolean(ownHeading(child)||child.getAttribute('aria-label'))&&
      !candidates.some(between=>between!==el&&between!==child&&el.contains(between)&&between.contains(child)));
    const wrapper=(el:Element)=>!ownHeading(el)&&!el.getAttribute('aria-label')&&independentChildren(el).filter(child=>Boolean(child.querySelector('h1,h2'))||child.getAttribute('aria-label')).length>=2;
    const leafBands = candidates.filter(el => {
      if(wrapper(el))return false;
      return !candidates.some(parent=>parent!==el&&parent.contains(el)&&!wrapper(parent));
    });
    // Div-based pages often put every chapter inside one page wrapper. A heading's
    // widest single-heading ancestor supplies its complete chapter, including media
    // and supporting cards. Narrow cards and heading-only text blocks are excluded.
    const majorHeadings=all.filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return main.contains(el)&&el.matches('h1,h2')&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Boolean((el.textContent??'').trim());});
    const majorIn=(el:Element)=>majorHeadings.filter(h=>el.contains(h));
    const mainWidth=main.getBoundingClientRect().width||innerWidth;
    const headingBands:Element[]=[];
    for(const h of majorHeadings){
      if(leafBands.some(band=>band.contains(h)))continue;
      let best:Element|undefined;
      for(let current=h.parentElement;current&&current!==main;current=current.parentElement){
        if(majorIn(current).length>1)break;
        const r=current.getBoundingClientRect();
        if(visible(current)&&r.width>=mainWidth*.8&&r.height>=120&&!['absolute','fixed'].includes(getComputedStyle(current).position)&&current.getAttribute('aria-hidden')!=='true')best=current;
      }
      if(best&&!headingBands.includes(best))headingBands.push(best);
    }
    const directBands=Array.from(main.children).filter(el => visible(el) && substantive(el) && !['absolute','fixed'].includes(getComputedStyle(el).position) && el.getBoundingClientRect().width >= innerWidth * .45 &&
      !leafBands.some(band => band === el || band.contains(el) || el.contains(band))&&headingBands.filter(band=>el!==band&&el.contains(band)).length<2);
    const inferred=[...directBands,...headingBands.filter(band=>!directBands.some(parent=>parent===band||parent.contains(band)))];
    const chrome = all.filter(el => el.matches('header, footer, [role="banner"], [role="contentinfo"]') && visible(el) &&
      !main.contains(el) && !all.some(parent => parent !== el && parent.matches('header, footer') && parent.contains(el)));
    const chosen = [...new Set([...leafBands, ...inferred, ...chrome])];
    const regions = chosen.map(el => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el), descendants = all.filter(child => el === child || el.contains(child)).slice(0, 1500);
      const headings = heading(el), first = (ownHeading(el)?.textContent??headings[0]?.text??'').replace(/\s+/g,' ').trim();
      const stickyElements = descendants.filter(child => ['sticky', 'fixed'].includes(getComputedStyle(child).position)).map(child => ({ tag: child.tagName.toLowerCase(), text: (child.textContent ?? '').trim().slice(0, 100), position: getComputedStyle(child).position }));
      const text = ((el as HTMLElement).innerText ?? '').trim().slice(0, 6000);
      const media = descendants.filter(child => child.matches('img,video,iframe,canvas,svg')).slice(0, 40).map(child => {
        const b = child.getBoundingClientRect();
        return { tag: child.tagName.toLowerCase(), src: child.getAttribute('src') ?? child.getAttribute('poster') ?? '', alt: child.getAttribute('alt') ?? '', width: b.width, height: b.height,
          loaded: child instanceof HTMLImageElement ? child.complete && child.naturalWidth > 0 : child instanceof HTMLVideoElement ? child.readyState >= 2 || !!child.poster : null };
      });
      const links = descendants.filter(child => child.matches('a[href]')).slice(0, 40).map(child => ({ text: (child.textContent ?? '').trim().slice(0, 160), href: (child as HTMLAnchorElement).href }));
      let columns: number | null = null;
      if (style.display.includes('grid') && style.gridTemplateColumns !== 'none') columns = style.gridTemplateColumns.split(/\s+(?![^()]*\))/).filter(Boolean).length;
      else if (style.display.includes('flex') && style.flexDirection.startsWith('row')) columns = el.children.length;
      const y = Math.max(0, r.top + scrollY), end = Math.min(height, r.bottom + scrollY);
      const unresolved=!leafBands.includes(el)&&!chrome.includes(el)&&directBands.includes(el)&&r.height>innerHeight*2&&majorIn(el).length>1;
      return { title: unresolved?'Unresolved page region':first || el.getAttribute('aria-label') || (el.tagName === 'HEADER' ? 'Navigation' : el.tagName === 'FOOTER' ? 'Footer' : text.slice(0, 80).split('\n')[0] || 'Untitled section'),
        section:!unresolved,
        selector: selector(el), y, end, semantic: leafBands.includes(el) || chrome.includes(el), sticky: stickyElements.length > 0,
        value: { title: first ?? '', headings, text, links, media, selector: selector(el),
          styles: { backgroundColor: style.backgroundColor, color: style.color, fontFamily: style.fontFamily,
            fontSizes: [...new Set(descendants.filter(child => child.matches('h1,h2,h3,p,span,a')).slice(0, 150).map(child => getComputedStyle(child).fontSize))],
            borderRadius: style.borderRadius, boxShadow: style.boxShadow, display: style.display },
          layout: { bounds: { x: r.left + scrollX, y, width: r.width, height: Math.max(0, end - y) }, widthRatio: r.width / innerWidth, columns, stickyElements } } };
    }).filter(region => region.end > region.y + 20).sort((a, b) => a.y - b.y || a.end - b.end);
    return { title: document.title, description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '', text: (document.body.innerText ?? '').slice(0, 15000), headings: heading(document.body), regions, height };
  });
}

function makeRegions(snapshot: Awaited<ReturnType<typeof describe>>, profile: CaptureOptions['profile'], contextPixels: number): Region[] {
  const bands: DomRegion[] = [];
  let cursor = 0;
  const fallback = (start: number, end: number) => ({ title: 'Unresolved page region', selector: '', y: start, end, semantic: false, sticky: false, value: {} });
  for (const candidate of snapshot.regions) {
    if (candidate.end <= cursor + 1) continue;
    if (candidate.y > cursor + 1) bands.push(fallback(cursor, candidate.y));
    const y = Math.max(cursor, candidate.y);
    bands.push({ ...candidate, y });
    cursor = candidate.end;
  }
  if (cursor < snapshot.height - 1) bands.push(fallback(cursor, snapshot.height));
  if (!bands.length) bands.push(fallback(0, snapshot.height));
  // A small site header belongs to the first composition, not an independent design section.
  if(bands.length>1&&bands[0].title==='Navigation'&&bands[0].y===0&&bands[0].end<=profile.height*.25&&bands[1].selector) {
    bands[1].y=0;bands.shift();
  }
  return bands.map((band, index) => {
    const bounds: Rect = { x: 0, y: band.y, width: profile.width, height: band.end - band.y };
    // Neighboring context never turns a section that fits into an extra screenshot.
    const padding=bounds.height<=profile.height?Math.min(contextPixels,Math.max(0,(profile.height-bounds.height)/2)):contextPixels;
    const captureBounds = { x: 0, y: Math.max(0, band.y - padding), width: profile.width,
      height: Math.min(snapshot.height, band.end + padding) - Math.max(0, band.y - padding) };
    const id = `${profile.id}-region-${String(index + 1).padStart(3, '0')}`;
    const opaqueSequence=band.sticky&&!band.semantic&&band.title==='Untitled section'&&bounds.height>profile.height*2;
    return { id, order: index, title: opaqueSequence?'Scroll sequence':band.title, selector: band.selector || undefined, roleHint: band.sticky ? 'scroll-dependent' : undefined,
      bounds, captureBounds, method: band.semantic ? 'semantic' : band.selector ? 'inferred' : 'viewport-fallback',
      referenceKind:band.selector&&band.section!==false?'section':'page-context',
      boundaryConfidence: opaqueSequence?'low':band.semantic ? 'high' : band.selector ? 'medium' : 'low', frames: [], evidenceIds: [`${id}-dom`] };
  });
}

async function navigationOcclusion(page: Page, region: Region): Promise<number> {
  if (/navigation/i.test(region.title)) return 0;
  return page.evaluate(atTop => {
    // Keep the original top-of-page composition, including intentional floating nav.
    if(atTop&&scrollY<=1)return 0;
    const main = document.querySelector('main, [role="main"]');
    return Math.max(0, ...Array.from(document.querySelectorAll('header, [role="banner"], nav, [role="navigation"]')).filter(el => !main?.contains(el)).flatMap(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      let positioned=false;
      for(let ancestor:Element|null=el;ancestor&&ancestor!==document.body;ancestor=ancestor.parentElement)if(['sticky','fixed'].includes(getComputedStyle(ancestor).position)){positioned=true;break;}
      return positioned && r.width>=innerWidth*.25 && r.top<=innerHeight*.15 && r.bottom>0 && r.bottom<innerHeight*.4 && s.visibility!=='hidden' && s.display!=='none' ? [r.bottom] : [];
    }));
  },region.captureBounds.y<=1);
}

/** Evidence belongs to the rendered frame, including text revealed only after scrolling. */
async function frameDom(page:Page,clip:Rect,selector?:string) {
  return page.evaluate(({clip,selector})=>{
    let root:Element=document.body;
    try{root=(selector?document.querySelector(selector):null)??root;}catch{/* Shadow-root selectors can lack a document match. */}
    const elements:Element[]=[];
    const visit=(parent:Element|ShadowRoot)=>{for(const el of parent.querySelectorAll('*')){elements.push(el);if(el.shadowRoot)visit(el.shadowRoot);}};
    elements.push(root);visit(root);
    const visible=elements.filter(el=>el.matches('h1,h2,h3,h4,h5,h6,p,a,button,label,li,img,video,canvas,svg')).filter(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0&&r.height>0&&r.bottom>clip.y&&r.top<clip.y+clip.height&&r.right>clip.x&&r.left<clip.x+clip.width&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.01&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    });
    const text=(el:Element)=>((el as HTMLElement).innerText??el.textContent??'').replace(/\s+/g,' ').trim();
    return {scope:'visible-frame',selector:selector??null,
      headings:visible.filter(el=>el.matches('h1,h2,h3,h4,h5,h6')).slice(0,12).map(el=>({level:Number(el.tagName[1]),text:text(el).slice(0,240)})),
      text:[...new Set(visible.filter(el=>el.matches('h1,h2,h3,h4,h5,h6,p,a,button,label,li')).map(text).filter(Boolean))].join('\n').slice(0,1600),
      media:visible.filter(el=>el.matches('img,video,canvas,svg')).slice(0,12).map(el=>({tag:el.tagName.toLowerCase(),alt:el.getAttribute('alt')??'',src:el.getAttribute('src')??el.getAttribute('poster')??''}))};
  },{clip,selector});
}

export async function captureViewport(options: CaptureOptions): Promise<ViewportCapture> {
  const { browser, profile, settings, outputDir, onProgress } = options;
  if (!/^[a-zA-Z0-9_-]+$/.test(profile.id)) throw new Error('Capture profile id must be a safe directory name.');
  const result: ViewportCapture = { profile, status: 'failed', requestedUrl: options.url, finalUrl: options.url, title: '',
    capturedAt: new Date().toISOString(), pageHeight: 0, regions: [], evidence: [], warnings: [], interventions: [], coverage: [], stoppingReason: 'not_started',
    environment: { browser: 'chromium', browserVersion: browser.version(), platform: os.platform(), release: os.release(), architecture: os.arch(),
      namingVersion:NAMING_VERSION,viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, screenshotScale: 'device', locale: 'en-US', timezone: 'UTC', colorScheme: 'light', reducedMotion: 'no-preference' } };
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let timedOut = false;
  let rawDiagnosticWritten = false, cleanupSnapshotNumber = 0;
  const abort = () => { void context?.close().catch(() => {}); };
  const timer = setTimeout(() => { timedOut = true; abort(); }, settings.attemptTimeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  const check = () => { if (options.signal?.aborted) throw new Error('Capture aborted.'); if (timedOut) throw new Error('Page attempt timed out.'); };
  const warn = (warning: string) => { if (!result.warnings.includes(warning)) result.warnings.push(warning); };
  const observeViewport = async () => {
    const actual = await page!.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio,
      visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop } : null }));
    result.environment.initialViewport ??= actual;
    result.environment.actualViewport = actual;
    return Math.abs(actual.innerWidth - profile.width) <= 1 && Math.abs(actual.innerHeight - profile.height) <= 1 &&
      Math.abs(actual.devicePixelRatio - profile.dpr) < .01 && (!actual.visualViewport || Math.abs(actual.visualViewport.scale - 1) < .01);
  };
  const verifyViewport = async () => {
    if (!await observeViewport()) throw new UnsupportedViewportError('Effective CSS viewport or visual scale differs from the requested profile; section crops require a layout-specific scale handler.');
  };
  const verifyEncodedViewport = (width: number | undefined, height: number | undefined) => {
    if (width === undefined || height === undefined || Math.abs(width - profile.width * profile.dpr) > 1 || Math.abs(height - profile.height * profile.dpr) > 1) {
      result.environment.unexpectedEncodedViewport = { width, height };
      throw new UnsupportedViewportError('Encoded viewport dimensions differ from the requested CSS-to-device scale; section crops were stopped.');
    }
  };
  const relativeWrite = async (relative: string, buffer: Buffer) => {
    const target = path.join(outputDir, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, buffer);
  };
  const cleanup = async () => {
    check();
    const cleaned = await sweepCleanup(page!, settings, result.interventions, async () => {
      if (rawDiagnosticWritten) return;
      const diagnostic = `diagnostics/${profile.id}/${imageName(options.url,profile.id,{diagnostic:'before-cleanup'})}.png`;
      await relativeWrite(diagnostic, await page!.screenshot({ type: 'png', timeout: settings.screenshotTimeoutMs, scale: 'device' }));
      result.evidence.push({ id: `${profile.id}-before-cleanup`, kind: 'raw-diagnostic', value: { path: diagnostic, purpose: 'Before the first nuisance intervention' } });
      rawDiagnosticWritten = true;
    });
    for (const blocker of cleaned.unresolved) warn(`Unresolved overlay: ${blocker}`);
    for (const warning of cleaned.warnings) warn(warning);
    if (cleaned.snapshots.length) result.evidence.push({ id: `${profile.id}-cleanup-state-${++cleanupSnapshotNumber}`, kind: 'cleanup-state', value: cleaned.snapshots });
    return cleaned;
  };
  const readiness = async (recordWarnings = true) => {
    const observations = await readyMedia(page!, settings.mediaTimeoutMs);
    if (!await settle(page!, settings.settleTimeoutMs)) observations.push('Layout did not settle within the configured budget.');
    if (recordWarnings) for (const warning of observations) warn(warning);
    check();
  };
  try {
    check();
    context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr,
      isMobile: profile.isMobile, hasTouch: profile.hasTouch, ...(profile.isMobile ? { userAgent: profile.width >= 768
        ? `Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`
        : devices['Pixel 7'].userAgent } : {}),
      locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'no-preference', permissions: [] });
    check();
    await guardNuisances(context,result.interventions,false);
    page = await context.newPage();await prepareSectionCapture(page,profile);
    result.environment.userAgent = await page.evaluate(() => navigator.userAgent);
    context.on('page', popup => {
      if (popup === page) return;
      result.interventions.push({ at: new Date().toISOString(), frameUrl: popup.url(), action: 'close-unrequested-window', target: 'new window', method: 'browser-popup-event', verified: true });
      void popup.close().catch(() => {});
    });
    page.on('dialog', dialog => {
      result.interventions.push({ at: new Date().toISOString(), frameUrl: page!.url(), action: 'dismiss-browser-dialog', target: dialog.message().slice(0, 200), method: dialog.type(), verified: true });
      void dialog.dismiss().catch(() => {});
    });
    onProgress?.(`${profile.id}: loading ${options.url}`);
    const response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs });
    result.finalUrl = page.url(); result.title = await page.title();
    result.evidence.push({ id: `${profile.id}-http`, kind: 'navigation', value: { status: response?.status() ?? null, finalUrl: result.finalUrl } });
    if(options.expectedHttpStatus)result.environment.expectedHttpStatus=options.expectedHttpStatus;
    if (response && response.status() >= 400 && response.status()!==options.expectedHttpStatus) {
      result.status = response.status() === 401 || response.status() === 403 || response.status() === 429 ? 'blocked' : 'failed';
      result.stoppingReason = `http_${response.status()}`;
      const diagnostic = `diagnostics/${profile.id}/${imageName(options.url,profile.id,{diagnostic:'blocked'})}.png`;
      await relativeWrite(diagnostic, await page.screenshot({ timeout: settings.screenshotTimeoutMs, scale: 'device' }));
      result.overview = diagnostic; return result;
    }
    const gate = await page.evaluate(() => {
      const title = document.title;
      const text = (document.body?.innerText ?? '').slice(0, 2000);
      return /(?:just a moment|access denied|attention required|verify you are human|checking your browser)/i.test(title) ||
        (text.length < 1200 && /(?:verify (?:that )?you are human|checking your browser|captcha verification|enable javascript and cookies to continue)/i.test(text));
    });
    if(!gate)await options.onNavigation?.(result.finalUrl);
    const initialCleanup = await cleanup();
    await readiness(false);
    const finalInitialCleanup = await cleanup();
    const supportedViewport = await observeViewport();
    result.overview = `${profile.id}/${imageName(options.url,profile.id,{diagnostic:'overview'})}.png`;
    const overview = await page.screenshot({ type: 'png', timeout: settings.screenshotTimeoutMs, scale: 'device', caret: 'hide' });
    const overviewDimensions = await sharp(overview).metadata();
    result.environment.encodedViewport = { width: overviewDimensions.width, height: overviewDimensions.height };
    if (gate || initialCleanup.unresolved.length || finalInitialCleanup.unresolved.length) {
      await relativeWrite(result.overview, overview);
      result.status = 'blocked'; result.stoppingReason = gate ? 'access_challenge' : 'unresolved_overlay';
      result.pageHeight = await pageHeight(page); return result;
    }
    if (!supportedViewport) {
      await relativeWrite(result.overview, overview);
      result.status = 'incomplete'; result.stoppingReason = 'unsupported_layout_viewport'; result.pageHeight = await pageHeight(page);
      warn('Effective CSS viewport or visual scale differs from the requested profile; no region crops were produced.');
      return result;
    }
    verifyEncodedViewport(overviewDimensions.width, overviewDimensions.height);
    // Successful captures do not need a second copy of the hero as an overview.
    delete result.overview;

    // Warm assets in real viewports. The capture pass revisits each section because offscreen reveals can reset.
    const explorationEnd = Date.now() + settings.explorationTimeoutMs;
    let reachedBottom = false, plateau = 0, priorHeight = 0;
    for (let step = 0; step < settings.maxScrollSteps && Date.now() < explorationEnd; step++) {
      check();
      const metrics = await page.evaluate(() => ({ y: scrollY, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0), viewport: innerHeight }));
      await cleanup(); await readiness(false);
      const newHeight = await pageHeight(page);
      if (metrics.y + metrics.viewport >= newHeight - 2 && Math.abs(newHeight - priorHeight) <= 1) plateau++;
      else plateau = 0;
      priorHeight = newHeight;
      if (plateau >= 2) { reachedBottom = true; break; }
      await page.evaluate(stepSize => scrollTo({ top: scrollY + stepSize, behavior: 'instant' }), profile.height * (1 - settings.frameOverlap));
    }
    if (!reachedBottom) warn('Exploration limit reached before a stable page bottom was established.');
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await cleanup(); await readiness(false);
    const snapshot = await describe(page);
    result.title = snapshot.title; result.pageHeight = snapshot.height;
    result.evidence.push({ id: `${profile.id}-page-dom`, kind: 'page-dom', value: { ...snapshot, regions: undefined, url: page.url(), viewport: profile, pageHeight: snapshot.height } });
    result.regions = makeRegions(snapshot, profile, settings.contextPixels);
    let frameCount = 0;
    for (const region of result.regions) {
      check();
      onProgress?.(`${profile.id}: section ${region.order + 1}/${result.regions.length}: ${region.title}`);
      const original = snapshot.regions.find(candidate => candidate.selector === region.selector && candidate.end > region.bounds.y);
      result.evidence.push({ id: `${region.id}-dom`, regionId: region.id, kind: 'region-dom', value: { ...(original?.value ?? { title: region.title, text: '', headings: [] }), boundaryMethod: region.method, bounds: region.bounds } });
      let nextY = region.captureBounds.y, part = 0, previousEnd = -1;
      while (nextY < region.captureBounds.y + region.captureBounds.height - 1 && frameCount < settings.maxScrollSteps) {
        check();
        const expectedNav = await navigationOcclusion(page, region);
        await page.evaluate(y => scrollTo({ top: Math.max(0, y), behavior: 'instant' }), nextY - expectedNav);
        const cleaned = await cleanup();
        if (cleaned.unresolved.length) { warn('A blocking overlay appeared during section capture.'); break; }
        await readiness();
        const beforeScreenshot = await cleanup();
        if (beforeScreenshot.unresolved.length) { warn('A blocking overlay appeared immediately before a screenshot.'); break; }
        await verifyViewport();
        const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        const nav = await navigationOcclusion(page, region);
        const viewport = { x: scroll.x, y: scroll.y + nav, width: profile.width, height: profile.height - nav };
        if(part===0&&region.referenceKind==='section'&&region.roleHint!=='scroll-dependent'){
          const safe=await page.evaluate(({selector,bounds})=>{
            let root:Element|null=null;try{root=selector?document.querySelector(selector):null;}catch{/* Unsupported shadow selector. */}
            if(!root)return false;
            if(root.querySelector('canvas,video'))return false;
            if(document.getAnimations().some(animation=>animation.effect instanceof KeyframeEffect&&animation.effect.target instanceof Element&&(animation.effect.target===root||root.contains(animation.effect.target))&&
              (['ScrollTimeline','ViewTimeline'].includes(animation.timeline?.constructor.name??'')||animation.effect.getTiming().iterations===Infinity)))return false;
            return Array.from(root.querySelectorAll('h1,h2,h3,p,img,li,button')).filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom+scrollY>bounds.y&&r.top+scrollY<bounds.y+bounds.height;}).every(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true,contentVisibilityAuto:true}));
          },{selector:region.selector,bounds:region.bounds});
          if(safe){
            const top=region.bounds.y>0?Math.max(region.captureBounds.y,scroll.y+nav):region.captureBounds.y;
            const completeBounds={...region.captureBounds,y:top,height:region.captureBounds.y+region.captureBounds.height-top};
            const complete=await captureCompleteSection(page,completeBounds,profile,settings.screenshotTimeoutMs);
            if(complete){
              result.environment.referenceImageMethods??={};
              const methods=result.environment.referenceImageMethods as Record<string,number>;methods['complete-section']=(methods['complete-section']??0)+1;
              const suffix=imageName(options.url,profile.id,{section:region,part:1});
              const imagePath=`${profile.id}/sections/${suffix}.png`,thumbnail=`thumbnails/${profile.id}/${suffix}.webp`;
              await relativeWrite(imagePath,complete.buffer);await relativeWrite(thumbnail,await sharp(complete.buffer).resize({width:480,withoutEnlargement:true}).webp({quality:85}).toBuffer());
              region.frames.push({path:imagePath,thumbnail,width:complete.crop.width,height:complete.crop.height,sha256:createHash('sha256').update(complete.buffer).digest('hex'),bounds:complete.bounds,scrollY:scroll.y,kind:'static'});
              const evidenceId=`${suffix}-state`;region.evidenceIds.push(evidenceId);
              result.evidence.push({id:evidenceId,regionId:region.id,kind:'capture-state',value:{scroll,viewport:profile,bounds:complete.bounds,navigationOcclusion:nav,method:'complete-section',dom:await frameDom(page,documentToViewport(complete.bounds,scroll.x,scroll.y),region.selector)}});
              result.coverage.push({start:complete.bounds.y,end:complete.bounds.y+complete.bounds.height});frameCount++;break;
            }
          }
          result.evidence.push({id:`${region.id}-capture-mode`,regionId:region.id,kind:'section-capture-mode',value:{mode:'ordered-viewport-states',reason:safe?'Complete section exceeds the verified raster, bounds, or image transport budget.':'Section has scroll-dependent, animated, or unrendered content; a single offscreen image would be unreliable.'}});
        }
        // At the page bottom scrollY clamps. Crop the remaining static part rather than
        // repeating nearly the whole previous viewport. Pinned scenes keep real states.
        const planned=region.roleHint==='scroll-dependent'?region.captureBounds:{...region.captureBounds,y:nextY,height:region.captureBounds.y+region.captureBounds.height-nextY};
        const visible = intersectRect(planned, viewport);
        if (!visible || visible.y + visible.height <= previousEnd + 1) { warn(`Section ${region.id} could not advance within its rendered viewport.`); break; }
        const stateDom=await frameDom(page,documentToViewport(visible,scroll.x,scroll.y),region.selector);
        const image=await captureRegionImage(page,documentToViewport(visible,scroll.x,scroll.y),profile,settings.screenshotTimeoutMs,verifyEncodedViewport);
        if (!image) { warn(`Invalid screenshot bounds for ${region.id}.`); break; }
        const {buffer:encoded,crop}=image;
        result.environment.referenceImageMethods??={};
        const methods=result.environment.referenceImageMethods as Record<string,number>;methods[image.method]=(methods[image.method]??0)+1;
        const suffix = imageName(options.url,profile.id,{section:region,part:++part,...(region.roleHint==='scroll-dependent'?{stateKey:region.id}:{})});
        const imagePath = `${profile.id}/sections/${suffix}.png`, thumbnail = `thumbnails/${profile.id}/${suffix}.webp`;
        await relativeWrite(imagePath, encoded);
        await relativeWrite(thumbnail, await sharp(encoded).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer());
        region.frames.push({ path: imagePath, thumbnail, width: crop.width, height: crop.height, sha256: createHash('sha256').update(encoded).digest('hex'),
          bounds: visible, scrollY: scroll.y, kind: region.roleHint === 'scroll-dependent' ? 'scroll-state' : region.method === 'viewport-fallback' ? 'viewport-fallback' : 'static' });
        frameCount++;
        const evidenceId = `${suffix}-state`;
        region.evidenceIds.push(evidenceId);
        result.evidence.push({ id: evidenceId, regionId: region.id, kind: 'capture-state', value: { scroll, viewport: profile, bounds: visible, navigationOcclusion: nav,dom:stateDom } });
        result.coverage.push({ start: visible.y, end: visible.y + visible.height });
        previousEnd = visible.y + visible.height;
        if (previousEnd >= region.captureBounds.y + region.captureBounds.height - 1) break;
        nextY = previousEnd - Math.min(visible.height * settings.frameOverlap, visible.height - 1);
      }
      if (!region.frames.length) warn(`No usable frames for ${region.id}.`);
    }
    const nestedScrollers = await page.evaluate(profileId => {
      const all: Element[] = [], roots: Array<Document | ShadowRoot> = [document];
      for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) { all.push(el); if (el.shadowRoot) roots.push(el.shadowRoot); }
      const main = all.find(el => el.matches('main, [role="main"]')) ?? document.body;
      const candidates = all.filter(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return main.contains(el) && r.width > innerWidth * .4 && r.height > 100 && s.display !== 'none' && s.visibility !== 'hidden' &&
          ((/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 100) || (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 24));
      });
      return candidates.map((el, index) => {
        const r = el.getBoundingClientRect(), style = getComputedStyle(el);
        const key = `${profileId}-scroll-${String(index + 1).padStart(3, '0')}`;
        el.setAttribute('data-folio-scroll-id', key);
        const parts: string[] = []; let current: Element | null = el;
        while (current && parts.length < 8) {
          if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
          let part = current.tagName.toLowerCase();
          if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter(sibling => sibling.tagName === current!.tagName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
          parts.unshift(part); current = current.parentElement;
        }
        return { key, selector: parts.join(' > '), tag: el.tagName.toLowerCase(), id: el.id,
          bounds: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
          scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          initialLeft: el.scrollLeft, initialTop: el.scrollTop, direction: style.direction,
          vertical: /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 100,
          horizontal: /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 24 };
      });
    }, profile.id);
    const unhandled: unknown[] = [];
    if (nestedScrollers.length > 20) warn('More than 20 internal scroll containers exceeded the capture budget.');
    for (const scroller of nestedScrollers.slice(0, 20)) {
      if (scroller.vertical) unhandled.push({ ...scroller, reason: 'vertical-scroll-handler-required' });
      if (!scroller.horizontal) continue;
      const parent = result.regions.map(region => ({ region, intersection: intersectRect(region.bounds, scroller.bounds) }))
        .filter(item => item.intersection).sort((a, b) => b.intersection!.height - a.intersection!.height)[0]?.region;
      if (!parent) { unhandled.push({ ...scroller, reason: 'no-parent-region' }); continue; }
      parent.roleHint ??= 'contains-horizontal-scroll';
      onProgress?.(`${profile.id}: horizontal scroll states for ${parent.title}`);
      const locator = page.locator(`[data-folio-scroll-id="${scroller.key}"]`);
      const scrollCoverage: Array<{ start: number; end: number }> = [];
      const stateDeadline = Date.now() + settings.explorationTimeoutMs;
      const stateLimit = Math.min(40, settings.maxScrollSteps);
      let previousOffset = -1, reachedEnd = false, triedEnd = false;
      try {
        await locator.evaluate(el => el.scrollTo({ left: 0, top: el.scrollTop, behavior: 'instant' }));
        for (let sequence = 0; sequence < stateLimit && frameCount < settings.maxScrollSteps && Date.now() < stateDeadline; sequence++) {
          check();
          const navBefore = await navigationOcclusion(page, parent);
          await locator.evaluate((el, context) => {
            const r = el.getBoundingClientRect(); scrollTo({ top: Math.max(0, r.top + scrollY - context.padding - context.nav), behavior: 'instant' });
          }, { padding: settings.contextPixels, nav: navBefore });
          const cleaned = await cleanup();
          if (cleaned.unresolved.length) { unhandled.push({ ...scroller, reason: 'blocking-overlay' }); break; }
          await readiness();
          const finalCleanup = await cleanup();
          if (finalCleanup.unresolved.length) { unhandled.push({ ...scroller, reason: 'late-blocking-overlay' }); break; }
          await verifyViewport();
          const metrics = await locator.evaluate(el => {
            const r = el.getBoundingClientRect();
            return { left: el.scrollLeft, top: el.scrollTop, width: el.scrollWidth, client: el.clientWidth,
              bounds: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }, scroll: { x: scrollX, y: scrollY } };
          });
          const offset = Math.abs(metrics.left), extent = metrics.width - metrics.client;
          if (sequence > 0 && offset <= previousOffset + 1) {
            if (!triedEnd && extent > offset + 1) {
              triedEnd = true;
              await locator.evaluate((el, requested) => el.scrollTo({ left: requested, top: el.scrollTop, behavior: 'instant' }), scroller.direction === 'rtl' ? -extent : extent);
              continue;
            }
            unhandled.push({ ...scroller, reason: 'scroll-could-not-advance', covered: mergeCoverage(scrollCoverage) }); break;
          }
          const nav = await navigationOcclusion(page, parent);
          const viewport = { x: metrics.scroll.x, y: metrics.scroll.y + nav, width: profile.width, height: profile.height - nav };
          const expanded = { x: Math.max(0, metrics.bounds.x - settings.contextPixels), y: Math.max(0, metrics.bounds.y - settings.contextPixels),
            width: metrics.bounds.width + settings.contextPixels * 2, height: metrics.bounds.height + settings.contextPixels * 2 };
          const visible = intersectRect(expanded, viewport), content = intersectRect(metrics.bounds, viewport);
          if (!visible || !content) { unhandled.push({ ...scroller, reason: 'container-not-visible' }); break; }
          if (content.height < metrics.bounds.height - 2 || content.width < metrics.client - 2) {
            unhandled.push({ ...scroller, reason: 'container-clipped-in-viewport' });
          }
          const image=await captureRegionImage(page,documentToViewport(visible,metrics.scroll.x,metrics.scroll.y),profile,settings.screenshotTimeoutMs,verifyEncodedViewport);
          if (!image) { unhandled.push({ ...scroller, reason: 'invalid-frame-bounds' }); break; }
          const {buffer:encoded,crop}=image;
          result.environment.referenceImageMethods??={};
          const methods=result.environment.referenceImageMethods as Record<string,number>;methods[image.method]=(methods[image.method]??0)+1;
          const suffix = imageName(options.url,profile.id,{section:parent,stateKey:scroller.key,part:parent.frames.length+1});
          const imagePath = `${profile.id}/sections/${suffix}.png`, thumbnail = `thumbnails/${profile.id}/${suffix}.webp`;
          await relativeWrite(imagePath, encoded);
          await relativeWrite(thumbnail, await sharp(encoded).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer());
          parent.frames.push({ path: imagePath, thumbnail, width: crop.width, height: crop.height, sha256: createHash('sha256').update(encoded).digest('hex'), bounds: visible, scrollY: metrics.scroll.y, kind: 'scroll-state' });
          frameCount++;
          const leadingClip = scroller.direction === 'rtl' ? Math.max(0, metrics.bounds.x + metrics.bounds.width - content.x - content.width) : Math.max(0, content.x - metrics.bounds.x);
          const coveredRange = { start: offset + leadingClip, end: Math.min(metrics.width, offset + leadingClip + Math.min(metrics.client, content.width)) };
          scrollCoverage.push(coveredRange);
          const evidenceId = `${scroller.key}-state-${sequence}`;
          parent.evidenceIds.push(evidenceId);
          result.evidence.push({ id: evidenceId, regionId: parent.id, kind: 'observed-scroll-state', value: { selector: scroller.selector, axis: 'horizontal', direction: scroller.direction,
            sequence, scrollLeft: metrics.left, scrollTop: metrics.top, coveredRange, clientWidth: metrics.client, scrollWidth: metrics.width,
            bounds: visible, path: imagePath, contextPixels: settings.contextPixels, windowScroll: metrics.scroll } });
          previousOffset = offset;
          if (offset >= extent - 2) { reachedEnd = true; break; }
          let nextOffset = Math.min(extent, offset + metrics.client * .8);
          // Native snap points may not move at a short increment. One final endpoint is still bounded.
          if (nextOffset <= offset + 1 && !triedEnd) { nextOffset = extent; triedEnd = true; }
          await locator.evaluate((el, requested) => el.scrollTo({ left: requested, top: el.scrollTop, behavior: 'instant' }), scroller.direction === 'rtl' ? -nextOffset : nextOffset);
        }
        const gaps = uncoveredRanges(scroller.scrollWidth, scrollCoverage);
        if (!reachedEnd || gaps.length) unhandled.push({ ...scroller, reason: !reachedEnd ? 'horizontal-state-budget-or-end-unconfirmed' : 'horizontal-content-coverage-gaps', covered: mergeCoverage(scrollCoverage), gaps });
        result.evidence.push({ id: `${scroller.key}-coverage`, regionId: parent.id, kind: 'observed-scroll-coverage', value: { selector: scroller.selector, axis: 'horizontal', covered: mergeCoverage(scrollCoverage), reachedEnd, restoredTo: { left: scroller.initialLeft, top: scroller.initialTop } } });
      } finally {
        const restored = await locator.evaluate((el, original) => {
          el.scrollTo({ left: original.left, top: original.top, behavior: 'instant' });
          return { left: el.scrollLeft, top: el.scrollTop };
        }, { left: scroller.initialLeft, top: scroller.initialTop }).catch(() => null);
        const verified = !!restored && Math.abs(restored.left - scroller.initialLeft) <= 1 && Math.abs(restored.top - scroller.initialTop) <= 1;
        if (!verified) warn(`Scroll position could not be restored for ${scroller.selector}.`);
        const restoreId = `${scroller.key}-restore`;
        parent.evidenceIds.push(restoreId);
        result.evidence.push({ id: restoreId, regionId: parent.id, kind: 'observed-scroll-restore', value: { selector: scroller.selector, requested: { left: scroller.initialLeft, top: scroller.initialTop }, actual: restored, verified } });
      }
    }
    if (unhandled.length) {
      warn('Some internal scrolling content remains uncovered; see observed scroll-state evidence.');
      result.evidence.push({ id: `${profile.id}-internal-scrollers`, kind: 'uncovered-scroll-states', value: unhandled });
    }
    const finalHeight = await pageHeight(page);
    if (Math.abs(finalHeight - result.pageHeight) > 2) warn(`Page height changed during capture (${result.pageHeight} to ${finalHeight}).`);
    result.pageHeight = Math.max(result.pageHeight, finalHeight);
    result.coverage = mergeCoverage(result.coverage);
    const gaps = uncoveredRanges(result.pageHeight, result.coverage);
    if (gaps.length) { warn('Capture coverage contains gaps.'); result.evidence.push({ id: `${profile.id}-coverage-gaps`, kind: 'coverage-gaps', value: gaps }); }
    result.status = result.warnings.length ? 'incomplete' : 'complete';
    result.stoppingReason = reachedBottom ? result.status === 'complete' ? 'page_end' : 'quality_warning' : 'exploration_limit';
  } catch (error) {
    if(error instanceof ResolvedDuplicate)throw error;
    result.status = error instanceof UnsupportedViewportError || result.regions.some(region => region.frames.length) ? 'incomplete' : 'failed';
    result.stoppingReason = options.signal?.aborted ? 'aborted' : timedOut ? 'attempt_timeout' : error instanceof UnsupportedViewportError ? 'unsupported_layout_viewport' : 'capture_error';
    warn(error instanceof Error ? error.message : String(error));
    if (page && !page.isClosed() && !timedOut) {
      try { await relativeWrite(`diagnostics/${profile.id}/${imageName(options.url,profile.id,{diagnostic:'error'})}.png`, await page.screenshot({ timeout: settings.screenshotTimeoutMs })); } catch { /* Original error is retained. */ }
    }
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    await context?.close().catch(() => {});
  }
  result.coverage = mergeCoverage(result.coverage);
  return result;
}
