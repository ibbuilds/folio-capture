import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Frozen when the process starts: a git pull cannot update already loaded engine modules.
const directory = dirname(fileURLToPath(import.meta.url));
const digest = createHash('sha256');
for (const name of readdirSync(directory)
  .filter((n) => n.endsWith('.ts'))
  .sort()) {
  digest
    .update(name)
    .update('\0')
    .update(readFileSync(join(directory, name), 'utf8').replaceAll('\r\n', '\n'));
}
export const RUNTIME_FINGERPRINT = digest.digest('hex');
