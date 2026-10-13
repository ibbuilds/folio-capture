import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {loadConfig} from '../src/config.ts';
import {libraryAdapter} from '../src/adapters.ts';
import {atomicJson,errorMessage} from '../src/utils.ts';
import type {DiscoveredEntry,DiscoveryEvent} from '../src/types.ts';

// Developer live traversal audit. Does not capture designs, run a model, or publish a catalog.
const args=process.argv.slice(2),flags=new Map<string,string>();
for(let i=0;i<args.length;i+=2){if(!['--config','--source','--report'].includes(args[i])||!args[i+1])throw new Error('Use --config, --source or --report with a value.');flags.set(args[i],args[i+1]);}
const config=await loadConfig(flags.get('--config')??'sources.yaml');
const reportPath=resolve(flags.get('--report')??'.cache/live-sources/report.json');
await mkdir(dirname(reportPath),{recursive:true});
type Row={url:string;name?:string;adapter?:string;status:string;entries:DiscoveredEntry[];end?:Extract<DiscoveryEvent,{type:'end'}>;resolved:Array<{detail:string;original?:string;finalUrl?:string;status?:number;title?:string;error?:string}>;error?:string;checkedAt?:string;durationMs?:number};
let rows:Row[]=[];try{rows=JSON.parse(await readFile(reportPath,'utf8')).sources;}catch{}
const sources=config.sources.filter(source=>!flags.has('--source')||source.url===flags.get('--source'));
if(!sources.length)throw new Error('Selected source is not configured.');
for(const source of config.sources)if(!rows.some(row=>row.url===source.url))rows.push({url:source.url,name:source.name,status:'queued',entries:[],resolved:[]});
const save=()=>atomicJson(reportPath,{schemaVersion:1,checkedAt:new Date().toISOString(),scope:'Bounded live discovery and original-link verification; not capture/classification acceptance',sources:rows});
const controller=new AbortController();process.once('SIGINT',()=>controller.abort(new Error('Interrupted verification')));
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 for(const source of sources){
  controller.signal.throwIfAborted();const row=rows.find(row=>row.url===source.url)!;
  if(!flags.has('--source')&&row.status==='sample-verified')continue;
  row.status='checking';row.entries=[];row.resolved=[];delete row.error;row.adapter=libraryAdapter(source.url)?.id;
  const started=Date.now();await save();console.log(`Checking ${source.name??source.url}`);
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]);
  const settings={...config.discovery,maxEntries:6,maxScrollSteps:8,maxDurationMs:60000};
  try{
   const adapter=libraryAdapter(source.url);if(!adapter)throw new Error('No adapter for this source');
   for await(const event of adapter.discover({browser,seed:source,settings,cleanupSettings:config.capture,signal,onDiscovered:entries=>{for(const entry of entries)if(!row.entries.some(known=>known.id===entry.id))row.entries.push(entry);}})){
    if(event.type==='entry'){if(!row.entries.some(known=>known.id===event.entry.id))row.entries.push(event.entry);}
    else row.end=event;
   }
   await save();
   for(const entry of row.entries.slice(0,4)){
    if(row.resolved.filter(item=>!item.error).length>=Math.min(2,row.entries.length))break;
    const item:Row['resolved'][number]={detail:entry.detailUrl};row.resolved.push(item);
    try{
     const reference=await adapter.resolve({browser,entryUrl:entry.detailUrl,entry,settings,cleanupSettings:config.capture,signal});item.original=reference.originalUrl;
     const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});
     const abort=()=>void context.close().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
     try{const page=await context.newPage();const response=await page.goto(reference.originalUrl,{waitUntil:'domcontentloaded',timeout:45000});item.status=response?.status();item.finalUrl=page.url();item.title=await page.title();if((item.status??0)>=400&&!(item.status===404&&adapter.id==='404s')||/just a moment|access denied|verify you are human|captcha/i.test(item.title))throw new Error(`Original inaccessible: HTTP ${item.status}, ${item.title}`);}
     finally{signal.removeEventListener('abort',abort);await context.close().catch(()=>{});}
    }catch(error){item.error=errorMessage(error);}
    await save();
   }
   row.status=row.entries.length&&row.resolved.filter(item=>!item.error).length>=Math.min(2,row.entries.length)?row.resolved.some(item=>item.error)?'sample-verified-with-exceptions':'sample-verified':'failed';
   if(!row.entries.length)row.error=row.end?.error??'No entries discovered';
   else if(row.end?.error&&!/entry limit/i.test(row.end.error)){row.status='discovery-exception';row.error=row.end.error;}
  }catch(error){row.status='failed';row.error=errorMessage(error);}
  row.checkedAt=new Date().toISOString();row.durationMs=Date.now()-started;await save();
  console.log(JSON.stringify({source:row.name??row.url,status:row.status,entries:row.entries.length,originals:row.resolved,error:row.error}));
 }
}finally{await browser.close();await save();}
console.log(`Live source report: ${reportPath}`);
