import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { PageManifest } from './types.ts';
import { sectionEvidenceIssues, type ReferenceRecord } from './references.ts';
import { runtimeOwnerAlive } from './runtime-owner.ts';
import { hasCurrentClassification } from './coverage.ts';
import { trustedAsset } from './quality.ts';
import { inside, canonicalUrl, errorMessage, now } from './utils.ts';
import { BRIDGE_CONTEXT_ID } from './bridge.ts';
import { databaseName, savedName } from './output-paths.ts';

type Issue = {
  severity: 'error' | 'warning';
  code: string;
  path?: string;
  subjectId?: string;
  message: string;
};
type Catalog = {
  schemaVersion: number;
  generation: string;
  references: Array<{
    id: string;
    captureId: string;
    images: Array<{
      path: string;
      thumbnail: string;
      sha256: string;
      width: number;
      height: number;
    }>;
  }>;
  indexes: Record<string, string>;
  exceptions: unknown[];
};
type Inventory = {
  files: Array<{ path: string; source?: string; sha256?: string }>;
  exceptions: unknown[];
};
const inventorySchema = z.object({
  files: z.array(
    z.object({ path: z.string(), source: z.string().optional(), sha256: z.string().optional() }),
  ),
  exceptions: z.array(z.unknown()),
});
const catalogSchema = z.object({
  schemaVersion: z.literal(2),
  generation: z.string(),
  references: z.array(
    z.object({
      id: z.string(),
      captureId: z.string(),
      images: z.array(
        z.object({
          path: z.string(),
          thumbnail: z.string(),
          sha256: z.string(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        }),
      ),
    }),
  ),
  indexes: z.record(z.string(), z.string()),
  exceptions: z.array(z.unknown()),
});
const indexSchema = z.object({
  schemaVersion: z.number().int(),
  references: z
    .array(z.object({ id: z.string(), quality: z.string(), classification: z.string() }))
    .optional(),
});
const categorySchema = z.object({ category: z.string(), referenceIds: z.array(z.string()) });

/** Opens a consistent read-only ledger snapshot. No recovery, collection, export or inference. */
export async function auditOutput(output: string) {
  const issues: Issue[] = [];
  const issue = (
    severity: Issue['severity'],
    code: string,
    message: string,
    extra: Partial<Issue> = {},
  ) => issues.push({ severity, code, message, ...extra });
  const db = new DatabaseSync(await trustedAsset(output, databaseName(output)), { readOnly: true });
  let captures: Array<{ id: string; directory: string; manifest: PageManifest }>,
    records: ReferenceRecord[],
    jobs: Array<{
      stage: string;
      status: string;
      key: string;
      payload: Record<string, unknown>;
      updatedAt: string;
    }>,
    pages: Array<{ id: string; url: string; captureId: string }>;
  try {
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA quick_check').all();
    if (integrity.some((row) => row.quick_check !== 'ok'))
      issue('error', 'ledger-integrity', JSON.stringify(integrity));
    captures = db
      .prepare('SELECT id,directory,manifest FROM captures WHERE manifest IS NOT NULL')
      .all()
      .map((row) => ({
        id: String(row.id),
        directory: String(row.directory),
        manifest: JSON.parse(String(row.manifest)),
      }));
    records = db
      .prepare('SELECT record FROM reference_records')
      .all()
      .map((row) => JSON.parse(String(row.record)));
    pages = db
      .prepare('SELECT id,url,latest_capture_id FROM pages')
      .all()
      .map((row) => ({
        id: String(row.id),
        url: String(row.url),
        captureId: String(row.latest_capture_id ?? ''),
      }));
    jobs = db
      .prepare('SELECT stage,status,job_key,payload,updated_at FROM jobs')
      .all()
      .map((row) => ({
        stage: String(row.stage),
        status: String(row.status),
        key: String(row.job_key),
        payload: JSON.parse(String(row.payload)),
        updatedAt: String(row.updated_at),
      }));
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  const latestIds = new Set(pages.map((p) => p.captureId));
  const current = records.filter((r) => latestIds.has(r.subject.captureId));
  const counts: Record<string, number> = {};
  for (const record of current) {
    const key =
      record.quality.verdict === 'accepted'
        ? hasCurrentClassification(record) && !record.pruned
          ? 'acceptedAndClassified'
          : 'classificationPending'
        : record.quality.verdict;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const hashes = new Map<
    string,
    { sha256: string; width?: number; height?: number; format?: string }
  >();
  const files = new Map<string, { identity: string; bytes: number }>(),
    identities = new Map<string, number>();
  let logicalBytes = 0,
    uniqueBytes = 0,
    jsonFiles = 0,
    imageFiles = 0;
  const checkedImages = new Set<string>();
  const scan = async (path: string) => {
    const absolute = inside(output, path),
      stats = await lstat(absolute, { bigint: true });
    if (stats.isSymbolicLink()) {
      issue('error', 'linked-output-path', 'Audit refuses a symbolic link or junction.', { path });
      return;
    }
    if (stats.isDirectory()) {
      for (const name of await readdir(absolute)) await scan(`${path}/${name}`);
      return;
    }
    if (!stats.isFile()) return;
    const identity = `${stats.dev}:${stats.ino}`,
      bytes = Number(stats.size);
    files.set(path, { identity, bytes });
    logicalBytes += bytes;
    if (!identities.has(identity)) {
      identities.set(identity, bytes);
      uniqueBytes += bytes;
    }
    const extension = extname(path).toLowerCase();
    try {
      if (extension === '.json') {
        JSON.parse(await readFile(await trustedAsset(output, path), 'utf8'));
        jsonFiles++;
      }
      if (['.png', '.webp'].includes(extension)) {
        imageFiles++;
        if (!hashes.has(identity)) {
          const bytes = await readFile(await trustedAsset(output, path));
          const metadata = await sharp(bytes).metadata();
          // metadata alone does not detect a truncated pixel stream.
          await sharp(bytes).stats();
          hashes.set(identity, {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
          });
        }
      }
    } catch (error) {
      issue('error', 'unreadable-artifact', errorMessage(error), { path });
    }
  };
  for (const name of [
    '.folio',
    'captures',
    'categories',
    'review',
    'exports',
    '.staging',
    'catalog.json',
    'index.json',
    'coverage.json',
    'quarantine.json',
    'file-views.json',
  ]) {
    try {
      await scan(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        issue('error', 'output-scan', errorMessage(error), { path: name });
    }
  }
  const prunedPaths = new Set(
    records.flatMap((r) => r.pruned?.paths ?? []).map((p) => inside(output, p)),
  );
  const checkImage = (
    path: string,
    expected?: { sha256: string; width: number; height: number },
  ) => {
    const file = files.get(path);
    if (!file) {
      if (!prunedPaths.has(inside(output, path)))
        issue('error', 'missing-image', 'Recorded image is missing.', { path });
      return;
    }
    const image = hashes.get(file.identity);
    if (!image) return;
    checkedImages.add(path);
    if (
      expected &&
      (image.sha256 !== expected.sha256 ||
        image.width !== expected.width ||
        image.height !== expected.height)
    )
      issue('error', 'image-contract', 'Image hash or dimensions differ from the manifest.', {
        path,
      });
    if (
      (extname(path) === '.png' && image.format !== 'png') ||
      (extname(path) === '.webp' && image.format !== 'webp')
    )
      issue('error', 'image-format', 'Encoded image format does not match its filename.', { path });
  };
  for (const capture of captures) {
    const savedPath = `${capture.directory}/manifest.json`;
    try {
      const saved = JSON.parse(await readFile(await trustedAsset(output, savedPath), 'utf8'));
      if (JSON.stringify(saved) !== JSON.stringify(capture.manifest))
        issue('error', 'manifest-ledger', 'Published manifest differs from the ledger.', {
          path: savedPath,
        });
    } catch (error) {
      issue('error', 'manifest-ledger', errorMessage(error), { path: savedPath });
    }
    for (const variant of capture.manifest.variants) {
      if (variant.overview) checkImage(`${capture.directory}/${variant.overview}`);
      for (const region of variant.regions) {
        for(const message of sectionEvidenceIssues(variant,region))issue('error','capture-evidence-mismatch',message,{path:`${capture.directory}/${region.frames[0]?.path??'manifest.json'}`,subjectId:region.id});
        for (const frame of region.frames) {
          checkImage(`${capture.directory}/${frame.path}`, frame);
          checkImage(`${capture.directory}/${frame.thumbnail}`);
        }
        if (
          region.method !== 'semantic' &&
          region.bounds.height > variant.profile.height * 2 &&
          region.frames.length > 2
        )
          issue(
            'warning',
            'uncertain-segmentation',
            'Several viewport states share one inferred region. They are not independently segmented design sections.',
            { path: savedPath, subjectId: region.id },
          );
        const staticFrames = region.frames.filter((f) => f.kind === 'static');
        for (let i = 1; i < staticFrames.length; i++) {
          const a = staticFrames[i - 1].bounds,
            b = staticFrames[i].bounds,
            overlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
          if (overlap / Math.min(a.height, b.height) > 0.75)
            issue(
              'warning',
              'repeated-static-tail',
              'Adjacent static captures overlap by more than 75%; a clamped page-bottom crop likely repeated content.',
              { path: `${capture.directory}/${staticFrames[i].path}` },
            );
        }
      }
    }
  }
  const destinations = new Map<string, string>();
  for (const page of pages.filter((p) => p.captureId)) {
    const key = canonicalUrl(page.url),
      previous = destinations.get(key);
    if (previous && previous !== page.id)
      issue('error', 'duplicate-destination', `Two current page identities use ${key}.`);
    destinations.set(key, page.id);
  }
  const readJson = async <T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> => {
    try {
      return schema.parse(JSON.parse(await readFile(await trustedAsset(output, path), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        issue('error', 'invalid-metadata', errorMessage(error), { path });
      return undefined;
    }
  };
  const inventory = await readJson<Inventory>(savedName(output,'file-views.json'), inventorySchema);
  let hardLinks = 0;
  for (const managed of inventory?.files ?? []) {
    const file = files.get(managed.path);
    if (!file) {
      issue('error', 'missing-view', 'Managed category/review file is missing.', {
        path: managed.path,
      });
      continue;
    }
    if (managed.source) {
      const source = files.get(managed.source);
      if (!source || source.identity !== file.identity)
        issue(
          'error',
          'view-not-hardlink',
          'Category/review image does not share its original file.',
          { path: managed.path },
        );
      else hardLinks++;
    } else if (
      managed.sha256 &&
      createHash('sha256')
        .update(await readFile(await trustedAsset(output, managed.path)))
        .digest('hex') !== managed.sha256
    )
      issue(
        'warning',
        'modified-view-metadata',
        'Managed reference metadata was modified outside the exporter.',
        { path: managed.path },
      );
  }
  if (inventory?.exceptions.length)
    issue(
      'warning',
      'view-exceptions',
      `${inventory.exceptions.length} category/review publication exceptions.`,
    );
  const catalog = await readJson<Catalog>('catalog.json', catalogSchema);
  const byId = new Map(current.map((r) => [r.subject.id, r]));
  if (catalog) {
    const seen = new Set<string>();
    for (const reference of catalog.references) {
      if (seen.has(reference.id))
        issue('error', 'duplicate-reference', 'Accepted catalog repeats a reference.', {
          subjectId: reference.id,
        });
      seen.add(reference.id);
      const record = byId.get(reference.id);
      if (
        record?.quality.verdict !== 'accepted' ||
        record.pruned ||
        !hasCurrentClassification(record)
      )
        issue(
          'warning',
          'catalog-out-of-date',
          'Catalog contains a reference that is no longer eligible; exports may be in progress.',
          { subjectId: reference.id },
        );
      for (const frame of reference.images) {
        checkImage(frame.path, frame);
        checkImage(frame.thumbnail);
      }
    }
    const eligible = current.filter(
      (r) => r.quality.verdict === 'accepted' && !r.pruned && hasCurrentClassification(r),
    );
    if (eligible.some((r) => !seen.has(r.subject.id)))
      issue(
        'warning',
        'catalog-out-of-date',
        'Some accepted/current references have not reached the published catalog.',
      );
    for (const [key, path] of Object.entries(catalog.indexes)) {
      const index = await readJson<{ category: string; referenceIds: string[] }>(
        path,
        categorySchema,
      );
      if (!index || index.category !== key || index.referenceIds.some((id) => !seen.has(id)))
        issue(
          'error',
          'invalid-category-index',
          'Category index is missing or points outside the accepted catalog.',
          { path },
        );
    }
  } else issue('warning', 'catalog-unpublished', 'No accepted catalog has been published.');
  const index = await readJson<{
    schemaVersion: number;
    references?: Array<{ id: string; quality: string; classification: string }>;
  }>(savedName(output,'index.json'), indexSchema);
  if (current.length && (!index || index.schemaVersion < 2 || !index.references))
    issue(
      'warning',
      'legacy-index',
      'Collection index contains preliminary labels; regenerate exports with the updated engine.',
    );
  else if (
    index?.references &&
    current.some((r) => {
      const saved = index.references!.find((s) => s.id === r.subject.id);
      return (
        !saved ||
        saved.quality !== r.quality.verdict ||
        saved.classification !== (hasCurrentClassification(r) ? 'current' : 'pending-or-stale')
      );
    })
  )
    issue(
      'warning',
      'stale-index',
      'Collection index does not match current decisions; exports may be in progress.',
    );
  const savedPendingPackets = jobs.filter(
    (j) => j.stage === 'mcp-packet' && j.status === 'pending',
  );
  const pendingPackets = savedPendingPackets.filter((j) => {
    const record = byId.get(String(j.payload.subjectId));
    if (
      !record ||
      record.pruned ||
      j.payload.qualityKey !== record.quality.cacheKey ||
      j.payload.classificationRevision !== (record.classificationRevision ?? 0)
    )
      return false;
    if (j.payload.phase === 'classification')
      return record.quality.verdict === 'accepted' && !hasCurrentClassification(record);
    if (record.quality.verdict !== 'pending') return false;
    return j.payload.phase === 'assessment'
      ? !record.quality.assessment
      : j.payload.phase === 'critique' && !record.quality.critique;
  });
  const workflow = jobs.find((j) => j.stage === 'workflow' && j.key === 'active');
  let abandoned=false;
  if(workflow?.status==='running'&&typeof workflow.payload.ownerPid==='number'){
    abandoned=!runtimeOwnerAlive(workflow.payload.ownerPid);
    if(abandoned)issue('warning','engine-interrupted','The saved workflow owner is no longer running. Progress is resumable; this is not an active classifier.');
  }
  if (workflow?.status === 'incomplete' && pendingPackets.length)
    issue(
      'warning',
      'review-paused',
      `Review loop paused (${String(workflow.payload.reason ?? 'interrupted')}); pending images have not been fully classified.`,
    );
  if (pendingPackets.some((j) => j.payload.contextId !== BRIDGE_CONTEXT_ID))
    issue(
      'warning',
      'older-review-protocol',
      'Pending reviews use an older protocol. Restart the updated engine and pair the chat again; saved captures remain available.',
    );
  const generations = new Set(
    [...files.keys()].filter((p) => /^(?:\.folio\/)?exports\//.test(p)).map((p) => p.replace(/^\.folio\//,'').split('/')[1]),
  );
  if (generations.size > 10)
    issue(
      'warning',
      'export-history',
      `${generations.size} immutable metadata export generations are retained. These are metadata history, not copied original images.`,
    );
  return {
    schemaVersion: 1,
    generatedAt: now(),
    readOnly: true,
    inferenceStarted: false,
    output,
    healthy: !issues.some((i) => i.severity === 'error'),
    publishedCaptures: captures.length,
    currentCaptures: captures.filter((c) => latestIds.has(c.id)).length,
    referenceCounts: counts,
    validation: {
      checkedManifestImages: checkedImages.size,
      imagePaths: imageFiles,
      uniqueImageFiles: hashes.size,
      jsonFiles,
      verifiedHardLinks: hardLinks,
    },
    storage: {
      logicalBytes,
      uniqueFileBytes: uniqueBytes,
      sharedBytes: logicalBytes - uniqueBytes,
      exportGenerations: generations.size,
      meaning:
        'Unique file bytes exclude allocation/compression. captures holds originals; categories and review share them through hard links. exports retains metadata snapshots.',
    },
    progress: {
      workflow: abandoned?'incomplete':workflow?.status ?? 'none',
      phase: abandoned?'paused':workflow?.payload.phase ?? null,
      reason: abandoned?'engine_interrupted':workflow?.payload.reason ?? null,
      pendingReviews: pendingPackets.length,
      obsoleteSavedPackets: savedPendingPackets.length - pendingPackets.length,
      discovery: jobs
        .filter((j) => j.stage === 'discovery')
        .map((j) => ({ source: j.key, status: j.status, updatedAt: j.updatedAt })),
    },
    qualityAccuracy:
      'Not certified by file/contract checks. Final editorial review remains required.',
    issues,
  };
}
