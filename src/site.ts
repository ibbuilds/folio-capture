import type { Browser,BrowserContext } from 'playwright';
import type { Store } from './store.ts';
import type { CaptureSettings, DiscoverySettings, Intervention, Provenance, Source } from './types.ts';
import { canonicalUrl, delay, errorMessage, isRelatedDestination, now } from './utils.ts';
import { guardNuisances } from './nuisance.ts';
import { sweepCleanup } from './cleanup.ts';

export function siteLink(value:string,seed:string):string|undefined {
  try {
    const url=new URL(value,seed);const origin=new URL(seed).origin;
    if(url.origin!==origin || url.username || url.password || !['http:','https:'].includes(url.protocol))return;
    if(/\.(?:pdf|zip|png|jpe?g|webp|gif|svg|mp4|mp3|css|js)$/i.test(url.pathname))return;
    if(/\/(?:logout|signout|delete|remove|unsubscribe|checkout)(?:\/|$)/i.test(url.pathname))return;
    // Plain fragments select an existing section; hash-router fragments identify pages.
    if(!/^#!?\//.test(url.hash))url.hash='';return canonicalUrl(url.href);
  } catch{return;}
}
export async function discoverSite(store:Store,browser:Browser|(()=>Promise<Browser>),source:Source,settings:DiscoverySettings,
  capture:(url:string,provenance:Provenance)=>Promise<void>,signal?:AbortSignal,canContinue=()=>true,cleanup?:CaptureSettings) {
  const maxPages=source.maxPages??25,maxDepth=source.maxDepth??2;
  const seed=siteLink(source.url,source.url)!;
  const job=store.job('site-discovery',source.url,{source});store.start(job);
  store.job('site-page',`${source.url}:${seed}`,{seed:source.url,url:seed,depth:0,parent:null,path:[seed],order:0});
  const seen=new Set<string>();let limited=false;
  let effectiveSeed=job.result?.effectiveSeed??seed;
  try {
    while(canContinue()) {
      const queued=store.jobs('site-page').filter(j=>j.payload.seed===source.url && !seen.has(j.key) && j.payload.depth<=maxDepth)
        .sort((a,b)=>(a.status==='pending'?-1:0)-(b.status==='pending'?-1:0)||a.payload.depth-b.payload.depth||(a.payload.order??0)-(b.payload.order??0));
      const next=queued[0];if(!next)break;
      if(seen.size>=maxPages){limited=true;break;}
      signal?.throwIfAborted();seen.add(next.key);store.start(next);
      const active=typeof browser==='function'?await browser():browser;
      let context:BrowserContext;
      try{context=await active.newContext();}catch(error){
        signal?.throwIfAborted();if(typeof browser!=='function'||active.isConnected())throw error;
        context=await (await browser()).newContext();
      }
      const abort=()=>{void context.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
      const interventions:Intervention[]=[];
      try {
        await guardNuisances(context,interventions);
        const page=await context.newPage();
        const response=await page.goto(next.payload.url,{waitUntil:'domcontentloaded',timeout:settings.navigationTimeoutMs});
        if(response && response.status()>=400 && !(next.payload.depth===0 && response.status()===source.expectedHttpStatus))throw new Error(`HTTP ${response.status()}`);
        if(next.payload.depth===0 && isRelatedDestination(seed,page.url()))effectiveSeed=siteLink(page.url(),page.url())!;
        if(new URL(page.url()).origin!==new URL(effectiveSeed).origin)throw new Error('Site navigation redirected outside selected origin.');
        await page.locator('body').waitFor({timeout:settings.settleTimeoutMs});
        if(cleanup){const result=await sweepCleanup(page,{...cleanup,preserveSelectors:[...cleanup.preserveSelectors,...source.preserveSelectors??[]],dismissSelectors:[...cleanup.dismissSelectors,...source.dismissSelectors??[]]},interventions);if(result.unresolved.length)throw new Error(`Site navigation blocked: ${result.unresolved.join('; ')}`);}
        let previous='',stable=0,settledEnd=false;
        const observed=new Set<string>(),known=new Set(store.jobs('site-page').filter(j=>j.payload.seed===source.url).map(j=>j.payload.url));
        known.add(effectiveSeed);
        const deadline=Date.now()+Math.min(settings.maxDurationMs,Math.max(settings.settleTimeoutMs,30000));
        for(let step=0;step<Math.min(settings.maxScrollSteps,200)&&Date.now()<deadline;step++){
          signal?.throwIfAborted();
          for(const link of await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).href))){const url=siteLink(link,effectiveSeed);if(url)observed.add(url);}
          const entries=[];
          for(const link of observed)if(!known.has(link)) {
            if(next.payload.depth>=maxDepth || known.size>=maxPages){limited=true;continue;}
            known.add(link);entries.push({key:`${source.url}:${link}`,payload:{seed:source.url,url:link,depth:next.payload.depth+1,parent:next.payload.url,path:[...(next.payload.path??[seed]),link],order:known.size}});
          }
          store.queueJobs('site-page',entries);
          const metrics=await page.evaluate(()=>({y:scrollY,height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0,innerHeight),viewport:innerHeight}));
          const signature=JSON.stringify([[...observed],metrics.height]);
          const bottom=metrics.y+metrics.viewport>=metrics.height-2;
          stable=bottom&&signature===previous?stable+1:0;previous=signature;
          if(stable>=3){settledEnd=true;break;}
          if(!bottom)await page.evaluate(size=>scrollTo({top:scrollY+size,behavior:'instant'}),metrics.viewport*.8);
          if(cleanup){const result=await sweepCleanup(page,{...cleanup,preserveSelectors:[...cleanup.preserveSelectors,...source.preserveSelectors??[]],dismissSelectors:[...cleanup.dismissSelectors,...source.dismissSelectors??[]]},interventions);if(result.unresolved.length)throw new Error(`Site navigation blocked: ${result.unresolved.join('; ')}`);}
          await delay(Math.min(250,settings.minDelayMs),signal);
        }
        store.finish(next,settledEnd?'complete':'incomplete',{links:[...observed],interventions},undefined,settledEnd?'navigation_links_observed':'navigation_observation_limit');
      } catch(error) {
        if(signal?.aborted)throw error;
        store.finish(next,'failed',{interventions},errorMessage(error));
      } finally {signal?.removeEventListener('abort',abort);await context.close().catch(()=>{});}
      // Register navigation before a potentially long classifier wait. Interruption cannot
      // erase the child-page queue, and a navigation failure still permits addressed-page capture.
      await capture(next.payload.url,{seedUrl:source.url,listingUrl:next.payload.parent??undefined,discoveredAt:next.createdAt,sourceLabels:[],navigationPath:next.payload.path??[seed,next.payload.url]});
    }
    const failed=store.jobs('site-page').some(j=>j.payload.seed===source.url && ['failed','incomplete'].includes(j.status));
    const reason=!canContinue()?'capture_limit':failed?'navigation_error':limited?'scope_limit':'navigation_graph_exhausted';
    store.finish(job,failed||!canContinue()||limited?'incomplete':'complete',{pages:seen.size,maxPages,maxDepth,effectiveSeed,at:now()},undefined,reason);
  } catch(error) {store.finish(job,'pending',undefined,errorMessage(error));throw error;}
}
