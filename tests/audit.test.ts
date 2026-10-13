import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, link, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Store } from '../src/store.ts';
import { auditOutput } from '../src/audit.ts';
import { atomicJson } from '../src/utils.ts';
import type { PageManifest } from '../src/types.ts';
import { referenceSubjects, subjectImageId } from '../src/references.ts';
import { TAXONOMY_VERSION, TAXONOMY_FINGERPRINT } from '../src/taxonomy.ts';
import { SCOPED_PROMPT_VERSION } from '../src/quality.ts';

async function fixture(t: test.TestContext) {
  const output = await mkdtemp(join(tmpdir(), 'folio-audit-'));
  t.after(() => rm(output, { recursive: true, force: true, maxRetries: 3 }));
  const store = new Store(output),
    page = store.page('https://example.test/'),
    directory = 'captures/example.test/home/v001';
  await mkdir(join(output, directory), { recursive: true });
  const image = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  await writeFile(join(output, directory, 'section.png'), image);
  await sharp(image)
    .webp()
    .toFile(join(output, directory, 'section.webp'));
  const bounds = { x: 0, y: 0, width: 20, height: 20 };
  const manifest: PageManifest = {
    schemaVersion: 1,
    pageId: page.id,
    captureId: 'capture',
    captureSignature: 'fixture',
    requestedUrl: page.url,
    title: 'Fixture',
    capturedAt: '2026-10-13T00:00:00Z',
    status: 'complete',
    reviewStatus: 'unreviewed',
    provenance: [],
    variants: [
      {
        profile: { id: 'desktop', width: 20, height: 20, dpr: 2, isMobile: false, hasTouch: false },
        status: 'complete',
        requestedUrl: page.url,
        finalUrl: page.url,
        title: 'Fixture',
        capturedAt: '2026-10-13T00:00:00Z',
        pageHeight: 20,
        evidence: [],
        warnings: [],
        interventions: [],
        coverage: [{ start: 0, end: 20 }],
        stoppingReason: 'complete',
        environment: {},
        regions: [
          {
            id: 'hero',
            order: 0,
            title: 'Hero',
            bounds,
            captureBounds: bounds,
            method: 'semantic',
            boundaryConfidence: 'high',
            evidenceIds: [],
            frames: [
              {
                path: 'section.png',
                thumbnail: 'section.webp',
                width: 40,
                height: 40,
                sha256: createHash('sha256').update(image).digest('hex'),
                bounds,
                scrollY: 0,
                kind: 'static',
              },
            ],
          },
        ],
      },
    ],
  };
  store.createCapture(page, 'fixture', directory, 'staging', 'capture');
  store.publishCapture(manifest, directory);
  store.close();
  await atomicJson(join(output, directory, 'manifest.json'), manifest);
  return { output, directory, manifest };
}

test('audit is read-only, checks encoded pixels and accounts hard-linked category images once', async (t) => {
  const { output, directory } = await fixture(t);
  const category = 'categories/aesthetic/minimal/site/image.png';
  await mkdir(join(output, 'categories/aesthetic/minimal/site'), { recursive: true });
  await link(join(output, directory, 'section.png'), join(output, category));
  await atomicJson(join(output, 'file-views.json'), {
    files: [{ path: category, source: `${directory}/section.png` }],
    exceptions: [],
  });
  const before = await readFile(join(output, 'state.sqlite')),
    names = await readdir(output);
  const result = await auditOutput(output);
  assert(result.readOnly);
  assert(!result.inferenceStarted);
  assert(result.healthy, JSON.stringify(result.issues));
  assert.equal(result.validation.verifiedHardLinks, 1);
  assert.equal(result.validation.imagePaths, 3);
  assert.equal(result.validation.uniqueImageFiles, 2);
  assert(result.storage.sharedBytes > 0);
  assert.deepEqual(await readFile(join(output, 'state.sqlite')), before);
  // SQLite can create WAL bookkeeping sidecars even for a read-only connection.
  assert.deepEqual(
    (await readdir(output)).filter((n) => !['state.sqlite-shm', 'state.sqlite-wal'].includes(n)),
    names,
  );
});

test('audit detects changed pixels and missing managed category paths without repairing or publishing', async (t) => {
  const { output, directory } = await fixture(t);
  const bad = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f00' } })
    .png()
    .toBuffer();
  await writeFile(join(output, directory, 'section.png'), bad);
  await atomicJson(join(output, 'file-views.json'), {
    files: [
      { path: 'categories/aesthetic/minimal/missing.png', source: `${directory}/section.png` },
    ],
    exceptions: [],
  });
  const result = await auditOutput(output);
  assert(!result.healthy);
  assert(result.issues.some((i) => i.code === 'image-contract'));
  assert(result.issues.some((i) => i.code === 'missing-view'));
  assert.deepEqual(await readFile(join(output, directory, 'section.png')), bad);
});

test('malformed export metadata is reported as an integrity error instead of crashing the audit', async (t) => {
  const { output } = await fixture(t);
  await writeFile(join(output, 'catalog.json'), '{}');
  const result = await auditOutput(output);
  assert(!result.healthy);
  assert(result.issues.some((i) => i.code === 'invalid-metadata' && i.path === 'catalog.json'));
});

test('obsolete packet history does not report a completed reference as still pending or requiring a protocol restart', async (t) => {
  const { output, directory, manifest } = await fixture(t),
    subject = referenceSubjects(manifest)[0],
    store = new Store(output);
  const inspectedImages = subject.frames.map((f) => subjectImageId(subject, f));
  try {
    store.saveReference({
      schemaVersion: 2,
      subject,
      directory,
      sourceUrl: manifest.requestedUrl,
      quality: {
        schemaVersion: 2,
        subjectId: subject.id,
        cacheKey: 'fixture',
        rubricVersion: 'fixture',
        verdict: 'accepted',
        assessedAt: 'fixture',
        experimental: true,
        reasons: [],
        model: 'fixture',
        reasoning: 'fixture',
        reportedModels: [],
        inspectedImages,
      },
      classification: {
        taxonomyVersion: TAXONOMY_VERSION,
        taxonomyFingerprint: TAXONOMY_FINGERPRINT,
        promptVersion: SCOPED_PROMPT_VERSION,
        cacheKey: 'fixture',
        model: 'fixture',
        classifiedAt: 'fixture',
        inspectedImages,
        labels: [],
      },
    });
    store.job('mcp-packet', 'old', {
      subjectId: subject.id,
      contextId: 'obsolete',
      phase: 'classification',
      qualityKey: 'fixture',
      classificationRevision: 0,
    });
  } finally {
    store.close();
  }
  const result = await auditOutput(output);
  assert.equal(result.progress.pendingReviews, 0);
  assert.equal(result.progress.obsoleteSavedPackets, 1);
  assert(!result.issues.some((i) => i.code === 'older-review-protocol'));
});
