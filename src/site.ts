import type { Browser,BrowserContext } from 'playwright';
import type { Store } from './store.ts';
import type { CaptureSettings, DiscoverySettings, Intervention, Provenance, Source } from './types.ts';
import { canonicalUrl, delay, errorMessage, isRelatedDestination, now } from './utils.ts';
import { guardNuisances } from './nuisance.ts';
import { sweepCleanup } from './cleanup.ts';
import { entryBoundary, publicSitemap, revealNavigation } from './navigation.ts';

export function siteLink(value:string,seed:string):string|undefined {
  try {
    const url=new URL(value,seed);const origin=new URL(seed).origin;
    if(url.origin!==origin || url.username || url.password || !['http:','https:'].includes(url.protocol))return;
    if(/\.(?:pdf|zip|png|jpe?g|webp|avif|gif|svg|ico|mp4|webm|mp3|wav|css|js|mjs|json|xml|txt|woff2?|ttf|otf)$/i.test(url.pathname))return;
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
        let previous='',stable=0,settledEnd=false,lastChange=Date.now();
        let boundary=await entryBoundary(page);const navigation:string[]=[];
        const excluded=new Map<string,string>();
        const observed=new Set<string>(),known=new Set(store.jobs('site-page').filter(j=>j.payload.seed===source.url).map(j=>j.payload.url));
        known.add(effectiveSeed);
        const queue=(links:string[],via:string)=>{
          const entries=[];
          for(const link of links){const url=siteLink(link,effectiveSeed);if(!url||observed.has(url))continue;observed.add(url);
            const oldExclusion=store.getJob('site-excluded',`${source.url}:${url}`);
            if(known.has(url)){if(oldExclusion)store.finish(oldExclusion,'complete',{url},undefined,'now_queued');continue;}
            if(next.payload.depth>=maxDepth || known.size>=maxPages){limited=true;excluded.set(url,next.payload.depth>=maxDepth?'depth_limit':'page_limit');continue;}
            known.add(url);if(oldExclusion)store.finish(oldExclusion,'complete',{url},undefined,'now_queued');entries.push({key:`${source.url}:${url}`,payload:{seed:source.url,url,depth:next.payload.depth+1,parent:next.payload.url,path:[...(next.payload.path??[seed]),url],order:known.size,via}});
          }
          store.queueJobs('site-page',entries);
        };
        const deadline=Date.now()+Math.min(settings.maxDurationMs,Math.max(settings.settleTimeoutMs,30000));
        let steps=0;
        for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
          await page.setViewportSize(viewport);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
          previous='';stable=0;lastChange=Date.now();settledEnd=false;
          for(;Date.now()<deadline;){
          signal?.throwIfAborted();
          const revealed=await revealNavigation(page,signal);navigation.push(...revealed.interventions);queue(revealed.links,'navigation-disclosure');
          const metrics=await page.evaluate(()=>({y:scrollY,height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0,innerHeight),viewport:innerHeight}));
          const signature=JSON.stringify([[...observed],metrics.height]);
          const bottom=metrics.y+metrics.viewport>=metrics.height-2;
          if(signature!==previous)lastChange=Date.now();
          stable=bottom&&signature===previous?stable+1:0;previous=signature;
          const loading=await page.locator('[aria-busy="true"],[role="progressbar"]').evaluateAll(nodes=>nodes.some(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&el.getBoundingClientRect().width>0));
          if(!loading&&stable>=settings.plateauChecks&&Date.now()-lastChange>=Math.max(500,Math.min(settings.settleTimeoutMs,2000))){settledEnd=true;break;}
          if(!bottom){
            if(steps>=Math.min(settings.maxScrollSteps,200))break;
            await page.evaluate(size=>scrollTo({top:scrollY+size,behavior:'instant'}),metrics.viewport*.8);steps++;
          }
          if(cleanup){const result=await sweepCleanup(page,{...cleanup,preserveSelectors:[...cleanup.preserveSelectors,...source.preserveSelectors??[]],dismissSelectors:[...cleanup.dismissSelectors,...source.dismissSelectors??[]]},interventions);if(result.unresolved.length)throw new Error(`Site navigation blocked: ${result.unresolved.join('; ')}`);}
          await delay(Math.min(250,settings.minDelayMs),signal);
          }
          boundary??=await entryBoundary(page);
          if(!settledEnd)break;
        }
        // Sitemaps supplement observed navigation; they never displace navigation pages.
        let sitemap:{urls:string[];documents:string[];limited:boolean}|undefined;
        if(next.payload.depth===0){
          const sitemapPage=await context.newPage();
          try{sitemap=await publicSitemap(sitemapPage,effectiveSeed,settings.navigationTimeoutMs,signal);queue(sitemap.urls,'sitemap');if(sitemap.limited)limited=true;}
          finally{await sitemapPage.close();}
        }
        store.queueJobs('site-excluded',[...excluded].map(([url,reason])=>({key:`${source.url}:${url}`,payload:{seed:source.url,url,reason,discoveredFrom:next.payload.url}})));
        store.db.prepare("UPDATE jobs SET status='incomplete',stopping_reason=json_extract(payload,'$.reason'),updated_at=? WHERE stage='site-excluded' AND json_extract(payload,'$.seed')=? AND status='pending'").run(now(),source.url);
        store.finish(next,settledEnd&&!boundary?'complete':'incomplete',{links:[...observed],interventions,navigation,...(boundary?{boundary}:{}),...(sitemap?{sitemap}:{}),excluded:[...excluded].map(([url,reason])=>({url,reason}))},undefined,boundary?'interaction_boundary':settledEnd?'navigation_links_observed':'navigation_observation_limit');
      } catch(error) {
        if(signal?.aborted)throw error;
        store.finish(next,'failed',{interventions},errorMessage(error));
      } finally {signal?.removeEventListener('abort',abort);await context.close().catch(()=>{});}
      // Register navigation before a potentially long classifier wait. Interruption cannot
      // erase the child-page queue, and a navigation failure still permits addressed-page capture.
      await capture(next.payload.url,{seedUrl:source.url,listingUrl:next.payload.parent??undefined,discoveredAt:next.createdAt,sourceLabels:[],navigationPath:next.payload.path??[seed,next.payload.url]});
    }
    const pages=store.jobs('site-page').filter(j=>j.payload.seed===source.url);
    const failed=pages.some(j=>['failed','incomplete'].includes(j.status));
    const boundaries=pages.filter(j=>j.stoppingReason==='interaction_boundary').map(j=>({url:j.payload.url,...j.result?.boundary}));
    const reason=!canContinue()?'capture_limit':pages.some(j=>j.status==='failed'||j.status==='incomplete'&&j.stoppingReason!=='interaction_boundary')?'navigation_error':boundaries.length?'interaction_boundary':limited?'scope_limit':'navigation_graph_exhausted';
    store.finish(job,failed||!canContinue()||limited?'incomplete':'complete',{pages:seen.size,queuedPages:pages.length,excludedPages:store.jobs('site-excluded').filter(j=>j.payload.seed===source.url&&j.status==='incomplete').length,boundaries,maxPages,maxDepth,effectiveSeed,at:now(),coverage:'Observed public navigation and bounded sitemap discovery; unobserved interactions are not claimed.'},undefined,reason);
  } catch(error) {store.finish(job,'pending',undefined,errorMessage(error));throw error;}
}
