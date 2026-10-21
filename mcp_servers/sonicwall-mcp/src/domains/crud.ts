// Shared builder for the objects and policies domains: five tools over a
// resource enum, differing only in key (name vs uuid) and the enum itself.
import { defineDomain, destructiveTool, hasOpOrInvalid, readOnlyTool, run, STAGED_NOTE, type Entry } from './_helpers.js';

export function crudDomain(opts: { prefix: string; noun: string; resources: readonly string[]; key: 'name' | 'uuid' }) {
  const { prefix, noun, resources, key } = opts;
  const resource = { type: 'string', enum: [...resources], description: `The ${noun} resource (SonicOS wire path segment).` };
  const id = { type: 'string', description: `The ${key} of the ${noun} (required).` };
  const body = {
    type: 'object',
    description:
      'Request body, passed through verbatim. Fetch an existing object with the matching _get tool first and reuse its shape; ' +
      'the wrapper key is the singular object name, e.g. {"address_objects":[{"ipv4":{...}}]} on the collection, {"address_object":{"ipv4":{...}}} on a name/uuid route.',
  };
  const patch = { type: 'boolean', description: 'Use PATCH (partial update) instead of PUT. Rejected where the resource has no PATCH.' };
  const GROUND = `Call ${prefix}_get first and reuse the existing object's shape.`;
  const entries: Entry[] = [
    {
      tool: readOnlyTool({ name: `${prefix}_list`, description: `List ${noun} of one resource type.`, inputSchema: { type: 'object' as const, properties: { resource }, required: ['resource'] } }),
      run: (a) => run(`${prefix}_list`, (c) => c.list(a.resource as string)),
    },
    {
      tool: readOnlyTool({ name: `${prefix}_get`, description: `Get one ${noun} by ${key}.`, inputSchema: { type: 'object' as const, properties: { resource, [key]: id }, required: ['resource', key] } }),
      run: (a) => run(`${prefix}_get`, (c) => c.get(a.resource as string, key, a[key] as string)),
    },
    {
      tool: destructiveTool({ name: `${prefix}_create`, description: `Create a ${noun}. ${STAGED_NOTE} ${GROUND}`, inputSchema: { type: 'object' as const, properties: { resource, body }, required: ['resource', 'body'] } }),
      run: (a) => run(`${prefix}_create`, (c) => c.create(a.resource as string, a.body), { note: STAGED_NOTE }),
    },
    {
      tool: destructiveTool({ name: `${prefix}_update`, description: `Update a ${noun} by ${key} (PUT, or PATCH with patch: true). ${STAGED_NOTE} ${GROUND}`, inputSchema: { type: 'object' as const, properties: { resource, [key]: id, body, patch }, required: ['resource', key, 'body'] } }),
      run: async (a) => {
        const usePatch = a.patch === true;
        const method = usePatch ? 'PATCH' : 'PUT';
        const bad = hasOpOrInvalid(method, `/${a.resource as string}/${key}/{${key.toUpperCase()}}`, `${prefix}_update`);
        if (bad) return bad;
        return run(`${prefix}_update`, (c) => c.update(a.resource as string, key, a[key] as string, a.body, { patch: usePatch }), { note: STAGED_NOTE });
      },
    },
    {
      tool: destructiveTool({ name: `${prefix}_delete`, description: `Delete a ${noun} by ${key}. ${STAGED_NOTE} Ground the ${key} with ${prefix}_list first.`, inputSchema: { type: 'object' as const, properties: { resource, [key]: id }, required: ['resource', key] } }),
      run: (a) => run(`${prefix}_delete`, (c) => c.remove(a.resource as string, key, a[key] as string), { note: STAGED_NOTE }),
    },
  ];
  return defineDomain(entries);
}
