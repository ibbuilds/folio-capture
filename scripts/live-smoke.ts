import { resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { runPipeline } from '../src/pipeline.ts';

const config=await loadConfig();
config.output=resolve('validation-output/live');
config.classifier.runner='mcp';
config.capture.maxAttempts=1;
config.capture.mediaTimeoutMs=5000;
config.capture.settleTimeoutMs=4000;
config.capture.attemptTimeoutMs=180000;
config.discovery.maxEntries=2;
if(process.argv.includes('--quick'))config.profiles=config.profiles.filter(p=>['desktop','tablet','mobile'].includes(p.id));
config.sources=[
  {url:'https://linear.app/',kind:'page'},
  {url:'https://vercel.com/',kind:'page'},
  {url:'https://www.flyhyer.com/',kind:'page'},
  {url:'https://styles.refero.design/',kind:'library'},
];
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort(new Error('Interrupted live validation')));
console.log(await runPipeline(config,{retry:process.argv.includes('--retry'),source:process.argv.find(a=>a.startsWith('--source='))?.slice(9),signal:controller.signal}));
