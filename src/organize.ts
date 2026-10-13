import { mkdir, rename, readFile, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Store } from './store.ts';
import type { CaptureProfile } from './types.ts';
import { captureVersion } from './naming.ts';
import { inside, atomicJson, errorMessage } from './utils.ts';
import { trustedAsset } from './quality.ts';
import { exportAccepted } from './catalog.ts';
import { exportCatalog } from './report.ts';
import { validateStoredCapture } from './pipeline.ts';

/** Move existing capture versions into readable site/page folders, with a durable rename ledger.
 * IDs, hashes, decisions and relative frame paths are preserved. No browser/model is started. */
export async function organizeOutput(
  store: Store,
  profiles?: CaptureProfile[],
  afterMove?: () => Promise<void>,
) {
  const pages = new Map(store.pages().map((page) => [page.id, page]));
  const ordinals = new Map<string, number>();
  let moved = 0;
  const exceptions: Array<{ captureId: string; reason: string }> = [];
  for (const capture of store.captures()) {
    const ordinal = (ordinals.get(capture.pageId) ?? 0) + 1;
    ordinals.set(capture.pageId, ordinal);
    if (capture.status === 'duplicate') continue;
    const page = pages.get(capture.pageId)!;
    const folder = store.folder(page);
    const directory = capture.directory.startsWith(`${folder}/`)
      ? capture.directory
      : `${folder}/${captureVersion(capture.createdAt, ordinal)}`;
    const staging = capture.stagingDirectory
      ? `.staging/${directory.slice('captures/'.length)}`
      : null;
    const prior = store.getJob('organize', capture.id);
    if (directory === capture.directory && staging === capture.stagingDirectory && (!prior || prior.status==='complete')) continue;
    const plan = prior?.payload ?? {
      from: capture.directory,
      to: directory,
      stageFrom: capture.stagingDirectory,
      stageTo: staging,
    };
    const job = store.job('organize', capture.id, plan);
    store.start(job);
    try {
      let published=Boolean(capture.manifest || plan.published);
      let from = published ? plan.from : plan.stageFrom,
        to = published ? plan.to : plan.stageTo;
      // A crash can publish files before committing the SQLite manifest.
      if(!published){
        try {
          const root=await trustedAsset(store.output,plan.from);
          const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
          if(manifest.captureId!==capture.id || !await validateStoredCapture(store,{...capture,manifest}))throw new Error('Uncommitted publication requires repair; files were preserved.');
          from=plan.from;to=plan.to;published=true;plan.published=true;store.job('organize',capture.id,plan);
        }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      }
      if (!from || !to || !/^(?:captures|\.staging)\//.test(from))
        throw new Error('Missing or unsupported capture directory; kept for repair.');
      let source: string | undefined;
      try {
        source = await trustedAsset(store.output, from);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (source) {
        if (capture.manifest && !(await validateStoredCapture(store, capture)))
          throw new Error('Capture assets require repair; files were preserved.');
        const parent = dirname(inside(store.output, to));
        // Verify each existing parent before creating it; junctions/symlinks are never followed.
        let current = '';
        for (const piece of to.split('/').slice(0, -1)) {
          current = current ? `${current}/${piece}` : piece;
          try {
            await trustedAsset(store.output, current);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            await mkdir(inside(store.output, current));
          }
        }
        await mkdir(parent, { recursive: true });
        if (!published)
          await atomicJson(join(source, '.folio-move.json'), { captureId: capture.id });
        try {
          await trustedAsset(store.output, to);
          throw new Error('Target capture directory already exists; both were preserved.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(source, inside(store.output, to));
        await afterMove?.();
      } else {
        let target:string|undefined;
        try{target=await trustedAsset(store.output,to);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        if(!target && capture.status==='running'){
          // Empty interrupted checkpoints have no assets to move; resume will recapture them.
          store.relocateCapture(capture.id,plan.from,plan.to,plan.stageTo);
          store.finish(job,'complete',{directory:plan.to},undefined,'empty_checkpoint_replanned');moved++;continue;
        }
        if(!target)throw new Error('Capture assets missing; kept for repair.');
        const identity = JSON.parse(await readFile(join(target, published ? 'manifest.json' : '.folio-move.json'),'utf8'));
        if (identity.captureId !== capture.id)
          throw new Error('Rename recovery identity does not match this capture.');
        if(published && !capture.manifest && !await validateStoredCapture(store,{...capture,directory:to,manifest:identity}))throw new Error('Moved publication requires repair; files were preserved.');
        if (
          capture.manifest &&
          !(await validateStoredCapture(store, { ...capture, directory: to }))
        )
          throw new Error('Moved capture assets require repair; files were preserved.');
      }
      store.relocateCapture(capture.id, plan.from, plan.to, plan.stageTo);
      if (capture.manifest) {
        const references = store.references(capture.id);
        if (references.length)
          await atomicJson(join(inside(store.output, plan.to), 'references.v2.json'), {
            schemaVersion: 2,
            captureId: capture.id,
            references,
          });
      }
      store.finish(job, 'complete', { directory: plan.to }, undefined, 'site_folder_organized');
      moved++;
      const oldParent = dirname(inside(store.output, from));
      if (
        oldParent !== inside(store.output, 'captures') &&
        oldParent !== inside(store.output, '.staging')
      )
        try {
          await rmdir(oldParent);
        } catch {
          /* Only empty folders are removed. */
        }
    } catch (error) {
      const reason = errorMessage(error);
      store.finish(job, 'pending', undefined, reason, 'organize_interrupted_or_repair');
      exceptions.push({ captureId: capture.id, reason });
    }
  }
  // A failed rename still has an old ledger path. Export verification must not mislabel
  // temporarily relocated assets as broken design or erase their saved classification.
  if(!exceptions.length){await exportCatalog(store, false);await exportAccepted(store, profiles);}
  return { moved, exceptions };
}
