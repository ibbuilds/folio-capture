import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseConfig } from '../src/config.ts';
import { main as cli } from '../src/cli.ts';
import { AnalysisBridge, BRIDGE_CONTEXT_ID } from '../src/bridge.ts';
import { serveBridgeHttp } from '../src/mcp.ts';
import { packageDesktopPlugin } from '../scripts/package-desktop-plugin.ts';
import { Store } from '../src/store.ts';
import { curateCapture, CRITERIA } from '../src/quality.ts';
import { TAXONOMY } from '../src/taxonomy.ts';
import type { PageManifest } from '../src/types.ts';
import { Workflow } from '../src/workflow.ts';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function fixture(t: test.TestContext, parts = 1) {
  const root = await mkdtemp(join(tmpdir(), 'folio-mcp-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const store = new Store(root),
    page = store.page('https://product.test/');
  const directory = `captures/${page.id}/fixture`,
    frames = [];
  await mkdir(join(root, directory), { recursive: true });
  for (let i = 0; i < parts; i++) {
    const png = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 4,
        background: { r: 30 + i * 10, g: 40, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(join(root, directory, `${i}.png`), png);
    await sharp(png)
      .webp()
      .toFile(join(root, directory, `${i}.webp`));
    frames.push({
      path: `${i}.png`,
      thumbnail: `${i}.webp`,
      width: 80,
      height: 60,
      sha256: createHash('sha256').update(png).digest('hex'),
      bounds: { x: 0, y: 0, width: 80, height: 60 },
      scrollY: 0,
      kind: 'static' as const,
    });
  }
  const manifest: PageManifest = {
    schemaVersion: 1,
    pageId: page.id,
    captureId: 'fixture',
    captureSignature: 'sig',
    requestedUrl: page.url,
    title: 'Saved product',
    capturedAt: new Date().toISOString(),
    status: 'complete',
    reviewStatus: 'unreviewed',
    provenance: [],
    variants: [
      {
        profile: {
          id: 'desktop',
          width: 1440,
          height: 1000,
          dpr: 2,
          isMobile: false,
          hasTouch: false,
        },
        status: 'complete',
        requestedUrl: page.url,
        finalUrl: page.url,
        title: 'Saved product',
        capturedAt: new Date().toISOString(),
        pageHeight: 60,
        regions: [
          {
            id: 'hero',
            order: 0,
            title: 'Hero',
            bounds: { x: 0, y: 0, width: 80, height: 60 },
            captureBounds: { x: 0, y: 0, width: 80, height: 60 },
            method: 'semantic',
            boundaryConfidence: 'high',
            frames,
            evidenceIds: ['hero-dom'],
          },
        ],
        evidence: [
          {
            id: 'hero-dom',
            regionId: 'hero',
            kind: 'region-dom',
            value: { text: 'Build better products' },
          },
        ],
        warnings: [],
        interventions: [],
        coverage: [{ start: 0, end: 60 }],
        stoppingReason: 'covered',
        environment: {},
      },
    ],
  };
  store.createCapture(page, 'sig', directory, 'staging', 'fixture');
  store.publishCapture(manifest, directory);
  store.close();
  const config = parseConfig({
    output: root,
    sources: [page.url],
    classifier: { runner: 'mcp', command: 'must-never-run-nonexistent-executable' },
  });
  return { root, config, manifest, directory, bridge: new AnalysisBridge(config) };
}
function pass(id: string, accept = true) {
  return {
    score: accept ? 9 : 6,
    verdict: accept ? 'accept' : 'reject',
    evidenceIds: [id],
    reasons: ['Synthetic contract judgment only'],
    weaknesses: accept ? [] : ['Weak hierarchy'],
    criteria: Object.fromEntries(
      CRITERIA.map((c) => [
        c,
        { score: accept ? 9 : 6, evidenceIds: [id], reason: 'Fixture image' },
      ]),
    ),
  };
}
function labels(scope: string, id: string) {
  return {
    labels: Object.keys(TAXONOMY)
      .filter((a) =>
        scope === 'page'
          ? a !== 'section_purpose'
          : !['experience', 'page_purpose', 'industry', 'audience'].includes(a),
      )
      .map((axis) => ({
        axis,
        label: axis === 'appearance' ? 'clean' : axis === 'visual_style' ? 'minimalism' : 'unknown',
        evidenceIds: [id],
        confidence: 'high',
        note: 'Fixture',
        ...(axis === 'visual_style' ? { role: 'primary' } : {}),
      })),
  };
}

test('installed Desktop package runs from a bare cache and returns screenshots and validated results', async (t) => {
  const { config, root } = await fixture(t);
  const server = await serveBridgeHttp(config, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const packaged = await packageDesktopPlugin(join(root, 'installed-cache', 'folio-capture'));
  assert.deepEqual(
    packaged.files.map((f) => f.file),
    ['plugin.json', 'mcp.json', 'scripts/desktop-bridge.mjs'],
  );
  const client = new Client({ name: 'desktop-plugin-contract', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(packaged.directory, 'scripts', 'desktop-bridge.mjs')],
      cwd: root,
      env: {
        ...(process.env as Record<string, string>),
        FOLIO_BRIDGE_URL: `http://127.0.0.1:${port}/mcp`,
      },
      stderr: 'pipe',
    }),
  );
  try {
    assert.ok((await client.listTools()).tools.some((t) => t.name === 'submit_result'));
    const context = await client.callTool({ name: 'get_context', arguments: {} });
    assert.equal(context.isError, undefined);
    const packet = await client.callTool({
      name: 'get_packet',
      arguments: { contextId: BRIDGE_CONTEXT_ID },
    });
    const blocks = packet.content as any[];
    assert.ok(blocks.some((b) => b.type === 'image' && b.mimeType === 'image/png'));
    const { packet: task } = JSON.parse(blocks[0].text);
    const invalid = await client.callTool({
      name: 'submit_result',
      arguments: { packetId: task.id, value: pass('invented') },
    });
    assert.equal(invalid.isError, true);
    const result = await client.callTool({
      name: 'submit_result',
      arguments: { packetId: task.id, value: pass(task.images[0].id) },
    });
    assert.equal(JSON.parse((result.content as any[])[0].text).committed, true);
    const status = await client.callTool({ name: 'status', arguments: {} });
    assert.equal(JSON.parse((status.content as any[])[0].text).modelCallsStartedByBridge, 0);
  } finally {
    await client.close();
  }
});

test('one ChatGPT start drives backlog, capture, validated review and export; competing chats and collectors cannot duplicate it', async (t) => {
  const { config, root } = await fixture(t, 5);
  config.sources = [
    { url: 'https://product.test/one', kind: 'page' },
    { url: 'https://product.test/two', kind: 'page' },
  ];
  config.profiles = [config.profiles.find((p) => p.id === 'desktop')!];
  Object.assign(config.capture, {
    maxAttempts: 1,
    mediaTimeoutMs: 400,
    settleTimeoutMs: 600,
    cleanupTimeoutMs: 400,
    explorationTimeoutMs: 4000,
    attemptTimeoutMs: 15000,
  });
  let launches = 0;
  const server = await serveBridgeHttp(config, 0, {
    waitMs: 50,
    runOptions: {
      log: () => {},
      launchBrowser: async () => {
        launches++;
        const browser = await chromium.launch({
          headless: true,
          channel: 'chromium',
          executablePath: process.env.FOLIO_TEST_BROWSER_PATH,
        });
        const context = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const c = await context(options);
          await c.route('**/*', (route) =>
            route.fulfill({
              contentType: 'text/html',
              body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}section{min-height:1000px;padding:40px;box-sizing:border-box}</style><main><section><h1>Build better products</h1><p>One deterministic reference.</p></section></main>',
            }),
          );
          return c;
        };
        return browser;
      },
    },
  });
  t.after(() => new Promise<void>((accept) => server.close(() => accept())));
  const client = new Client({ name: 'automatic-contract', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`),
    ),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as any[])[0].text);
  };
  const context = await call('get_context');
  const started = await call('start_run', {
    contextId: context.contextId,
    clientId: context.clientId,
    limit: 2,
  });
  const session = { runId: started.runId, clientId: started.clientId };
  try {
    assert.equal(launches, 0, 'Saved review backlog is drained before Chromium starts');
    assert.equal(
      (
        await call('start_run', {
          ...session,
          runId: undefined,
          contextId: context.contextId,
          limit: 2,
        })
      ).runId,
      started.runId,
    );
    const other = await call('get_context');
    assert.equal(
      (
        await client.callTool({
          name: 'start_run',
          arguments: { contextId: other.contextId, clientId: other.clientId, limit: 2 },
        })
      ).isError,
      true,
    );
    const guard = new Store(root);
    try {
      assert.throws(() => guard.assertWorkflowAccess(), /owns collection/);
    } finally {
      guard.close();
    }
    let packets = 0,
      done = false,
      sawWaiting = false;
    for (let i = 0; i < 500 && !done; i++) {
      const result = await call('get_packet', { contextId: context.contextId, ...session });
      if (result.done) {
        assert.equal(result.phase, 'completed', JSON.stringify(result));
        done = true;
        break;
      }
      if (result.waiting) {
        sawWaiting = true;
        const status = await call('status');
        assert.equal(status.workflow.phase, 'collecting');
        continue;
      }
      const packet = result.packet;
      packets++;
      let offset = result.nextOffset,
        remaining = result.remainingImages;
      while (remaining) {
        const more = await call('get_images', { packetId: packet.id, offset, ...session });
        offset = more.nextOffset;
        remaining = more.remainingImages;
      }
      if (packets === 1) {
        const invalid = await client.callTool({
          name: 'submit_result',
          arguments: { packetId: packet.id, value: pass('invented'), ...session },
        });
        assert.equal(invalid.isError, true);
        assert.equal(launches, 0);
      }
      const value =
        packet.phase === 'classification'
          ? labels(packet.scope, packet.images[0].id)
          : pass(packet.images[0].id, packet.scope === 'section');
      const first = await call('submit_result', { packetId: packet.id, value, ...session });
      assert.equal(first.committed, true);
      assert.equal(
        (await call('submit_result', { packetId: packet.id, value, ...session })).idempotent,
        true,
      );
    }
    assert.ok(done);
    assert.ok(sawWaiting);
    assert.equal(launches, 1);
    const status = await call('status');
    assert.equal(status.counts.pending, 0);
    assert.equal(status.modelCallsStartedByBridge, 0);
    assert.ok(status.classified >= 3);
    const store = new Store(root);
    try {
      assert.equal(store.latestCaptures().length, 3);
      assert.equal(store.jobs('mcp-response').length, packets);
      assert.ok(
        store
          .references()
          .filter((r) => r.quality.verdict === 'accepted')
          .every((r) => r.classification),
      );
    } finally {
      store.close();
    }
    const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
    assert.ok(catalog.references.every((r: any) => r.scope === 'section'));
    assert.ok(catalog.references.every((r: any) => r.images.every((im: any) => im.assetId)));
  } finally {
    await new Workflow(config).shutdown();
    await client.close();
  }
});

test('an idle chat pauses rather than claiming completion, and its committed assessment resumes without recapture', async (t) => {
  const { config, bridge } = await fixture(t);
  const workflow = new Workflow(config, { idleMs: 60, waitMs: 10 });
  const context = bridge.context();
  let run = await workflow.start(context.contextId, context.clientId);
  let packet = await workflow.next(context.contextId, run.runId, run.clientId);
  if ('done' in packet) assert.fail('assessment missing');
  await bridge.submit(packet.packet.id, pass(packet.images[0].id));
  await new Promise((accept) => setTimeout(accept, 120));
  const paused = await workflow.next(context.contextId, run.runId, run.clientId);
  assert.ok('done' in paused && paused.done);
  assert.equal((paused as any).phase, 'paused');
  assert.equal((paused as any).reason, 'chat_idle');
  run = await workflow.start(context.contextId, context.clientId);
  packet = await workflow.next(context.contextId, run.runId, run.clientId);
  if ('done' in packet) assert.fail('critique missing');
  assert.equal(packet.packet.phase, 'critique');
  await workflow.stop(run.runId, run.clientId);
  assert.equal((await bridge.status()).workflow?.phase, 'paused');
});

test('a restarted engine records an interrupted owner honestly and preserves the saved review stage', async (t) => {
  const { config, bridge, root } = await fixture(t);
  const workflow = new Workflow(config);
  const context = bridge.context();
  const run = await workflow.start(context.contextId, context.clientId);
  const task = await workflow.next(context.contextId, run.runId, run.clientId);
  if ('done' in task) assert.fail();
  await bridge.submit(task.packet.id, pass(task.images[0].id));
  await workflow.stop(run.runId, run.clientId);
  const store = new Store(root);
  try {
    const stale = store.getJob('workflow', 'active')!;
    const state = { ...stale.payload, phase: 'collecting', ownerPid: 2147483000 };
    store.job('workflow', 'active', state);
    store.finish(stale, 'running');
  } finally {
    store.close();
  }
  const restarted = new Workflow(config);
  const stopped = await restarted.next(context.contextId, run.runId, run.clientId);
  assert.ok('done' in stopped && stopped.done);
  assert.equal((stopped as any).phase, 'paused');
  assert.equal((stopped as any).reason, 'engine_interrupted');
  const resumed = await restarted.start(context.contextId, context.clientId);
  const next = await restarted.next(context.contextId, resumed.runId, resumed.clientId);
  if ('done' in next) assert.fail();
  assert.equal(next.packet.phase, 'critique');
  await restarted.stop(resumed.runId, resumed.clientId);
});

test('the normal MCP capture command starts a waiting engine and carries its capture limit into the chat run', async (t) => {
  const { root, config } = await fixture(t);
  const reservation = await serveBridgeHttp(config, 0);
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((accept) => reservation.close(() => accept()));
  const file = join(root, 'cli-config.json');
  await writeFile(file, JSON.stringify(config));
  const processUnderTest = spawn(
    process.execPath,
    [resolve('src/cli.ts'), 'run', '--config', file, '--port', String(port), '--limit', '1'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  t.after(() => {
    if (processUnderTest.exitCode === null) processUnderTest.kill();
  });
  let output = '';
  const ready = new Promise<void>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`Engine did not start: ${output}`)), 10000);
    processUnderTest.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Folio engine:') && output.includes('select @Folio Capture')) {
        clearTimeout(timer);
        accept();
      }
    });
    processUnderTest.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    processUnderTest.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(output));
    });
  });
  await ready;
  assert.match(output, /select @Folio Capture/);
  const client = new Client({ name: 'normal-command', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as any[])[0].text);
  };
  try {
    assert.equal((await call('status')).workflow, null);
    const context = await call('get_context');
    const run = await call('start_run', {
      contextId: context.contextId,
      clientId: context.clientId,
      limit: 20,
    });
    const status = await call('status');
    assert.equal(
      status.workflow.options.limit,
      1,
      'The model cannot exceed the startup capture budget',
    );
    assert.equal(status.registry.captureVersions, 1);
    await call('stop_run', { runId: run.runId, clientId: run.clientId });
    assert.equal((await call('status')).workflow.phase, 'paused');
  } finally {
    await client.close();
    const closed = once(processUnderTest, 'exit');
    processUnderTest.kill();
    await closed;
  }
});

test('Desktop launcher refuses external endpoints and gives an actionable offline error', async (t) => {
  const { root } = await fixture(t);
  const packaged = await packageDesktopPlugin(join(root, 'offline-package'));
  await writeFile(join(packaged.directory, 'private-config.json'), 'Private test fixture');
  await assert.rejects(packageDesktopPlugin(packaged.directory), /must be empty/);
  const script = join(packaged.directory, 'scripts', 'desktop-bridge.mjs');
  const offline = new Client({ name: 'offline-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    cwd: root,
    env: { ...(process.env as Record<string, string>), FOLIO_BRIDGE_URL: 'http://127.0.0.1:1/mcp' },
    stderr: 'pipe',
  });
  await assert.rejects(offline.connect(transport), /Start npm run capture/);
  await transport.close();
  const { spawnSync } = await import('node:child_process');
  const external = spawnSync(process.execPath, [script], {
    env: { ...process.env, FOLIO_BRIDGE_URL: 'https://outside.test/mcp' },
    encoding: 'utf8',
  });
  assert.notEqual(external.status, 0);
  assert.match(external.stderr, /only to a loopback/);
  assert.equal(external.stdout, '');
});

test('only MCP and Codex providers are configurable; old opt-out CLI flags are rejected', async () => {
  for (const runner of ['none', 'off', '', false])
    assert.throws(() => parseConfig({ sources: ['https://product.test'], classifier: { runner } }));
  assert.equal(parseConfig({ sources: ['https://product.test'] }).classifier.runner, 'mcp');
  assert.equal(
    parseConfig({ sources: ['https://product.test'], classifier: { runner: 'codex' } }).classifier
      .runner,
    'codex',
  );
  for (const flag of ['--capture-only', '--discover-only'])
    await assert.rejects(cli(['run', flag]), /Unknown option/);
});

test('MCP completes assessment, critique and scoped classification without CLI or API; survives restart and retries', async (t) => {
  const { root, config, bridge } = await fixture(t);
  await assert.rejects(bridge.next('0'.repeat(64)), /get_context/);
  let packet = await bridge.next(BRIDGE_CONTEXT_ID);
  assert.ok(!('done' in packet));
  if ('done' in packet) return;
  assert.equal(packet.packet.phase, 'assessment');
  assert.equal(packet.images[0].mimeType, 'image/png');
  await assert.rejects(bridge.submit(packet.packet.id, pass('invented')), /own subject scope/);
  const result = pass(packet.images[0].id, false);
  await bridge.submit(packet.packet.id, result, 'client-model');
  assert.equal((await bridge.submit(packet.packet.id, result, 'client-model')).idempotent, true);
  await assert.rejects(
    bridge.submit(packet.packet.id, pass(packet.images[0].id, true), 'client-model'),
    /different committed/,
  );
  const restarted = new AnalysisBridge(config);
  packet = await restarted.next(BRIDGE_CONTEXT_ID);
  assert.ok(!('done' in packet));
  if ('done' in packet) return;
  assert.equal(packet.packet.phase, 'critique');
  assert.ok(packet.packet.priorAssessment);
  await restarted.submit(packet.packet.id, pass(packet.images[0].id, false));
  packet = await restarted.next(BRIDGE_CONTEXT_ID);
  assert.ok(!('done' in packet));
  if ('done' in packet) return;
  assert.equal(packet.packet.scope, 'section', 'Rejected page does not reject its section');
  await restarted.submit(packet.packet.id, pass(packet.images[0].id));
  packet = await restarted.next(BRIDGE_CONTEXT_ID);
  if ('done' in packet) assert.fail('critique missing');
  await restarted.submit(packet.packet.id, pass(packet.images[0].id));
  packet = await restarted.next(BRIDGE_CONTEXT_ID);
  if ('done' in packet) assert.fail('classification missing');
  assert.equal(packet.packet.phase, 'classification');
  const invalid = labels(packet.packet.scope, packet.images[0].id);
  invalid.labels[0].label = 'invented';
  await assert.rejects(restarted.submit(packet.packet.id, invalid), /Unsupported taxonomy/);
  await restarted.submit(packet.packet.id, labels(packet.packet.scope, packet.images[0].id));
  assert.equal('done' in (await restarted.next(BRIDGE_CONTEXT_ID)), true);
  const status = await restarted.status();
  assert.equal(status.modelCallsStartedByBridge, 0);
  assert.equal(status.classified, 1);
  const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
  assert.equal(catalog.references.length, 1);
  assert.equal(catalog.references[0].scope, 'section');
  const store = new Store(root);
  try {
    assert.equal(store.jobs('mcp-response').length, 5);
    assert.ok(store.references().every((r) => r.quality.model === 'chatgpt-client-selected'));
  } finally {
    store.close();
  }
});

test('all original images must be delivered; changed DOM or pixels and stale reviews are rejected', async (t) => {
  const { bridge, root, directory, manifest, config } = await fixture(t, 5);
  const task = await bridge.next(BRIDGE_CONTEXT_ID);
  if ('done' in task) assert.fail('task missing');
  assert.equal(task.images.length, 4);
  assert.equal(task.remaining, 1);
  await assert.rejects(bridge.submit(task.packet.id, pass(task.images[0].id)), /Retrieve all/);
  await bridge.images(task.packet.id, task.nextOffset, 1);
  const store = new Store(root);
  manifest.variants[0].title = 'Changed evidence';
  store.publishCapture(manifest, directory);
  store.close();
  await assert.rejects(bridge.submit(task.packet.id, pass(task.images[0].id)), /Stale capture/);
  const next = await bridge.next(BRIDGE_CONTEXT_ID);
  if ('done' in next) assert.fail('new task missing');
  assert.notEqual(next.packet.id, task.packet.id);
  await writeFile(join(root, directory, '0.png'), 'Tampered');
  await assert.rejects(bridge.images(next.packet.id, 0), /hash mismatch/);
  // Force reassessment of unchanged pixels invalidates the old queue and does not replay prior model responses.
  const fresh = await fixture(t);
  const first = await fresh.bridge.next(BRIDGE_CONTEXT_ID);
  if ('done' in first) assert.fail();
  await fresh.bridge.submit(first.packet.id, pass(first.images[0].id));
  const ledger = new Store(fresh.root);
  await curateCapture(ledger, 'fixture', fresh.config, { reassess: true });
  ledger.close();
  await assert.rejects(
    fresh.bridge.submit(first.packet.id, pass(first.images[0].id)),
    /Stale capture or review/,
  );
  const forced = await fresh.bridge.next(BRIDGE_CONTEXT_ID);
  if ('done' in forced) assert.fail();
  assert.equal(forced.packet.phase, 'assessment');
  assert.notEqual(forced.packet.id, first.packet.id);
  assert.equal(config.classifier.runner, 'mcp');
});

test('HTTP and STDIO expose genuine MCP tools with clean protocol and no model invocation', async (t) => {
  const { config, root } = await fixture(t);
  const http = await serveBridgeHttp(config, 0);
  const port = (http.address() as { port: number }).port;
  t.after(() => new Promise<void>((resolve) => http.close(() => resolve())));
  const url = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal(
    (await fetch(`${url}/mcp`, { method: 'POST', headers: { Origin: 'https://untrusted.test' } }))
      .status,
    403,
  );
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  const listed = await client.listTools();
  assert.ok(listed.tools.some((t) => t.name === 'get_packet'));
  const ctx = await client.callTool({ name: 'get_context', arguments: {} });
  assert.equal(ctx.isError, undefined);
  const response = await client.callTool({
    name: 'get_packet',
    arguments: { contextId: BRIDGE_CONTEXT_ID },
  });
  assert.ok((response.content as any[]).some((c) => c.type === 'image'));
  await client.close();
  const configPath = join(root, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  const stdio = new Client({ name: 'stdio-test', version: '1.0.0' });
  await stdio.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/mcp.ts'), '--config', configPath],
      stderr: 'pipe',
    }),
  );
  const status = await stdio.callTool({ name: 'status', arguments: {} });
  assert.equal(status.isError, undefined);
  assert.match((status.content as any[])[0].text, /"modelCallsStartedByBridge":0/);
  await stdio.close();
});
