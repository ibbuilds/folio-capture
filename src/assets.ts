import { readdir, readFile, link, rename, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import { trustedAsset } from './quality.ts';
import { inside } from './utils.ts';

async function imageFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Capture staging contains an unexpected symbolic link.');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(png|webp)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(root);
  return files;
}

/** Exact byte matches share storage, never labels or judgments. Paths and capture context survive.
 * New links are atomically substituted only in this run's unpublished staging directory. */
export async function shareCaptureAssets(store: Store, root: string) {
  const seen = new Map<string, string>();
  for (const target of await imageFiles(root)) {
    const bytes = await readFile(await trustedAsset(root, relative(root, target)));
    const sha = createHash('sha256').update(bytes).digest('hex');
    let source = seen.get(sha);
    if (!source) {
      const registered = store.asset(sha);
      if (registered)
        try {
          const existing = await trustedAsset(store.output, registered);
          if (
            createHash('sha256')
              .update(await readFile(existing))
              .digest('hex') === sha
          )
            source = existing;
        } catch {
          /* Pruned or changed assets are never used as a link source. */
        }
    }
    if (source) {
      const temporary = `${target}.${randomUUID()}.link`;
      try {
        await link(source, temporary);
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    seen.set(sha, source ?? target);
  }
}

/** The hash registry points only to atomically published, verified files. */
export async function registerCaptureAssets(store: Store, directory: string) {
  const root = inside(store.output, directory);
  for (const path of await imageFiles(root)) {
    const bytes = await readFile(await trustedAsset(root, relative(root, path)));
    store.saveAsset(
      createHash('sha256').update(bytes).digest('hex'),
      relative(store.output, path).replaceAll('\\', '/'),
    );
  }
}
