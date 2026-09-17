import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { shapeRaw, TARGET_PROP, panosToolError, readOnlyTool } from './_helpers.js';
import type { LogParams } from 'node-panos';

// Confirmed against "PAN-OS XML API.postman_collection.json" (Retrieve logs,
// type=log) query-parameter description for `log-type`. The task brief's
// suggested list (hip-match, sctp, decryption, tunnel, userid, globalprotect)
// does not match the collection and was dropped rather than guessed; the
// collection's own spelling (e.g. `hipmatch`, `user-id`) is used verbatim.
const LOG_TYPES = [
  'traffic',
  'threat',
  'config',
  'system',
  'hipmatch',
  'wildfire',
  'url',
  'data',
  'corr',
  'corr-detail',
  'corr-categ',
  'user-id',
  'auth',
  'gtp',
  'external',
  'iptag',
] as const;

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_logs_query',
      description:
        'Phase 1 of 2 for reading PAN-OS logs. Starts an asynchronous log retrieval job (type=log) and returns a job ID; ' +
        'it does not return log entries. Retrieve that ID with panos_logs_retrieve - NOT with panos_job_status or ' +
        'panos_job_wait, which read the job table and answer PAN-OS error code 7 (Object not present) for a log job ID. ' +
        "The `query` filter uses the same syntax as the Monitor tab, e.g. \"(receive_time geq '2020/12/15 06:00:00')\" " +
        "or \"(zone.src eq 'trust') and (action eq 'deny')\". Omitting `query` returns the most recent logs of the given type.",
      inputSchema: {
        type: 'object',
        properties: {
          'log-type': {
            type: 'string',
            enum: [...LOG_TYPES],
            description: 'Required. The log type to query.',
          },
          query: {
            type: 'string',
            description:
              "Optional filter, e.g. \"(receive_time geq '2020/12/15 06:00:00')\". URL-encoded automatically.",
          },
          nlogs: {
            type: 'string',
            description: 'Optional. Number of logs to retrieve. Default 20, maximum 5000.',
          },
          skip: {
            type: 'string',
            description: 'Optional. Number of logs to skip, for paging through results in batches. Default 0.',
          },
          dir: {
            type: 'string',
            enum: ['forward', 'backward'],
            description: 'Optional. Oldest first (forward) or newest first (backward, the default).',
          },
          ...TARGET_PROP,
        },
        required: ['log-type'],
      },
    }),
    readOnlyTool({
      name: 'panos_logs_retrieve',
      description:
        'Phase 2 of 2 for reading PAN-OS logs. Fetches the results of a log retrieval job started by panos_logs_query ' +
        '(type=log&action=get&job-id=<id>), and is the only tool that can: log jobs live outside the job table that ' +
        'panos_job_status reads. Call this after panos_logs_query returns a job ID; a job may not be ready ' +
        'immediately, so a "still running" style result may need to be retried.',
      inputSchema: {
        type: 'object',
        properties: {
          'job-id': {
            type: 'string',
            description: 'Required. The job ID returned by panos_logs_query.',
          },
          'log-type': {
            type: 'string',
            enum: [...LOG_TYPES],
            description: 'Optional. The log type the job was started with; the collection includes it on retrieval too.',
          },
          ...TARGET_PROP,
        },
        required: ['job-id'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const target = args.target as string | undefined;
  switch (toolName) {
    case 'panos_logs_query': {
      logger.info('API call: logs.query', args);
      try {
        const params: LogParams = {
          'log-type': args['log-type'],
          query: args.query,
          nlogs: args.nlogs,
          skip: args.skip,
          dir: args.dir,
        } as LogParams;
        // GAP: the client contract documents `target` as a second `opts` arg
        // on op()/commit() but gives logs() a single params object with no
        // documented target slot. Threaded here rather than dropped; flagged
        // in the implementer report for confirmation against the real type.
        const result = await client.logs((target ? { ...params, target } : params) as LogParams);
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_logs_query', err, {
          hint: 'Verify `log-type` is a supported value and `query` uses valid Monitor-tab filter syntax.',
        });
      }
    }
    case 'panos_logs_retrieve': {
      logger.info('API call: logs.retrieve', args);
      try {
        const params: LogParams = {
          action: 'get',
          'job-id': args['job-id'],
          'log-type': args['log-type'],
        } as LogParams;
        const result = await client.logs((target ? { ...params, target } : params) as LogParams);
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_logs_retrieve', err, {
          hint: 'Verify the job ID with panos_logs_query first; the job may still be running.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const logsHandler: DomainHandler = { getTools, handleCall };
