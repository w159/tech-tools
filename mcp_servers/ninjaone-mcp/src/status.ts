/**
 * ninjaone_status report for a server that has no credentials yet.
 *
 * AGENTS.md section 4: every server exposes a <vendor>_status tool that runs
 * WITHOUT credentials and reports configuration state. Kept out of index.ts
 * (which boots a server on import) so it is unit-testable and has no I/O.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeBaseUrl } from "../../_shared/base-url.js";

/** Unresolved `${user_config.*}` placeholders and blanks count as unset (mirrors getCredentials). */
const isSet = (name: string): boolean => {
  const v = process.env[name]?.trim();
  return !!v && !/^\$\{[^}]+\}$/.test(v);
};

const line = (name: string, requirement: string): string =>
  `  ${name}: ${isSet(name) ? "set" : `MISSING (${requirement})`}`;

/** Names only, never values. */
export function describeUnconfigured(domains: string[]): CallToolResult {
  const text = [
    "NinjaOne MCP Server Status",
    "",
    "Credentials: NOT CONFIGURED",
    line("NINJAONE_CLIENT_ID", "required"),
    line("NINJAONE_CLIENT_SECRET", "required unless NINJAONE_AUTH_MODE=user"),
    `  NINJAONE_REGION: ${isSet("NINJAONE_REGION") ? "set" : "not set (optional, defaults to us)"}`,
    `  NINJAONE_AUTH_MODE: ${isSet("NINJAONE_AUTH_MODE") ? "set" : "not set (optional, defaults to client_credentials; set to user for browser sign-in)"}`,
    `Base URL: ${describeBaseUrl("ninjaone", process.env.NINJAONE_BASE_URL, "NINJAONE_BASE_URL")}`,
    "Auth check: SKIPPED (no credentials)",
    `Available domains: ${domains.join(", ")}`,
    "",
    "Only ninjaone_status, ninjaone_navigate and the sign-in/auth tools are listed until credentials are set and the session is restarted. Use ninjaone_navigate to discover tools by domain.",
  ].join("\n");
  return { content: [{ type: "text", text }] };
}
