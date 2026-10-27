// The SonicOS endpoint inventory (vendor Swagger dump, 7.3.2-7010) that
// grounds sonicwall_navigate and sonicwall_request. Inlined into the bundle.
import inventory from '../../sonicos-endpoints.json';

export interface Op {
  method: string;
  path: string;
  tag: string;
  re: RegExp;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `{PARAM}` segments match any non-empty segment; every literal segment must match exactly. */
const toRegex = (path: string): RegExp =>
  new RegExp('^' + path.split('/').map((seg) => (/^\{[^}]+\}$/.test(seg) ? '[^/]+' : escapeRe(seg))).join('/') + '$');

const OPS: Op[] = (inventory.ops as Array<{ method: string; path: string; tag: string }>).map((o) => ({
  ...o,
  re: toRegex(o.path),
}));

const BASE = inventory.base as string;

/** Normalize a model-supplied path: strip query, the /api/sonicos base, trailing slash; force a leading slash. */
export function normalizePath(raw: string): string {
  let p = raw.trim().split('?')[0];
  if (p.startsWith(BASE + '/')) p = p.slice(BASE.length);
  if (!p.startsWith('/')) p = '/' + p;
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function matchPath(path: string): Op[] {
  return OPS.filter((o) => o.re.test(path));
}

export function hasOp(method: string, templatePath: string): boolean {
  return OPS.some((o) => o.method === method && o.path === templatePath);
}

/** The three inventory rows whose path shares the most leading segments with `path`. */
export function nearest(path: string, n = 3): Op[] {
  const want = path.split('/').filter(Boolean);
  const score = (o: Op): number => {
    const have = o.path.split('/').filter(Boolean);
    let lead = 0;
    while (lead < want.length && lead < have.length && want[lead] === have[lead]) lead++;
    const shared = want.filter((w) => have.includes(w)).length;
    return lead * 10 + shared - Math.abs(have.length - want.length) * 0.1;
  };
  const seen = new Set<string>();
  return [...OPS]
    .sort((a, b) => score(b) - score(a))
    .filter((o) => { const k = `${o.method} ${o.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
}

/** Rows matching every whitespace-separated term in method + path + tag, capped. */
export function search(terms: string, cap = 50): Array<{ method: string; path: string; tag: string }> {
  const ts = terms.toLowerCase().split(/\s+/).filter(Boolean);
  return OPS.filter((o) => {
    const hay = `${o.method} ${o.path} ${o.tag}`.toLowerCase();
    return ts.every((t) => hay.includes(t));
  })
    .slice(0, cap)
    .map(({ method, path, tag }) => ({ method, path, tag }));
}
