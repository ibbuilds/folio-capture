import { createInterface } from 'node:readline';
import {readFile} from 'node:fs/promises';

const metadata=JSON.parse(await readFile(new URL('../mcp-tools.json',import.meta.url),'utf8'));

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
  if(request.method==='initialize'){
    protocolVersion=metadata.supportedProtocols.includes(request.params?.protocolVersion)?request.params.protocolVersion:metadata.protocolVersion;
    if(hasId)write({jsonrpc:'2.0',id:request.id,result:{protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:metadata.serverInfo,instructions:metadata.instructions}});
    return;
  }
  if(request.method==='tools/list'){if(hasId)write({jsonrpc:'2.0',id:request.id,result:{tools:metadata.tools}});return;}
  if(request.method==='ping'){if(hasId)write({jsonrpc:'2.0',id:request.id,result:{}});return;}
  if(request.method==='notifications/initialized')return;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'X-Folio-Client': 'desktop-plugin/0.5.0',
        Accept: 'application/json, text/event-stream',
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
        ...(process.env.FOLIO_MCP_TOKEN
          ? { Authorization: `Bearer ${process.env.FOLIO_MCP_TOKEN}` }
          : {}),
      },
      body: line,
    });
    if (!response.ok) throw new Error(`Folio local bridge returned HTTP ${response.status}.`);
    if (response.status === 202 || !hasId) return;
    const result = await response.json();
    if (result.jsonrpc !== '2.0' || result.id !== request.id)
      throw new Error('Invalid response from Folio local bridge.');
    if (request.method === 'initialize') protocolVersion = result.result?.protocolVersion;
    write(result);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Connection failed';
    const note = `${message} Start npm run capture -- --classifier mcp in your Folio Capture checkout and keep it running. No Codex or AI API was invoked.`;
    if(hasId&&request.method==='tools/call')write({jsonrpc:'2.0',id:request.id,result:{isError:true,content:[{type:'text',text:JSON.stringify({provider:'chatgpt-mcp',engineReachable:false,paired:false,collectionStarted:false,error:note})}]}});
    else if (hasId) error(request.id, note);
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
