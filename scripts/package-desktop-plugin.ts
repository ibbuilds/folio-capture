import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

/** Package only the portable manifest and built-in-only launcher; no private config, images or dependencies. */
export async function packageDesktopPlugin(
  destination = resolve('.cache', 'desktop-plugin', randomUUID(), 'folio-capture'),
) {
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length)
    throw new Error(
      'The desktop package destination must be empty; existing files were preserved.',
    );
  await mkdir(join(destination, 'scripts'), { recursive: true });
  for (const file of ['plugin.json', 'mcp.json', 'scripts/desktop-bridge.mjs']) {
    const output = join(destination, file);
    await copyFile(resolve(file), output);
  }
  const manifest = JSON.parse(await readFile(join(destination, 'plugin.json'), 'utf8'));
  return {
    directory: destination,
    name: manifest.name,
    version: manifest.version,
    files: await Promise.all(
      ['plugin.json', 'mcp.json', 'scripts/desktop-bridge.mjs'].map(async (file) => ({
        file,
        sha256: createHash('sha256')
          .update(await readFile(join(destination, file)))
          .digest('hex'),
      })),
    ),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('desktop:package takes no options.');
  console.log(JSON.stringify(await packageDesktopPlugin(), null, 2));
}
