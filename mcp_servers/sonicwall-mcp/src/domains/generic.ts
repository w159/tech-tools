import { defineDomain, invalid, run, STAGED_NOTE, unknownEffectTool, toQuery } from './_helpers.js';
import { matchPath, nearest, normalizePath } from '../utils/inventory.js';

// Hard-deny regardless of `confirm`: lockout, data-destroying, secret-exporting
// or session-breaking endpoints (docs/sonicwall-connector-design.md, "The
// generic tool, grounded"). Segment-aware, so /authors is not caught by /auth.
const DENY_PREFIXES = [
  '/restart', '/import/', '/cloud-backup-boot', '/local-backup-boot', '/administration/password',
  '/administration/unbind-totp-key', '/log/clear-log', '/access-rules/restore-defaults', '/auth', '/tfa',
  '/direct-mode', '/export/current-config',
];
const denyReason = (method: string, path: string): string | undefined => {
  const p = path.toLowerCase();
  for (const d of DENY_PREFIXES) {
    if (d.endsWith('/') ? p.startsWith(d) : d === '/restart' ? p.startsWith(d) : p === d || p.startsWith(d + '/')) return `path starts with ${d}`;
  }
  if (p.includes('factory-default')) return 'path contains factory-default';
  if (p.includes('/all-')) return 'path is a delete-all endpoint (/all-)';
  if (method === 'DELETE' && /\/all$/.test(p)) return 'DELETE on a trailing /all path is a delete-all endpoint';
  return undefined;
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const genericHandler = defineDomain([
  {
    tool: unknownEffectTool({
      name: 'sonicwall_request',
      description:
        'Call any SonicOS REST endpoint listed in the vendor endpoint inventory. The path must match an inventory row; an unlisted path is rejected with the nearest rows. ' +
        'Some endpoints are hard-denied regardless of confirm (restart, import, password and TOTP, clear-log, restore-defaults, auth, factory-default, delete-all, full config export). ' +
        'Any non-GET needs confirm: true and changes the firewall: it is staged in the pending config and takes effect only after sonicwall_config_commit, a separate call. ' +
        'Ground the path with `sonicwall_navigate` first. Do not compose a path from memory.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          method: { type: 'string', enum: METHODS, description: 'HTTP method.' },
          path: { type: 'string', description: 'Endpoint path from the inventory, e.g. "/address-objects/ipv4/name/web-1". No query string, no host.' },
          query: { type: 'object', description: 'Optional flat object of query parameters.' },
          body: { type: 'object', description: 'Optional JSON body for POST/PUT/PATCH/DELETE.' },
          confirm: { type: 'boolean', description: 'Required true for any non-GET.' },
        },
        required: ['method', 'path'],
      },
    }),
    run: async (a) => {
      const method = String(a.method).toUpperCase();
      if (!METHODS.includes(method)) return invalid(`Unsupported method: ${String(a.method)}. Use one of ${METHODS.join(', ')}.`);
      const path = normalizePath(String(a.path ?? ''));
      const denied = denyReason(method, path);
      if (denied) return invalid(`${method} ${path} is hard-denied (${denied}); confirm cannot override this.`, 'Use the curated tools, or the SonicOS admin UI, for this action.');
      const rows = matchPath(path);
      if (rows.length === 0) {
        const near = nearest(path).map((o) => `${o.method} ${o.path}`).join('; ');
        return invalid(`${path} is not in the SonicOS endpoint inventory.`, `Nearest rows: ${near}. Ground the path with sonicwall_navigate.`);
      }
      if (!rows.some((o) => o.method === method)) {
        return invalid(`${method} is not listed for ${path}. Inventory lists: ${[...new Set(rows.map((o) => o.method))].join(', ')}.`);
      }
      if (method !== 'GET' && a.confirm !== true) {
        return invalid(`${method} ${path} changes the firewall; pass confirm: true to proceed. ${STAGED_NOTE}`);
      }
      return run(
        'sonicwall_request',
        (c) => c.request(method as 'GET', path, { query: toQuery(a.query), body: a.body }),
        method === 'GET' ? {} : { note: STAGED_NOTE },
      );
    },
  },
]);
