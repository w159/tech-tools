/**
 * Thrown whenever a parsed PAN-OS XML `<response>` envelope carries
 * status="error", including when the transport-level HTTP status is 200.
 * See docs/panos-connector-design.md: "The failure mode the client must not have".
 */
export class PanosApiError extends Error {
  readonly code: string | undefined;
  readonly httpStatus: number;
  readonly responseText: string;

  constructor(message: string, opts: { code: string | undefined; httpStatus: number; responseText: string }) {
    super(message);
    this.name = 'PanosApiError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.responseText = opts.responseText;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
