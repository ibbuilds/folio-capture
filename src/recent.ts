import type { DiscoveryEvent, DiscoveredEntry } from './types.ts';
import type { ReferoDiscoveryOptions } from './discovery.ts';
import type { resolveReferoEntry } from './discovery.ts';
import { canonicalUrl, delay, errorMessage, idFor, now } from './utils.ts';
import type { Page } from 'playwright';
class RecentPersistenceError extends Error {}

async function recentSnapshot(page:Page) {
  return page.evaluate(()=>{
    const anchors=[...document.querySelectorAll<HTMLAnchorElement>('a[href]')];
    const dom={visible(e:Element){const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}};
    const cards=anchors.filter(a=>new URL(a.href).origin===location.origin && /^\/i\/[^/]+\/?$/.test(new URL(a.href).pathname));
    let scroller=document.scrollingElement||document.documentElement;
    for(let ancestor=cards[0]?.parentElement;ancestor;ancestor=ancestor.parentElement)if(/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY)&&ancestor.scrollHeight>ancestor.clientHeight+2){scroller=ancestor;break;}
    const accumulated=(window as unknown as {__folioRecentEntries:Map<string,{url:string;title:string}>}).__folioRecentEntries;
    return {entries:[...accumulated.values()],
      collections:anchors.map(a=>a.href).filter(value=>{const u=new URL(value);return u.origin===location.origin && /^\/websites\/[^/]+\/?$/.test(u.pathname);}),
      next:anchors.find(a=>a.rel==='next')?.href,
      loading:[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-loading="true"]')].some(dom.visible),
      explicit:[...document.querySelectorAll('p,[role="status"]')].some(e=>dom.visible(e)&&/^(no more (websites|results)|end of results|all websites loaded)[.!]?$/i.test(e.textContent?.trim()??'')),
      height:scroller.scrollHeight,bottom:scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-4};
  });
}

async function settleRecent(page:Page,options:ReferoDiscoveryOptions,pending:Set<unknown>,failed:()=>boolean,remaining:()=>number) {
  const budget=Math.min(options.settings.settleTimeoutMs,remaining());
  if(budget<=0)throw new Error('Recent discovery duration limit');
  const started=Date.now(),quietMs=Math.min(500,options.settings.settleTimeoutMs/2);
  let previous='',quietStarted=Date.now();
  while(Date.now()-started<budget) {
    options.signal?.throwIfAborted();if(failed())throw new Error('Recent loading request failed; cannot establish exhaustion');
    const snapshot=await recentSnapshot(page);
    const key=JSON.stringify([snapshot.entries.map(e=>[e.url,e.title]),snapshot.height,snapshot.loading]);
    if(key!==previous || snapshot.loading || pending.size)quietStarted=Date.now();
    previous=key;
    if(!snapshot.loading && !pending.size && Date.now()-quietStarted>=quietMs)return snapshot;
    await delay(Math.min(50,Math.max(1,budget-(Date.now()-started))),options.signal);
  }
  throw new Error('Recent listing did not settle before its timeout');
}

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
  let page:Page|undefined,lastListing=collections[0]!;
  const persist=(items:Array<{url:string;title:string}>,listing:string)=>{
    const batch:DiscoveredEntry[]=[];
    for(const item of items) {
      const detailUrl=canonicalUrl(item.url);if(seen.has(detailUrl))continue;
      if(settings.maxEntries && seen.size>=settings.maxEntries)break;
      seen.add(detailUrl);batch.push({id:idFor(detailUrl),seedUrl:seed.url,listingUrl:listing,detailUrl,title:item.title,discoveredAt:now()});
    }
    try {options.onDiscovered?.(batch);}catch(error){throw new RecentPersistenceError(`Recent batch persistence failed: ${errorMessage(error)}`);}
    return batch;
  };
  try {
    page=await context.newPage();page.on('dialog',dialog=>{void dialog.dismiss();});
    // Observe identities from document creation, including cards removed before a settled
    // snapshot. Every accumulated batch is persisted before its first entry is yielded.
    await page.addInitScript(()=>{
      const entries=new Map<string,{url:string;title:string}>();
      (window as unknown as {__folioRecentEntries:typeof entries}).__folioRecentEntries=entries;
      const dom={collect(node:Node){
        if(!(node instanceof Element))return;
        const anchors=[...(node instanceof HTMLAnchorElement?[node]:[]),...node.querySelectorAll<HTMLAnchorElement>('a[href]')];
        for(const a of anchors) {
          let url:URL;try{url=new URL(a.href);}catch{continue;}
          if(url.origin!==location.origin || !/^\/i\/[^/]+\/?$/.test(url.pathname) || a.closest('[data-sponsored="true"], [aria-label="Advertisement"]'))continue;
          const title=(a.textContent||a.querySelector('img')?.alt||'').trim().slice(0,200);
          entries.set(url.href,{url:url.href,title:title||entries.get(url.href)?.title||''});
        }
      }};
      new MutationObserver(changes=>{for(const change of changes){dom.collect(change.target);for(const node of [...change.addedNodes,...change.removedNodes])dom.collect(node);}})
        .observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['href','data-sponsored'],characterData:true});
      document.addEventListener('DOMContentLoaded',()=>dom.collect(document.documentElement));
    });
    page.on('request',r=>{if(['document','fetch','xhr'].includes(r.resourceType()))pending.add(r);});
    page.on('requestfinished',r=>pending.delete(r));
    page.on('requestfailed',r=>{pending.delete(r);if(['document','fetch','xhr'].includes(r.resourceType()))failedRequest=true;});
    page.on('response',r=>{if(['document','fetch','xhr'].includes(r.request().resourceType()) && r.status()>=400)failedRequest=true;});
    for(let c=0;c<collections.length;c++) {
      const listing=collections[c]!;if(visited.has(listing))continue;visited.add(listing);lastListing=listing;
      const response=await page.goto(listing,{waitUntil:'domcontentloaded',timeout:settings.navigationTimeoutMs});
      if(response && response.status()>=400)throw new Error(`Recent HTTP ${response.status()}`);
      if(!recentHost(page.url()) || !/^\/websites(?:\/|$)/.test(new URL(page.url()).pathname))throw new Error('Unsupported Recent collection redirect');
      let observedEntries=false;
      let plateau=0,previousHeight=0,reason:'explicit_end'|'observed_plateau'|undefined;
      for(let step=0;step<settings.maxScrollSteps;step++) {
        signal?.throwIfAborted();
        if(Date.now()-started-consumerMs>settings.maxDurationMs)throw new Error('Recent discovery duration limit');
        const snapshot=await settleRecent(page,options,pending,()=>failedRequest,()=>settings.maxDurationMs-(Date.now()-started-consumerMs));
        if(snapshot.entries.length)observedEntries=true;
        if(failedRequest)throw new Error('Recent loading request failed; cannot establish exhaustion');
        const batch=persist(snapshot.entries,listing);
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
        plateau=snapshot.bottom && !batch.length && snapshot.height===previousHeight ? plateau+1:0;
        previousHeight=snapshot.height;
        if(plateau>=Math.max(3,settings.plateauChecks)){reason='observed_plateau';break;}
        await page.evaluate(()=>{
          const card=[...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a=>/^\/i\/[^/]+\/?$/.test(new URL(a.href).pathname));
          for(let ancestor=card?.parentElement;ancestor;ancestor=ancestor.parentElement)if(/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY)&&ancestor.scrollHeight>ancestor.clientHeight+2){ancestor.scrollTo({top:ancestor.scrollHeight,behavior:'instant'});return;}
          window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});
        });
        await delay(settings.minDelayMs,signal);
      }
      if(!observedEntries && reason!=='explicit_end')throw new Error('Unsupported Recent structure: no website entries were observed');
      if(!reason)throw new Error('Recent discovery step limit');
      // A plateau is never upgraded to an explicit end, even if other pages have end markers.
      if(reason==='observed_plateau')observedPlateau=true;
    }
    yield {type:'end',reason:observedPlateau?'observed_plateau':'explicit_end',collections,discovered:seen.size};
  } catch(error) {
    if(signal?.aborted || error instanceof RecentPersistenceError)throw error;
    // Loading failure prevents exhaustion, but must not erase already observed identities.
    if(page && recentHost(page.url()) && /^\/websites(?:\/|$)/.test(new URL(page.url()).pathname)) {
      const snapshot=await recentSnapshot(page).catch(()=>undefined);
      if(snapshot)for(const entry of persist(snapshot.entries,lastListing))yield {type:'entry',entry};
    }
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
    // A hydrated detail can render its original link after DOMContentLoaded.
    try {
      await page.getByRole('link',{name:/^(visit|view|open)( (the|original|live))? (website|site)(\s*[\u2197\u2192])?$/i}).first()
        .waitFor({state:'visible',timeout:settings.settleTimeoutMs});
    } catch(error) {if(signal?.aborted)throw error;throw new Error('Missing original website link after detail hydration wait');}
    const candidates=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>({url:(node as HTMLAnchorElement).href,text:(node.getAttribute('aria-label')||node.textContent||'').trim()})));
    const links=candidates.filter(a=>/^(visit|view|open)( (the|original|live))? (website|site)(\s*[\u2197\u2192])?$/i.test(a.text)).map(a=>a.url).filter(value=>{
      const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/(^|\.)(recent.design|godly.website|dribbble.com|behance.net|figma.com|x.com|twitter.com|instagram.com)$/.test(url.hostname);
    });
    const unique=[...new Set(links.map(canonicalUrl))];
    if(unique.length!==1)throw new Error(unique.length?'Ambiguous original website links':'Missing original website link');
    return {originalUrl:unique[0]!,title:await page.title(),sourceLabels:[],metadata:{adapter:'recent',detailUrl:page.url()}};
  } finally {signal?.removeEventListener('abort',abort);await context.close();}
};
