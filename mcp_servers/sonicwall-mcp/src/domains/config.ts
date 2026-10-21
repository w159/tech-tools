import { defineDomain, destructiveTool, getEntry, run } from './_helpers.js';

export const configHandler = defineDomain([
  getEntry('sonicwall_config_pending', 'Show the staged (uncommitted) config delta (GET /config/pending). Check this before sonicwall_config_commit.', '/config/pending'),
  {
    tool: destructiveTool({
      name: 'sonicwall_config_commit',
      description:
        'VISIBLE-TO-OTHERS: commits ALL staged pending config (POST /config/pending), which changes traffic handling for everyone behind the firewall. ' +
        'Review sonicwall_config_pending first. Set bestEffort to commit with /config/pending/best-effort, which applies what it can instead of failing the whole commit.',
      inputSchema: {
        type: 'object' as const,
        properties: { bestEffort: { type: 'boolean', description: 'Use POST /config/pending/best-effort.' } },
      },
    }),
    run: (args) => run('sonicwall_config_commit', (c) => c.commit({ bestEffort: args.bestEffort === true })),
  },
  {
    tool: destructiveTool({
      name: 'sonicwall_config_discard',
      description: 'Discard ALL staged pending config (DELETE /config/pending). Staged writes are lost; committed config is untouched.',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
    run: () => run('sonicwall_config_discard', (c) => c.discard()),
  },
  {
    tool: destructiveTool({
      name: 'sonicwall_config_mode',
      description:
        'VISIBLE-TO-OTHERS: enter config mode (POST /config-mode). When SONICWALL_SESSION_OVERRIDE is true this evicts a human admin who holds config mode. ' +
        'Write tools enter config mode automatically; call this only to recover from a non-config error.',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
    run: () => run('sonicwall_config_mode', (c) => c.configMode()),
  },
  {
    tool: destructiveTool({
      name: 'sonicwall_non_config_mode',
      description: 'Leave config mode and release the config lock (POST /non-config-mode). Uncommitted pending config may be lost.',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
    run: () => run('sonicwall_non_config_mode', (c) => c.nonConfigMode()),
  },
]);
