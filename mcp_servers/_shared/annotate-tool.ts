// Drop-in TypeScript helper. Each server copies this file into its own src/
// because there is no shared workspace import root.
//
// Usage:
//   import { annotate } from "./annotate-tool.js";
//   const tools = annotate(rawTools, "Vendor");
//
// Tools whose names match read-only patterns are marked readOnlyHint:true so
// Claude Desktop groups them under "Read-only tools". Tools matching destructive
// patterns get destructiveHint:true. Everything else falls under
// "Write/delete tools".

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

export function classifyTool(name: string): ToolClass {
  if (matchesAny(name, DESTRUCTIVE_PATTERNS)) return "destructive";
  if (matchesAny(name, CREATE_PATTERNS)) return "create";
  if (matchesAny(name, READ_PATTERNS)) return "read";
  // Fallback: read so unknown tools don't get scary destructive labels.
  return "read";
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

export function annotationsFor(name: string, title?: string): ToolAnnotations {
  const base = ANNOTATION_PRESETS[classifyTool(name)];
  return title ? { title, ...base } : base;
}

// Annotate a list of Tool objects in-place style (returns new objects). The
// optional `vendorTitle` prefix produces a friendly display name like
// "Vanta: list frameworks" for the Title column in Claude Desktop.
export function annotate(tools: Tool[], vendorTitle?: string): Tool[] {
  return tools.map((t) => {
    if (t.annotations?.readOnlyHint !== undefined) return t; // already annotated
    const rest = vendorTitle
      ? t.name.replace(new RegExp(`^${vendorTitle.toLowerCase()}_`), "").replace(/_/g, " ")
      : undefined;
    const title = vendorTitle && rest ? `${vendorTitle}: ${rest}` : undefined;
    return { ...t, annotations: annotationsFor(t.name, title) };
  });
}
