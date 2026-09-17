import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { shapeRaw, TARGET_PROP, panosToolError, readOnlyTool } from './_helpers.js';
import type { ReportParams } from 'node-panos';

// Confirmed against the "Reports" folder of the postman collection:
// "Dynamic report" (period/starttime+endtime/topn), "Predefined report"
// (reportname only), "Custom dynamic report" (reporttype=dynamic + cmd XML),
// "Retrieve report results" (action=get&job-id=).
const PERIODS = [
  'last-60-seconds',
  'last-15-minutes',
  'last-hour',
  'last-12-hours',
  'last-calendar-day',
  'last-7-days',
  'last-calendar-week',
  'last-30-days',
] as const;

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_report_dynamic',
      description:
        'Run a built-in dynamic report (type=report&reporttype=dynamic) by name, e.g. "top-app-summary". ' +
        'Enqueues an async report job and returns a job ID; call panos_report_get with that ID for results - NOT ' +
        'panos_job_status or panos_job_wait, which read the job table and answer PAN-OS error code 7 (Object not ' +
        'present) for a report job ID. Requires either `period` or both `starttime` and `endtime`.',
      inputSchema: {
        type: 'object',
        properties: {
          reportname: { type: 'string', description: 'Required. Name of the dynamic report, e.g. "top-app-summary".' },
          period: { type: 'string', enum: [...PERIODS], description: 'Required unless starttime/endtime are given.' },
          starttime: { type: 'string', description: 'Required unless `period` is given. URL-escaped timestamp.' },
          endtime: { type: 'string', description: 'Required unless `period` is given. URL-escaped timestamp.' },
          topn: { type: 'string', description: 'Required. Number of results to return.' },
          ...TARGET_PROP,
        },
        required: ['reportname', 'topn'],
      },
    }),
    readOnlyTool({
      name: 'panos_report_predefined',
      description:
        'Run a predefined PAN-OS report (type=report&reporttype=predefined) by name, e.g. "top-applications". ' +
        'Normally returns the report body directly rather than a job ID; if this appliance answers with a job ID ' +
        'instead, retrieve it with panos_report_get, never with panos_job_status or panos_job_wait.',
      inputSchema: {
        type: 'object',
        properties: {
          reportname: { type: 'string', description: 'Required. Name of the predefined report, e.g. "top-applications".' },
          ...TARGET_PROP,
        },
        required: ['reportname'],
      },
    }),
    readOnlyTool({
      name: 'panos_report_custom',
      description:
        'Run a custom dynamic report (type=report&reporttype=dynamic&reportname=custom-dynamic-report) defined by an ' +
        'inline XML `cmd`, e.g. "<type><appstat><aggregate-by><member>category-of-name</member></aggregate-by>' +
        "</appstat></type><period>last-24-hrs</period><topn>10</topn><topm>10</topm><query>(name+neq+'')</query>\". " +
        'Enqueues an async report job and returns a job ID; call panos_report_get with that ID for results - NOT ' +
        'panos_job_status or panos_job_wait, which cannot see report jobs.',
      inputSchema: {
        type: 'object',
        properties: {
          cmd: { type: 'string', description: 'Required. XML definition of the report.' },
          ...TARGET_PROP,
        },
        required: ['cmd'],
      },
    }),
    readOnlyTool({
      name: 'panos_report_get',
      description:
        'Retrieve the results of a report job (type=report&action=get&job-id=<id>) started by panos_report_dynamic ' +
        'or panos_report_custom, and the only tool that can: report jobs live outside the job table that ' +
        'panos_job_status reads. Call this after one of those returns a job ID.',
      inputSchema: {
        type: 'object',
        properties: {
          'job-id': { type: 'string', description: 'Required. The job ID returned by panos_report_dynamic or panos_report_custom.' },
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
    case 'panos_report_dynamic': {
      logger.info('API call: report.dynamic', args);
      try {
        const params: ReportParams = {
          reporttype: 'dynamic',
          reportname: args.reportname,
          period: args.period,
          starttime: args.starttime,
          endtime: args.endtime,
          topn: args.topn,
        } as ReportParams;
        // GAP: see logs.ts - `target` has no documented slot on ReportParams;
        // threaded here and flagged in the implementer report.
        const result = await client.report((target ? { ...params, target } : params) as ReportParams);
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_report_dynamic', err, {
          hint: 'Provide either `period` or both `starttime` and `endtime`, and verify `reportname`.',
        });
      }
    }
    case 'panos_report_predefined': {
      logger.info('API call: report.predefined', args);
      try {
        const params: ReportParams = {
          reporttype: 'predefined',
          reportname: args.reportname,
        } as ReportParams;
        const result = await client.report((target ? { ...params, target } : params) as ReportParams);
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_report_predefined', err, {
          hint: 'Verify `reportname` matches a predefined report on this appliance.',
        });
      }
    }
    case 'panos_report_custom': {
      logger.info('API call: report.custom', args);
      try {
        const params: ReportParams = {
          reporttype: 'dynamic',
          reportname: 'custom-dynamic-report',
          cmd: args.cmd,
        } as ReportParams;
        const result = await client.report((target ? { ...params, target } : params) as ReportParams);
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_report_custom', err, {
          hint: 'Verify `cmd` is well-formed XML matching a valid report definition.',
        });
      }
    }
    case 'panos_report_get': {
      logger.info('API call: report.get', args);
      try {
        const params: ReportParams = {
          action: 'get',
          'job-id': args['job-id'],
        } as ReportParams;
        const result = await client.report((target ? { ...params, target } : params) as ReportParams);
        return shapeRaw(result);
      } catch (err) {
        return panosToolError('panos_report_get', err, {
          hint: 'Verify the job ID with panos_report_dynamic or panos_report_custom first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const reportsHandler: DomainHandler = { getTools, handleCall };
