import { defineDomain, destructiveTool, run } from './_helpers.js';

export const sessionHandler = defineDomain([
  {
    tool: destructiveTool({
      name: 'sonicwall_logout',
      description:
        'Log out of the SonicOS API session and release the single admin slot, without stopping the server. ' +
        'Any uncommitted pending config is discarded by the firewall when the session ends; commit first with sonicwall_config_commit if it should survive. ' +
        'The next tool call logs in again automatically.',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
    run: () => run('sonicwall_logout', async (c) => { await c.logout(); return { loggedOut: true }; }),
  },
]);
