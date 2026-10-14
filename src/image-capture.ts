import type { Page, CDPSession } from 'playwright';
import sharp from 'sharp';
import { pixelCrop } from './geometry.ts';
import type { CaptureProfile, Rect } from './types.ts';
const sectionSessions = new WeakMap<Page, { session: CDPSession; profileKey: string }>();
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
    if (
      metadata.format === 'png' &&
      metadata.width === anticipated.width &&
      metadata.height === anticipated.height
    )
      return { buffer, crop: anticipated, method: 'browser-clip' as const };
    // Unexpected clip dimensions are never accepted as the requested crop.
  }
  const buffer = await page.screenshot(options),
    metadata = await sharp(buffer).metadata();
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
  const session = await prepareSectionCapture(page, profile);
  let timer: ReturnType<typeof setTimeout> | undefined;
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
  }
}
