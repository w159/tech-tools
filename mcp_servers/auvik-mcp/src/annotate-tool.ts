// Drop-in TypeScript helper. Each server copies this file into its own src/
// because there is no shared workspace import root.
//
// Usage:
//   import { annotate } from "./annotate-tool.js";
//   const tools = annotate(rawTools, "Vendor");
//
// Two signals decide a tool's effect class, in this order:
//
//   1. The tool's own description. A leading "DESTRUCTIVE:" or
//      "VISIBLE-TO-OTHERS:" marker is a declaration by whoever wrote the tool
//      and is AUTHORITATIVE: the annotations follow it whatever the name looks
//      like. The prose a human reads and the flags a client automates on
//      therefore cannot disagree in the dangerous direction.
//   2. The name-pattern tables below, plus CLASS_OVERRIDES for the names those
//      tables get wrong.
//
// A name that matches nothing FAILS CLOSED to mutating, and says so on stderr.
// This module used to `return "read"` for an unmatched name, so a mutating tool
// the tables did not anticipate shipped readOnlyHint:true - the flag an MCP
// client reads to decide it may run a tool without asking. That is exactly how
// ninjaone_devices_service_control ("DESTRUCTIVE: Start, stop, pause, or
// restart a Windows service") shipped annotated read-only: "control" appears in
// no pattern, so it fell through to the read default.

import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

const READ_PATTERNS: RegExp[] = [
  /(^|_)status$/,
  /(^|_)ping$/,
  /(^|_)version$/,
  /(^|_)navigate$/,
  /(^|_)back$/,
  /(^|_)get(_|$)/,
  /(^|_)list(_|$)/,
  /(^|_)search(_|$)/,
  /(^|_)summary$/,
  /(^|_)count$/,
  /(^|_)detail(s)?$/,
  /(^|_)check$/,
  /(^|_)bec_check$/,
  /(^|_)test_connection$/,
  /(^|_)history$/,
  /(^|_)dropdown$/,
  /(^|_)wait_for$/,
  /(^|_)checkins$/,
  /(^|_)alignment$/,
  /(^|_)drift$/,
  /(^|_)bpa$/,
  /(^|_)usage$/,
  /(^|_)activities$/,
  /(^|_)comments$/,
  /(^|_)notes$/,
  /(^|_)audits$/,
  /(^|_)services$/,
  /(^|_)devices$/,
  /(^|_)alerts$/,
  /(^|_)locations$/,
  /(^|_)domain_health$/,
  /(^|_)permit_application$/,
  /(^|_)risk_score_history$/,
  /(^|_)for_move_computers$/,
  /(^|_)auth_key$/,
  /(^|_)file_history$/,
  /(^|_)resource_kinds$/,
  /(^|_)resources$/,
  /(^|_)resource$/,
  /(^|_)groups$/,
  /(^|_)mailboxes$/,
  /(^|_)mailbox_permissions$/,
  /(^|_)named_locations$/,
  /(^|_)user_devices$/,
  /(^|_)user_groups$/,
  /(^|_)users$/,
  /(^|_)mfa_users$/,
  /(^|_)gdap_invites$/,
  /(^|_)gdap_roles$/,
  /(^|_)conditional_access_policies$/,
  /(^|_)csp_licenses$/,
  /(^|_)licenses$/,
  /(^|_)standards$/,
  /(^|_)standard_templates$/,
  /(^|_)scheduled_items$/,
  /(^|_)alert_queue$/,
  /(^|_)audit_logs$/,
  /(^|_)logs$/,
  /(^|_)tenants$/,
  /(^|_)tenant_details$/,
  /(^|_)standards_check$/,
  /(^|_)keys$/,
  /(^|_)findings$/,
  /(^|_)accounts$/,
  /(^|_)resolutions$/,
  /(^|_)all$/,
  /(^|_)organizations$/,
  /(^|_)pending_count$/,
];

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /(^|_)update(_|$)/,
  /(^|_)edit(_|$)/,
  /(^|_)patch(_|$)/,
  /(^|_)delete(_|$)/,
  /(^|_)remove(_|$)/,
  /(^|_)dismiss(_|$)/,
  /(^|_)disable(_|$)/,
  /(^|_)revoke(_|$)/,
  /(^|_)reboot(_|$)/,
  /(^|_)restart(_|$)/,
  /(^|_)reset(_|$)/,
  /(^|_)reset_all(_|$)/,
  /(^|_)reset_mfa$/,
  /(^|_)reset_password$/,
  /(^|_)revoke_sessions$/,
  /(^|_)offboard(_|$)/,
  /(^|_)close(_|$)/,
  /(^|_)resolve(_|$)/,
  /(^|_)set_email_forwarding$/,
  /(^|_)set_out_of_office$/,
];

const CREATE_PATTERNS: RegExp[] = [
  /(^|_)create(_|$)/,
  /(^|_)add(_|$)/,
  /(^|_)assign(_|$)/,
  /(^|_)queue(_|$)/,
  /(^|_)approve(_|$)/,
  /(^|_)deny(_|$)/,
  /(^|_)run(_|$)/,
  /(^|_)send(_|$)/,
];

function matchesAny(name: string, patterns: RegExp[]): boolean {
  for (const p of patterns) if (p.test(name)) return true;
  return false;
}

export type ToolClass = "read" | "create" | "destructive";

// A tool's own description declaring that it changes state. Authoritative.
const MUTATING_DESCRIPTION_MARKER = /^\s*(?:DESTRUCTIVE|VISIBLE-TO-OTHERS):/;

/**
 * Effect class for tool names the pattern tables get wrong, or do not cover at
 * all. This is the declaration site for an unmatched name: without an entry
 * here (or a "DESTRUCTIVE:" description marker) a tool is annotated mutating
 * and warned about on stderr, never silently treated as safe.
 */
const CLASS_OVERRIDES: Record<string, ToolClass> = {
  auvik_statistics_device: "read", // GET /stat/deviceDetail time-series
  auvik_statistics_device_availability: "read", // GET /stat/deviceAvailability time-series
  auvik_statistics_interface: "read", // GET /stat/interface time-series
  auvik_statistics_service: "read", // GET /stat/service time-series
  auvik_statistics_component: "read", // GET /stat/component time-series
  auvik_statistics_oid: "read", // GET /stat/oid time-series
};

/**
 * Classify by name alone, or return undefined when no table matches. This
 * deliberately has no default: a name-pattern heuristic must never answer
 * "safe" for a name it does not recognize. Callers use effectClassFor().
 */
export function classifyTool(name: string): ToolClass | undefined {
  const override = CLASS_OVERRIDES[name];
  if (override) return override;
  if (matchesAny(name, DESTRUCTIVE_PATTERNS)) return "destructive";
  if (matchesAny(name, CREATE_PATTERNS)) return "create";
  if (matchesAny(name, READ_PATTERNS)) return "read";
  return undefined;
}

/**
 * The class actually annotated: description marker, then name, then fail
 * closed. `description` is the tool's own description text.
 */
export function effectClassFor(name: string, description?: string): ToolClass {
  if (MUTATING_DESCRIPTION_MARKER.test(description ?? "")) return "destructive";
  const byName = classifyTool(name);
  if (byName) return byName;
  // stderr only - stdout is the JSON-RPC channel.
  console.error(
    `[auvik-mcp] tool ${name} matches no effect-class pattern; annotating it as ` +
      `mutating. Declare it in CLASS_OVERRIDES in src/annotate-tool.ts, or ` +
      `prefix its description with "DESTRUCTIVE: " if it changes state.`,
  );
  return "destructive";
}

const ANNOTATION_PRESETS: Record<ToolClass, ToolAnnotations> = {
  read: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  destructive: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export function annotationsFor(name: string, title?: string, description?: string): ToolAnnotations {
  const base = ANNOTATION_PRESETS[effectClassFor(name, description)];
  return title ? { title, ...base } : base;
}

// Annotate a list of Tool objects in-place style (returns new objects). The
// optional `vendorTitle` prefix produces a friendly display name like
// "Vanta: list frameworks" for the Title column in Claude Desktop.
export function annotate(tools: Tool[], vendorTitle?: string): Tool[] {
  return tools.map((t) => {
    if (t.annotations?.readOnlyHint !== undefined) {
      // A hand-written annotation wins over the tables - but it may not claim
      // read-only for a tool whose own description declares it mutating.
      if (t.annotations.readOnlyHint === true && MUTATING_DESCRIPTION_MARKER.test(t.description ?? "")) {
        console.error(
          `[auvik-mcp] tool ${t.name} is annotated readOnlyHint:true but its own ` +
            `description declares it mutating; annotating it as mutating.`,
        );
        return { ...t, annotations: { ...t.annotations, ...ANNOTATION_PRESETS.destructive } };
      }
      return t;
    }
    const rest = vendorTitle
      ? t.name.replace(new RegExp(`^${vendorTitle.toLowerCase()}_`), "").replace(/_/g, " ")
      : undefined;
    const title = vendorTitle && rest ? `${vendorTitle}: ${rest}` : undefined;
    return { ...t, annotations: annotationsFor(t.name, title, t.description) };
  });
}
