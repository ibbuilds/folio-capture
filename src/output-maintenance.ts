import { readFile, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { Store } from './store.ts';
import { trustedAsset } from './quality.ts';
import { atomicJson, canonicalUrl, hash, inside } from './utils.ts';

const sealName = '.folio-publication.json';
async function filesUnder(output: string, directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (name: string) => {
    const target = await trustedAsset(output, `${directory}/${name}`);
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const next = name ? `${name}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Linked files are preserved.');
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) files.push(next);
      else throw new Error('Unsupported filesystem entry is preserved.');
    }
  };
  await walk('');
  return files.sort();
}

/** Ownership fingerprints make automatic retention refuse edited snapshots. */
export async function sealExport(output: string, staging: string, generation: string) {
  const files = await filesUnder(output, staging),
    hashes: Record<string, string> = {};
  for (const name of files)
    hashes[name] = hash(await readFile(await trustedAsset(output, `${staging}/${name}`), 'utf8'));
  await atomicJson(inside(output, `${staging}/${sealName}`), {
    schemaVersion: 1,
    kind: 'folio-export',
    generation,
    hashes,
  });
}

/** Keep the current and previous atomic publication. Unknown/edited files are never removed.
 * Explicit organization can compact legacy engine snapshots without a fingerprint seal. */
export async function pruneExportHistory(output: string, current: string, allowLegacy = false) {
  if (!/^\.folio\/exports\/\d{13}-[a-f0-9]{8}$/.test(current))
    throw new Error('Unsafe export publication path.');
  const root = await trustedAsset(output, '.folio/exports');
  const candidates = (await readdir(root, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.isSymbolicLink() && /^\d{13}-[a-f0-9]{8}$/.test(entry.name),
    )
    .map((entry) => `.folio/exports/${entry.name}`);
  const ordered = [
    current,
    ...candidates
      .filter((path) => path !== current)
      .sort(
        (a, b) =>
          Number(basename(b).slice(0, 13)) - Number(basename(a).slice(0, 13)) || b.localeCompare(a),
      ),
  ];
  const removed: string[] = [],
    preserved: Array<{ path: string; reason: string }> = [];
  for (const directory of ordered.slice(2)) {
    try {
      const names = await filesUnder(output, directory);
      const catalog = JSON.parse(
        await readFile(await trustedAsset(output, `${directory}/catalog.json`), 'utf8'),
      );
      if (
        catalog.schemaVersion !== 2 ||
        catalog.generation !== directory ||
        !Array.isArray(catalog.references) ||
        !catalog.indexes
      )
        throw new Error('Unrecognized export metadata.');
      const expected = new Set([
        'catalog.json',
        'coverage.json',
        'taxonomy.json',
        ...Object.values(catalog.indexes).map((path) => {
          if (
            typeof path !== 'string' ||
            !path.startsWith(`${directory}/indexes/`) ||
            !path.endsWith('.json')
          )
            throw new Error('Export index escapes its publication.');
          inside(inside(output, directory), path.slice(directory.length + 1));
          return path.slice(directory.length + 1);
        }),
      ]);
      const sealed = names.includes(sealName);
      if (
        names.some((name) => name !== sealName && !expected.has(name)) ||
        [...expected].some((name) => !names.includes(name))
      )
        throw new Error('Unexpected or missing files; snapshot preserved.');
      if (sealed) {
        const seal = JSON.parse(
          await readFile(await trustedAsset(output, `${directory}/${sealName}`), 'utf8'),
        );
        if (
          seal.kind !== 'folio-export' ||
          seal.generation !== directory ||
          Object.keys(seal.hashes).length !== expected.size
        )
          throw new Error('Invalid ownership fingerprint.');
        for (const name of expected)
          if (
            seal.hashes[name] !==
            hash(await readFile(await trustedAsset(output, `${directory}/${name}`), 'utf8'))
          )
            throw new Error('Edited export snapshot preserved.');
      } else if (!allowLegacy) continue;
      // Resolve and verify the final absolute target before recursive removal.
      const target = await trustedAsset(output, directory);
      inside(root, target);
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
      removed.push(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        preserved.push({
          path: directory,
          reason: error instanceof Error ? error.message : String(error),
        });
    }
  }
  return { removed, preserved };
}

/** Only superseded, unpublished checkpoints with a newer published capture qualify.
 * Complete captures, pending work, unknown files, and changed PNGs are preserved. */
export async function pruneSupersededStaging(store: Store) {
  store.assertNoEngines();
  const pages = new Map(store.pages().map((page) => [page.id, page]));
  const removed: string[] = [],
    preserved: Array<{ path: string; reason: string }> = [];
  for (const capture of store.captures()) {
    const directory = capture.stagingDirectory,
      page = pages.get(capture.pageId);
    if (
      capture.status !== 'superseded' ||
      capture.manifest ||
      !directory ||
      !page?.latestCaptureId ||
      !store.capture(page.latestCaptureId)?.manifest
    )
      continue;
    let scanned = false;
    try {
      if (!/^\.folio\/staging\//.test(directory)) throw new Error('Unrecognized checkpoint path.');
      const files = await filesUnder(store.output, directory),
        results = files.filter((name) => /^[a-z][a-z0-9-]*\/result\.json$/.test(name));
      scanned = true;
      if (!results.length) throw new Error('Checkpoint has no recognized viewport results.');
      const expected = new Set(results);
      for (const name of results) {
        const result = JSON.parse(
          await readFile(await trustedAsset(store.output, `${directory}/${name}`), 'utf8'),
        );
        if (
          !result.profile ||
          name !== `${result.profile.id}/result.json` ||
          canonicalUrl(result.requestedUrl) !== canonicalUrl(page.url) ||
          !Array.isArray(result.regions)
        )
          throw new Error('Checkpoint identity differs from its registry.');
        for (const region of result.regions)
          for (const frame of region.frames) {
            inside(inside(store.output, directory), frame.path);
            inside(inside(store.output, directory), frame.thumbnail);
            expected.add(frame.path);
            expected.add(frame.thumbnail);
            const png = await readFile(
              await trustedAsset(store.output, `${directory}/${frame.path}`),
            );
            if (createHash('sha256').update(png).digest('hex') !== frame.sha256)
              throw new Error('Changed checkpoint image preserved.');
          }
        if (result.overview) expected.add(result.overview);
        for (const evidence of result.evidence ?? [])
          if (evidence.kind === 'raw-diagnostic' && typeof evidence.value?.path === 'string')
            expected.add(evidence.value.path);
      }
      if (files.includes('.folio-move.json')) {
        const marker = JSON.parse(
          await readFile(await trustedAsset(store.output, `${directory}/.folio-move.json`), 'utf8'),
        );
        if (marker.captureId !== capture.id)
          throw new Error('Checkpoint move marker has a different identity.');
        expected.add('.folio-move.json');
      }
      if (files.some((name) => !expected.has(name)))
        throw new Error('Unknown checkpoint files preserved.');
      const target = await trustedAsset(store.output, directory);
      inside(await trustedAsset(store.output, '.folio/staging'), target);
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
      store.db
        .prepare("UPDATE captures SET staging_directory=NULL WHERE id=? AND status='superseded'")
        .run(capture.id);
      removed.push(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !scanned)
        store.db
          .prepare("UPDATE captures SET staging_directory=NULL WHERE id=? AND status='superseded'")
          .run(capture.id);
      else
        preserved.push({
          path: directory,
          reason: error instanceof Error ? error.message : String(error),
        });
    }
  }
  return { removed, preserved };
}
