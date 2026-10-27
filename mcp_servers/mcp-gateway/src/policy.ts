import { parse as parseYaml } from "yaml";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Effect classes
// ---------------------------------------------------------------------------

export type Effect = "read" | "write" | "destructive";
export const EFFECTS: readonly Effect[] = ["read", "write", "destructive"];

// Derived from MCP tool annotations. Fails closed: no annotations, or a
// mutating tool that does not say destructiveHint:false, is destructive. This
// matches the MCP default (destructiveHint defaults to true) and
// mcp_servers/_shared/annotate-tool.ts, which sets both flags explicitly.
export function effectOf(tool: Tool): Effect {
  const a = tool.annotations;
  if (!a) return "destructive";
  if (a.readOnlyHint === true) return "read";
  if (a.destructiveHint === false) return "write";
  return "destructive";
}

// ---------------------------------------------------------------------------
// Policy document (policy.yaml, schema version 1)
// ---------------------------------------------------------------------------

export interface SubjectRule {
  role: string;
  when: { claim: string; equals: string };
}

export interface Grant {
  role: string;
  connectors: string[];
  effects: Effect[];
  deny_tools?: string[];
}

export interface Policy {
  version: 1;
  subjects: SubjectRule[];
  grants: Grant[];
}

// A connector as the policy engine sees it. compatRole is the "<Vendor>" part
// of the legacy "<Vendor>.Read" / "<Vendor>.Write" app roles.
export interface PolicyConnector {
  id: string;
  compatRole?: string;
}

// The gateway's own audit tools live under this connector id.
export const GATEWAY_CONNECTOR = "gateway";

export class PolicyError extends Error {}

function fail(msg: string): never {
  throw new PolicyError(`policy: ${msg}`);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
}

// Strict validation: a typo in an access-control file must stop startup, not
// silently grant or deny.
export function parsePolicy(text: string, knownConnectors: readonly string[]): Policy {
  const doc = parseYaml(text) as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") fail("document is empty");
  const allowedTop = new Set(["version", "subjects", "grants"]);
  for (const key of Object.keys(doc)) if (!allowedTop.has(key)) fail(`unknown top-level key "${key}"`);
  if (doc.version !== 1) fail(`version must be 1, got ${JSON.stringify(doc.version)}`);
  if (!Array.isArray(doc.subjects)) fail("subjects must be a list");
  if (!Array.isArray(doc.grants)) fail("grants must be a list");

  const subjects: SubjectRule[] = doc.subjects.map((raw, i) => {
    const s = raw as Record<string, unknown> | null;
    const when = s?.when as Record<string, unknown> | undefined;
    if (!s || typeof s.role !== "string" || !s.role) fail(`subjects[${i}].role is required`);
    if (!when || typeof when.claim !== "string" || typeof when.equals !== "string") {
      fail(`subjects[${i}].when needs string claim and equals`);
    }
    return { role: s.role as string, when: { claim: when.claim as string, equals: when.equals as string } };
  });

  const declaredRoles = new Set(subjects.map((s) => s.role));
  const known = new Set([...knownConnectors, GATEWAY_CONNECTOR]);
  const grants: Grant[] = doc.grants.map((raw, i) => {
    const g = raw as Record<string, unknown> | null;
    if (!g || typeof g.role !== "string" || !g.role) fail(`grants[${i}].role is required`);
    const role = g.role as string;
    if (!declaredRoles.has(role)) fail(`grants[${i}].role "${role}" has no subjects rule`);
    if (!isStringArray(g.connectors) || g.connectors.length === 0) fail(`grants[${i}].connectors must be a non-empty list`);
    for (const c of g.connectors) if (c !== "*" && !known.has(c)) fail(`grants[${i}] names unknown connector "${c}"`);
    if (!isStringArray(g.effects) || g.effects.length === 0) fail(`grants[${i}].effects must be a non-empty list`);
    for (const e of g.effects) if (!EFFECTS.includes(e as Effect)) fail(`grants[${i}] has unknown effect "${e}"`);
    if (g.deny_tools !== undefined && !isStringArray(g.deny_tools)) fail(`grants[${i}].deny_tools must be a list of strings`);
    return {
      role,
      connectors: g.connectors,
      effects: g.effects as Effect[],
      ...(g.deny_tools ? { deny_tools: g.deny_tools as string[] } : {}),
    };
  });

  return { version: 1, subjects, grants };
}

// Built-in compat profile: maps the original "<Vendor>.Read" / "<Vendor>.Write"
// app roles so an existing Entra deployment needs no policy file.
// Read -> read tools; Write -> every tool (Write used to allow any tool).
export function compatPolicy(connectors: readonly PolicyConnector[]): Policy {
  const subjects: SubjectRule[] = [];
  const grants: Grant[] = [];
  for (const c of connectors) {
    if (!c.compatRole) continue;
    const read = `compat:${c.id}:read`;
    const write = `compat:${c.id}:write`;
    subjects.push({ role: read, when: { claim: "roles", equals: `${c.compatRole}.Read` } });
    subjects.push({ role: write, when: { claim: "roles", equals: `${c.compatRole}.Write` } });
    grants.push({ role: read, connectors: [c.id], effects: ["read"] });
    grants.push({ role: write, connectors: [c.id], effects: ["read", "write", "destructive"] });
  }
  return { version: 1, subjects, grants };
}

export function mergePolicies(a: Policy, b: Policy): Policy {
  return { version: 1, subjects: [...a.subjects, ...b.subjects], grants: [...a.grants, ...b.grants] };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

// Claims may hold a string or a list (Entra "roles"/"groups"; Google groups
// resolved at sign-in). Matching is exact and case-sensitive.
function claimValues(claims: Record<string, unknown>, name: string): string[] {
  const v = claims[name];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

export function resolveRoles(policy: Policy, claims: Record<string, unknown>): string[] {
  const roles = new Set<string>();
  for (const s of policy.subjects) {
    if (claimValues(claims, s.when.claim).includes(s.when.equals)) roles.add(s.role);
  }
  return [...roles].sort();
}

// Glob with "*" only; everything else is literal.
export function toolPatternMatches(pattern: string, name: string): boolean {
  const body = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`).test(name);
}

export interface Decision {
  allow: boolean;
  effect: Effect;
  // Short, stable rule identifier for the audit log.
  reason: string;
}

function grantsFor(policy: Policy, roles: readonly string[], connector: string) {
  const held = new Set(roles);
  return policy.grants.filter((g) => held.has(g.role) && (g.connectors.includes(connector) || g.connectors.includes("*")));
}

// Default deny. A deny_tools hit on any grant covering the connector beats
// every allow, so a broad grant cannot undo a narrow carve-out.
export function decide(policy: Policy, roles: readonly string[], connector: string, tool: Tool): Decision {
  const effect = effectOf(tool);
  const applicable = grantsFor(policy, roles, connector);

  for (const g of applicable) {
    const hit = g.deny_tools?.find((p) => toolPatternMatches(p, tool.name));
    if (hit) return { allow: false, effect, reason: `deny_tools:${g.role}:${hit}` };
  }
  if (applicable.length === 0) return { allow: false, effect, reason: "no_grant" };

  const granting = applicable.find((g) => g.effects.includes(effect));
  if (!granting) return { allow: false, effect, reason: `effect_not_granted:${effect}` };
  return { allow: true, effect, reason: `grant:${granting.role}` };
}

export function hasAnyGrant(policy: Policy, roles: readonly string[], connector: string): boolean {
  return grantsFor(policy, roles, connector).length > 0;
}

// Who-can-call-what matrix: per gateway role and connector, which tools it may
// call. Backs gateway_access_report and the harbor-policy skill.
export interface AccessRow {
  role: string;
  connector: string;
  allowed: string[];
  denied: Array<{ tool: string; reason: string }>;
}

export function accessMatrix(policy: Policy, catalog: ReadonlyMap<string, readonly Tool[]>): AccessRow[] {
  const roles = [...new Set(policy.subjects.map((s) => s.role))].sort();
  const connectors = [...catalog.keys()].sort();
  const rows: AccessRow[] = [];
  for (const role of roles) {
    for (const connector of connectors) {
      if (!hasAnyGrant(policy, [role], connector)) continue;
      const row: AccessRow = { role, connector, allowed: [], denied: [] };
      for (const t of catalog.get(connector) ?? []) {
        const d = decide(policy, [role], connector, t);
        if (d.allow) row.allowed.push(t.name);
        else row.denied.push({ tool: t.name, reason: d.reason });
      }
      rows.push(row);
    }
  }
  return rows;
}
