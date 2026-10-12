import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { parseConfig } from '../src/config.ts';
import { sweepCleanup } from '../src/cleanup.ts';
import { atomicJson } from '../src/utils.ts';
import type { Intervention } from '../src/types.ts';

// Public-page diagnostic only. It does not start voice sessions or change countries.
const root=resolve('validation-output/cleanup-smoke');
await mkdir(root,{recursive:true});
const config=parseConfig({sources:['https://www.apple.com/iphone-duo','https://elevenlabs.io/']});
const browser=await chromium.launch({channel:'chromium',headless:true});
const results:Array<Record<string,unknown>>=[];
try{
  for(const sample of [
    {id:'apple',url:config.sources[0].url,selector:'aside#ac-localeswitcher',profile:config.profiles.find(p=>p.id==='desktop')!,action:'dismiss-locale'},
    {id:'elevenlabs',url:config.sources[1].url,selector:'div[data-floating-agent]',profile:config.profiles.find(p=>p.id==='mobile')!,action:'dismiss-chat'},
  ]){
    const context=await browser.newContext({viewport:{width:sample.profile.width,height:sample.profile.height},deviceScaleFactor:2,isMobile:sample.profile.isMobile,hasTouch:sample.profile.hasTouch,locale:'en-US',timezoneId:'UTC',colorScheme:'light',reducedMotion:'no-preference'});
    try{
      await context.addInitScript({content:'globalThis.__name ??= function(value){return value;};'});
      const page=await context.newPage();page.on('dialog',dialog=>void dialog.dismiss());
      await page.goto(sample.url,{waitUntil:'domcontentloaded',timeout:45000});
      const observed=await page.locator(sample.selector).first().waitFor({state:'visible',timeout:10000}).then(()=>true,()=>false);
      if(sample.id==='elevenlabs')await page.evaluate(()=>scrollTo(0,Math.min(3000,document.documentElement.scrollHeight-innerHeight)));
      await page.screenshot({path:join(root,`${sample.id}-before.png`),timeout:15000});
      const interventions:Intervention[]=[];
      const cleanup=await sweepCleanup(page,config.capture,interventions);
      const retained=await page.locator(sample.selector).first().isVisible().catch(()=>false);
      assert.equal(retained,false,`${sample.id}: verified nuisance survived cleanup`);
      assert.equal(new URL(page.url()).hostname,new URL(sample.url).hostname,'Cleanup must not navigate to another site');
      assert.equal(new URL(page.url()).pathname.replace(/\/$/,''),new URL(sample.url).pathname.replace(/\/$/,''),'Locale cleanup must not change country or page');
      assert(await page.locator('main').first().isVisible(),'Primary page content must remain');
      if(observed)assert(interventions.some(item=>item.action===sample.action&&item.verified),'A visible known nuisance must produce a verified intervention');
      await page.screenshot({path:join(root,`${sample.id}-after.png`),timeout:15000});
      results.push({id:sample.id,url:sample.url,finalUrl:page.url(),profile:sample.profile,observed,removed:!retained,interventions,warnings:cleanup.warnings,unresolved:cleanup.unresolved});
      await atomicJson(join(root,'results.json'),results);
      console.log(`${sample.id}: ${observed?'observed and removed':'not presented in this context'}; primary content retained`);
    }finally{await context.close();}
  }
}finally{await browser.close();}
