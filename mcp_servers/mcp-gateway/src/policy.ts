import type { Tool } from "@modelcontextprotocol/sdk/types.js";
// Missing annotations fail closed to Write, matching mcp_servers/_shared/annotate-tool.ts.
export function isReadOnly(tool: Tool): boolean { return tool.annotations?.readOnlyHint === true; }
// Entra app roles are "<Vendor>.Read" and "<Vendor>.Write". Write implies Read.
export function canUseTool(roles: readonly string[], vendorRole: string, tool: Tool): boolean {
  if (roles.includes(`${vendorRole}.Write`)) return true;
  return isReadOnly(tool) && roles.includes(`${vendorRole}.Read`);
}
export function hasAnyVendorRole(roles: readonly string[], vendorRole: string): boolean {
  return roles.includes(`${vendorRole}.Read`) || roles.includes(`${vendorRole}.Write`);
}
