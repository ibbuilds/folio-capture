import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { JobStatus, PageManifest, Provenance, Classification } from './types.ts';
import { canonicalUrl, idFor, now } from './utils.ts';
import type { ReferenceRecord } from './references.ts';
import { pageFolder } from './naming.ts';
import { databaseName } from './output-paths.ts';

export type Job = { id: string; stage: string; key: string; status: JobStatus; attempts: number; payload: any; result: any; error: string | null; stoppingReason: string | null; createdAt: string; updatedAt: string };
export type PageRecord = { id: string; url: string; provenance: Provenance[]; latestCaptureId: string | null };
export type CaptureRecord = { id: string; pageId: string; signature: string; directory: string; stagingDirectory: string | null; status: string; createdAt: string; manifest: PageManifest | null; classification: Classification | null };

export class Store {
  readonly db: DatabaseSync;
  readonly output: string;
  private lockToken: string | undefined;
  constructor(output: string, options:{resetting?:boolean;organizing?:boolean}={}) {
    this.output = output;
    if(!options.resetting && existsSync(join(output,'.folio-reset.json')))throw new Error('A collection reset was interrupted. Stop Folio and finish npm run clean before using this output.');
    if(!options.organizing && existsSync(join(output,'.folio-organize.json')))throw new Error('Output organization was interrupted. Finish npm run folio -- organize before using this output.');
    mkdirSync(output, { recursive: true });
    const filename=join(output,databaseName(output));mkdirSync(dirname(filename),{recursive:true});
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, stage TEXT NOT NULL, job_key TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, result TEXT, error TEXT, stopping_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(stage,job_key));
      CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, provenance TEXT NOT NULL, latest_capture_id TEXT);
      CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id), signature TEXT NOT NULL, directory TEXT NOT NULL, staging_directory TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, manifest TEXT, classification TEXT);
      CREATE INDEX IF NOT EXISTS jobs_stage_status ON jobs(stage,status);
      CREATE INDEX IF NOT EXISTS captures_page_signature ON captures(page_id,signature,created_at);
      CREATE TABLE IF NOT EXISTS reference_records (id TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES captures(id), record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS references_capture ON reference_records(capture_id);
      CREATE INDEX IF NOT EXISTS pages_latest_capture ON pages(latest_capture_id);
      CREATE TABLE IF NOT EXISTS page_urls (url TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id), reason TEXT NOT NULL, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (sha256 TEXT PRIMARY KEY, path TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS page_folders (page_id TEXT PRIMARY KEY REFERENCES pages(id), directory TEXT UNIQUE NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('schema_version','1')").run();
    if(!this.db.prepare("SELECT value FROM meta WHERE key='page_urls_migrated'").get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of this.db.prepare('SELECT id,url FROM pages ORDER BY rowid').iterate()) {
          this.db.prepare('INSERT OR IGNORE INTO page_urls VALUES (?,?,?,?)').run(canonicalUrl(String(row.url)),String(row.id),'supplied',now());
        }
        this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('page_urls_migrated','1')").run();this.db.exec('COMMIT');
      } catch(error) {this.db.exec('ROLLBACK');throw error;}
    }
  }
  acquireLock() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare("SELECT value FROM meta WHERE key='runtime_lock'").get() as { value: string } | undefined;
      if (row) {
        const owner = JSON.parse(row.value) as { pid: number };
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        if (alive) throw new Error(`Another Folio Capture run owns this output folder (PID ${owner.pid}).`);
      }
      this.lockToken = randomUUID();
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('runtime_lock',?)").run(JSON.stringify({ pid: process.pid, token: this.lockToken, acquiredAt: now() }));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  releaseLock() {
    if (!this.lockToken) return;
    this.db.prepare("DELETE FROM meta WHERE key='runtime_lock' AND json_extract(value,'$.token')=?").run(this.lockToken);
    this.lockToken = undefined;
  }
  close() { this.releaseLock(); this.db.close(); }
  registerEngine() {
    this.acquireLock();
    try{const key=`engine:${randomUUID()}`;this.db.prepare('INSERT INTO meta VALUES (?,?)').run(key,JSON.stringify({pid:process.pid}));return key;}
    finally{this.releaseLock();}
  }
  unregisterEngine(key:string){this.db.prepare('DELETE FROM meta WHERE key=?').run(key);}
  assertNoEngines() {
    for(const row of this.db.prepare("SELECT value FROM meta WHERE key LIKE 'engine:%'").all()){
      const owner=JSON.parse(String(row.value));
      try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')continue;throw error;}
      throw new Error('Stop the Folio engine/bridge with Ctrl+C before resetting its output.');
    }
  }
  resetRegistry() {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.exec("DELETE FROM reference_records; DELETE FROM captures; DELETE FROM page_folders; DELETE FROM page_urls; DELETE FROM pages; DELETE FROM assets; DELETE FROM jobs; DELETE FROM meta WHERE key NOT IN ('schema_version','runtime_lock');");
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    this.db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  }
  recoverRunning() {
    return this.db.prepare("UPDATE jobs SET status='pending', error='Recovered after interrupted run', updated_at=? WHERE status='running' AND stage!='workflow'").run(now()).changes;
  }
  assertWorkflowAccess(runId?: string) {
    const active=this.getJob('workflow','active');
    if(active?.status!=='running')return;
    if(active.payload.runId===runId && active.payload.ownerPid===process.pid)return;
    try { process.kill(active.payload.ownerPid,0); }
    catch(error) { if((error as NodeJS.ErrnoException).code==='ESRCH')return; }
    throw new Error('An automatic Folio workflow owns collection. Use its ChatGPT loop or stop_run before starting another collector.');
  }
  requirePairedWorkflow(runId?:string) {
    const active=this.getJob('workflow','active');
    const client=active?this.getJob('mcp-client',active.payload.clientId):undefined;
    if(!runId || active?.status!=='running' || active.payload.runId!==runId || active.payload.ownerPid!==process.pid || client?.status!=='complete' || client.payload.runId!==runId)throw new Error('MCP collection requires the local bridge paired to an active classifier chat. Start the engine, then get_context and start_run in that chat. No collection started.');
  }
  folder(page:PageRecord):string {
    const known=this.db.prepare('SELECT directory FROM page_folders WHERE page_id=?').get(page.id) as {directory:string}|undefined;
    if(known){const directory=known.directory.replace(/^captures\//,'.folio/captures/');if(directory!==known.directory)this.db.prepare('UPDATE page_folders SET directory=? WHERE page_id=?').run(directory,page.id);return directory;}
    const base=pageFolder(page.url);let directory=base,ordinal=1;
    while(this.db.prepare('SELECT page_id FROM page_folders WHERE directory=? OR directory=?').get(directory,directory.replace(/^\.folio\/captures\//,'captures/')))directory=`${base}--${++ordinal}`;
    this.db.prepare('INSERT INTO page_folders VALUES (?,?)').run(page.id,directory);return directory;
  }
  relocateCapture(captureId:string,from:string,to:string,stagingDirectory:string|null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE captures SET directory=?,staging_directory=? WHERE id=?').run(to,stagingDirectory,captureId);
      for(const reference of this.references(captureId)) {
        reference.directory=to;
        if(reference.pruned)reference.pruned.paths=reference.pruned.paths.map(path=>path.startsWith(`${from}/`)?`${to}${path.slice(from.length)}`:path);
        this.db.prepare('UPDATE reference_records SET record=? WHERE id=?').run(JSON.stringify(reference),reference.subject.id);
      }
      const aliases=this.db.prepare('SELECT sha256,path FROM assets WHERE substr(path,1,?)=?').all(from.length+1,`${from}/`);
      for(const row of aliases)this.saveAsset(String(row.sha256),`${to}${String(row.path).slice(from.length)}`);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  asset(sha256:string):string|undefined {return (this.db.prepare('SELECT path FROM assets WHERE sha256=?').get(sha256) as {path:string}|undefined)?.path;}
  saveAsset(sha256:string,path:string) {this.db.prepare('INSERT OR REPLACE INTO assets VALUES (?,?)').run(sha256,path);}
  pageForUrl(url:string):PageRecord|undefined {
    const row=this.db.prepare('SELECT p.* FROM pages p JOIN page_urls u ON u.page_id=p.id WHERE u.url=?').get(canonicalUrl(url)) as any;
    return row?{id:row.id,url:row.url,provenance:JSON.parse(row.provenance),latestCaptureId:row.latest_capture_id??null}:undefined;
  }
  rememberRedirect(pageId:string,finalUrl:string):boolean {
    const existing=this.pageForUrl(finalUrl);
    if(existing && existing.id!==pageId)return false; // Never overwrite another page's history.
    this.db.prepare('INSERT OR IGNORE INTO page_urls VALUES (?,?,?,?)').run(canonicalUrl(finalUrl),pageId,'observed_redirect',now());
    return true;
  }
  aliasUncapturedPage(pageId:string,destination:string):boolean {
    const target=this.pageForUrl(destination);
    const original=this.db.prepare('SELECT latest_capture_id FROM pages WHERE id=?').get(pageId);
    if(!target || !original || original.latest_capture_id || target.id===pageId)return false;
    this.db.prepare("UPDATE page_urls SET page_id=?,reason='observed_redirect',observed_at=? WHERE page_id=?").run(target.id,now(),pageId);
    return true;
  }
  abandonDuplicateCapture(captureId:string) {this.db.prepare("UPDATE captures SET status='duplicate',staging_directory=NULL WHERE id=? AND status='running'").run(captureId);}
  job(stage: string, key: string, payload: unknown): Job {
    const timestamp = now();
    this.db.prepare('INSERT INTO jobs(id,stage,job_key,status,payload,created_at,updated_at) VALUES (?,?,?,\'pending\',?,?,?) ON CONFLICT(stage,job_key) DO UPDATE SET payload=excluded.payload').run(idFor([stage,key]),stage,key,JSON.stringify(payload),timestamp,timestamp);
    return this.getJob(stage,key)!;
  }
  queueJobs(stage:string, entries:Array<{key:string;payload:unknown}>):void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const entry of entries)this.job(stage,entry.key,entry.payload);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  getJob(stage: string, key: string): Job | undefined { return this.decodeJob(this.db.prepare('SELECT * FROM jobs WHERE stage=? AND job_key=?').get(stage,key)); }
  jobs(stage?: string, statuses?: JobStatus[]): Job[] {
    if(statuses && !statuses.length)return [];
    const where:string[]=[],parameters:string[]=[];
    if(stage){where.push('stage=?');parameters.push(stage);}
    if(statuses){where.push(`status IN (${statuses.map(()=>'?').join(',')})`);parameters.push(...statuses);}
    const rows=this.db.prepare(`SELECT * FROM jobs ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY created_at,id`).iterate(...parameters);
    return Array.from(rows,row=>this.decodeJob(row)!);
  }
  start(job: Job) { this.db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, error=NULL, updated_at=? WHERE id=?").run(now(),job.id); }
  finish(job: Job, status: JobStatus, result?: unknown, error?: string, stoppingReason?: string) {
    this.db.prepare('UPDATE jobs SET status=?,result=?,error=?,stopping_reason=?,updated_at=? WHERE id=?').run(status,result === undefined ? null : JSON.stringify(result),error ?? null,stoppingReason ?? null,now(),job.id);
  }
  retryFailures(stages?: string[]) {
    for (const job of this.jobs().filter(j => ['failed','incomplete','blocked'].includes(j.status) && (!stages || stages.includes(j.stage)))) this.finish(job,'pending',job.result);
  }
  supersedeCaptureJobs(pageId:string,sourceUrl:string,currentKey:string,captureId:string) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const job of this.jobs('capture',['pending','running']))if(job.payload.pageId===pageId&&job.payload.source?.url===sourceUrl&&job.key!==currentKey&&/^[a-f0-9]{64}$/.test(job.key.split(':').at(-1)!)){
        const obsolete=this.db.prepare("SELECT id FROM captures WHERE page_id=? AND signature=? AND status='running'").all(pageId,job.key.split(':').at(-1)!);
        for(const row of obsolete){
          this.db.prepare("UPDATE captures SET status='superseded' WHERE id=?").run(row.id);
          for(const viewport of this.jobs('viewport',['pending','running']))if(viewport.payload.captureId===row.id)this.finish(viewport,'complete',viewport.result,undefined,'capture_profile_superseded');
        }
        this.finish(job,'complete',{captureId,supersededBy:currentKey},undefined,'capture_profile_superseded');
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  page(url: string, provenance?: Provenance): PageRecord {
    const canonical = canonicalUrl(url);
    const known=this.pageForUrl(canonical);
    const existing = known ? this.db.prepare('SELECT * FROM pages WHERE id=?').get(known.id) as any : undefined;
    const origins: Provenance[] = existing ? JSON.parse(existing.provenance) : [];
    if (provenance && !origins.some(p => p.seedUrl === provenance.seedUrl && p.detailUrl === provenance.detailUrl && p.listingUrl === provenance.listingUrl)) origins.push(provenance);
    const id = existing?.id ?? idFor(canonical);
    this.db.prepare('INSERT INTO pages(id,url,provenance) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET provenance=excluded.provenance').run(id,existing?.url??canonical,JSON.stringify(origins));
    this.db.prepare('INSERT OR IGNORE INTO page_urls VALUES (?,?,?,?)').run(canonical,id,'supplied',now());
    return { id, url: existing?.url??canonical, provenance: origins, latestCaptureId: existing?.latest_capture_id ?? null };
  }
  pages(): PageRecord[] { return this.db.prepare('SELECT * FROM pages ORDER BY id').all().map((r:any)=>({id:r.id,url:r.url,provenance:JSON.parse(r.provenance),latestCaptureId:r.latest_capture_id})); }
  createCapture(page: PageRecord, signature: string, directory: string, stagingDirectory: string, id: string) {
    this.db.prepare('INSERT INTO captures(id,page_id,signature,directory,staging_directory,status,created_at) VALUES (?,?,?,?,?,\'running\',?)').run(id,page.id,signature,directory,stagingDirectory,now());
  }
  publishCapture(manifest: PageManifest, directory: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE captures SET directory=?,staging_directory=NULL,status=?,manifest=? WHERE id=?').run(directory,manifest.status,JSON.stringify(manifest),manifest.captureId);
      this.db.prepare('UPDATE pages SET latest_capture_id=? WHERE id=?').run(manifest.captureId,manifest.pageId);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  saveClassification(captureId: string, result: Classification) { this.db.prepare('UPDATE captures SET classification=? WHERE id=?').run(JSON.stringify(result),captureId); }
  saveReference(record: ReferenceRecord) {
    this.db.prepare('INSERT INTO reference_records(id,capture_id,record) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record')
      .run(record.subject.id, record.subject.captureId, JSON.stringify(record));
  }
  references(captureId?: string): ReferenceRecord[] {
    const rows = captureId ? this.db.prepare('SELECT record FROM reference_records WHERE capture_id=? ORDER BY id').iterate(captureId)
      : this.db.prepare('SELECT record FROM reference_records ORDER BY id').iterate();
    return Array.from(rows,row => JSON.parse(String(row.record)) as ReferenceRecord);
  }
  reference(id:string):ReferenceRecord|undefined {
    const row=this.db.prepare('SELECT record FROM reference_records WHERE id=?').get(id);
    return row?JSON.parse(String(row.record)) as ReferenceRecord:undefined;
  }
  /** Read-only export projection. Never save it over the full evidence/history record. */
  exportReferences():ReferenceRecord[] {
    const rows=this.db.prepare(`SELECT json_set(json_remove(record,'$.classificationHistory','$.qualityHistory'),
      '$.subject.evidence',json('[]')) AS record FROM reference_records
      WHERE capture_id IN (SELECT latest_capture_id FROM pages) ORDER BY id`).iterate();
    return Array.from(rows,row=>JSON.parse(String(row.record)) as ReferenceRecord);
  }
  /** Export/counting needs geometry and provenance, not DOM text duplicated in each viewport. */
  exportCaptures():CaptureRecord[] {
    const rows=this.db.prepare(`SELECT c.id,c.page_id,c.signature,c.directory,c.staging_directory,c.status,c.created_at,c.classification,
      json_set(c.manifest,'$.variants',json((SELECT json_group_array(json_set(value,'$.evidence',json('[]')))
        FROM json_each(c.manifest,'$.variants')))) AS manifest
      FROM captures c JOIN pages p ON p.latest_capture_id=c.id WHERE c.manifest IS NOT NULL ORDER BY c.created_at,c.id`).iterate();
    return Array.from(rows,row=>this.decodeCapture(row));
  }
  quarantineInventory():Array<{id:string;verdict:string;reasons:string[];pruned:ReferenceRecord['pruned']|null}> {
    const rows=this.db.prepare(`SELECT json_object('id',json_extract(record,'$.subject.id'),
      'verdict',json_extract(record,'$.quality.verdict'),'reasons',json(json_extract(record,'$.quality.reasons')),
      'pruned',json(json_extract(record,'$.pruned'))) AS record FROM reference_records
      WHERE json_extract(record,'$.quality.verdict')!='accepted' ORDER BY id`).iterate();
    return Array.from(rows,row=>JSON.parse(String(row.record)));
  }
  captures(): CaptureRecord[] { return this.db.prepare('SELECT * FROM captures ORDER BY created_at,id').all().map(r=>this.decodeCapture(r)); }
  latestCaptures(): CaptureRecord[] { return this.db.prepare('SELECT c.* FROM captures c JOIN pages p ON p.latest_capture_id=c.id ORDER BY c.created_at,c.id').all().map(r=>this.decodeCapture(r)); }
  capture(id: string): CaptureRecord | undefined { const row=this.db.prepare('SELECT * FROM captures WHERE id=?').get(id);return row?this.decodeCapture(row):undefined; }
  inProgressCapture(pageId:string,signature:string):CaptureRecord|undefined {const row=this.db.prepare("SELECT * FROM captures WHERE page_id=? AND signature=? AND status='running' ORDER BY created_at DESC LIMIT 1").get(pageId,signature);return row?this.decodeCapture(row):undefined;}
  latestUsable(pageId: string, signature: string, freshnessDays: number): CaptureRecord | undefined {
    const cutoff = new Date(Date.now() - freshnessDays * 86400000).toISOString();
    const row=this.db.prepare("SELECT * FROM captures WHERE page_id=? AND signature=? AND status='complete' AND created_at>=? ORDER BY created_at DESC LIMIT 1").get(pageId,signature,cutoff);
    return row?this.decodeCapture(row):undefined;
  }
  private decodeCapture(r:any):CaptureRecord{return {id:r.id,pageId:r.page_id,signature:r.signature,directory:r.directory,stagingDirectory:r.staging_directory,status:r.status,createdAt:r.created_at,manifest:r.manifest ? JSON.parse(r.manifest):null,classification:r.classification ? JSON.parse(r.classification):null};}
  private decodeJob(row: any): Job | undefined { return row ? { id:row.id,stage:row.stage,key:row.job_key,status:row.status,attempts:row.attempts,payload:JSON.parse(row.payload),result:row.result ? JSON.parse(row.result):null,error:row.error,stoppingReason:row.stopping_reason,createdAt:row.created_at,updatedAt:row.updated_at } : undefined; }
}
