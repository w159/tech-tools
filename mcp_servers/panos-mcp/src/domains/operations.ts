import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { keygen } from 'node-panos';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { TARGET_PROP, destructiveTool, toolError, panosToolError, jsonResult, readOnlyTool, unknownEffectTool } from './_helpers.js';

// Same placeholder-stripping rule as utils/client.ts, duplicated here because
// panos_keygen must read raw env vars before any PanosClient (and its apiKey
// requirement) exists.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

function getTools(): Tool[] {
  return [
    unknownEffectTool({
      name: 'panos_op',
      description: "Run a raw PAN-OS operational command (type=op), given its <cmd> XML exactly as it would appear in the API browser or CLI 'debug cli xml-output' form. An op command can be destructive (for example a restart, a config load, or a session clear) as easily as it can be read-only. Read the cmd you are about to send before calling this; this tool does not know which commands are safe.",
      inputSchema: {
        type: 'object' as const,
        properties: {
          cmd: { type: 'string', description: "Required raw operational command XML, e.g. '<show><system><info/></system></show>'." },
          ...TARGET_PROP,
        },
        required: ['cmd'],
      },
    }),
    readOnlyTool({
      name: 'panos_version',
      description: 'Get the PAN-OS version, serial number, model number, and multi-vsys capability of the device (type=version).',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
    readOnlyTool({
      name: 'panos_system_info',
      description: "Show current system information: hostname, uptime, model, serial, software versions (op command <show><system><info/></system></show>).",
      inputSchema: {
        type: 'object' as const,
        properties: { ...TARGET_PROP },
      },
    }),
    readOnlyTool({
      name: 'panos_devices_list',
      description: 'PANORAMA ONLY: list the firewalls this Panorama manages, with connection state, software versions, and vsys detail. A standalone firewall has no managed devices and answers PAN-OS error code 17 (Invalid command) rather than an empty list - that error is expected there, not a credential or connector fault. For the connected device itself, use panos_system_info or panos_version.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          connectedOnly: { type: 'boolean', description: 'When true, list only currently connected firewalls (<show><devices><connected/></devices></show>). Defaults to false, which lists all managed firewalls including disconnected ones (<show><devices><all/></devices></show>).' },
        },
      },
    }),
    readOnlyTool({
      name: 'panos_globalprotect_users',
      description: 'Show all users currently connected through GlobalProtect: username, computer, client IP, virtual IP, login time, and tunnel type.',
      inputSchema: {
        type: 'object' as const,
        properties: { ...TARGET_PROP },
      },
    }),
    destructiveTool({
      name: 'panos_globalprotect_disconnect',
      description: "VISIBLE-TO-OTHERS: Force-disconnect a user's active GlobalProtect session, dropping their VPN tunnel immediately. The user sees their connection drop with no warning.",
      inputSchema: {
        type: 'object' as const,
        properties: {
          gateway: { type: 'string', description: 'Required GlobalProtect gateway name the user is connected to.' },
          user: { type: 'string', description: 'Required username to disconnect.' },
          computer: { type: 'string', description: 'Required computer/endpoint name reported by the client.' },
          reason: { type: 'string', description: "Reason recorded for the logout. Defaults to 'force-logout'." },
          ...TARGET_PROP,
        },
        required: ['gateway', 'user', 'computer'],
      },
    }),
    readOnlyTool({
      name: 'panos_keygen',
      description: "Mint a new PAN-OS API key from a username and password (type=keygen, sent as a POST body, never in the URL). Returns the minted key to you; it is NOT stored or persisted by this server - put it in PANOS_API_KEY yourself. The returned key is a long-lived credential and will appear in this conversation's transcript, so treat it accordingly and rotate it if the transcript is shared.",
      inputSchema: {
        type: 'object' as const,
        properties: {
          username: { type: 'string', description: 'Admin username. Defaults to PANOS_USERNAME if omitted.' },
          password: { type: 'string', description: 'Admin password. Defaults to PANOS_PASSWORD if omitted.' },
        },
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (toolName === 'panos_keygen') {
    try {
      const host = cleanEnv(process.env.PANOS_HOST);
      const user = (args.username as string | undefined) ?? cleanEnv(process.env.PANOS_USERNAME);
      const password = (args.password as string | undefined) ?? cleanEnv(process.env.PANOS_PASSWORD);
      const verifyTlsRaw = cleanEnv(process.env.PANOS_VERIFY_TLS);
      const verifyTls = verifyTlsRaw.toLowerCase() !== 'false';
      if (!host || !user || !password) {
        return toolError('MISSING_CREDENTIALS', 'panos_keygen needs a host, username, and password.', {
          hint: 'Set PANOS_HOST, PANOS_USERNAME, and PANOS_PASSWORD, or pass username/password directly.',
        });
      }
      logger.info('API call: keygen', { host, user });
      const key = await keygen({ host, user, password, verifyTls });
      return jsonResult({
        apiKey: key,
        warning: 'This key is not stored anywhere by this server. Set it as PANOS_API_KEY yourself. It is a long-lived credential now visible in this conversation transcript.',
      });
    } catch (err) {
      return panosToolError('panos_keygen', err, {
        hint: 'Verify PANOS_HOST, PANOS_USERNAME, and PANOS_PASSWORD are correct.',
      });
    }
  }

  const client = await getClient();
  const target = args.target as string | undefined;
  try {
    switch (toolName) {
      case 'panos_op': {
        logger.info('API call: op', { cmd: args.cmd, target });
        const result = await client.op(args.cmd as string, { target });
        return jsonResult(result);
      }
      case 'panos_version': {
        logger.info('API call: version');
        const result = await client.version();
        return jsonResult(result);
      }
      case 'panos_system_info': {
        logger.info('API call: op system info', { target });
        const result = await client.op('<show><system><info/></system></show>', { target });
        return jsonResult(result);
      }
      case 'panos_devices_list': {
        logger.info('API call: op devices list', { connectedOnly: args.connectedOnly });
        const cmd = args.connectedOnly
          ? '<show><devices><connected/></devices></show>'
          : '<show><devices><all/></devices></show>';
        const result = await client.op(cmd);
        return jsonResult(result);
      }
      case 'panos_globalprotect_users': {
        logger.info('API call: op globalprotect users', { target });
        const result = await client.op('<show><global-protect-gateway><current-user/></global-protect-gateway></show>', { target });
        return jsonResult(result);
      }
      case 'panos_globalprotect_disconnect': {
        logger.info('API call: op globalprotect disconnect', { user: args.user, gateway: args.gateway, target });
        const reason = (args.reason as string | undefined) ?? 'force-logout';
        const cmd = `<request><global-protect-gateway><client-logout><gateway>${args.gateway}</gateway><user>${args.user}</user><computer>${args.computer}</computer><reason>${reason}</reason></client-logout></global-protect-gateway></request>`;
        const result = await client.op(cmd, { target });
        return jsonResult(result);
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (err) {
    // No credential hint here: panosToolError adds one only when PAN-OS
    // actually rejected the credential. This call-site hint is about the
    // command itself, which is what a code 1 / 17 failure is about.
    return panosToolError(toolName, err, {
      hint: 'Confirm the command exists on this device - panos_version reports its model, software version, and multi-vsys mode.',
    });
  }
}

export const operationsHandler: DomainHandler = { getTools, handleCall };
