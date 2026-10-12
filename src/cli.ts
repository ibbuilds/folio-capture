import { resolve, join, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.ts';
import { Store } from './store.ts';
import { runPipeline } from './pipeline.ts';
import { exportCatalog } from './report.ts';
import { inside, errorMessage } from './utils.ts';

export async function main(args=process.argv.slice(2)) {
  const command=args[0] && !args[0].startsWith('-') ? args.shift()! : 'run';
  const flags=new Map<string,string|boolean>();
  const valued=new Set(['--config','--output','--source','--limit','--port']);
  const booleans=new Set(['--capture-only','--refresh','--help']);
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(valued.has(arg)){const value=args[++i];if(!value || value.startsWith('--'))throw new Error(`${arg} needs a value.`);flags.set(arg,value);}
    else if(booleans.has(arg))flags.set(arg,true);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if(flags.has('--help') || command==='help'){
    console.log(`Folio Capture\n\n  npm run capture                       Discover, capture, classify, export\n  npm run capture -- --capture-only      No model required\n  npm run capture -- --limit 3           Process at most 3 pages this run\n  npm run folio -- status                Inspect the job ledger\n  npm run folio -- retry                 Retry recorded failures\n  npm run folio -- refresh               Force new captures\n  npm run folio -- classify              Enrich saved captures only\n  npm run folio -- classify --refresh    Reclassify saved captures\n  npm run folio -- report                Regenerate local indexes/report\n  npm run folio -- serve                 View report at http://127.0.0.1:4173\n\nOptions: --config sources.yaml, --output folder, --source URL, --port 4173`);
    return;
  }
  if(!['run','status','retry','refresh','classify','report','serve'].includes(command))throw new Error(`Unknown command: ${command}. Use --help.`);
  const config=await loadConfig(String(flags.get('--config') ?? 'sources.yaml'));
  if(flags.get('--output'))config.output=resolve(String(flags.get('--output')));
  if(command==='serve'){
    const port=Number(flags.get('--port') ?? 4173);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Port must be an integer from 1024 to 65535.');
    const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp'};
    const server=createServer(async(req,res)=>{
      try{
        if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end();return;}
        const pathname=decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        if(pathname.includes('\\'))throw new Error('Invalid path');
        const path=inside(config.output,pathname==='/'?'report.html':pathname.replace(/^\//,''));
        if(!['.html','.json','.png','.webp'].includes(extname(path)))throw new Error('Unsupported file');
        if(!(await stat(path)).isFile())throw new Error('Not a file');
        const content=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)] ?? 'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
      }catch{res.writeHead(404);res.end('Not found');}
    });
    server.listen(port,'127.0.0.1',()=>console.log(`Folio report: http://127.0.0.1:${port}/`));
    process.once('SIGINT',()=>server.close());process.once('SIGTERM',()=>server.close());return;
  }
  if(command==='status' || command==='report'){
    const store=new Store(config.output);
    try{
      if(command==='report'){store.acquireLock();await exportCatalog(store);console.log(join(config.output,'report.html'));}
      else{const jobs=store.jobs();console.table(jobs.map(j=>({stage:j.stage,status:j.status,attempts:j.attempts,source:j.key,reason:j.error ?? j.stoppingReason ?? ''})));console.log(`${store.captures().filter(c=>c.manifest).length} published capture versions.`);}
    }finally{store.close();}return;
  }
  const limit=flags.has('--limit')?Number(flags.get('--limit')):undefined;
  if(limit!==undefined && (!Number.isInteger(limit)||limit<1))throw new Error('--limit must be a positive integer.');
  const controller=new AbortController();
  const interrupt=()=>controller.abort(new Error('Interrupted by user'));
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
    const summary=await runPipeline(config,{captureOnly:flags.has('--capture-only'),refresh:command==='refresh'||flags.has('--refresh'),retry:command==='retry',classifyOnly:command==='classify',source:flags.has('--source')?String(flags.get('--source')):undefined,limit,signal:controller.signal});
    console.log(JSON.stringify(summary,null,2));console.log(`Report: ${join(config.output,'report.html')}`);
    if(summary.interrupted)process.exitCode=130;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(errorMessage(error));process.exitCode=1;});
