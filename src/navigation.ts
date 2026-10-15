import type { Page } from 'playwright';
import { delay } from './utils.ts';

/** Open only navigation disclosures. Never operate forms, product actions or onboarding. */
export async function revealNavigation(page:Page,signal?:AbortSignal) {
  const interventions:string[]=[];
  const links=new Set<string>();
  const collect=async()=>{for(const href of await page.locator('a[href]').evaluateAll(nodes=>nodes.map(el=>(el as HTMLAnchorElement).href)))links.add(href);};
  const details=page.locator('header details:not([open]), nav details:not([open]), [role="navigation"] details:not([open])');
  for(const detail of (await details.all()).slice(0,12)) {
    signal?.throwIfAborted();
    await detail.evaluate(el=>el.setAttribute('open',''));
    interventions.push('Opened navigation details');
  }
  const buttons=page.locator('header button, nav button, [role="navigation"] button, button[aria-label*="menu" i], button[aria-label*="navigation" i]');
  for(const button of (await buttons.all()).slice(0,20)) {
    signal?.throwIfAborted();
    const allowed=await button.evaluate(el=>{
      const button=el as HTMLButtonElement;
      const label=(button.getAttribute('aria-label')||button.innerText||button.textContent||'').trim();
      if(button.disabled||button.form||button.dataset.folioNavigationVisited==='true'||button.getAttribute('aria-expanded')==='true')return false;
      if(/sign.?in|log.?in|sign.?up|buy|checkout|subscribe|delete|remove|submit|accept|reject|download/i.test(label))return false;
      return button.getAttribute('aria-expanded')==='false'&&Boolean(button.getAttribute('aria-controls')||button.getAttribute('aria-haspopup')) || /^(?:open |toggle )?(?:main |mobile )?(?:menu|navigation)$/i.test(label);
    });
    if(!allowed||!await button.isVisible())continue;
    try {
      const label=(await button.getAttribute('aria-label')??await button.textContent()??'menu').trim().slice(0,120);
      await button.evaluate(el=>{(el as HTMLElement).dataset.folioNavigationVisited='true';});
      await button.click({timeout:1000,noWaitAfter:true});
      interventions.push(`Opened navigation: ${label}`);
      await delay(150,signal);
      // Observe this menu before opening a mutually exclusive disclosure next time.
      break;
    }catch(error){signal?.throwIfAborted();if(!(error instanceof Error)||!error.message.includes('Timeout'))throw error;}
  }
  await collect();return {interventions,links:[...links]};
}

/** Record entry screens as exploration boundaries without rejecting their visual design. */
export async function entryBoundary(page:Page) {
  return page.evaluate(()=>{
    const main=document.querySelector('main,[role="main"]')??document.body;
    const text=((main as HTMLElement)?.innerText??main?.textContent??'').replace(/\s+/g,' ').trim();
    const visible=(el:Element)=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&el.getBoundingClientRect().width>0;
    const controls=[...main.querySelectorAll('button,input[type="submit"],a')].filter(visible);
    const continuation=controls.find(el=>/^(?:continue|start|enter|begin|get started)$/i.test((el.textContent||el.getAttribute('value')||'').trim()));
    const compact=text.length<1500&&[...main.querySelectorAll('h1,h2')].filter(visible).length<=2;
    const deviceChoice=compact&&/\b(?:your|select|choose)\s+(?:a\s+)?device\b/i.test(text)&&continuation;
    const login=compact&&[...main.querySelectorAll('input[type="password"]')].some(visible)&&/sign.?in|log.?in/i.test(text);
    if(!deviceChoice&&!login)return null;
    return {kind:deviceChoice?'device-selection':'authentication',control:continuation?.textContent?.trim()??null,
      reason:'Only the addressed entry screen was observed. Content behind this interaction has not been explored.'};
  });
}

export function sitemapLocations(xml:string):{index:boolean;urls:string[]}|undefined {
  if(xml.length>2_000_000)return;
  const content=xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g,'').trim();
  if(!/^<(?:[\w.-]+:)?(?:urlset|sitemapindex)\b/i.test(content))return;
  const decode=(text:string)=>text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,value=>{
    const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
    if(named[value])return named[value];
    const code=value[2].toLowerCase()==='x'?parseInt(value.slice(3,-1),16):Number(value.slice(2,-1));
    return Number.isInteger(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):value;
  });
  return {index:/<(?:[\w.-]+:)?sitemapindex\b/i.test(content),urls:[...content.matchAll(/<(?:[\w.-]+:)?loc\b[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:[\w.-]+:)?loc>/gi)].slice(0,10000).map(match=>decode(match[1].trim()))};
}

/** Optional public sitemap discovery, using browser requests so fixture routes remain deterministic. */
export async function publicSitemap(page:Page,origin:string,timeoutMs:number,signal?:AbortSignal) {
  const pending=[new URL('/sitemap.xml',origin).href],visited=new Set<string>(),urls=new Set<string>(),documents:string[]=[];
  while(pending.length&&visited.size<4) {
    signal?.throwIfAborted();
    const url=pending.shift()!;if(visited.has(url))continue;visited.add(url);
    try {
      const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:Math.min(timeoutMs,4000)});
      if(!response?.ok()||new URL(page.url()).origin!==new URL(origin).origin)continue;
      const parsed=sitemapLocations(await response.text());if(!parsed)continue;documents.push(url);
      for(const value of parsed.urls) {
        let target:URL;try{target=new URL(value,url);}catch{continue;}
        if(target.origin!==new URL(origin).origin||target.username||target.password)continue;
        if(parsed.index){if(pending.length<12&&!visited.has(target.href))pending.push(target.href);}
        else urls.add(target.href);
      }
    }catch{signal?.throwIfAborted();/* Optional discovery failure is not a successful sitemap. */}
  }
  return {urls:[...urls],documents,limited:pending.length>0};
}
