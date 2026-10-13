import { resolve, join, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.ts';
import { evaluateQuality } from './evaluation.ts';
import { exportAccepted, pruneQuarantine } from './catalog.ts';
import { exportCoverage } from './coverage.ts';
import { Store } from './store.ts';
import { runPipeline } from './pipeline.ts';
import { serveBridgeHttp } from './mcp.ts';
import { Workflow } from './workflow.ts';
import { organizeOutput } from './organize.ts';
import { doctor } from './doctor.ts';
import { resetOutput } from './reset.ts';
import { exportCatalog } from './report.ts';
import { inside, errorMessage, atomicJson } from './utils.ts';

export async function main(args=process.argv.slice(2)) {
  const command=args[0] && !args[0].startsWith('-') ? args.shift()! : 'run';
  const flags=new Map<string,string|boolean>();
  const valued=new Set(['--config','--output','--source','--limit','--port','--older-than-days','--benchmark','--classifier']);
  const booleans=new Set(['--refresh','--help']);
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(valued.has(arg)){const value=args[++i];if(!value || value.startsWith('--'))throw new Error(`${arg} needs a value.`);flags.set(arg,value);}
    else if(booleans.has(arg))flags.set(arg,true);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if(flags.has('--help') || command==='help'){
    console.log(`Folio Capture\n\n  npm run capture                       Discover, capture, assess, classify, export\n  npm run capture -- --classifier mcp    ChatGPT reviews through the MCP bridge\n  npm run capture -- --classifier codex  Codex CLI assesses and classifies\n  npm run capture -- --limit 3           Capture at most 3 new pages this run\n  npm run folio -- status                Inspect the job ledger\n  npm run folio -- doctor                Check engine/authentication and pairing\n  npm run folio -- organize              Migrate saved folders safely; engine stopped\n  npm run clean                         Delete generated output and reset all history\n  npm run folio -- coverage              Inspect aesthetic and viewport gaps; offline\n  npm run folio -- retry                 Retry recorded failures\n  npm run folio -- refresh               Force new captures\n  npm run folio -- classify              Classify accepted saved references only\n  npm run folio -- classify --refresh    Reclassify saved captures\n  npm run folio -- reassess              Reassess saved pixels; no browser\n  npm run folio -- export                Regenerate accepted catalog\n  npm run folio -- evaluate --benchmark reviewed.json  Evaluate saved decisions\n  npm run folio -- prune                 Prune rejected assets after retention\n  npm run folio -- report                Regenerate local indexes/report\n  npm run folio -- serve                 View report at http://127.0.0.1:4173\n\nOptions: --classifier mcp|codex, --config sources.yaml, --output folder, --source URL, --port 4173`);
    return;
  }
  if(!['run','reset','status','doctor','organize','coverage','retry','refresh','classify','reassess','export','evaluate','prune','report','serve'].includes(command))throw new Error(`Unknown command: ${command}. Use --help.`);
  const config=await loadConfig(String(flags.get('--config') ?? 'sources.yaml'));
  if(flags.has('--classifier')){
    const provider=flags.get('--classifier');
    if(provider!=='mcp' && provider!=='codex')throw new Error('--classifier must be mcp or codex.');
    config.classifier.runner=provider;
  }
  if(flags.get('--output'))config.output=resolve(String(flags.get('--output')));
  if(command==='reset'){console.log(JSON.stringify(await resetOutput(config.output,String(flags.get('--config')??'sources.yaml')),null,2));return;}
  if(command==='doctor'){
    const port=Number(flags.get('--port')??4317);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port.');
    const result=await doctor(config,port);console.log(JSON.stringify(result,null,2));return;
  }
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
  if(['status','organize','coverage','report','export','evaluate','prune'].includes(command)){
    const store=new Store(config.output);
    try{
      if(command==='organize') {store.assertWorkflowAccess();store.acquireLock();const result=await organizeOutput(store,config.profiles);console.log(JSON.stringify(result,null,2));if(result.exceptions.length)process.exitCode=1;}
      else if(command==='evaluate'){
        if(!flags.has('--benchmark'))throw new Error('evaluate requires --benchmark with a frozen, independently reviewed dataset.');
        const result=evaluateQuality(JSON.parse(await readFile(resolve(String(flags.get('--benchmark'))),'utf8')),store.references());
        store.acquireLock();await atomicJson(join(config.output,'quality-evaluation.json'),result);console.log(JSON.stringify(result.overall,null,2));
      }
      else if(command==='export'){store.acquireLock();await exportAccepted(store,config.profiles);console.log(join(config.output,'catalog.json'));}
      else if(command==='coverage'){store.acquireLock();const coverage=await exportCoverage(store,config.profiles);console.log(JSON.stringify({totals:coverage.totals,viewport:coverage.viewport,gaps:coverage.gaps},null,2));console.log(join(config.output,'coverage.json'));}
      else if(command==='prune'){store.acquireLock();console.log(await pruneQuarantine(store,Number(flags.get('--older-than-days')??config.quality?.quarantineDays??30),config.profiles));}
      else if(command==='report'){store.acquireLock();await exportCatalog(store);console.log(join(config.output,'report.html'));}
      else{const jobs=store.jobs();console.table(jobs.map(j=>({stage:j.stage,status:j.status,attempts:j.attempts,source:j.key,reason:j.error ?? j.stoppingReason ?? ''})));console.log(`${store.captures().filter(c=>c.manifest).length} published capture versions.`);}
    }finally{store.close();}return;
  }
  const limit=flags.has('--limit')?Number(flags.get('--limit')):undefined;
  if(limit!==undefined && (!Number.isInteger(limit)||limit<1))throw new Error('--limit must be a positive integer.');
  if(config.classifier.runner==='mcp') {
    const port=Number(flags.get('--port')??4317);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Port must be an integer from 1024 to 65535.');
    const server=await serveBridgeHttp(config,port,{startOptions:{...(limit?{limit}:{}),...(flags.has('--source')?{source:String(flags.get('--source'))}:{})},
      runOptions:{refresh:command==='refresh'||flags.has('--refresh'),classifyOnly:command==='classify'||command==='reassess',reassess:command==='reassess'}});
    console.log(`Folio engine: http://127.0.0.1:${port}/mcp. Keep this terminal open.`);
    console.log('Classifier: NOT PAIRED. Collection is blocked until the ChatGPT plugin completes get_context and start_run.');
    console.log('In ordinary ChatGPT Desktop Chat, select @Folio Capture and say: Start Folio and continue its collection/review loop until done.');
    console.log('Saved reviews are processed first; collection waits for validated judgments. This engine never starts Codex or calls a model API.');
    const stop=()=>{void new Workflow(config).shutdown().finally(()=>server.close());};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  const controller=new AbortController();
  const interrupt=()=>controller.abort(new Error('Interrupted by user'));
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
    console.log('Classifier: Codex CLI');
    const summary=await runPipeline(config,{refresh:command==='refresh'||flags.has('--refresh'),retry:command==='retry',classifyOnly:command==='classify'||command==='reassess',reassess:command==='reassess',source:flags.has('--source')?String(flags.get('--source')):undefined,limit,signal:controller.signal});
    console.log(JSON.stringify(summary,null,2));console.log(`Catalog: ${join(config.output,'catalog.json')}`);
    if(summary.interrupted)process.exitCode=130;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(errorMessage(error));process.exitCode=1;});
