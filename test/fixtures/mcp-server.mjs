import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'ailo-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
 { name: 'read_example', description: 'Returns a fixed fixture value', inputSchema: { type: 'object', properties: {} } },
 { name: 'other_example', description: 'Another fixture tool', inputSchema: { type: 'object', properties: {} } }
] }));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'MCP-FIXTURE-42' }] }));
await server.connect(new StdioServerTransport());
