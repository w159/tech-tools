import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { shapeRaw, panosToolError, destructiveTool, TARGET_PROP, readOnlyTool } from './_helpers.js';

const SSL_DECRYPT_XPATH = '/config/shared/ssl-decrypt';

function getTools(): Tool[] {
  return [
    destructiveTool({
      name: 'panos_cert_generate',
      description:
        'Generate a self-signed root certificate, or a subordinate certificate signed by an existing one on the appliance (pass signed-by). ' +
        'Mirrors the postman collection\'s "Generate self signed certificate" and "Create subordinate certificate" op-commands.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name to store the certificate under on the appliance (required).' },
          name: { type: 'string', description: 'Certificate subject, e.g. a hostname or IP such as "10.1.1.1" (required).' },
          'rsa-nbits': { type: 'string', enum: ['512', '1024', '2048', '3072', '4096'], description: 'RSA key size in bits (default 2048).' },
          digest: { type: 'string', enum: ['sha1', 'sha256', 'sha384', 'sha512', 'md5'], description: 'Signing digest algorithm (default sha256).' },
          ca: { type: 'string', enum: ['yes', 'no'], description: '"yes" for a self-signed CA/root certificate, "no" for a leaf/subordinate certificate (default "yes").' },
          'signed-by': { type: 'string', description: 'Name of an existing certificate on the appliance to sign this one with. Required to create a subordinate certificate (implies ca=no).' },
          ...TARGET_PROP,
        },
        required: ['certificate-name', 'name'],
      },
    }),
    destructiveTool({
      name: 'panos_cert_renew',
      description: 'Renew an existing self-signed certificate, extending its expiry by the given number of days.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name of the certificate to renew (required).' },
          'days-till-expiry': { type: 'string', description: 'New validity length in days from today, e.g. "365" (required).' },
          ...TARGET_PROP,
        },
        required: ['certificate-name', 'days-till-expiry'],
      },
    }),
    destructiveTool({
      name: 'panos_cert_revoke',
      description:
        'Revoke a certificate. This breaks every session and every service relying on that certificate immediately - TLS decryption profiles, GlobalProtect gateways, or management access bound to it will fail until a replacement is issued.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name of the certificate to revoke (required).' },
          ...TARGET_PROP,
        },
        required: ['certificate-name'],
      },
    }),
    readOnlyTool({
      name: 'panos_cert_export',
      description: 'Export a certificate (and optionally its private key) from the appliance in the given format. Read-only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name of the certificate to export (required).' },
          format: { type: 'string', enum: ['pem', 'pkcs12', 'pkcs10'], description: 'Export format (default "pem").' },
          'include-key': { type: 'string', enum: ['yes', 'no'], description: 'Whether to include the private key in the export (default "no").' },
          ...TARGET_PROP,
        },
        required: ['certificate-name'],
      },
    }),
    destructiveTool({
      name: 'panos_cert_import',
      description: 'Import a certificate file onto the appliance under the given name.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name to store the imported certificate under (required).' },
          format: { type: 'string', enum: ['pem', 'pkcs12'], description: 'Format of the file being imported (default "pem").' },
          content: { type: 'string', description: 'Certificate file content to import (required).' },
          ...TARGET_PROP,
        },
        required: ['certificate-name', 'content'],
      },
    }),
    destructiveTool({
      name: 'panos_cert_set_trusted_root',
      description:
        'Add a certificate to the SSL decryption trusted-root-CA list. This writes to the candidate config only under ' +
        `${SSL_DECRYPT_XPATH} - it does not take effect until a separate panos_commit. Ground the xpath with panos_config_show or panos_config_complete before calling this if you are unsure of the current list.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name of an existing certificate to add as a trusted root CA (required).' },
          ...TARGET_PROP,
        },
        required: ['certificate-name'],
      },
    }),
    destructiveTool({
      name: 'panos_cert_set_forward_trust',
      description:
        'Set a certificate as the SSL forward-proxy forward-trust certificate. This writes to the candidate config only under ' +
        `${SSL_DECRYPT_XPATH} - it does not take effect until a separate panos_commit. Ground the xpath with panos_config_show or panos_config_complete before calling this if you are unsure of the current setting.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          'certificate-name': { type: 'string', description: 'Name of an existing certificate to set as the forward-trust certificate (required).' },
          ...TARGET_PROP,
        },
        required: ['certificate-name'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const target = args.target as string | undefined;
  const certName = args['certificate-name'] as string;
  switch (toolName) {
    case 'panos_cert_generate': {
      logger.info('API call: cert.generate', { certName, target });
      const nbits = (args['rsa-nbits'] as string) || '2048';
      const digest = (args.digest as string) || 'sha256';
      const ca = (args.ca as string) || 'yes';
      const signedBy = args['signed-by'] as string | undefined;
      // "Generate self signed certificate" / "Create subordinate certificate" (signed-by present)
      const cmd =
        `<request><certificate><generate><certificate-name>${certName}</certificate-name>` +
        `<name>${args.name as string}</name><algorithm><RSA><rsa-nbits>${nbits}</rsa-nbits></RSA></algorithm>` +
        `<digest>${digest}</digest><ca>${ca}</ca>` +
        (signedBy ? `<signed-by>${signedBy}</signed-by>` : '') +
        '</generate></certificate></request>';
      try {
        const result = await client.op(cmd, { target });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_generate', err);
      }
    }
    case 'panos_cert_renew': {
      logger.info('API call: cert.renew', { certName, target });
      // "Renew self signed certificate"
      const cmd = `<request><certificate><renew><certificate-name>${certName}</certificate-name><days-till-expiry>${args['days-till-expiry'] as string}</days-till-expiry></renew></certificate></request>`;
      try {
        const result = await client.op(cmd, { target });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_renew', err, { hint: 'Verify the certificate name with panos_cert_export or the config tree first.' });
      }
    }
    case 'panos_cert_revoke': {
      logger.info('API call: cert.revoke', { certName, target });
      // "Revoke subordinate certificate"
      const cmd = `<request><certificate><revoke><certificate-name>${certName}</certificate-name></revoke></certificate></request>`;
      try {
        const result = await client.op(cmd, { target });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_revoke', err);
      }
    }
    case 'panos_cert_export': {
      const format = (args.format as string) || 'pem';
      const includeKey = (args['include-key'] as string) || 'no';
      logger.info('API call: cert.export', { certName, format, target });
      try {
        // "Export certificate"
        const result = await client.exportFile({
          category: 'certificate',
          'certificate-name': certName,
          format,
          'include-key': includeKey,
          target,
        });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_export', err, { hint: 'Verify the certificate name with the config tree first.' });
      }
    }
    case 'panos_cert_import': {
      const format = (args.format as string) || 'pem';
      logger.info('API call: cert.import', { certName, format, target });
      try {
        // "Import certificate"
        const result = await client.importFile(
          { category: 'certificate', 'certificate-name': certName, format, target },
          { name: `${certName}.${format}`, content: args.content as string },
        );
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_import', err);
      }
    }
    case 'panos_cert_set_trusted_root': {
      logger.info('API call: cert.set_trusted_root', { certName, target });
      try {
        // "Set certificate as trusted root"
        const result = await client.config('set', {
          xpath: SSL_DECRYPT_XPATH,
          element: `<trusted-root-CA><member>${certName}</member></trusted-root-CA>`,
          target,
        });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_set_trusted_root', err, { hint: 'Ground the xpath with panos_config_show or panos_config_complete first.' });
      }
    }
    case 'panos_cert_set_forward_trust': {
      logger.info('API call: cert.set_forward_trust', { certName, target });
      try {
        // "Set certificate as forward trust"
        const result = await client.config('set', {
          xpath: SSL_DECRYPT_XPATH,
          element: `<forward-trust-certificate><rsa>${certName}</rsa></forward-trust-certificate>`,
          target,
        });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_cert_set_forward_trust', err, { hint: 'Ground the xpath with panos_config_show or panos_config_complete first.' });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const certificatesHandler: DomainHandler = { getTools, handleCall };
