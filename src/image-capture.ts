import type { Page, CDPSession } from 'playwright';
import sharp from 'sharp';
import { documentToViewport, pixelCrop } from './geometry.ts';
import type { CaptureProfile, Rect } from './types.ts';
const sectionSessions = new WeakMap<Page, { session: CDPSession; profileKey: string }>();
const position = (page:Page) => page.evaluate(()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
type Position = Awaited<ReturnType<typeof position>>;
async function restorePosition(page:Page,before:Position) {
  const after=await position(page);
  if(after.width!==before.width||after.height!==before.height||after.dpr!==before.dpr)
    throw new Error('Screenshot changed the layout viewport; capture requires repair.');
  if(after.x===before.x&&after.y===before.y)return;
  await page.evaluate(({x,y})=>scrollTo({left:x,top:y,behavior:'instant'}),before);
  await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
  const restored=await position(page);
  if(restored.x!==before.x||restored.y!==before.y)throw new Error('Screenshot scroll position could not be restored; capture requires repair.');
}
export async function prepareSectionCapture(page: Page, profile: CaptureProfile) {
  const profileKey = JSON.stringify(profile),
    existing = sectionSessions.get(page);
  if (existing) {
    if (existing.profileKey !== profileKey)
      throw new Error('A capture page cannot switch device profiles.');
    return existing.session;
  }
  const session = await page.context().newCDPSession(page);
  // Own these metrics before navigation/readiness. Reapplying them immediately before a
  // screenshot can restart resize/reveal handlers even when CSS dimensions are unchanged.
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.dpr,
    mobile: profile.isMobile,
    screenWidth: profile.width,
    screenHeight: profile.height,
  });
  sectionSessions.set(page, { session, profileKey });
  page.once('close', () => sectionSessions.delete(page));
  return session;
}

/** The pinned Playwright page screenshot clip is in viewport CSS coordinates.
 * Integer CSS/device geometry can be cropped by Chromium without decoding a full
 * viewport in Node. Fractional geometry keeps the validated full-image path. */
export async function captureRegionImage(
  page: Page,
  viewportRect: Rect,
  profile: CaptureProfile,
  timeoutMs: number,
  verifyFullImage: (width: number | undefined, height: number | undefined) => void,
) {
  const expected = {
    width: Math.round(profile.width * profile.dpr),
    height: Math.round(profile.height * profile.dpr),
  };
  const anticipated = pixelCrop(viewportRect, expected, profile.dpr);
  if (!anticipated) return null;
  const options = {
    type: 'png' as const,
    scale: 'device' as const,
    caret: 'hide' as const,
    timeout: timeoutMs,
  };
  const before=await position(page);
  if (
    Number.isInteger(profile.dpr) &&
    Object.values(anticipated).every((value) => Number.isInteger(value / profile.dpr))
  ) {
    const clip = {
      x: anticipated.x / profile.dpr,
      y: anticipated.y / profile.dpr,
      width: anticipated.width / profile.dpr,
      height: anticipated.height / profile.dpr,
    };
    const buffer = await page.screenshot({ ...options, clip, fullPage: false });
    const metadata = await sharp(buffer).metadata();
    const after=await position(page);
    const stable=Object.keys(before).every(key=>before[key as keyof Position]===after[key as keyof Position]);
    await restorePosition(page,before);
    if (
      stable &&
      metadata.format === 'png' &&
      metadata.width === anticipated.width &&
      metadata.height === anticipated.height
    )
      return { buffer, crop: anticipated, method: 'browser-clip' as const };
    // Unexpected clip dimensions are never accepted as the requested crop.
  }
  const buffer = await page.screenshot(options),
    metadata = await sharp(buffer).metadata();
  const after=await position(page);
  await restorePosition(page,before);
  if(Object.keys(before).some(key=>before[key as keyof Position]!==after[key as keyof Position]))
    throw new Error('Viewport screenshot moved away from its recorded section; capture requires repair.');
  verifyFullImage(metadata.width, metadata.height);
  const crop = pixelCrop(
    viewportRect,
    { width: metadata.width!, height: metadata.height! },
    profile.dpr,
  );
  if (!crop) return null;
  if (
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === metadata.width &&
    crop.height === metadata.height
  )
    return { buffer, crop, method: 'viewport-reuse' as const };
  const encoded = await sharp(buffer)
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
    .png()
    .toBuffer();
  return { buffer: encoded, crop, method: 'sharp-crop' as const };
}

/** Chromium captures one complete static section without resizing the CSS viewport or stitching states. */
export async function captureCompleteSection(
  page: Page,
  documentRect: Rect,
  profile: CaptureProfile,
  timeoutMs = 15000,
) {
  if (
    !Object.values(documentRect).every(Number.isFinite) ||
    documentRect.x < 0 ||
    documentRect.y < 0 ||
    documentRect.width <= 0 ||
    documentRect.height <= 0
  )
    return null;
  const left = Math.floor(documentRect.x * profile.dpr),
    top = Math.floor(documentRect.y * profile.dpr);
  const width = Math.ceil((documentRect.x + documentRect.width) * profile.dpr) - left,
    height = Math.ceil((documentRect.y + documentRect.height) * profile.dpr) - top;
  if (width * height > 32_000_000 || height > 24_000) return null;
  const dimensions = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, innerWidth),
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      innerHeight,
    ),
  }));
  if (
    documentRect.x + documentRect.width > dimensions.width + 1 / profile.dpr ||
    documentRect.y + documentRect.height > dimensions.height + 1 / profile.dpr
  )
    return null;
  const before=await position(page);
  // A section already inside the viewport does not need an offscreen CDP capture.
  // Besides being cheaper, this avoids mobile clip attempts that can reset scroll.
  if(documentRect.x>=before.x&&documentRect.y>=before.y&&
    documentRect.x+documentRect.width<=before.x+profile.width&&documentRect.y+documentRect.height<=before.y+profile.height){
    const image=await captureRegionImage(page,documentToViewport(documentRect,before.x,before.y),profile,timeoutMs,(w,h)=>{
      if(w!==profile.width*profile.dpr||h!==profile.height*profile.dpr)throw new Error('Unexpected encoded viewport dimensions.');
    });
    if(!image)return null;
    return {buffer:image.buffer,crop:image.crop,bounds:{x:before.x+image.crop.x/profile.dpr,y:before.y+image.crop.y/profile.dpr,width:image.crop.width/profile.dpr,height:image.crop.height/profile.dpr},method:'complete-section' as const};
  }
  const session = await prepareSectionCapture(page, profile);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed=false;
  try {
    // Chromium uses the requesting session's metrics for screenshots. Detaching it resets
    // device emulation, so retain the session until its fresh browser context closes.
    const result = await Promise.race([
      session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: left / profile.dpr,
          y: top / profile.dpr,
          width: width / profile.dpr,
          height: height / profile.dpr,
          scale: 1,
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Complete-section screenshot timed out')),
          timeoutMs,
        );
      }),
    ]);
    completed=true;
    const buffer = Buffer.from(result.data, 'base64');
    if (buffer.length > 12 * 1024 * 1024) return null;
    const metadata = await sharp(buffer).metadata();
    if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height)
      return null;
    return {
      buffer,
      crop: { x: 0, y: 0, width, height },
      bounds: {
        x: left / profile.dpr,
        y: top / profile.dpr,
        width: width / profile.dpr,
        height: height / profile.dpr,
      },
      method: 'complete-section' as const,
    };
  } finally {
    clearTimeout(timer);
    // Rejected native clips can still move the browser. The fallback must never
    // use old document coordinates against pixels from the reset hero viewport.
    if(completed)await restorePosition(page,before);
  }
}
