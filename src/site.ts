import type { Browser } from 'playwright';
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
    url.hash='';return canonicalUrl(url.href);
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
      await capture(next.payload.url,{seedUrl:source.url,listingUrl:next.payload.parent??undefined,discoveredAt:next.createdAt,sourceLabels:[],navigationPath:next.payload.path??[seed,next.payload.url]});
      const active=typeof browser==='function'?await browser():browser;
      const context=await active.newContext();const abort=()=>{void context.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
      const interventions:Intervention[]=[];
      try {
        await guardNuisances(context,interventions);
        const page=await context.newPage();
        const response=await page.goto(next.payload.url,{waitUntil:'domcontentloaded',timeout:settings.navigationTimeoutMs});
        if(response && response.status()>=400 && !(next.payload.depth===0 && response.status()===source.expectedHttpStatus))throw new Error(`HTTP ${response.status()}`);
        if(next.payload.depth===0 && isRelatedDestination(seed,page.url()))effectiveSeed=siteLink(page.url(),page.url())!;
        if(new URL(page.url()).origin!==new URL(effectiveSeed).origin)throw new Error('Site navigation redirected outside selected origin.');
        await page.locator('body').waitFor({timeout:settings.settleTimeoutMs});
        if(cleanup)await sweepCleanup(page,{...cleanup,preserveSelectors:[...cleanup.preserveSelectors,...source.preserveSelectors??[]],dismissSelectors:[...cleanup.dismissSelectors,...source.dismissSelectors??[]]},interventions);
        let previous='',stable=0,links:string[]=[];
        const deadline=Date.now()+settings.settleTimeoutMs;
        while(Date.now()<deadline && stable<3){
          signal?.throwIfAborted();
          links=[...new Set((await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).href))).map(link=>siteLink(link,effectiveSeed)).filter((url):url is string=>Boolean(url)))];
          const signature=JSON.stringify(links);stable=signature===previous?stable+1:0;previous=signature;
          if(stable<3)await delay(Math.min(250,settings.minDelayMs),signal);
        }
        const known=new Set(store.jobs('site-page').filter(j=>j.payload.seed===source.url).map(j=>j.payload.url));
        known.add(effectiveSeed);
        const entries=[];
        for(const link of links)if(!known.has(link)) {
          if(next.payload.depth>=maxDepth || known.size>=maxPages){limited=true;continue;}
          known.add(link);entries.push({key:`${source.url}:${link}`,payload:{seed:source.url,url:link,depth:next.payload.depth+1,parent:next.payload.url,path:[...(next.payload.path??[seed]),link],order:known.size}});
        }
        store.queueJobs('site-page',entries);
        store.finish(next,'complete',{links,interventions},undefined,'navigation_links_observed');
      } catch(error) {
        if(signal?.aborted)throw error;
        store.finish(next,'failed',{interventions},errorMessage(error));
      } finally {signal?.removeEventListener('abort',abort);await context.close().catch(()=>{});}
    }
    const failed=store.jobs('site-page').some(j=>j.payload.seed===source.url && j.status==='failed');
    const reason=!canContinue()?'capture_limit':failed?'navigation_error':limited?'scope_limit':'navigation_graph_exhausted';
    store.finish(job,failed||!canContinue()||limited?'incomplete':'complete',{pages:seen.size,maxPages,maxDepth,effectiveSeed,at:now()},undefined,reason);
  } catch(error) {store.finish(job,'pending',undefined,errorMessage(error));throw error;}
}
