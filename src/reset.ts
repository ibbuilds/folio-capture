import {lstat,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute,parse,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Store} from './store.ts';
import {inside} from './utils.ts';
import {trustedAsset} from './quality.ts';

const directories=['captures','.staging','exports','categories','review','reports'];
const files=['index.json','catalog.json','coverage.json','quarantine.json','file-views.json','quality-evaluation.json','report.html'];
const marker='.folio-reset.json';
function contains(parent:string,child:string){const path=relative(parent,child);return !path || !path.startsWith('..')&&!isAbsolute(path);}

/** Explicit destructive maintenance: erase generated artifacts and all persistent collection history.
 * Preserve configuration/unrelated files; hold the writer lock and block access after interruption. */
export async function resetOutput(output:string,configPath:string,afterRemoval?:()=>Promise<void>){
  const root=resolve(output),project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),config=resolve(configPath);
  if(root===parse(root).root || contains(root,project) || contains(root,process.cwd()) || contains(root,config))throw new Error('Reset requires a dedicated output folder outside the repository/configuration ancestors. Nothing deleted.');
  for(let current=root;;current=dirname(current)){
    try{if((await lstat(current)).isSymbolicLink())throw new Error('Linked output paths cannot be reset. Nothing deleted.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(current===dirname(current))break;
  }
  try{if((await lstat(root)).isSymbolicLink())throw new Error('Linked output folders cannot be reset. Nothing deleted.');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {output:root,reset:true,removed:[],preserved:[]};throw error;}
  const entries=await readdir(root);
  if(!entries.includes('state.sqlite')){
    if(entries.some(name=>directories.includes(name)||files.includes(name)))throw new Error('Output has artifacts but no Folio registry. Nothing deleted.');
    return {output:root,reset:true,removed:[],preserved:entries};
  }
  await trustedAsset(root,'state.sqlite');
  for(const name of ['state.sqlite-wal','state.sqlite-shm',marker]){
    try{await trustedAsset(root,name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  const existing=new DatabaseSync(join(root,'state.sqlite'),{readOnly:true,timeout:1000});
  try{
    const tables=new Set(existing.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
    if(!['meta','jobs','pages','captures'].every(table=>tables.has(table)) || existing.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value!=='1')throw new Error('This is not a supported Folio registry. Nothing deleted.');
  }finally{existing.close();}
  const store=new Store(root,{resetting:true});
  try{
    store.assertWorkflowAccess();store.acquireLock();store.assertNoEngines();
    const names=entries.filter(name=>directories.includes(name)||files.includes(name)||files.some(file=>name.startsWith(`${file}.`)&&/\.[a-f0-9-]{36}\.tmp$/.test(name)));
    // Validate every absolute deletion target before the first removal. Root links are refused.
    for(const name of names){const target=await trustedAsset(root,name);if(!contains(root,target)||target===root)throw new Error('Unsafe reset target. Nothing deleted.');}
    try{await writeFile(join(root,marker),JSON.stringify({output:root,startedAt:new Date().toISOString()}),{flag:'wx'});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await trustedAsset(root,marker);}
    for(const name of names){await rm(inside(root,name),{recursive:directories.includes(name),force:true,maxRetries:3});await afterRemoval?.();}
    store.resetRegistry();
    await rm(join(root,marker));
    return {output:root,reset:true,removed:names,registry:'empty',preserved:entries.filter(name=>!names.includes(name)&&!name.startsWith('state.sqlite')&&name!==marker)};
  }finally{store.close();}
}
