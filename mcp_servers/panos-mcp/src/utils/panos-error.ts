/**
 * panos-error.ts - the single place this server turns a PAN-OS failure into an
 * error a human can act on.
 *
 * PAN-OS answers a bad xpath, an unsupported command, and an invalid API key
 * all with `<response status="error" code="..."><msg>...</msg></response>`, so
 * `PanosApiError` is the one error shape every domain sees. The generic
 * `toolErrorFromCatch` in @shared cannot read it: PanosApiError carries
 * `httpStatus`, not `.status`/`.statusCode`, so it falls through to the plain
 * `Error` branch and reports only `err.message` - "PAN-OS API error (code 17)"
 * - while the appliance's own `<msg>` explanation sits unused in
 * `responseText`. Combined with a per-domain "check your credentials" hint,
 * that sent an operator debugging a credential that was provably fine (live
 * validation against a PA-460: 13 other calls authenticated in the same
 * session).
 *
 * So: one code->meaning table straight from the vendor doc, one failure class
 * per code, and one hint per failure class. Codes and meanings are verbatim
 * from "PAN-OS XML API Error Codes",
 * https://docs.paloaltonetworks.com/ngfw/api/getting-started/pan-os-xml-api-error-codes
 * (Updated Thu Aug 28 2025). 403/401/404/429/5xx are not in that table - they
 * are the transport statuses the REST half of the API returns, which
 * node-panos surfaces as `code === String(httpStatus)`.
 */
import { toolError, toolErrorFromCatch } from '@shared/error-envelope.js';
import type { ErrorCode, ToolResult } from '@shared/error-envelope.js';

/** What kind of failure a PAN-OS code represents, which is what picks the hint. */
export type PanosFailureClass =
  | 'auth-credential'
  | 'auth-role'
  | 'session'
  | 'xpath-object'
  | 'unsupported-command'
  | 'malformed'
  | 'operation-refused'
  | 'appliance-internal'
  | 'rest-request'
  | 'unknown';

interface PanosCodeEntry {
  /** The vendor's own name for the code. */
  meaning: string;
  failure: PanosFailureClass;
  code: ErrorCode;
}

/**
 * PAN-OS error code -> vendor meaning, failure class, and canonical error code.
 * Codes 2-5, 11 and 21 are documented as "Internal errors"; 19-20 are
 * documented as success and are listed only so an unexpected throw carrying
 * one still reports the vendor's own wording.
 */
export const PANOS_ERROR_CODES: Record<string, PanosCodeEntry> = {
  '1': { meaning: 'Unknown command', failure: 'unsupported-command', code: 'UNSUPPORTED_COMMAND' },
  '2': { meaning: 'Internal error', failure: 'appliance-internal', code: 'VENDOR_ERROR' },
  '3': { meaning: 'Internal error', failure: 'appliance-internal', code: 'VENDOR_ERROR' },
  '4': { meaning: 'Internal error', failure: 'appliance-internal', code: 'VENDOR_ERROR' },
  '5': { meaning: 'Internal error', failure: 'appliance-internal', code: 'VENDOR_ERROR' },
  '6': { meaning: 'Bad Xpath', failure: 'xpath-object', code: 'INVALID_ARGS' },
  '7': { meaning: 'Object not present', failure: 'xpath-object', code: 'NOT_FOUND' },
  '8': { meaning: 'Object not unique', failure: 'operation-refused', code: 'INVALID_ARGS' },
  '10': { meaning: 'Reference count not zero', failure: 'operation-refused', code: 'INVALID_ARGS' },
  '11': { meaning: 'Internal error', failure: 'appliance-internal', code: 'VENDOR_ERROR' },
  '12': { meaning: 'Invalid object', failure: 'xpath-object', code: 'INVALID_ARGS' },
  '13': { meaning: 'Object not found', failure: 'xpath-object', code: 'NOT_FOUND' },
  '14': { meaning: 'Operation not possible', failure: 'operation-refused', code: 'INVALID_ARGS' },
  '15': { meaning: 'Operation denied', failure: 'operation-refused', code: 'FORBIDDEN' },
  '16': { meaning: 'Unauthorized', failure: 'auth-role', code: 'FORBIDDEN' },
  '17': { meaning: 'Invalid command', failure: 'unsupported-command', code: 'UNSUPPORTED_COMMAND' },
  '18': { meaning: 'Malformed command', failure: 'malformed', code: 'INVALID_ARGS' },
  '19': { meaning: 'Success', failure: 'unknown', code: 'INTERNAL_ERROR' },
  '20': { meaning: 'Success', failure: 'unknown', code: 'INTERNAL_ERROR' },
  '21': { meaning: 'Internal error', failure: 'appliance-internal', code: 'VENDOR_ERROR' },
  '22': { meaning: 'Session timed out', failure: 'session', code: 'FORBIDDEN' },
  // Transport statuses, returned by the REST half of the API (and by the XML
  // API for an invalid key, which arrives as code="403" with HTTP 200).
  '400': { meaning: 'Bad request', failure: 'rest-request', code: 'INVALID_ARGS' },
  '401': { meaning: 'Unauthorized', failure: 'auth-credential', code: 'FORBIDDEN' },
  '403': { meaning: 'Forbidden', failure: 'auth-credential', code: 'FORBIDDEN' },
  '404': { meaning: 'Not found', failure: 'rest-request', code: 'NOT_FOUND' },
  '405': { meaning: 'Method not allowed', failure: 'rest-request', code: 'INVALID_ARGS' },
  '409': { meaning: 'Conflict', failure: 'operation-refused', code: 'INVALID_ARGS' },
  '429': { meaning: 'Too many requests', failure: 'rest-request', code: 'RATE_LIMITED' },
};

const GROUNDING_HINT =
  'The request authenticated successfully - this is not a credential problem. ' +
  'Ground the xpath or object name with panos_config_show or panos_config_complete before retrying.';

const LOCATION_HINT =
  'The request authenticated successfully - this is not a credential problem. ' +
  'Verify `location` and its companion argument (vsys / deviceGroup / template) exist on this appliance, ' +
  'and that the REST path and body match the PAN-OS REST version in PANOS_REST_VERSION.';

const CREDENTIAL_HINT =
  'PAN-OS rejected the credential itself. Mint a new key with panos_keygen and set PANOS_API_KEY to it; ' +
  'an existing key is invalidated by an admin password change or by the configured API key lifetime. ' +
  'See "API Authentication and Security" in the PAN-OS and Panorama API guide.';

const ROLE_HINT =
  'The credential authenticated but its admin role is not allowed to run this query. ' +
  'Do not regenerate PANOS_API_KEY - grant the admin role XML/REST API access for this area, or use an admin that has it.';

const SESSION_HINT =
  'The PAN-OS session for this query timed out. Retry the call; if it keeps happening, mint a fresh key with panos_keygen.';

const MALFORMED_HINT =
  'PAN-OS could not parse the XML sent for this call. Check the element nesting and quoting of the cmd/element argument.';

const INTERNAL_HINT =
  'PAN-OS reported an internal error, which is an appliance-side fault rather than a bad request. ' +
  'Retry once; if it persists, capture the message above for Palo Alto support.';

const UNSUPPORTED_HINT =
  'PAN-OS does not accept this command on this device: the command, or that form of it, does not exist in this ' +
  "device's mode, model, or software version. Confirm the device type with panos_version / panos_system_info " +
  'before assuming a connector or credential fault - the request authenticated successfully.';

/**
 * Per-tool addendum for the unsupported-command class. `show devices` and
 * `commit-all` only exist on Panorama; a standalone firewall answers code 17.
 */
const PANORAMA_ONLY_NOTES: Record<string, string> = {
  panos_devices_list:
    '`show devices` is a Panorama-only command - it enumerates the firewalls a Panorama manages, and a standalone ' +
    'firewall has no managed devices to report. Point PANOS_HOST at a Panorama to use this tool; for this device ' +
    'itself, use panos_system_info or panos_version.',
  panos_commit_all:
    '`commit-all` is a Panorama-only command - it pushes to managed firewalls. On a standalone firewall, commit the ' +
    'local candidate config with panos_commit instead.',
};

/**
 * Code 7 on a job ID is the trap that looks like a broken connector: PAN-OS
 * keeps log-query and report jobs outside the job table that
 * `<show><jobs>` reads, so an ID printed by panos_logs_query or
 * panos_report_* is genuinely "not present" there. Confirmed live on a PA-460
 * (PAN-OS 11.1.13-h6): log job 116 and report job 115 both answered code 7
 * from panos_job_status and from a raw `<show><jobs><id>116</id></jobs></show>`,
 * while `<show><jobs><all/></jobs></show>` listed only commit-class jobs.
 */
const JOB_NAMESPACE_HINT =
  'A log-query or report job ID is NOT in this table: retrieve a panos_logs_query ID with panos_logs_retrieve, and a ' +
  'panos_report_dynamic / panos_report_predefined / panos_report_custom ID with panos_report_get. ' +
  'panos_job_status and panos_job_wait only see job-table jobs (commit, content/software install, tech-support export); ' +
  'list those with panos_op "<show><jobs><all/></jobs></show>".';

/** Tools whose id argument is read from the job table. */
const JOB_TABLE_TOOLS: Record<string, true> = { panos_job_status: true, panos_job_wait: true };

function hintFor(
  failure: PanosFailureClass,
  operation: string,
  callerHint: string | undefined
): string | undefined {
  switch (failure) {
    case 'auth-credential':
      return CREDENTIAL_HINT;
    case 'auth-role':
      return ROLE_HINT;
    case 'session':
      return SESSION_HINT;
    case 'appliance-internal':
      return INTERNAL_HINT;
    case 'malformed':
      return join(MALFORMED_HINT, callerHint);
    case 'unsupported-command':
      return join(UNSUPPORTED_HINT, PANORAMA_ONLY_NOTES[operation]);
    case 'xpath-object':
      return join(
        JOB_TABLE_TOOLS[operation] ? JOB_NAMESPACE_HINT : GROUNDING_HINT,
        callerHint
      );
    case 'rest-request':
      // LOCATION_HINT already covers the location/path question a REST 4xx
      // raises, and the REST body says which parameter was wrong, so a
      // call-site hint here only repeats both.
      return LOCATION_HINT;
    case 'operation-refused':
      // PAN-OS allowed the request and refused this instance of it; the
      // appliance's own message above says why, so add only call context.
      return callerHint;
    case 'unknown':
      // No remedy is known for this code. Reporting the code and the
      // appliance's message without a guess beats sending the operator
      // somewhere wrong.
      return callerHint;
  }
}

function join(base: string, extra: string | undefined): string {
  return extra ? `${base} ${extra}` : base;
}

const MAX_MSG_CHARS = 300;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function collapse(s: string): string {
  // CDATA first: PAN-OS wraps op-command diagnostics in it (`<line><![CDATA[
  // show -> devices  is unexpected]]></line>`), and the payload can itself
  // contain a `>`, so stripping tags before unwrapping eats half the text and
  // leaves a stray `]]>` behind.
  const flat = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (whole: string, token: string) => {
      if (token.startsWith('#')) {
        const cp = Number(token.slice(1));
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
      }
      return ENTITIES[token] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_MSG_CHARS ? `${flat.slice(0, MAX_MSG_CHARS - 3)}...` : flat;
}

/**
 * The REST half of the API answers with JSON, whose `message` field is the
 * one-line explanation ("Invalid Query Parameter: location=device-group
 * expects vsys,panorama-pushed"). Prefer it over the whole envelope.
 */
function jsonMessage(responseText: string): string | undefined {
  const trimmed = responseText.trimStart();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const message = (parsed as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message.trim() ? collapse(message) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pull the appliance's own explanation out of the error response: `<msg>`
 * first (PAN-OS puts it under `<response>` or `<response><result>`), then
 * `<line>` elements, then whatever text the envelope carries. Always returned
 * as one collapsed, length-capped line - never raw XML.
 */
export function extractApplianceMessage(responseText: string): string | undefined {
  if (!responseText) return undefined;

  const fromJson = jsonMessage(responseText);
  if (fromJson) return fromJson;

  const msgs = [...responseText.matchAll(/<msg\b[^>]*>([\s\S]*?)<\/msg>/gi)].map(m => m[1]);
  if (msgs.length) {
    const text = collapse(msgs.join(' '));
    if (text) return text;
  }

  const lines = [...responseText.matchAll(/<line\b[^>]*>([\s\S]*?)<\/line>/gi)].map(m => m[1]);
  if (lines.length) {
    const text = collapse(lines.join(' '));
    if (text) return text;
  }

  return collapse(responseText) || undefined;
}

/** The PanosApiError fields this module needs, duck-typed so a bundled and a
 * linked copy of node-panos both classify (instanceof would not). */
interface PanosApiErrorLike {
  code: string | undefined;
  httpStatus: number;
  responseText: string;
  message: string;
}

function isPanosApiError(err: unknown): err is PanosApiErrorLike {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return (
    typeof e.httpStatus === 'number' &&
    typeof e.responseText === 'string' &&
    (e.code === undefined || typeof e.code === 'string')
  );
}

/** Classification for a PAN-OS code, including codes absent from the table. */
function classify(code: string | undefined): PanosCodeEntry | undefined {
  if (!code) return undefined;
  const known = PANOS_ERROR_CODES[code];
  if (known) return known;
  const numeric = Number(code);
  if (Number.isInteger(numeric) && numeric >= 500 && numeric < 600) {
    return { meaning: 'Server error', failure: 'appliance-internal', code: 'VENDOR_ERROR' };
  }
  return undefined;
}

/**
 * Build a tool error result for anything a PAN-OS call throws.
 *
 * For a `PanosApiError` this reports the PAN-OS code, the vendor's meaning for
 * it, the appliance's own `<msg>` text, and the HTTP status when it adds
 * anything, then attaches the one hint that matches that failure class. Any
 * other throw (network, client-side) falls through to the shared classifier.
 *
 * `hint` is call-site context (which argument to re-check). It is used only
 * where it can help; the failure classes where a call-site hint would
 * misdirect - credential, role, session, unsupported command, appliance
 * internal - ignore it.
 */
export function panosToolError(
  operation: string,
  err: unknown,
  ctx: { hint?: string } = {}
): ToolResult {
  if (!isPanosApiError(err)) return toolErrorFromCatch(operation, err, ctx);

  const entry = classify(err.code);
  const failure: PanosFailureClass = entry?.failure ?? 'unknown';
  const parts = [`${operation} failed:`];

  if (err.code) {
    parts.push(`PAN-OS error code ${err.code}${entry ? ` (${entry.meaning})` : ' (undocumented code)'}`);
  } else {
    parts.push('PAN-OS returned status="error" with no error code');
  }

  const applianceMessage = extractApplianceMessage(err.responseText);
  if (applianceMessage) parts.push(`- ${applianceMessage}`);

  // The XML API answers most errors with HTTP 200, so the status is noise
  // unless it failed at the transport level, and duplicated noise when the
  // code *is* the status (the REST path).
  if (err.httpStatus >= 400 && err.code !== String(err.httpStatus)) {
    parts.push(`(HTTP ${err.httpStatus})`);
  }

  return toolError(entry?.code ?? 'VENDOR_ERROR', parts.join(' '), {
    hint: hintFor(failure, operation, ctx.hint),
  });
}
