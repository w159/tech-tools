import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { TARGET_PROP, destructiveTool, panosToolError, jsonResult, readOnlyTool } from './_helpers.js';

// panos_job_wait's bounded default; named in its description per the spec.
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

function getTools(): Tool[] {
  return [
    destructiveTool({
      name: 'panos_commit',
      description: 'DESTRUCTIVE: Commit the candidate configuration to the running configuration on this device (or, with target, a managed firewall). This is the separate step that makes panos_config_set / edit / delete / rename / clone / move / override changes live. Returns a job ID; poll it with panos_job_status or panos_job_wait.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          partial: { type: 'boolean', description: 'Only commit a portion of the configuration (adds action=partial).' },
          force: { type: 'boolean', description: 'Force the commit even if another admin holds a commit lock.' },
          cmd: { type: 'string', description: 'Optional raw <commit>...</commit> XML overriding the constructed command, for advanced partial-commit scoping (for example excluding shared-object or device-and-network changes).' },
          ...TARGET_PROP,
        },
      },
    }),
    destructiveTool({
      name: 'panos_commit_all',
      description: "DESTRUCTIVE: Commit and push configuration from Panorama to managed firewalls, templates, or a virtual system (type=commit&action=all). This is the separate step that makes candidate-config changes live on the managed devices. Returns a job ID; poll it with panos_job_status or panos_job_wait.",
      inputSchema: {
        type: 'object' as const,
        properties: {
          cmd: { type: 'string', description: 'Required raw <commit-all>...</commit-all> XML naming the device group, template, or vsys to push to.' },
          ...TARGET_PROP,
        },
        required: ['cmd'],
      },
    }),
    readOnlyTool({
      name: 'panos_job_status',
      description: 'Check the current status of a job-table job by ID, without waiting for it to finish. The job table (<show><jobs>) holds commits, content/software downloads and installs, and tech-support exports. It does NOT hold log-query or report jobs: PAN-OS keeps those in a separate namespace, so an ID from panos_logs_query or panos_report_* answers PAN-OS error code 7 (Object not present) here - fetch those with panos_logs_retrieve and panos_report_get instead.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          jobId: { type: 'string', description: 'Required job-table job ID, from panos_commit, panos_commit_all, an update/software download or install, or a tech-support export. Not a panos_logs_query or panos_report_* ID.' },
          ...TARGET_PROP,
        },
        required: ['jobId'],
      },
    }),
    readOnlyTool({
      name: 'panos_job_wait',
      description: `Poll a job-table job by ID until it finishes or a timeout elapses, then return its final status. Defaults to a ${DEFAULT_WAIT_TIMEOUT_MS / 1000}s timeout; pass timeoutMs to change it. Same scope as panos_job_status: commits, content/software jobs, and tech-support exports only - log-query and report IDs are not in the job table and must be fetched with panos_logs_retrieve or panos_report_get.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          jobId: { type: 'string', description: 'Required job-table job ID to wait on. Not a panos_logs_query or panos_report_* ID.' },
          timeoutMs: { type: 'number', description: `Maximum time to wait in milliseconds. Defaults to ${DEFAULT_WAIT_TIMEOUT_MS}.` },
          pollMs: { type: 'number', description: 'Polling interval in milliseconds.' },
          ...TARGET_PROP,
        },
        required: ['jobId'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const target = args.target as string | undefined;
  try {
    switch (toolName) {
      case 'panos_commit': {
        logger.info('API call: commit', args);
        const action = args.partial ? 'partial' : undefined;
        const cmd = (args.cmd as string | undefined) ?? (args.force ? '<commit><force></force></commit>' : '<commit></commit>');
        const result = await client.commit({ cmd, action, target });
        return jsonResult(result);
      }
      case 'panos_commit_all': {
        logger.info('API call: commit-all', { target });
        const result = await client.commit({ cmd: args.cmd as string, action: 'all', target });
        return jsonResult(result);
      }
      case 'panos_job_status': {
        logger.info('API call: jobs.status', args);
        const result = await client.jobs.status(args.jobId as string);
        return jsonResult(result);
      }
      case 'panos_job_wait': {
        logger.info('API call: jobs.wait', args);
        const result = await client.jobs.wait(args.jobId as string, {
          timeoutMs: (args.timeoutMs as number | undefined) ?? DEFAULT_WAIT_TIMEOUT_MS,
          pollMs: args.pollMs as number | undefined,
        });
        return jsonResult(result);
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (err) {
    return panosToolError(toolName, err, {
      hint: 'Job IDs accepted here come from panos_commit, panos_commit_all, an update/software install, or a tech-support export.',
    });
  }
}

export const commitsHandler: DomainHandler = { getTools, handleCall };
