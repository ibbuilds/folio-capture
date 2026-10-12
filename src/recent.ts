import type { DiscoveryEvent, DiscoveredEntry } from './types.ts';
import type { ReferoDiscoveryOptions } from './discovery.ts';
import type { resolveReferoEntry } from './discovery.ts';
import { canonicalUrl, delay, errorMessage, idFor, now } from './utils.ts';

export function isRecentLibrary(value:string):boolean {
  let url:URL;try{url=new URL(value);}catch{return false;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false;
  const host=url.hostname.replace(/^www\./,'');
  return host==='godly.website' && url.pathname==='/' || host==='recent.design' && (url.pathname==='/' || /^\/websites(?:\/[^/]+)?\/?$/.test(url.pathname));
}
const recentHost=(value:string)=>new URL(value).hostname.replace(/^www\./,'')==='recent.design';
export function recentListing(value:string):string {
  const url=new URL(value);
  if(url.hostname.replace(/^www\./,'')==='godly.website' || url.pathname==='/')return 'https://recent.design/websites';
  return url.href;
}

/** Current Recent website collections; Godly seeds resolve through the known successor. */
export async function* discoverRecent(options:ReferoDiscoveryOptions):AsyncGenerator<DiscoveryEvent> {
  const {browser,seed,settings,signal}=options;
  const context=await browser.newContext();const abort=()=>{void context.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  const seen=new Set<string>();const visited=new Set<string>();const collections=[recentListing(seed.url)];
  const started=Date.now();let failedRequest=false;let observedPlateau=false;let consumerMs=0;
  const pending=new Set<unknown>();
  try {
    const page=await context.newPage();page.on('dialog',dialog=>{void dialog.dismiss();});
    page.on('request',r=>{if(['document','fetch','xhr'].includes(r.resourceType()))pending.add(r);});
    page.on('requestfinished',r=>pending.delete(r));
    page.on('requestfailed',r=>{pending.delete(r);if(['document','fetch','xhr'].includes(r.resourceType()))failedRequest=true;});
    page.on('response',r=>{if(['document','fetch','xhr'].includes(r.request().resourceType()) && r.status()>=400)failedRequest=true;});
    for(let c=0;c<collections.length;c++) {
      const listing=collections[c]!;if(visited.has(listing))continue;visited.add(listing);
      const response=await page.goto(listing,{waitUntil:'domcontentloaded',timeout:settings.navigationTimeoutMs});
      if(response && response.status()>=400)throw new Error(`Recent HTTP ${response.status()}`);
      if(!recentHost(page.url()) || !/^\/websites(?:\/|$)/.test(new URL(page.url()).pathname))throw new Error('Unsupported Recent collection redirect');
      let plateau=0,reason:'explicit_end'|'observed_plateau'|undefined;
      for(let step=0;step<settings.maxScrollSteps;step++) {
        signal?.throwIfAborted();
        if(Date.now()-started-consumerMs>settings.maxDurationMs)throw new Error('Recent discovery duration limit');
        await delay(settings.minDelayMs,signal);
        const snapshot=await page.evaluate(()=>{
          const anchors=[...document.querySelectorAll<HTMLAnchorElement>('a[href]')];
          const dom={visible(e:Element){const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}};
          return {entries:anchors.filter(a=>new URL(a.href).origin===location.origin && /^\/i\/[^/]+\/?$/.test(new URL(a.href).pathname))
              .filter(a=>!a.closest('[data-sponsored="true"], [aria-label="Advertisement"]')).map(a=>({url:a.href,title:(a.textContent||a.querySelector('img')?.alt||'').trim().slice(0,200)})),
            collections:anchors.map(a=>a.href).filter(value=>{const u=new URL(value);return u.origin===location.origin && /^\/websites\/[^/]+\/?$/.test(u.pathname);}),
            next:anchors.find(a=>a.rel==='next')?.href,
            loading:[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-loading="true"]')].some(dom.visible),
            explicit:[...document.querySelectorAll('p,[role="status"]')].some(e=>dom.visible(e)&&/^(no more (websites|results)|end of results|all websites loaded)[.!]?$/i.test(e.textContent?.trim()??'')),
            height:document.documentElement.scrollHeight,bottom:window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-4};
        });
        if(failedRequest)throw new Error('Recent loading request failed; cannot establish exhaustion');
        const batch:DiscoveredEntry[]=[];
        for(const item of snapshot.entries) {
          const detailUrl=canonicalUrl(item.url);if(seen.has(detailUrl))continue;
          if(settings.maxEntries && seen.size>=settings.maxEntries)break;
          seen.add(detailUrl);batch.push({id:idFor(detailUrl),seedUrl:seed.url,listingUrl:listing,detailUrl,title:item.title,discoveredAt:now()});
        }
        options.onDiscovered?.(batch); // Commit all identities before processing the first one.
        for(const entry of batch){const beforeYield=Date.now();yield {type:'entry',entry};consumerMs+=Date.now()-beforeYield;}
        if(settings.maxEntries && seen.size>=settings.maxEntries){yield {type:'end',reason:'incomplete',error:'Entry limit reached',collections,discovered:seen.size};return;}
        if(new URL(seed.url).pathname==='/' || new URL(seed.url).pathname==='/websites')for(const collection of snapshot.collections)if(!collections.includes(collection))collections.push(collection);
        if(snapshot.next) {
          const next=new URL(snapshot.next);
          const selected=new URL(listing);
          if(next.origin===selected.origin && next.pathname===selected.pathname && !collections.includes(next.href))collections.push(next.href);
        }
        if(snapshot.loading || pending.size){plateau=0;continue;}
        if(snapshot.explicit){reason='explicit_end';break;}
        plateau=snapshot.bottom && !batch.length ? plateau+1:0;
        if(plateau>=settings.plateauChecks){reason='observed_plateau';break;}
        await page.evaluate(()=>window.scrollBy(0,Math.max(200,window.innerHeight*.8)));
      }
      if(!seen.size)throw new Error('Unsupported Recent structure: no website entries were observed');
      if(!reason)throw new Error('Recent discovery step limit');
      // A plateau is never upgraded to an explicit end, even if other pages have end markers.
      if(reason==='observed_plateau')observedPlateau=true;
    }
    yield {type:'end',reason:observedPlateau?'observed_plateau':'explicit_end',collections,discovered:seen.size};
  } catch(error) {
    if(signal?.aborted)throw error;
    yield {type:'end',reason:'incomplete',error:errorMessage(error),collections,discovered:seen.size};
  } finally {signal?.removeEventListener('abort',abort);await context.close();}
}
export const resolveRecentEntry:typeof resolveReferoEntry=async ({browser,entryUrl,settings,signal})=>{
  const context=await browser.newContext();const abort=()=>{void context.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try {
    const page=await context.newPage();page.on('dialog',d=>{void d.dismiss();});
    const response=await page.goto(entryUrl,{waitUntil:'domcontentloaded',timeout:settings.navigationTimeoutMs});
    if(response && response.status()>=400)throw new Error(`Recent HTTP ${response.status()}`);
    if(!recentHost(page.url()) || !/^\/i\/[^/]+\/?$/.test(new URL(page.url()).pathname))throw new Error('Unsupported Recent detail redirect');
    await page.locator('body').waitFor({timeout:settings.settleTimeoutMs});
    const candidates=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>({url:(node as HTMLAnchorElement).href,text:(node.getAttribute('aria-label')||node.textContent||'').trim()})));
    const links=candidates.filter(a=>/^(visit|view|open)( (the|original|live))? (website|site)(\s*[↗→])?$/i.test(a.text)).map(a=>a.url).filter(value=>{
      const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/(^|\.)(recent.design|godly.website|dribbble.com|behance.net|figma.com|x.com|twitter.com|instagram.com)$/.test(url.hostname);
    });
    const unique=[...new Set(links.map(canonicalUrl))];
    if(unique.length!==1)throw new Error(unique.length?'Ambiguous original website links':'Missing original website link');
    return {originalUrl:unique[0]!,title:await page.title(),sourceLabels:[],metadata:{adapter:'recent',detailUrl:page.url()}};
  } finally {signal?.removeEventListener('abort',abort);await context.close();}
};
