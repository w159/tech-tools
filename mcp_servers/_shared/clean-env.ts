/**
 * clean-env.ts - env value cleaning for optional connector settings.
 *
 * Some MCP hosts (Claude Desktop before ~0.11) pass the literal template
 * placeholder `${user_config.x}` as the env value when an optional config
 * field is left blank. Blank and placeholder values resolve to "" so callers
 * fall through to their defaults.
 */
const UNRESOLVED_PLACEHOLDER = /^\$\{[^}]+\}$/;

export function cleanEnv(value: string | undefined): string {
  return !value || UNRESOLVED_PLACEHOLDER.test(value.trim()) ? "" : value.trim();
}
