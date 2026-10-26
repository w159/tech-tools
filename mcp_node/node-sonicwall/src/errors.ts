import type { SonicwallInfo } from './types.js';

/**
 * Thrown whenever a SonicOS response is an error: HTTP >= 400, `status.success
 * === false`, or any `info[].level === "error"`, including on HTTP 200.
 * See docs/architecture/sonicwall-connector-design.md: "The failure mode the client must not have".
 * message and responseText are scrubbed of credentials before construction.
 */
export class SonicwallApiError extends Error {
  readonly httpStatus: number;
  readonly code: string | undefined;
  readonly info: SonicwallInfo[];
  readonly responseText: string;

  constructor(
    message: string,
    opts: { httpStatus: number; code: string | undefined; info: SonicwallInfo[]; responseText: string },
  ) {
    super(message);
    this.name = 'SonicwallApiError';
    this.httpStatus = opts.httpStatus;
    this.code = opts.code;
    this.info = opts.info;
    this.responseText = opts.responseText;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
