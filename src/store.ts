import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JobStatus, PageManifest, Provenance, Classification } from './types.ts';
import { canonicalUrl, idFor, now } from './utils.ts';

export type Job = { id: string; stage: string; key: string; status: JobStatus; attempts: number; payload: any; result: any; error: string | null; stoppingReason: string | null; createdAt: string; updatedAt: string };
export type PageRecord = { id: string; url: string; provenance: Provenance[]; latestCaptureId: string | null };
export type CaptureRecord = { id: string; pageId: string; signature: string; directory: string; stagingDirectory: string | null; status: string; createdAt: string; manifest: PageManifest | null; classification: Classification | null };

export class Store {
  readonly db: DatabaseSync;
  private lockToken: string | undefined;
  constructor(readonly output: string) {
    mkdirSync(output, { recursive: true });
    this.db = new DatabaseSync(join(output, 'state.sqlite'), { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, stage TEXT NOT NULL, job_key TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, result TEXT, error TEXT, stopping_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(stage,job_key));
      CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, provenance TEXT NOT NULL, latest_capture_id TEXT);
      CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id), signature TEXT NOT NULL, directory TEXT NOT NULL, staging_directory TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, manifest TEXT, classification TEXT);
      CREATE INDEX IF NOT EXISTS jobs_stage_status ON jobs(stage,status);
      CREATE INDEX IF NOT EXISTS captures_page_signature ON captures(page_id,signature,created_at);
    `);
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('schema_version','1')").run();
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
  recoverRunning() {
    return this.db.prepare("UPDATE jobs SET status='pending', error='Recovered after interrupted run', updated_at=? WHERE status='running'").run(now()).changes;
  }
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
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY created_at,id').all();
    return rows.map(row => this.decodeJob(row)!).filter(j => (!stage || j.stage === stage) && (!statuses || statuses.includes(j.status)));
  }
  start(job: Job) { this.db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, error=NULL, updated_at=? WHERE id=?").run(now(),job.id); }
  finish(job: Job, status: JobStatus, result?: unknown, error?: string, stoppingReason?: string) {
    this.db.prepare('UPDATE jobs SET status=?,result=?,error=?,stopping_reason=?,updated_at=? WHERE id=?').run(status,result === undefined ? null : JSON.stringify(result),error ?? null,stoppingReason ?? null,now(),job.id);
  }
  retryFailures(stages?: string[]) {
    for (const job of this.jobs().filter(j => ['failed','incomplete','blocked'].includes(j.status) && (!stages || stages.includes(j.stage)))) this.finish(job,'pending',job.result);
  }
  page(url: string, provenance?: Provenance): PageRecord {
    const canonical = canonicalUrl(url);
    const existing = this.db.prepare('SELECT * FROM pages WHERE url=?').get(canonical) as any;
    const origins: Provenance[] = existing ? JSON.parse(existing.provenance) : [];
    if (provenance && !origins.some(p => p.seedUrl === provenance.seedUrl && p.detailUrl === provenance.detailUrl && p.listingUrl === provenance.listingUrl)) origins.push(provenance);
    const id = existing?.id ?? idFor(canonical);
    this.db.prepare('INSERT INTO pages(id,url,provenance) VALUES (?,?,?) ON CONFLICT(url) DO UPDATE SET provenance=excluded.provenance').run(id,canonical,JSON.stringify(origins));
    return { id, url: canonical, provenance: origins, latestCaptureId: existing?.latest_capture_id ?? null };
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
