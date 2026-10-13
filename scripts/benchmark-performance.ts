import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Store } from '../src/store.ts';
import { parseConfig, DEFAULT_PROFILES } from '../src/config.ts';
import { exportAccepted } from '../src/catalog.ts';
import { buildCoverage } from '../src/coverage.ts';
import { runPipeline } from '../src/pipeline.ts';
import { referenceSubjects, subjectImageId, type ReferenceRecord } from '../src/references.ts';
import { TAXONOMY, TAXONOMY_VERSION, TAXONOMY_FINGERPRINT } from '../src/taxonomy.ts';
import { SCOPED_PROMPT_VERSION, RUBRIC_VERSION } from '../src/quality.ts';
import type { PageManifest, ViewportCapture, Region, Label } from '../src/types.ts';

const args=process.argv.slice(2);
const option=(name:string,fallback:string)=>args.includes(name)?args[args.indexOf(name)+1]!:fallback;
const mode=option('--case','catalog'),tag=option('--tag','sample'),pages=Number(option('--pages','20'));
if(!['catalog','images','capture'].includes(mode) || !/^[a-z0-9-]+$/i.test(tag) || !Number.isInteger(pages) || pages<1 || pages>200)throw new Error('Invalid benchmark options');
const root=resolve('.cache','performance',`${tag}-${mode}-${randomUUID().slice(0,8)}`);
await mkdir(root,{recursive:true});
const mb=(n:number)=>Math.round(n/1024/1024*100)/100;
const median=(numbers:number[])=>[...numbers].sort((a,b)=>a-b)[Math.floor(numbers.length/2)];
async function measure<T>(name:string,fn:()=>Promise<T>|T) {
  globalThis.gc?.();const memory=process.memoryUsage();const cpu=process.cpuUsage();const started=performance.now();
  const value=await fn();
  const elapsed=performance.now()-started,used=process.cpuUsage(cpu),after=process.memoryUsage();
  return {value,metrics:{name,wallMs:Math.round(elapsed),cpuMs:Math.round((used.user+used.system)/1000),heapDeltaMB:mb(after.heapUsed-memory.heapUsed),rssMB:mb(after.rss),nodePeakRssMB:mb(process.resourceUsage().maxRSS*1024)}};
}
const observations:unknown[]=[];

if(mode==='catalog') {
  const store=new Store(root);store.acquireLock();
  try {
    const bytes=await sharp({create:{width:40,height:40,channels:3,background:'#abcdef'}}).png().toBuffer();
    const thumbnail=await sharp(bytes).webp().toBuffer(),digest=createHash('sha256').update(bytes).digest('hex');
    const text='Synthetic DOM evidence for performance measurement only. '.repeat(240);
    for(let n=0;n<pages;n++) {
      const page=store.page(`https://performance.invalid/page-${n}`),captureId=`fixture-${n}`,directory=`captures/${page.id}/${captureId}`;
      const variants:ViewportCapture[]=[];
      await mkdir(join(root,directory),{recursive:true});
      for(const profile of DEFAULT_PROFILES) {
        const regions:Region[]=[];
        for(let order=0;order<6;order++) {
          const id=`${profile.id}-${order}`,path=`${id}.png`,thumb=`${id}.webp`,bounds={x:0,y:order*400,width:profile.width,height:400};
          await writeFile(join(root,directory,path),bytes);await writeFile(join(root,directory,thumb),thumbnail);
          regions.push({id,order,title:`Region ${order}`,selector:`section:nth-of-type(${order+1})`,bounds,captureBounds:bounds,method:'semantic',boundaryConfidence:'high',evidenceIds:[`${id}-dom`],
            frames:[{path,thumbnail:thumb,width:40,height:40,sha256:digest,bounds,scrollY:bounds.y,kind:'static'}]});
        }
        variants.push({profile,status:'complete',requestedUrl:page.url,finalUrl:page.url,title:'Synthetic fixture',capturedAt:new Date().toISOString(),pageHeight:2400,regions,
          evidence:regions.map(r=>({id:`${r.id}-dom`,regionId:r.id,kind:'region-dom',value:{text}})),warnings:[],interventions:[],coverage:[{start:0,end:2400}],stoppingReason:'covered',environment:{benchmark:true}});
      }
      const manifest:PageManifest={schemaVersion:1,pageId:page.id,captureId,captureSignature:'benchmark',requestedUrl:page.url,title:'Synthetic fixture',capturedAt:new Date().toISOString(),status:'complete',reviewStatus:'unreviewed',
        provenance:[{seedUrl:'https://performance.invalid',sourceLabels:['Minimalism','Newsprint'],discoveredAt:new Date().toISOString()}],variants};
      store.createCapture(page,'benchmark',directory,'unused',captureId);store.publishCapture(manifest,directory);
      store.db.exec('BEGIN IMMEDIATE');
      try {
        for(const subject of referenceSubjects(manifest)) {
          const inspectedImages=subject.frames.map(f=>subjectImageId(subject,f));
          const labels:Label[]=Object.keys(TAXONOMY).filter(a=>subject.scope==='page'?a!=='section_purpose':!['experience','page_purpose','industry','audience'].includes(a)).map(axis=>({axis:axis as Label['axis'],
            label:axis==='visual_style'?'minimalism':axis==='appearance'?'clean':axis==='section_purpose'?'hero':'unknown',regionId:subject.regionId??null,
            evidenceIds:axis==='visual_style'||axis==='appearance'||axis==='section_purpose'?[inspectedImages[0]]:[],provenance:'model',confidence:'high',note:'Synthetic fixture, not a model judgment',...(axis==='visual_style'?{role:'primary' as const}:{})}));
          const record:ReferenceRecord={schemaVersion:2,subject,directory,sourceUrl:page.url,
            quality:{schemaVersion:2,subjectId:subject.id,cacheKey:'benchmark',rubricVersion:RUBRIC_VERSION,verdict:'accepted',assessedAt:new Date().toISOString(),experimental:true,reasons:['Synthetic contract fixture only'],model:'fixture-no-model',reasoning:'none',reportedModels:[],inspectedImages},
            classification:{taxonomyVersion:TAXONOMY_VERSION,taxonomyFingerprint:TAXONOMY_FINGERPRINT,promptVersion:SCOPED_PROMPT_VERSION,cacheKey:'benchmark',model:'fixture-no-model',classifiedAt:new Date().toISOString(),labels,inspectedImages}};
          store.saveReference(record);
        }
        store.db.exec('COMMIT');
      }catch(error){store.db.exec('ROLLBACK');throw error;}
    }
    let captureReads=0,referenceReads=0,manifestReads=0;
    const capture=store.capture.bind(store),references=store.references.bind(store),latest=store.latestCaptures.bind(store);
    store.capture=id=>{captureReads++;return capture(id);};store.references=id=>{referenceReads++;return references(id);};store.latestCaptures=()=>{manifestReads++;return latest();};
    const coverage=await measure('coverage',()=>buildCoverage(store));observations.push(coverage.metrics);
    const exported=await measure('accepted-export',()=>exportAccepted(store));observations.push(exported.metrics);
    observations.push({pages,references:exported.value.references.length,captureReads,referenceReads,manifestReads,catalogBytes:(await stat(join(root,'catalog.json'))).size});
  }finally{store.close();}
}

if(mode==='images') {
  const svg=Buffer.from(`<svg width="2880" height="2000" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#1c2044"/><stop offset="1" stop-color="#889bcd"/></linearGradient></defs><rect width="2880" height="2000" fill="url(#g)"/>${Array.from({length:90},(_,i)=>`<rect x="${i%9*310+20}" y="${Math.floor(i/9)*190+20}" rx="25" width="280" height="160" fill="#fff" opacity=".7"/><text x="${i%9*310+40}" y="${Math.floor(i/9)*190+105}" font-size="28">Design reference ${i}</text>`).join('')}</svg>`);
  let state=12345;const raw=Buffer.alloc(2880*2000*3);for(let i=0;i<raw.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;raw[i]=state>>>24;}
  const inputs=[{name:'gradient-ui',buffer:await sharp(svg).png().toBuffer()},
    {name:'textured-media',buffer:await sharp(raw,{raw:{width:2880,height:2000,channels:3}}).blur(1).png().toBuffer()}];
  for(const input of inputs) {
    const rows:Record<string,Array<{wallMs:number;cpuMs:number;pngBytes:number;webpBytes:number}>>={};
    for(let trial=0;trial<4;trial++)for(const [compressionLevel,effort] of [[6,4],[3,3],[1,2]].slice(trial%3).concat([[6,4],[3,3],[1,2]].slice(0,trial%3))) {
      const result=await measure('encode',async()=>{
        const png=await sharp(input.buffer).extract({left:0,top:200,width:2880,height:1200}).png({compressionLevel}).toBuffer();
        const webp=await sharp(png).resize({width:480,withoutEnlargement:true}).webp({quality:85,effort}).toBuffer();return {png,webp};
      });
      if(trial===0)continue; // warm each candidate before recording.
      const key=`png-${compressionLevel}-webp-${effort}`;rows[key]??=[];rows[key].push({wallMs:result.metrics.wallMs,cpuMs:result.metrics.cpuMs,pngBytes:result.value.png.length,webpBytes:result.value.webp.length});
    }
    observations.push({input:input.name,candidates:Object.fromEntries(Object.entries(rows).map(([key,samples])=>[key,{medianWallMs:median(samples.map(s=>s.wallMs)),medianCpuMs:median(samples.map(s=>s.cpuMs)),pngBytes:samples[0].pngBytes,webpBytes:samples[0].webpBytes,samples}]))});
  }
}

if(mode==='capture') {
  const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Performance fixture</title><style>body{margin:0;font-family:Arial}section{min-height:500px;padding:48px;box-sizing:border-box}h1{font-size:72px}h2{font-size:40px}section:nth-child(even){background:linear-gradient(120deg,#eff2ff,#889acd)}@media(max-width:600px){section{padding:24px}h1{font-size:40px}}</style><main><section><h1>Performance fixture</h1><p>Static, readable, local content.</p></section><section><h2>Features</h2><p>Faithful capture with neighboring context.</p></section><section><h2>Frequently asked questions</h2><p>All profiles preserve readable text.</p></section></main>`);});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  try {
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
    const config=parseConfig({output:root,sources:[url],classifier:{runner:'none'}});
    let contexts=0,screenshots=0;
    const result=await measure('six-profile-capture',()=>runPipeline(config,{captureOnly:true,log:()=>{},launchBrowser:async()=>{
      const browser=await chromium.launch({headless:true,channel:'chromium'});
      return new Proxy(browser,{get(target,key){if(key==='newContext')return async(...args:any[])=>{
        contexts++;const context=await target.newContext(...args);
        const newPage=context.newPage.bind(context);context.newPage=async()=>{const page=await newPage();const screenshot=page.screenshot.bind(page);page.screenshot=async(...args)=>{screenshots++;return screenshot(...args);};return page;};return context;
      };const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    }}));
    observations.push(result.metrics,result.value,{contexts,screenshots});
  }finally{await new Promise<void>((done,error)=>server.close(e=>e?error(e):done()));}
}
const report={schemaVersion:1,case:mode,tag,node:process.version,platform:process.platform,arch:process.arch,
  hardware:{cpu:cpus()[0]?.model.trim(),logicalCpus:cpus().length,totalMemoryMB:mb(totalmem())},sharp:sharp.versions,
  note:'Local deterministic fixtures only; no public sites or model calls. Memory and CPU describe the Node process, excluding Chromium children. Synthetic acceptance is not aesthetic accuracy.',observations};
await writeFile(join(root,'benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,...report},null,2));
