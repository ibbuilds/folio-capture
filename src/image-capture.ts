import type { Page } from 'playwright';
import sharp from 'sharp';
import { pixelCrop } from './geometry.ts';
import type { CaptureProfile, Rect } from './types.ts';

/** The pinned Playwright page screenshot clip is in viewport CSS coordinates.
 * Integer CSS/device geometry can be cropped by Chromium without decoding a full
 * viewport in Node. Fractional geometry keeps the validated full-image path. */
export async function captureRegionImage(page:Page,viewportRect:Rect,profile:CaptureProfile,timeoutMs:number,
  verifyFullImage:(width:number|undefined,height:number|undefined)=>void) {
  const expected={width:Math.round(profile.width*profile.dpr),height:Math.round(profile.height*profile.dpr)};
  const anticipated=pixelCrop(viewportRect,expected,profile.dpr);
  if(!anticipated)return null;
  const options={type:'png' as const,scale:'device' as const,caret:'hide' as const,timeout:timeoutMs};
  if(Number.isInteger(profile.dpr) && Object.values(anticipated).every(value=>Number.isInteger(value/profile.dpr))) {
    const clip={x:anticipated.x/profile.dpr,y:anticipated.y/profile.dpr,width:anticipated.width/profile.dpr,height:anticipated.height/profile.dpr};
    const buffer=await page.screenshot({...options,clip,fullPage:false});
    const metadata=await sharp(buffer).metadata();
    if(metadata.format==='png' && metadata.width===anticipated.width && metadata.height===anticipated.height)
      return {buffer,crop:anticipated,method:'browser-clip' as const};
    // Unexpected clip dimensions are never accepted as the requested crop.
  }
  const buffer=await page.screenshot(options),metadata=await sharp(buffer).metadata();
  verifyFullImage(metadata.width,metadata.height);
  const crop=pixelCrop(viewportRect,{width:metadata.width!,height:metadata.height!},profile.dpr);
  if(!crop)return null;
  if(crop.x===0 && crop.y===0 && crop.width===metadata.width && crop.height===metadata.height)
    return {buffer,crop,method:'viewport-reuse' as const};
  const encoded=await sharp(buffer).extract({left:crop.x,top:crop.y,width:crop.width,height:crop.height}).png().toBuffer();
  return {buffer:encoded,crop,method:'sharp-crop' as const};
}
