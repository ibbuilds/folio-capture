import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const internalName = (name: string) => `.folio/${name}`;
/** Old collections stay readable until explicit, stopped-engine migration. */
export function savedName(output: string, name: string) {
  const current = internalName(name);
  return existsSync(join(output, current))
    ? current
    : existsSync(join(output, name))
      ? name
      : current;
}
export function databaseName(output: string) {
  if (
    existsSync(join(output, 'state.sqlite')) &&
    existsSync(join(output, internalName('state.sqlite')))
  )
    throw new Error('Two Folio registries exist; refusing to select one silently.');
  return savedName(output, 'state.sqlite');
}
export const captureKey = (folder: string) => folder.replace(/^(?:\.folio\/)?captures\//, '');
