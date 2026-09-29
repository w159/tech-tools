import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { logger } from './utils/logger.js';

const server = await createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('Vanta MCP server started (stdio)');
