import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { captureRegionImage, captureCompleteSection } from '../src/image-capture.ts';
import { documentToViewport, pixelCrop } from '../src/geometry.ts';
import type { CaptureProfile, Rect } from '../src/types.ts';

let browser:Browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:'chromium'});});
after(async()=>{await browser?.close();});
async function fixture(dpr:number) {
  const profile:CaptureProfile={id:'fixture',width:640,height:480,dpr,isMobile:false,hasTouch:false};
  const context=await browser.newContext({viewport:{width:640,height:480},deviceScaleFactor:dpr});
  const page=await context.newPage();
  await page.setContent('<style>body{margin:0;height:3000px;background:repeating-linear-gradient(0deg,#aabbcc 0px,#aabbcc 31px,#664422 32px,#664422 59px)}nav{position:fixed;top:0;left:0;width:100%;height:40px;background:#ffaa00}main{margin-top:850px;padding:30px;font:24px Arial;background:linear-gradient(90deg,#00ff00,#0000ff);height:900px}.marker{position:absolute;top:1000px;left:80px;width:140px;height:50px;background:white;color:black;font:24px Arial}</style><nav>Protected navigation</nav><main>Rendered reference below the fold</main><div class="marker">Folio 123</div>');
  await page.evaluate(()=>scrollTo(0,900));
  await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
  return {context,page,profile};
}
async function expected(page:Page,rect:Rect,dpr:number) {
  const buffer=await page.screenshot({type:'png',scale:'device',caret:'hide'}),metadata=await sharp(buffer).metadata();
  const crop=pixelCrop(rect,{width:metadata.width!,height:metadata.height!},dpr)!;
  return sharp(buffer).extract({left:crop.x,top:crop.y,width:crop.width,height:crop.height}).ensureAlpha().raw().toBuffer();
}
const verify=(profile:CaptureProfile)=>(width:number|undefined,height:number|undefined)=>{assert.equal(width,profile.width*profile.dpr);assert.equal(height,profile.height*profile.dpr);};

for(const dpr of [1,2,3])test(`complete section at DPR ${dpr} retains the viewport and captures every below-fold pixel`,async()=>{
  const {page,context,profile}=await fixture(dpr);
  try{
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollY,dpr:devicePixelRatio}));
    const bounds={x:0,y:900,width:640,height:900};
    const full=await captureCompleteSection(page,bounds,profile);
    assert(full);assert.equal(full.crop.width,640*dpr);assert.equal(full.crop.height,900*dpr);
    assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollY,dpr:devicePixelRatio})),viewport);
    const {data}=await sharp(full.buffer).extract({left:80*dpr,top:100*dpr,width:140*dpr,height:50*dpr}).raw().toBuffer({resolveWithObject:true});
    const visible=await expected(page,{x:80,y:100,width:140,height:50},dpr);
    assert.ok((await sharp(data,{raw:{width:140*dpr,height:50*dpr,channels:3}}).ensureAlpha().raw().toBuffer()).equals(visible),'Opaque marker and text remain pixel-identical');
    assert.equal(await captureCompleteSection(page,{x:0,y:0,width:640,height:25000},profile),null,'Oversized regions use actual viewport parts');
  }finally{await context.close();}
});

for(const dpr of [1,2,3])test(`native clip at DPR ${dpr} preserves geometry and opaque text with at most one RGB level of gradient variation`,async()=>{
  const {page,context,profile}=await fixture(dpr);
  try {
    const scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));
    const rect=documentToViewport({x:20,y:scroll.y+15,width:300,height:190},scroll.x,scroll.y);
    const pixels=await expected(page,rect,dpr);
    const image=await captureRegionImage(page,rect,profile,5000,verify(profile));
    assert.equal(image?.method,'browser-clip');
    const actual=await sharp(image!.buffer).ensureAlpha().raw().toBuffer();
    assert.equal(actual.length,pixels.length);
    let maxDelta=0;for(let i=0;i<actual.length;i++)maxDelta=Math.max(maxDelta,Math.abs(actual[i]-pixels[i]));
    assert.ok(maxDelta<=1,`Unexpected pixel difference ${maxDelta}; native Chromium gradient rasterization may vary by one 8-bit level.`);
    const marker={left:60*dpr,top:85*dpr,width:140*dpr,height:50*dpr};
    const raw={width:300*dpr,height:190*dpr,channels:4 as const};
    const actualText=await sharp(actual,{raw}).extract(marker).raw().toBuffer();
    const expectedText=await sharp(pixels,{raw}).extract(marker).raw().toBuffer();
    assert.ok(actualText.equals(expectedText),'Opaque content and text must match exactly');
  }finally{await context.close();}
});

test('complete fractional section bounds record the exact enclosing native image rectangle',async()=>{
  const {page,context,profile}=await fixture(2);
  try{
    const image=await captureCompleteSection(page,{x:10.25,y:900.3,width:300.5,height:899.6},profile);
    assert(image);assert.deepEqual(image.bounds,{x:10,y:900,width:301,height:900});
    assert.equal(image.crop.width,image.bounds.width*2);assert.equal(image.crop.height,image.bounds.height*2);
    assert.equal(await page.evaluate(()=>devicePixelRatio),2);
  }finally{await context.close();}
});

test('fractional CSS geometry keeps exact enclosing image pixels through the fallback',async()=>{
  const {page,context,profile}=await fixture(2);
  try {
    const rect={x:10.5,y:30.5,width:130.5,height:100.5},pixels=await expected(page,rect,2);
    const image=await captureRegionImage(page,rect,profile,5000,verify(profile));
    assert.equal(image?.method,'sharp-crop');assert.ok((await sharp(image!.buffer).ensureAlpha().raw().toBuffer()).equals(pixels));
  }finally{await context.close();}
});

test('native clipping preserves layered glass, shadows, transforms and intentional interface content',async()=>{
  const {page,context,profile}=await fixture(2);
  try {
    await page.addStyleTag({content:'.glass{position:absolute;top:980px;left:50px;width:300px;height:170px;background:rgba(255,255,255,.3);backdrop-filter:blur(12px);border:2px solid white;border-radius:24px;box-shadow:8px 16px 24px #1238;transform:rotate(-2deg);padding:20px;font:20px Arial}.glass strong{display:block;background:white;color:black}.scene{position:absolute;top:1100px;left:240px;width:100px;height:70px;background:#ff004488;mix-blend-mode:multiply;border-radius:50%}'});
    await page.evaluate(()=>{const panel=document.createElement('div');panel.className='glass';panel.innerHTML='<strong>Intentional interface</strong>Layered product scene';document.body.append(panel);const scene=document.createElement('div');scene.className='scene';document.body.append(scene);});
    await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
    const rect={x:10,y:45,width:500,height:300},pixels=await expected(page,rect,2);
    const image=await captureRegionImage(page,rect,profile,5000,verify(profile));
    assert.equal(image?.method,'browser-clip');
    const actual=await sharp(image!.buffer).ensureAlpha().raw().toBuffer();assert.equal(actual.length,pixels.length);
    let maxDelta=0;for(let i=0;i<actual.length;i++)maxDelta=Math.max(maxDelta,Math.abs(actual[i]-pixels[i]));
    assert.ok(maxDelta<=1,`Layered scene changed by ${maxDelta} levels`);
    assert.equal(await page.locator('.glass').innerText(),'Intentional interface\nLayered product scene');
  }finally{await context.close();}
});

test('fractional DPR full viewport reuses the original PNG without re-encoding',async()=>{
  const {page,context,profile}=await fixture(1.5);
  try {
    let original:Buffer|undefined;
    const wrapped=new Proxy(page,{get(target,key){if(key==='screenshot')return async(options:any)=>{original=await target.screenshot(options);return original;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    const image=await captureRegionImage(wrapped,{x:0,y:0,width:640,height:480},profile,5000,verify(profile));
    assert.equal(image?.method,'viewport-reuse');
    assert.equal(image!.buffer,original,'The exact browser PNG is reused; a second rasterization is not an encoding baseline');
  }finally{await context.close();}
});

test('invalid bounds do not request a screenshot',async()=>{
  const page={screenshot:()=>{throw new Error('Must not capture');}} as unknown as Page;
  const profile:CaptureProfile={id:'fixture',width:640,height:480,dpr:2,isMobile:false,hasTouch:false};
  for(const rect of [{x:0,y:900,width:100,height:50},{x:NaN,y:0,width:50,height:50}])assert.equal(await captureRegionImage(page,rect,profile,1000,verify(profile)),null);
});

test('unexpected native clip dimensions fall back to a verified full screenshot',async()=>{
  const {page,context,profile}=await fixture(2);
  try {
    const bad=await sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer();
    const wrapped=new Proxy(page,{get(target,key){if(key==='screenshot')return (options:any)=>options?.clip?Promise.resolve(bad):target.screenshot(options);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    const rect={x:20,y:50,width:300,height:200},pixels=await expected(page,rect,2);
    const image=await captureRegionImage(wrapped,rect,profile,5000,verify(profile));
    assert.equal(image?.method,'sharp-crop');assert.ok((await sharp(image!.buffer).ensureAlpha().raw().toBuffer()).equals(pixels));
  }finally{await context.close();}
});

test('a rejected complete-section capture restores scroll before a viewport fallback',async()=>{
  const {page,context,profile}=await fixture(2);
  try{
    const bad=await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer();
    const wrapped=new Proxy(page,{get(target,key){
      if(key==='context')return ()=>new Proxy(context,{get(c,k){
        if(k==='newCDPSession')return async()=>{const session=await c.newCDPSession(target);return new Proxy(session,{get(s,p){
          if(p==='send')return async(method:string,args:any)=>{if(method==='Page.captureScreenshot'){await target.evaluate(()=>scrollTo(0,0));return {data:bad.toString('base64')};}return s.send(method as any,args);};
          const value=Reflect.get(s,p,s);return typeof value==='function'?value.bind(s):value;
        }});};
        const value=Reflect.get(c,k,c);return typeof value==='function'?value.bind(c):value;
      }});
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    const pixels=await expected(page,{x:0,y:0,width:640,height:300},2);
    assert.equal(await captureCompleteSection(wrapped,{x:0,y:900,width:640,height:900},profile),null);
    assert.equal(await page.evaluate(()=>scrollY),900);
    const fallback=await captureRegionImage(page,{x:0,y:0,width:640,height:300},profile,5000,verify(profile));
    assert(fallback);assert.ok((await sharp(fallback.buffer).ensureAlpha().raw().toBuffer()).equals(pixels),'Fallback captures the intended section, not the reset top of the page');
  }finally{await context.close();}
});

for(const width of [360,390])test(`a visible fractional mobile section at ${width}px captures its own pixels without changing scroll`,async()=>{
  const profile:CaptureProfile={id:'mobile',width,height:844,dpr:2,isMobile:true,hasTouch:true};
  const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:844px;background:red}section{height:502.09375px;background:blue}footer{height:2000px;background:green}</style><header>Hero</header><section>Overview</section><footer>Footer</footer>');
    await page.evaluate(()=>scrollTo(0,780));
    const bounds={x:0,y:780,width,height:630.09375};
    const before=await expected(page,{...bounds,y:0},2);
    const image=await captureCompleteSection(page,bounds,profile);assert(image);
    assert.equal(await page.evaluate(()=>scrollY),780);
    assert.ok((await sharp(image.buffer).ensureAlpha().raw().toBuffer()).equals(before),'Overview pixels match the actual scrolled mobile viewport');
  }finally{await context.close();}
});
