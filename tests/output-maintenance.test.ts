import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  sealExport,
  pruneExportHistory,
  pruneSupersededStaging,
} from '../src/output-maintenance.ts';
import { Store } from '../src/store.ts';
import { atomicJson } from '../src/utils.ts';
import sharp from 'sharp';
import { runPipeline } from '../src/pipeline.ts';
import { parseConfig } from '../src/config.ts';
import { CRITERIA } from '../src/quality.ts';

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'folio-retention-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 4 }));
  return root;
}
async function publication(root: string, ordinal: number, sealed = true) {
  const generation = `.folio/exports/${1700000000000 + ordinal}-abcdefab`,
    staging = `${generation}.staging`;
  await mkdir(join(root, staging), { recursive: true });
  await atomicJson(join(root, staging, 'catalog.json'), {
    schemaVersion: 2,
    generation,
    references: [],
    indexes: {},
  });
  await atomicJson(join(root, staging, 'coverage.json'), {});
  await atomicJson(join(root, staging, 'taxonomy.json'), {});
  if (sealed) await sealExport(root, staging, generation);
  await rename(join(root, staging), join(root, generation));
  return generation;
}

test('export retention keeps current and previous publications and never removes edited or unknown files', async (t) => {
  const root = await fixture(t),
    old = await publication(root, 1),
    edited = await publication(root, 2),
    notes = await publication(root, 3),
    previous = await publication(root, 4),
    current = await publication(root, 5);
  await writeFile(join(root, edited, 'taxonomy.json'), 'User edit');
  await writeFile(join(root, notes, 'my-notes.txt'), 'Keep me');
  const result = await pruneExportHistory(root, current);
  assert.deepEqual(result.removed, [old]);
  assert.equal(result.preserved.length, 2);
  await assert.rejects(access(join(root, old)));
  await access(join(root, previous));
  await access(join(root, current));
  assert.equal(await readFile(join(root, edited, 'taxonomy.json'), 'utf8'), 'User edit');
  assert.equal(await readFile(join(root, notes, 'my-notes.txt'), 'utf8'), 'Keep me');
});

test('legacy export compaction is explicit and validates the complete generated file list', async (t) => {
  const root = await fixture(t),
    legacy = await publication(root, 1, false),
    unknown = await publication(root, 2, false);
  await writeFile(join(root, unknown, 'keep.txt'), 'User file');
  await publication(root, 3);
  const current = await publication(root, 4);
  await pruneExportHistory(root, current);
  await access(join(root, legacy));
  const result = await pruneExportHistory(root, current, true);
  assert(result.removed.includes(legacy));
  await assert.rejects(access(join(root, legacy)));
  assert.equal(await readFile(join(root, unknown, 'keep.txt'), 'utf8'), 'User file');
});

test('superseded staging cleanup removes only verified unpublished checkpoints with a newer published capture', async (t) => {
  const root = await fixture(t),
    store = new Store(root);
  try {
    store.acquireLock();
    const page = store.page('https://example.test/'),
      stage = '.folio/staging/example.test/home/old';
    store.createCapture(page, 'old', '.folio/captures/example.test/home/old', stage, 'old');
    const png = await sharp({
        create: { width: 20, height: 20, channels: 3, background: '#abcdef' },
      })
        .png()
        .toBuffer(),
      frame = {
        path: 'desktop/section.png',
        thumbnail: 'desktop/section.png',
        sha256: createHash('sha256').update(png).digest('hex'),
        width: 20,
        height: 20,
        bounds: { x: 0, y: 0, width: 20, height: 20 },
        scrollY: 0,
        kind: 'static' as const,
      };
    await mkdir(join(root, stage, 'desktop'), { recursive: true });
    await writeFile(join(root, stage, frame.path), png);
    await atomicJson(join(root, stage, 'desktop/result.json'), {
      profile: { id: 'desktop' },
      requestedUrl: page.url,
      regions: [{ frames: [frame] }],
    });
    store.db.prepare("UPDATE captures SET status='superseded' WHERE id='old'").run();
    assert.equal(
      (await pruneSupersededStaging(store)).removed.length,
      0,
      'Without a newer published capture the checkpoint is protected',
    );
    store.createCapture(
      page,
      'new',
      '.folio/captures/example.test/home/new',
      '.folio/staging/example.test/home/new',
      'new',
    );
    const publishedDirectory = '.folio/captures/example.test/home/new';
    await mkdir(join(root, publishedDirectory, 'desktop'), { recursive: true });
    await writeFile(join(root, publishedDirectory, frame.path), png);
    store.publishCapture(
      {
        schemaVersion: 1,
        pageId: page.id,
        captureId: 'new',
        captureSignature: 'new',
        requestedUrl: page.url,
        title: 'New',
        capturedAt: new Date().toISOString(),
        status: 'complete',
        reviewStatus: 'unreviewed',
        provenance: [],
        variants: [
          {
            profile: {
              id: 'desktop',
              width: 20,
              height: 20,
              dpr: 1,
              isMobile: false,
              hasTouch: false,
            },
            status: 'complete',
            requestedUrl: page.url,
            finalUrl: page.url,
            title: 'New',
            capturedAt: new Date().toISOString(),
            pageHeight: 20,
            regions: [
              {
                id: 'hero',
                order: 0,
                title: 'Hero',
                bounds: frame.bounds,
                captureBounds: frame.bounds,
                method: 'semantic',
                boundaryConfidence: 'high',
                frames: [frame],
                evidenceIds: [],
              },
            ],
            evidence: [],
            warnings: [],
            interventions: [],
            coverage: [{ start: 0, end: 20 }],
            stoppingReason: 'covered',
            environment: {},
          },
        ],
      },
      '.folio/captures/example.test/home/new',
    );
    const replacement = store.capture('new')!.manifest!;
    replacement.status = 'incomplete';
    store.publishCapture(replacement, publishedDirectory);
    assert.equal(
      (await pruneSupersededStaging(store)).removed.length,
      0,
      'An incomplete replacement cannot justify automatic removal',
    );
    replacement.status = 'complete';
    store.publishCapture(replacement, publishedDirectory);
    await writeFile(join(root, stage, 'my-notes.txt'), 'Keep');
    assert.equal((await pruneSupersededStaging(store)).removed.length, 0);
    await access(join(root, stage));
    await rm(join(root, stage, frame.path));
    assert.equal((await pruneSupersededStaging(store)).removed.length, 0);
    assert.equal(
      store.capture('old')!.stagingDirectory,
      stage,
      'A missing expected asset must not orphan the remaining checkpoint',
    );
    await writeFile(join(root, stage, frame.path), png);
    await rm(join(root, stage, 'my-notes.txt'));
    await writeFile(join(root, stage, frame.path), 'Changed');
    assert.equal(
      (await pruneSupersededStaging(store)).removed.length,
      0,
      'Changed images are protected',
    );
    await writeFile(join(root, stage, frame.path), png);
    await writeFile(join(root, publishedDirectory, frame.path), 'Broken replacement');
    assert.equal(
      (await pruneSupersededStaging(store)).removed.length,
      0,
      'A newer corrupt capture cannot justify automatic removal',
    );
    await access(join(root, stage));
    await writeFile(join(root, publishedDirectory, frame.path), png);
    store.releaseLock();
    const summary = await runPipeline(
      parseConfig({ output: root, sources: [page.url], classifier: { runner: 'codex' } }),
      {
        classifyOnly: true,
        reassess: true,
        preflightClassifier: async () => {},
        log: () => {},
        launchBrowser: async () => {
          throw new Error('Saved classification must never open a browser');
        },
        runProcess: async (_command, _args, request) => {
          const evidence = JSON.parse(request.prompt.match(/^EVIDENCE_DATA=(.*)$/m)![1]),
            id = evidence.images[0].id;
          return {
            stdout: '',
            stderr: '',
            lastMessage: JSON.stringify({
              score: 6,
              verdict: 'reject',
              evidenceIds: [id],
              reasons: ['Synthetic test judgment'],
              weaknesses: ['Fixture only'],
              criteria: Object.fromEntries(
                CRITERIA.map((criterion) => [
                  criterion,
                  { score: 6, evidenceIds: [id], reason: 'Fixture only' },
                ]),
              ),
            }),
          };
        },
      },
    );
    assert.equal(
      summary.interrupted,
      false,
      'Normal Codex saved-classification completes its own maintenance',
    );
    await assert.rejects(access(join(root, stage)));
    assert.equal(store.capture('old')!.stagingDirectory, null);
    assert.equal(store.capture('new')!.status, 'complete');
  } finally {
    store.close();
  }
});

test('automatic checkpoint maintenance permits the active writer and refuses unlocked or competing stores', async (t) => {
  const root = await fixture(t),
    owner = new Store(root),
    other = new Store(root);
  const engine = owner.registerEngine();
  try {
    await assert.rejects(pruneSupersededStaging(owner), /exclusive runtime lock/);
    owner.acquireLock();
    assert.deepEqual(
      (await pruneSupersededStaging(owner)).removed,
      [],
      'A running engine can maintain output while it owns the writer lock',
    );
    await assert.rejects(pruneSupersededStaging(other), /exclusive runtime lock/);
    owner.releaseLock();
    await assert.rejects(pruneSupersededStaging(owner), /exclusive runtime lock/);
  } finally {
    owner.unregisterEngine(engine);
    other.close();
    owner.close();
  }
});
