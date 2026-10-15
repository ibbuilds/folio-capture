import { link, lstat, mkdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReferenceRecord } from './references.ts';
import { hasCurrentClassification } from './coverage.ts';
import { trustedAsset } from './quality.ts';
import { atomicJson, errorMessage, hash, inside } from './utils.ts';
import { imageName, pageFolder, nameComponent } from './naming.ts';
import { captureKey, internalName, savedName } from './output-paths.ts';
import type { Label } from './types.ts';

type ViewReference = {
  id: string;
  title: string;
  url: string;
  profileId: string;
  order?: number;
  scope?: string;
  labels?: Label[];
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
  return `${captureKey(pageFolder(reference.url))}/${section}/${nameComponent(reference.profileId, 32)}`;
}
function primaryAesthetic(reference:ViewReference) {
  return reference.labels?.find(label=>label.axis==='visual_style'&&label.role==='primary'&&label.label!=='unknown'&&['model','human'].includes(label.provenance));
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
    previous = JSON.parse(
      await readFile(await trustedAsset(output, savedName(output, 'file-views.json')), 'utf8'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const previousByPath = new Map(previous.files.map((f) => [f.path, f]));
  const desired: ManagedFile[] = [],
    notes = new Map<string, unknown>();
  const assigned = new Map<string, string>(),
    claimed = new Set<string>();
  const publishedImages: Record<string, string> = {};
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
    for (const [i, image] of reference.images.entries()) {
      if (publishedImages[image.path]) continue;
      const path = `${directory}/${imageName(reference.url, reference.profileId, { ...(reference.scope === 'page' ? {} : { section: { title: reference.title, order: reference.order ?? 0 } }), part: i + 1, ...(image.kind === 'scroll-state' ? { stateKey: 'scroll' } : {}) })}.png`;
      publishedImages[image.path] = path;
      desired.push({ path, source: image.path });
    }
    const path = `${directory}/reference.json`;
    desired.push({ path });
    notes.set(
      path,
      typeof note === 'object' && note !== null
        ? {
            ...note,
            images: reference.images.map((image) => ({
              ...image,
              path: publishedImages[image.path] ?? image.path,
            })),
          }
        : note,
    );
  };
  void indexes; // Other dimensions are metadata indexes, never additional image folders.
  for (const reference of references.filter((r) => r.scope === 'section')) {
    const primary = primaryAesthetic(reference);
    const category = primary ? nameComponent(primary.label, 80) : 'unassigned';
    add(`categories/${category}/${readableFolder(reference)}`, reference, {
      id: reference.id,
      url: reference.url,
      primaryAesthetic: primary?.label ?? null,
      labels: reference.labels,
      images: reference.images,
    });
  }
  for(const reference of references.filter(reference=>reference.scope==='page')) {
    if(reference.images.every(image=>publishedImages[image.path]))continue;
    const primary=primaryAesthetic(reference),category=primary?nameComponent(primary.label,80):'unassigned';
    add(`categories/${category}/${readableFolder(reference)}`,reference,{
      id:reference.id,url:reference.url,scope:'page',primaryAesthetic:primary?.label??null,
      labels:reference.labels,images:reference.images,
      qualification:'Whole-page qualification only; individual sections keep their own decisions.',
    });
  }
  for (const record of [...records].sort(
    (a, b) => (a.subject.scope === 'section' ? 0 : 1) - (b.subject.scope === 'section' ? 0 : 1),
  )) {
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
    // Whole-page decisions can expose otherwise unowned context frames, never duplicate section PNGs.
    if (
      record.subject.scope === 'page' &&
      reference.images.every((image) => publishedImages[image.path])
    )
      continue;
    const status =
      record.quality.verdict === 'accepted' ? 'classification-pending' : record.quality.verdict;
    add(`review/${readableFolder(reference)}`, reference, {
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
  await atomicJson(inside(output, internalName('file-views.json')), {
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
  await atomicJson(inside(output, internalName('file-views.json')), inventory);
  return {
    categories: 'categories',
    review: 'review',
    storage: 'Hard links to original PNGs; no image copies',
    publishedImages: Object.fromEntries(
      Object.entries(publishedImages).filter(([, path]) =>
        inventory.files.some((f) => f.path === path),
      ),
    ),
    exceptions: inventory.exceptions,
  };
}
