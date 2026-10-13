import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './types.ts';
import { ensureCodexReady } from './classifier-ready.ts';
import { errorMessage } from './utils.ts';
import { BRIDGE_CONTEXT_ID } from './bridge.ts';
import { RUNTIME_FINGERPRINT } from './runtime.ts';

/** Read-only connection diagnosis. Never collects a page or invokes inference. */
export async function doctor(config: Config, port = 4317) {
  if (config.classifier.runner === 'codex') {
    try {
      await ensureCodexReady(config.classifier);
      return { provider: 'codex', ready: true, authentication: 'ChatGPT', inferenceStarted: false };
    } catch (error) {
      return {
        provider: 'codex',
        ready: false,
        error: errorMessage(error),
        inferenceStarted: false,
      };
    }
  }
  const url = `http://127.0.0.1:${port}`;
  const headers:Record<string,string>=process.env.FOLIO_MCP_TOKEN?{Authorization:`Bearer ${process.env.FOLIO_MCP_TOKEN}`} : {};
  const client = new Client({ name: 'folio-connection-check', version: '0.5.0' });
  let engineReachable=false,restartRequired=false;
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000),headers });
    if (!response.ok) throw new Error(`Local engine HTTP ${response.status}`);
    const health = (await response.json()) as { name: string; version?: string; protocolContextId?:string; runtimeFingerprint?:string; output?: string };
    if (health.name !== 'folio-capture-classifier' || health.version !== '0.5.0')
      throw new Error(
        'An older or different engine is running. Stop its terminal and restart after git pull.',
      );
    engineReachable=true;
    if (!health.output || resolve(health.output) !== resolve(config.output))
      throw new Error(
        'The running engine uses a different output folder. Use the same --config for capture and doctor.',
      );
    if(health.protocolContextId!==BRIDGE_CONTEXT_ID || health.runtimeFingerprint!==RUNTIME_FINGERPRINT){restartRequired=true;throw new Error('The running engine has older loaded code. Stop its terminal with Ctrl+C, restart the updated engine, then get_context and start_run again. Saved work is retained.');}
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`),{requestInit:{headers}}), {
      timeout: 5000,
    });
    const tools = (await client.listTools()).tools.map((t) => t.name);
    if (
      !['get_context', 'get_concepts', 'start_run', 'get_packet', 'submit_result', 'status'].every(
        (t) => tools.includes(t),
      )
    )
      throw new Error(
        'The required classifier tools are missing. Refresh the Folio plugin connection.',
      );
    const result = await client.callTool({ name: 'status', arguments: {} }, undefined, {
      timeout: 5000,
    });
    if (result.isError) throw new Error('The engine rejected its status request.');
    const parsed = CallToolResultSchema.parse(result);
    const status = JSON.parse(
      parsed.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    );
    return {
      provider: 'mcp',
      engineReachable: true,
      engineVersion: health.version,
      output: health.output,
      desktopLauncherSeen: Boolean(status.connection.desktopLauncherSeenAt),
      paired: status.connection.paired,
      ready: Boolean(status.connection.paired),
      phase: status.workflow?.phase ?? 'awaiting-chat',
      classified: status.classified,
      pending: status.counts.pending,
      inferenceStarted: false,
      next: status.connection.paired
        ? 'The paired chat drives the loop.'
        : 'Ordinary ChatGPT requires a registered Secure MCP Tunnel connection to this engine. Keep tunnel-client running, select the connected plugin and call get_context and start_run. The packaged STDIO launcher requires a local-executor thread.',
    };
  } catch (error) {
    return {
      provider: 'mcp',
      engineReachable,
      restartRequired,
      paired: false,
      ready: false,
      error: errorMessage(error),
      next: 'Start npm run capture -- --classifier mcp and keep that terminal open. For ordinary ChatGPT, keep its registered Secure MCP Tunnel running too.',
      inferenceStarted: false,
    };
  } finally {
    await client.close().catch(() => {});
  }
}
