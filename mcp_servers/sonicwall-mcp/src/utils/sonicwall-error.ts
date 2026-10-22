/**
 * sonicwall-error.ts - the single place this server turns a SonicOS failure
 * into an error a human can act on (docs/sonicwall-connector-design.md,
 * "Error-surface contract").
 *
 * node-sonicwall throws SonicwallApiError for HTTP >= 400, status.success ===
 * false and any error-level info[], so one shape reaches every domain. The
 * generic @shared classifier cannot read it (httpStatus, not status), and a
 * blanket "check your credentials" hint sends an operator debugging a
 * credential that is fine. So: one failure class per condition, one hint per
 * class, the appliance's own message kept, and credentials blamed only for
 * the two classes that are actually about the login.
 */
import { toolError, toolErrorFromCatch } from '@shared/error-envelope.js';
import type { ErrorCode, ToolResult } from '@shared/error-envelope.js';

type SonicwallFailureClass =
  | 'auth-credential'
  | 'auth-session'
  | 'session-conflict'
  | 'api-disabled'
  | 'non-config'
  | 'not-found'
  | 'bad-request'
  | 'appliance'
  | 'transport'
  | 'unknown';

const HINTS: Record<Exclude<SonicwallFailureClass, 'unknown'>, string> = {
  'auth-credential':
    'SonicOS rejected the login itself. Check SONICWALL_USERNAME and SONICWALL_PASSWORD, and that Basic authentication is enabled under ' +
    'Device > Settings > Administration > SonicOS API. A locked-out account stays locked until the lockout expires or another admin clears it.',
  'auth-session':
    'The request authenticated, but the session did not persist: SonicOS session security (RFC-7616 Digest) or the bearer-token check is ' +
    'rejecting later calls. This is not a credential problem. Retry once; if it repeats, review the SonicOS API settings with sonicwall_api_settings.',
  'session-conflict':
    'Another admin holds the single SonicOS API session. Wait for them to log out, or set SONICWALL_SESSION_OVERRIDE=true to preempt them ' +
    '(that logs the human admin out and discards their pending config).',
  'api-disabled':
    'The SonicOS API is disabled on this appliance. Enable it under Device > Settings > Administration > SonicOS API.',
  'non-config':
    'The request authenticated successfully, but the session is not in config mode. Call sonicwall_config_mode, then repeat the call.',
  'not-found':
    'The request authenticated successfully. Ground the resource name or uuid with the matching _list tool or sonicwall_navigate before retrying.',
  'bad-request':
    'The request authenticated successfully; the appliance rejected its shape. Fetch an existing object with the matching _get tool and reuse its body shape.',
  appliance:
    'The appliance reported a fault or a state problem (HA standby, unlicensed feature, lost connection, timeout). Retry once; ' +
    'check HA and license state with sonicwall_license_status.',
  transport:
    'The request never got an answer. Check SONICWALL_HOST, SONICWALL_PORT and SONICWALL_VERIFY_TLS (an appliance on its factory ' +
    'self-signed certificate needs SONICWALL_VERIFY_TLS=false), and that this machine can reach the management port.',
};

const BAD_REQUEST_CODES = new Set(['E_INVALID_API_CALL', 'E_INVALID_FXN_ARG', 'E_SYNTAX', 'E_RANGE', 'E_EXISTS']);
const APPLIANCE_CODES = new Set(['E_HA_IDLE', 'E_UNLICENSED', 'E_LOST_CONN', 'E_ERROR', 'E_TIME_OUT']);

/** The SonicwallApiError fields used here, duck-typed so a bundled and a linked copy both classify. */
interface SonicwallApiErrorLike {
  code: string | undefined;
  httpStatus: number;
  responseText: string;
  message: string;
}

function isSonicwallApiError(err: unknown): err is SonicwallApiErrorLike {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return (
    typeof e.httpStatus === 'number' &&
    typeof e.responseText === 'string' &&
    typeof e.message === 'string' &&
    (e.code === undefined || typeof e.code === 'string')
  );
}

const TRANSPORT_RE = /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT|certificate|self[- ]signed|SSL|TLS|timed out|timeout|aborted|socket/i;

function classify(err: SonicwallApiErrorLike): SonicwallFailureClass {
  const { httpStatus: h, code: c, message: m } = err;
  // The client words its errors "SonicOS <METHOD> <path> failed: ...".
  const onAuth = /SonicOS \w+ \/auth\b/.test(m);
  const onConfigMode = /SonicOS \w+ \/config-mode\b/.test(m);
  if (c === 'E_MAX_LOGIN_ATTEMPTS' || c === 'E_USER_LOCKOUT') return 'auth-credential';
  if (h === 401) {
    if (/Authentication-Info:\s*Digest/i.test(err.responseText)) return 'auth-session';
    return onAuth ? 'auth-credential' : 'auth-session';
  }
  if (h === 503 || (c === 'E_ACCESS_DENIED' && (onAuth || onConfigMode))) return 'session-conflict';
  if (c === 'E_DISABLED') return 'api-disabled';
  if (c === 'E_NON_CONFIG' || c === 'E_READ_ONLY') return 'non-config';
  if (c === 'E_NOT_FOUND' || c === 'E_NO_MATCH' || h === 404) return 'not-found';
  if ((c && APPLIANCE_CODES.has(c)) || h >= 500) return 'appliance';
  if ((c && BAD_REQUEST_CODES.has(c)) || h === 400 || h === 406 || h === 413 || h === 414) return 'bad-request';
  return 'unknown';
}

const CODE_BY_CLASS: Record<SonicwallFailureClass, ErrorCode> = {
  'auth-credential': 'FORBIDDEN',
  'auth-session': 'FORBIDDEN',
  'session-conflict': 'FORBIDDEN',
  'api-disabled': 'FORBIDDEN',
  'non-config': 'INVALID_ARGS',
  'not-found': 'NOT_FOUND',
  'bad-request': 'INVALID_ARGS',
  appliance: 'VENDOR_ERROR',
  transport: 'NETWORK_ERROR',
  unknown: 'VENDOR_ERROR',
};

/**
 * Build a tool error result for anything a SonicOS call throws. `hint` is
 * call-site context, used only where it cannot misdirect (bad-request,
 * not-found, unknown).
 */
export function sonicwallToolError(operation: string, err: unknown, ctx: { hint?: string } = {}): ToolResult {
  if (!isSonicwallApiError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    if (TRANSPORT_RE.test(msg)) {
      return toolError(CODE_BY_CLASS.transport, `${operation} failed: ${msg.slice(0, 300)}`, { hint: HINTS.transport });
    }
    return toolErrorFromCatch(operation, err, ctx);
  }
  const failure = classify(err);
  const callerHint = failure === 'bad-request' || failure === 'not-found' || failure === 'unknown' ? ctx.hint : undefined;
  const base = failure === 'unknown' ? undefined : HINTS[failure];
  const hint = base && callerHint ? `${base} ${callerHint}` : base ?? callerHint;
  // err.message already carries the appliance's own info[].message, scrubbed of credentials.
  return toolError(CODE_BY_CLASS[failure], `${operation} failed [${failure}]: ${err.message}`, { hint });
}
