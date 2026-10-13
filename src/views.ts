import { link, lstat, mkdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReferenceRecord } from './references.ts';
import { hasCurrentClassification } from './coverage.ts';
import { trustedAsset } from './quality.ts';
import { atomicJson, errorMessage, hash, inside } from './utils.ts';
import { imageName, pageFolder, nameComponent } from './naming.ts';

type ViewReference = {
  id: string;
  title: string;
  url: string;
  profileId: string;
  order?: number;
  scope?: string;
  images: Array<{ path: string; kind?: string }>;
};
type ManagedFile = { path: string; source?: string; ino?: string; dev?: string; sha256?: string };
type Inventory = {
  schemaVersion: 1;
  files: ManagedFile[];
  exceptions: Array<{ path: string; reason: string }>;
};
/** Separate owned paths can publish independently; the ownership ledger is written first. */
async function eachFile<T>(items: T[], action: (item: T) => Promise<void>) {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await action(item);
      }
    }),
  );
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
function folder(reference: ViewReference) {
  const section =
    reference.scope === 'page'
      ? 'whole-page'
      : `s${String((reference.order ?? 0) + 1).padStart(3, '0')}-${nameComponent(reference.title, 32)}`;
  return `${pageFolder(reference.url).slice('captures/'.length)}/${section}/${nameComponent(reference.profileId, 32)}`;
}

/** Ordinary category folders share original image bytes through hard links, never copies. */
export async function exportFileViews(
  output: string,
  references: ViewReference[],
  indexes: Record<string, Set<string>>,
  records: ReferenceRecord[],
) {
  let previous: Inventory = { schemaVersion: 1, files: [], exceptions: [] };
  try {
    previous = JSON.parse(await readFile(await trustedAsset(output, 'file-views.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const previousByPath = new Map(previous.files.map((f) => [f.path, f]));
  const desired: ManagedFile[] = [],
    notes = new Map<string, unknown>();
  const assigned = new Map<string, string>(),
    claimed = new Set<string>();
  const readableFolder = (reference: ViewReference) => {
    const existing = assigned.get(reference.id);
    if (existing) return existing;
    const base = folder(reference);
    let directory = base,
      ordinal = 1;
    while (claimed.has(directory)) directory = `${base}--${++ordinal}`;
    assigned.set(reference.id, directory);
    claimed.add(directory);
    return directory;
  };
  const add = (directory: string, reference: ViewReference, note: unknown) => {
    for (const [i, image] of reference.images.entries())
      desired.push({
        path: `${directory}/${imageName(reference.url, reference.profileId, { ...(reference.scope === 'page' ? {} : { section: { title: reference.title, order: reference.order ?? 0 } }), part: i + 1, ...(image.kind === 'scroll-state' ? { stateKey: 'scroll' } : {}) })}.png`,
        source: image.path,
      });
    const path = `${directory}/reference.json`;
    desired.push({ path });
    notes.set(path, note);
  };
  const byId = new Map(references.map((r) => [r.id, r]));
  for (const [category, ids] of Object.entries(indexes)) {
    if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(category)) throw new Error('Invalid category path');
    for (const id of ids) {
      const reference = byId.get(id);
      if (reference)
        add(`categories/${category}/${readableFolder(reference)}`, reference, {
          id,
          url: reference.url,
          category,
          images: reference.images,
        });
    }
  }
  for (const record of records) {
    if (
      record.pruned ||
      (record.quality.verdict === 'accepted' && hasCurrentClassification(record))
    )
      continue;
    const reference = {
      id: record.subject.id,
      title: record.subject.title,
      url: record.sourceUrl,
      profileId: record.subject.profileId,
      order: record.subject.order,
      scope: record.subject.scope,
      images: record.subject.frames.map((f) => ({
        path: `${record.directory}/${f.path}`,
        kind: f.kind,
      })),
    };
    const status =
      record.quality.verdict === 'accepted' ? 'classification-pending' : record.quality.verdict;
    add(`review/${status}/${readableFolder(reference)}`, reference, {
      id: reference.id,
      url: reference.url,
      status,
      scope: record.subject.scope,
      reasons: record.quality.reasons,
      images: reference.images,
    });
  }
  const inventory: Inventory = { schemaVersion: 1, files: [], exceptions: [] };
  const ownedPath = (name: string) => {
    if (!/^(?:categories|review)\//.test(name))
      throw new Error('Managed view path escapes category/review folders');
    return inside(output, name);
  };
  async function sameAsset(path: string, source: string) {
    const a = await stat(await trustedAsset(output, path)),
      b = await stat(await trustedAsset(output, source));
    return a.dev === b.dev && a.ino === b.ino;
  }
  async function matchesOwned(file: ManagedFile) {
    const target = await trustedAsset(output, file.path);
    if (file.source) {
      const s = await stat(target);
      return String(s.ino) === file.ino && String(s.dev) === file.dev;
    }
    return hash(await readFile(target, 'utf8')) === file.sha256;
  }
  const prepared: ManagedFile[] = [];
  await eachFile(desired, async (file) => {
    try {
      ownedPath(file.path);
      if (file.source) {
        const s = await stat(await trustedAsset(output, file.source));
        file.ino = String(s.ino);
        file.dev = String(s.dev);
      } else file.sha256 = hash(`${JSON.stringify(notes.get(file.path), null, 2)}\n`);
      try {
        await trustedAsset(output, file.path);
        const old = previousByPath.get(file.path);
        if (
          file.source
            ? !(await sameAsset(file.path, file.source)) && (!old || !(await matchesOwned(old)))
            : !old || !(await matchesOwned(old))
        )
          throw new Error('Existing file is not the managed view; preserved');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      prepared.push(file);
    } catch (error) {
      inventory.exceptions.push({ path: file.path, reason: errorMessage(error) });
    }
  });
  prepared.sort((a, b) => a.path.localeCompare(b.path));
  // Persist ownership before file creation. Restart can recover partially generated views.
  await atomicJson(inside(output, 'file-views.json'), {
    ...inventory,
    files: [...new Map([...previous.files, ...prepared].map((f) => [f.path, f])).values()],
  });
  await eachFile(prepared, async (file) => {
    try {
      const target = ownedPath(file.path);
      // Check existing parent components for junctions/symlinks before mkdir or publication.
      try {
        await trustedAsset(output, dirname(file.path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await mkdir(dirname(target), { recursive: true });
      await trustedAsset(output, dirname(file.path));
      if (file.source) {
        const source = await trustedAsset(output, file.source);
        try {
          await link(source, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (!(await sameAsset(file.path, file.source))) {
            const old = previousByPath.get(file.path);
            if (!old?.source || !(await matchesOwned(old)))
              throw new Error('Existing file is not the managed image; preserved');
            await rm(await trustedAsset(output, file.path));
            await link(source, target);
          }
        }
      } else {
        try {
          await lstat(target);
          const old = previousByPath.get(file.path);
          if (!old || !(await matchesOwned(old)))
            throw new Error('Existing metadata is not managed; preserved');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const old = previousByPath.get(file.path);
        if (old?.sha256 !== file.sha256 || !(await matchesOwned(file)))
          await atomicJson(target, notes.get(file.path));
      }
      inventory.files.push(file);
    } catch (error) {
      inventory.exceptions.push({ path: file.path, reason: errorMessage(error) });
    }
  });
  const desiredPaths = new Set(desired.map((f) => f.path));
  for (const old of previous.files)
    if (!desiredPaths.has(old.path)) {
      try {
        ownedPath(old.path);
        if (!(await matchesOwned(old))) throw new Error('Modified view preserved');
        await rm(await trustedAsset(output, old.path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          inventory.files.push(old);
          inventory.exceptions.push({ path: old.path, reason: errorMessage(error) });
        }
      }
    }
  for (const old of previous.files)
    if (!desiredPaths.has(old.path)) {
      let parent = old.path.split('/').slice(0, -1).join('/');
      while (parent.split('/').length >= 2) {
        try {
          ownedPath(`${parent}/unused`);
          await rmdir(await trustedAsset(output, parent));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break;
        }
        parent = parent.split('/').slice(0, -1).join('/');
      }
    }
  inventory.files.sort((a, b) => a.path.localeCompare(b.path));
  inventory.exceptions.sort((a, b) => a.path.localeCompare(b.path));
  await atomicJson(inside(output, 'file-views.json'), inventory);
  return {
    categories: 'categories',
    review: 'review',
    storage: 'Hard links to original PNGs; no image copies',
    exceptions: inventory.exceptions,
  };
}
