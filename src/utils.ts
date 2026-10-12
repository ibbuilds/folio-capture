import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

export const now = () => new Date().toISOString();
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const idFor = (value: unknown) => hash(value).slice(0, 24);
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function publicUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Sources must be HTTP(S) URLs without embedded credentials.');
  return url.href;
}

export function canonicalUrl(value: string): string {
  const url = new URL(publicUrl(value));
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.href;
}

export function inside(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error(`Artifact path escapes its output folder: ${path}`);
  return target;
}

export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export async function jsonFile<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolveDelay, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolveDelay(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('Interrupted')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function isRelatedDestination(requested: string, destination: string): boolean {
  const a = new URL(requested).hostname.replace(/^www\./, '');
  const b = new URL(destination).hostname.replace(/^www\./, '');
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
