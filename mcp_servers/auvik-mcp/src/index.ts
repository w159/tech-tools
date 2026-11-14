import { startHttpTransport } from './http-transport.js';
import { startStdioTransport } from './stdio-transport.js';

// No dotenv: reading <cwd>/.env would let any launch directory set the
// credentials and region. Env comes from the launcher (the armada plugin's
// mcp/_env/load.mjs, an MCP host's env block, or the shell).

const transport = process.env.MCP_TRANSPORT || (process.argv.includes('--stdio') ? 'stdio' : 'http');

async function main() {
  try {
    if (transport === 'stdio') {
      console.error('Starting Auvik MCP server (stdio)...');
      await startStdioTransport();
    } else {
      console.error('Starting Auvik MCP server (http)...');
      await startHttpTransport();
    }
  } catch (error) {
    console.error('Failed to start Auvik MCP server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});