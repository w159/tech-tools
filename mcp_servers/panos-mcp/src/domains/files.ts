import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { shapeRaw, TARGET_PROP, destructiveTool, panosToolError, readOnlyTool } from './_helpers.js';
import type { ExportParams, ImportParams } from 'node-panos';

// Rule: enumerate exactly the candidate categories named in the task brief
// (application-pcap, certificate, filters-pcap, tech-support, threat-pcap,
// configuration, device-state), keeping only those confirmed by a real
// `category=` request in the postman collection. `device-state` is not
// requested anywhere in the collection (only named in prose) and is dropped.
// `application-block-page` is a real collection category but was never a
// brief candidate, so it is out of scope here, not "dropped" - see the
// implementer report for both distinctions.
const EXPORT_CATEGORIES = [
  'configuration',
  'application-pcap',
  'certificate',
  'filters-pcap',
  'tech-support',
  'threat-pcap',
] as const;

const CERT_FORMATS = ['pem', 'pkcs10', 'pkcs12'] as const;

// Large artifacts (tech-support bundles, pcaps) must never be inlined whole
// into a tool result; a bounded text preview plus metadata is all a caller gets.
const PREVIEW_CHARS = 4000;

function summarizeExport(result: { contentType: string; bytes: number; text?: string }) {
  const truncated = !!result.text && result.text.length > PREVIEW_CHARS;
  return {
    contentType: result.contentType,
    bytes: result.bytes,
    preview: result.text ? result.text.slice(0, PREVIEW_CHARS) : undefined,
    previewTruncated: truncated,
    note: result.text
      ? 'Binary or oversized exports are summarized, not inlined; preview is capped at ' + PREVIEW_CHARS + ' characters.'
      : 'Binary content (no text preview available); only metadata is returned.',
  };
}

function decodeFile(fileContentBase64: unknown): Buffer {
  return Buffer.from(String(fileContentBase64), 'base64');
}

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_export',
      description:
        'Export a configuration, certificate, or packet capture from the appliance (type=export). Not destructive: reads ' +
        'only. Returns metadata (content type, byte count) and a bounded text preview, not the raw file; tech-support ' +
        'bundles and pcaps are large binaries and are summarized rather than inlined. For tech-support bundles, use ' +
        'panos_export_tech_support instead, which handles the begin/status/get job lifecycle.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...EXPORT_CATEGORIES], description: 'Required. What to export.' },
          'certificate-name': { type: 'string', description: 'Required for category=certificate. Name of the certificate.' },
          format: { type: 'string', enum: [...CERT_FORMATS], description: 'Required for category=certificate. Certificate format.' },
          'include-key': { type: 'string', enum: ['yes', 'no'], description: 'Required for category=certificate. Include the private key.' },
          from: { type: 'string', description: 'Required for category=application-pcap or filters-pcap. Source pcap directory or file path.' },
          'pcap-id': { type: 'string', description: 'Required for category=threat-pcap. PCAP ID from the threat log entry.' },
          'search-time': { type: 'string', description: 'Required for category=threat-pcap. search-time from the threat log entry.' },
          sessionid: { type: 'string', description: 'Optional for category=threat-pcap.' },
          vsys: { type: 'string', description: 'Optional. Virtual system where the object is located. Default shared.' },
          ...TARGET_PROP,
        },
        required: ['category'],
      },
    }),
    readOnlyTool({
      name: 'panos_export_tech_support',
      description:
        'Export a tech-support bundle (type=export&category=tech-support), a three-step async job: call with no `action` ' +
        '(the "begin" step here) to start the export and get a job ID, action=status to poll progress, action=get to ' +
        'download it once complete. Not destructive: reads only. The bundle itself is never inlined; every step returns ' +
        'metadata plus a bounded text preview, never the raw bundle.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['begin', 'status', 'get'],
            description: 'Step to perform. "begin" (default) starts the export; "status" and "get" require job-id.',
          },
          'job-id': { type: 'string', description: 'Required for action=status or action=get. The job ID from the begin step.' },
          ...TARGET_PROP,
        },
      },
    }),
    destructiveTool({
      name: 'panos_import_file',
      description:
        'Import a file to the appliance (type=import), e.g. category=anti-virus content updates. Writes appliance state ' +
        'and, for update packages, does not install them; installation is a separate updates-domain step. Provide ' +
        'file content as base64 in `fileContentBase64`.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Required. Import category confirmed against the collection: "anti-virus". Other PAN-OS import categories (content, software, license) are not yet grounded here; use panos_import_certificate for certificates.' },
          fileName: { type: 'string', description: 'Required. File name to send with the upload.' },
          fileContentBase64: { type: 'string', description: 'Required. File content, base64-encoded.' },
          vsys: { type: 'string', description: 'Optional. Target virtual system. Default shared.' },
          ...TARGET_PROP,
        },
        required: ['category', 'fileName', 'fileContentBase64'],
      },
    }),
    destructiveTool({
      name: 'panos_import_certificate',
      description:
        'Import a certificate or key (type=import&category=certificate). Writes appliance state. Provide file content ' +
        'as base64 in `fileContentBase64`. On Panorama, `target-tpl` (+ optional `target-tpl-vsys`) pushes the import ' +
        'into a template instead of the local candidate config.',
      inputSchema: {
        type: 'object',
        properties: {
          'certificate-name': { type: 'string', description: 'Required. Name for the imported certificate.' },
          format: { type: 'string', enum: [...CERT_FORMATS], description: 'Required. Format of the certificate being imported.' },
          passphrase: { type: 'string', description: 'Required when the file includes a private key. Passphrase to decrypt it.' },
          'target-tpl': { type: 'string', description: 'Optional. On Panorama, import into this template.' },
          'target-tpl-vsys': { type: 'string', description: 'Optional. On Panorama, import into this vsys within the target template. Default shared.' },
          vsys: { type: 'string', description: 'Optional. Target virtual system. Default shared.' },
          fileName: { type: 'string', description: 'Required. File name to send with the upload.' },
          fileContentBase64: { type: 'string', description: 'Required. File content, base64-encoded.' },
          ...TARGET_PROP,
        },
        required: ['certificate-name', 'format', 'fileName', 'fileContentBase64'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const target = args.target as string | undefined;
  switch (toolName) {
    case 'panos_export': {
      logger.info('API call: export', { category: args.category });
      try {
        const params: ExportParams = {
          category: args.category,
          'certificate-name': args['certificate-name'],
          format: args.format,
          'include-key': args['include-key'],
          from: args.from,
          'pcap-id': args['pcap-id'],
          'search-time': args['search-time'],
          sessionid: args.sessionid,
          vsys: args.vsys,
        } as ExportParams;
        // GAP: see logs.ts - `target` has no documented slot on ExportParams;
        // threaded here and flagged in the implementer report.
        const result = await client.exportFile((target ? { ...params, target } : params) as ExportParams);
        return shapeRaw(summarizeExport(result));
      } catch (err) {
        return panosToolError('panos_export', err, {
          hint: 'Check that the fields required for the chosen `category` are present (see the tool description).',
        });
      }
    }
    case 'panos_export_tech_support': {
      const action = (args.action as string | undefined) ?? 'begin';
      logger.info('API call: export.tech-support', { action, jobId: args['job-id'] });
      try {
        const params: ExportParams = {
          category: 'tech-support',
          action: action === 'begin' ? undefined : action,
          'job-id': args['job-id'],
        } as ExportParams;
        const result = await client.exportFile((target ? { ...params, target } : params) as ExportParams);
        return shapeRaw(summarizeExport(result));
      } catch (err) {
        return panosToolError('panos_export_tech_support', err, {
          hint: 'Call with no action first, then poll action=status with the returned job-id before action=get.',
        });
      }
    }
    case 'panos_import_file': {
      logger.info('API call: import.file', { category: args.category, fileName: args.fileName });
      try {
        const params: ImportParams = {
          category: args.category,
          vsys: args.vsys,
        } as ImportParams;
        const result = await client.importFile(
          (target ? { ...params, target } : params) as ImportParams,
          { name: String(args.fileName), content: decodeFile(args.fileContentBase64) },
        );
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_import_file', err, {
          hint: 'Verify `category` and that `fileContentBase64` is valid base64 of the intended file.',
        });
      }
    }
    case 'panos_import_certificate': {
      logger.info('API call: import.certificate', { certName: args['certificate-name'], fileName: args.fileName });
      try {
        const params: ImportParams = {
          category: 'certificate',
          'certificate-name': args['certificate-name'],
          format: args.format,
          passphrase: args.passphrase,
          'target-tpl': args['target-tpl'],
          'target-tpl-vsys': args['target-tpl-vsys'],
          vsys: args.vsys,
        } as ImportParams;
        const result = await client.importFile(
          (target ? { ...params, target } : params) as ImportParams,
          { name: String(args.fileName), content: decodeFile(args.fileContentBase64) },
        );
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_import_certificate', err, {
          hint: 'Verify `format` matches the file and that `passphrase` is set if the file includes a private key.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const filesHandler: DomainHandler = { getTools, handleCall };
