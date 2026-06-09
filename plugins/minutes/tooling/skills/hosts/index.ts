import type { HostConfig, HostName } from "../schema.js";
import { claudeHost } from "./claude.js";
import { codexHost } from "./codex.js";
import { opencodeHost } from "./opencode.js";

export const HOSTS: Record<HostName, HostConfig> = {
  claude: claudeHost,
  codex: codexHost,
  opencode: opencodeHost,
};

export function getHostConfig(name: HostName): HostConfig {
  return HOSTS[name];
}
