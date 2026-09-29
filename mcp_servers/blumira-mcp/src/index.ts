import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

const server = await createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('Blumira MCP server started (stdio)');
