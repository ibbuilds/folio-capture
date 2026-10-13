import {writeFile,readFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {SUPPORTED_PROTOCOL_VERSIONS,LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/sdk/types.js';
import {parseConfig} from '../src/config.ts';
import {createBridgeServer} from '../src/mcp.ts';

// Static discovery metadata lets the installed plugin initialize while its local engine is offline.
// Generated from the real server, without invoking tools, collecting pages or starting inference.
const server=createBridgeServer(parseConfig({sources:['https://example.invalid/'],output:'.cache/schema-unused'}));
const client=new Client({name:'folio-tool-schema',version:'1.0.0'});
const [left,right]=InMemoryTransport.createLinkedPair();
try{
 await server.connect(right);await client.connect(left);
 const manifest=JSON.parse(await readFile('plugin.json','utf8'));
 await writeFile('mcp-tools.json',`${JSON.stringify({protocolVersion:LATEST_PROTOCOL_VERSION,supportedProtocols:SUPPORTED_PROTOCOL_VERSIONS,serverInfo:{...client.getServerVersion(),version:manifest.version},instructions:client.getInstructions(),tools:(await client.listTools()).tools},null,2)}\n`);
}finally{await client.close();await server.close();}
