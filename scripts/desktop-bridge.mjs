import { createInterface } from 'node:readline';

// This portable launcher uses only Node built-ins. It still works in the installed plugin cache.
const endpoint = new URL(process.env.FOLIO_BRIDGE_URL || 'http://127.0.0.1:4317/mcp');
if (
  endpoint.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(endpoint.hostname) ||
  endpoint.pathname !== '/mcp' ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
) {
  throw new Error('Folio Desktop connects only to a loopback HTTP /mcp endpoint.');
}
let protocolVersion;
const tasks = new Set();
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const error = (id, message, code = -32000) =>
  write({ jsonrpc: '2.0', id, error: { code, message } });

async function forward(line) {
  let request;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('MCP request exceeds 1 MiB.');
    request = JSON.parse(line);
    if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string')
      throw new Error('Invalid MCP request.');
  } catch {
    error(null, 'Invalid MCP JSON request.', -32700);
    return;
  }
  const hasId = Object.hasOwn(request, 'id');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
        ...(process.env.FOLIO_MCP_TOKEN
          ? { Authorization: `Bearer ${process.env.FOLIO_MCP_TOKEN}` }
          : {}),
      },
      body: line,
    });
    if (!response.ok) throw new Error(`Folio local bridge returned HTTP ${response.status()}.`);
    if (response.status === 202 || !hasId) return;
    const result = await response.json();
    if (result.jsonrpc !== '2.0' || result.id !== request.id)
      throw new Error('Invalid response from Folio local bridge.');
    if (request.method === 'initialize') protocolVersion = result.result?.protocolVersion;
    write(result);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Connection failed';
    const note = `${message} Start npm run bridge -- --http in your Folio Capture checkout and keep it running. No Codex or AI API was invoked.`;
    if (hasId) error(request.id, note);
    else process.stderr.write(`${note}\n`);
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  const task = forward(line);
  tasks.add(task);
  void task.finally(() => tasks.delete(task));
});
input.on('close', async () => {
  await Promise.allSettled(tasks);
});
