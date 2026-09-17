import { XMLParser } from 'fast-xml-parser';
import { PanosApiError } from './errors.js';

// attributeNamePrefix '@' matches PAN-OS REST's own JSON attribute convention
// (design doc: node-panos client contract), so callers read status/code the
// same way regardless of which API answered.
//
// parseTagValue/parseAttributeValue disable fast-xml-parser's strnum coercion:
// PAN-OS serials, versions, job ids, and error codes are identifiers, not
// quantities. Coercion drops leading zeros, so serial 023009014025 would parse
// as 23009014025 and corrupt every target=<serial> route built from it.
const parser = new XMLParser({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function parseXml(text: string): Record<string, any> {
  return parser.parse(text);
}

/**
 * PAN-OS answers auth failures, bad xpaths, and malformed elements with
 * HTTP 200 and <response status="error" code="..."/>. Checking res.ok alone
 * reports every one of those as a success, so status is read from the parsed
 * body, never from the transport-level HTTP status.
 */
export function assertSuccess(text: string, httpStatus: number): Record<string, any> {
  const parsed = parseXml(text);
  const response = parsed?.response;
  const status = response?.['@status'];
  if (status !== 'success') {
    const code = response?.['@code'] as string | undefined;
    throw new PanosApiError(`PAN-OS API error${code ? ` (code ${code})` : ''}`, {
      code,
      httpStatus,
      responseText: text,
    });
  }
  return response ?? {};
}
