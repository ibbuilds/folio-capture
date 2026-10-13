import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Store } from '../src/store.ts';
import { shareCaptureAssets, registerCaptureAssets } from '../src/assets.ts';
import { imageName } from '../src/naming.ts';

test('identical published pixels share storage across captures; pruned or tampered registry paths are not reused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'folio-assets-'));
  const store = new Store(root);
  try {
    const png = await sharp({ create: { width: 60, height: 40, channels: 4, background: 'white' } })
      .png()
      .toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const a = join(root, 'captures/a'),
      b = join(root, 'captures/b');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, 'one.png'), png);
    await registerCaptureAssets(store, 'captures/a');
    await writeFile(join(b, 'two.png'), png);
    await writeFile(join(b, 'three.png'), png);
    await shareCaptureAssets(store, b);
    await registerCaptureAssets(store, 'captures/b');
    const first = await stat(join(a, 'one.png'));
    assert.equal((await stat(join(b, 'two.png'))).ino, first.ino);
    assert.equal((await stat(join(b, 'three.png'))).ino, first.ino);
    await rm(join(a, 'one.png'));
    assert.deepEqual(await readFile(join(b, 'two.png')), png);
    store.saveAsset(sha, 'captures/missing.png');
    const c = join(root, 'captures/c');
    await mkdir(c, { recursive: true });
    await writeFile(join(c, 'four.png'), png);
    await shareCaptureAssets(store, c);
    await registerCaptureAssets(store, 'captures/c');
    assert.deepEqual(await readFile(join(c, 'four.png')), png);
    assert.equal(store.asset(sha), 'captures/c/four.png');
    await writeFile(join(c, 'four.png'), 'tampered');
    const d = join(root, 'captures/d');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'five.png'), png);
    await shareCaptureAssets(store, d);
    assert.deepEqual(await readFile(join(d, 'five.png')), png);
    assert.notEqual((await stat(join(d, 'five.png'))).ino, (await stat(join(c, 'four.png'))).ino);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('image names are ordered, bounded, Windows-safe and distinguish pages, viewports, sections and states', () => {
  const base = { section: { title: 'CON / Téšt 👻 . '.repeat(20), order: 2 }, part: 1 };
  const name = imageName('https://example.com/pricing?plan=pro', 'tablet-landscape', base);
  assert.match(name, /example-com--pricing-plan-pro--s003-con-test/);
  assert.match(name, /--tablet-landscape--part-001$/);
  assert.ok(name.length <= 105);
  assert.match(name, /^[a-z0-9-]+$/);
  assert.notEqual(
    name,
    imageName('https://example.com/pricing?plan=free', 'tablet-landscape', base),
  );
  assert.notEqual(name, imageName('https://example.com/pricing?plan=pro', 'mobile', base));
  const states = ['scroller-one', 'scroller-two'].map((stateKey,index) =>
    imageName('https://example.com/', 'desktop', { ...base, stateKey,part:index+1 }),
  );
  assert.notEqual(states[0], states[1]);
  assert.ok(
    imageName('https://example.com/', 'desktop', { section: { title: 'Hero', order: 1 } }) <
      imageName('https://example.com/', 'desktop', { section: { title: 'Hero', order: 10 } }),
  );
  assert.doesNotThrow(() =>
    imageName('https://example.com/%ZZ', 'desktop', { diagnostic: 'before-cleanup' }),
  );
});
