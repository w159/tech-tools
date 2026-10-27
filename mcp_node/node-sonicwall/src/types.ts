export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SonicwallConfig {
  host: string;
  username: string;
  password: string;
  port?: number; // default 443
  verifyTls?: boolean; // default true
  sessionOverride?: boolean; // default false
  timeoutMs?: number; // default 60_000
  fetch?: typeof fetch; // injectable for tests
}

export interface SonicwallInfo {
  level: string;
  code: string;
  message: string;
}

export interface SonicwallStatus {
  success: boolean;
  cli?: {
    depth?: number;
    mode?: string;
    command?: string;
    configuring?: boolean;
    pending_config?: boolean;
    restart_required?: string;
  };
  info: SonicwallInfo[];
}
