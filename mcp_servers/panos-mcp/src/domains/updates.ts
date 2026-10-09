import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { shapeRaw, panosToolError, destructiveTool, TARGET_PROP, readOnlyTool } from './_helpers.js';

// Op-command XML per content-update family, copied verbatim from the
// postman collection ("Use Cases/Automatically check for and install
// content updates"). Do not compose these from memory - a hand-typed
// element name is a silent no-op or a PAN-OS validation error.
const CHECK_CMD: Record<string, string> = {
  content: '<request><content><upgrade><check></check></upgrade></content></request>', // "Check for Application & Threat updates"
  wildfire: '<request><wildfire><upgrade><check></check></upgrade></wildfire></request>', // "Check for WildFire updates"
  'anti-virus': '<request><anti-virus><upgrade><check></check></upgrade></anti-virus></request>', // "Check for Antivirus updates"
  'global-protect-client': '<request><global-protect-client><software><check></check></software></global-protect-client></request>', // "Check for GlobalProtect client updates"
};

const DOWNLOAD_CMD: Record<string, (version?: string) => string> = {
  content: () => '<request><content><upgrade><download><latest></latest></download></upgrade></content></request>', // "Download latest Application & Threat update"
  wildfire: () => '<request><wildfire><upgrade><download><latest></latest></download></upgrade></wildfire></request>', // "Download latest WildFire update"
  'anti-virus': () => '<request><anti-virus><upgrade><download><latest></latest></download></upgrade></anti-virus></request>', // "Download latest Anti-Virus update"
  // "Download latest GlobalProtect client update" pins a version rather than "latest"; default matches the collection's example.
  'global-protect-client': (version = '5.2.4') =>
    `<request><global-protect-client><software><download><version>${version}</version></download></software></global-protect-client></request>`,
};

const INSTALL_CMD: Record<string, (version?: string) => string> = {
  content: () => '<request><content><upgrade><install><version>latest</version></install></upgrade></content></request>', // "Install latest Application & Threat update"
  wildfire: () => '<request><wildfire><upgrade><install><version>latest</version></install></upgrade></wildfire></request>', // "Install latest WildFire update"
  'anti-virus': () => '<request><anti-virus><upgrade><install><version>latest</version></install></upgrade></anti-virus></request>', // "Install latest Anti-Virus update"
  // GlobalProtect client has no op-command named "install" in the collection - its lifecycle's
  // installation step is "activate" ("Install latest GlobalProtect client", which calls <activate>).
  'global-protect-client': (version = '5.2.4') =>
    `<request><global-protect-client><software><activate><version>${version}</version></activate></software></global-protect-client></request>`,
};

const KIND_ENUM = ['content', 'wildfire', 'anti-virus', 'global-protect-client'];

const JOB_WAIT_NOTE =
  'Returns a job id. Follow it to completion with panos_job_wait (commits domain) before treating the update as applied.';

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_updates_check',
      description:
        'Check for available content updates for the given family (Application & Threat content, WildFire, Antivirus, or GlobalProtect client). Read-only; does not download or install anything.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          kind: { type: 'string', enum: KIND_ENUM, description: 'Content update family to check.' },
          ...TARGET_PROP,
        },
        required: ['kind'],
      },
    }),
    destructiveTool({
      name: 'panos_updates_download',
      description:
        `Download the latest content update for the given family. Long-running. ${JOB_WAIT_NOTE} ` +
        'Do not call panos_updates_install for this kind until the matching download job reports done.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          kind: { type: 'string', enum: KIND_ENUM, description: 'Content update family to download.' },
          version: { type: 'string', description: 'Version to download. Only used for global-protect-client (default 5.2.4); other kinds always download "latest".' },
          ...TARGET_PROP,
        },
        required: ['kind'],
      },
    }),
    destructiveTool({
      name: 'panos_updates_install',
      description:
        `Install the latest downloaded content update for the given family. Long-running. ${JOB_WAIT_NOTE} ` +
        'Must not be called before the matching panos_updates_download job for this kind reports done - installing an update that has not finished downloading fails or installs stale content.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          kind: { type: 'string', enum: KIND_ENUM, description: 'Content update family to install.' },
          version: { type: 'string', description: 'Version to activate. Only used for global-protect-client (default 5.2.4); other kinds always install "latest".' },
          ...TARGET_PROP,
        },
        required: ['kind'],
      },
    }),
    readOnlyTool({
      name: 'panos_software_check',
      description: 'Check for the latest available PAN-OS software (base image) update. Read-only; does not download or install anything.',
      inputSchema: { type: 'object' as const, properties: { ...TARGET_PROP } },
    }),
    destructiveTool({
      name: 'panos_software_download',
      description:
        `Download a PAN-OS software version. Long-running. ${JOB_WAIT_NOTE} ` +
        'Do not call panos_software_install for this version until the matching download job reports done.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          version: { type: 'string', description: 'PAN-OS version to download, e.g. "10.0.2". Obtain valid versions from panos_software_check.' },
          ...TARGET_PROP,
        },
        required: ['version'],
      },
    }),
    destructiveTool({
      name: 'panos_software_install',
      description:
        `Install a downloaded PAN-OS software version. Long-running. ${JOB_WAIT_NOTE} ` +
        'Must not be called before the matching panos_software_download job for this version reports done. Installing PAN-OS software typically requires a subsequent panos_system_reboot to take effect.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          version: { type: 'string', description: 'PAN-OS version to install, e.g. "10.0.2". Must already be downloaded.' },
          ...TARGET_PROP,
        },
        required: ['version'],
      },
    }),
    destructiveTool({
      name: 'panos_system_reboot',
      description:
        'VISIBLE-TO-OTHERS: Reboot the firewall now. This drops traffic for every user behind the firewall for the duration of the reboot. Only call after confirming the operator wants the device to go offline.',
      inputSchema: { type: 'object' as const, properties: { ...TARGET_PROP } },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const target = args.target as string | undefined;
  switch (toolName) {
    case 'panos_updates_check': {
      const kind = args.kind as string;
      try {
        const result = await client.op(CHECK_CMD[kind], { target });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_updates_check', err, { hint: 'Verify the appliance can reach the Palo Alto update server.' });
      }
    }
    case 'panos_updates_download': {
      const kind = args.kind as string;
      logger.info('API call: updates.download', { kind, target });
      try {
        const result = await client.op(DOWNLOAD_CMD[kind](args.version as string | undefined), { target });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_updates_download', err, { hint: 'Run panos_updates_check first to confirm an update is available.' });
      }
    }
    case 'panos_updates_install': {
      const kind = args.kind as string;
      logger.info('API call: updates.install', { kind, target });
      try {
        const result = await client.op(INSTALL_CMD[kind](args.version as string | undefined), { target });
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_updates_install', err, { hint: 'Confirm the matching panos_updates_download job reported done via panos_job_wait before retrying.' });
      }
    }
    case 'panos_software_check': {
      try {
        const result = await client.op('<request><system><software><check></check></software></system></request>', { target }); // "Check for the latest PAN-OS software update"
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_software_check', err, { hint: 'Verify the appliance can reach the Palo Alto update server.' });
      }
    }
    case 'panos_software_download': {
      const version = args.version as string;
      logger.info('API call: software.download', { version, target });
      try {
        // "Download the latest PAN-OS software update"
        const result = await client.op(
          `<request><system><software><download><version>${version}</version></download></software></system></request>`,
          { target },
        );
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_software_download', err, { hint: 'Run panos_software_check first to confirm the version is available.' });
      }
    }
    case 'panos_software_install': {
      const version = args.version as string;
      logger.info('API call: software.install', { version, target });
      try {
        // "Install the latest PAN-OS software update"
        const result = await client.op(
          `<request><system><software><install><version>${version}</version></install></software></system></request>`,
          { target },
        );
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_software_install', err, { hint: 'Confirm the matching panos_software_download job reported done via panos_job_wait before retrying.' });
      }
    }
    case 'panos_system_reboot': {
      logger.info('API call: system.reboot', { target });
      try {
        const result = await client.op('<request><restart><system></system></restart></request>', { target }); // "Reboot the firewall"
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_system_reboot', err);
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const updatesHandler: DomainHandler = { getTools, handleCall };
