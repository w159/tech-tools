import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName } from '../utils/types.js';

export const DOMAINS: DomainName[] = [
  'employees',
  'legacy_employees',
  'earnings',
  'deductions',
  'taxes',
  'direct_deposit',
  'cost_centers',
  'pay_grades',
  'job_codes',
  'pay_statements',
  'lookup_codes',
];

const domainDescriptions: Record<DomainName, string> = {
  employees:
    'Modern CoreHR employees — list/get with expansion (info, position, status, payRate, futurePayRate)',
  legacy_employees:
    'Legacy /api/v2 employees — list/get returning raw JSON arrays (no pagination)',
  earnings:
    'Company-level earning codes (modern Payroll API Hub) + per-employee earnings (legacy WebLink /api/v2)',
  deductions: 'Per-employee deductions (legacy WebLink /api/v1)',
  taxes: 'Per-employee local taxes (legacy WebLink /api/v2)',
  direct_deposit: 'Per-employee direct deposit accounts (legacy WebLink /api/v2)',
  cost_centers: 'Cost center catalog (modern Time and Labor API Hub)',
  pay_grades: 'Pay grade catalog (modern Position Management API Hub)',
  job_codes: 'Job code catalog (modern Payroll API Hub)',
  pay_statements:
    'Yearly pay statement summary for an employee (legacy WebLink /api/v2)',
  lookup_codes:
    'Lookup codes by resource (paygroup, EEO, positions, departments, etc.)',
};

export function getNavigationTools(): Tool[] {
  const domainLines = DOMAINS.map(d => `- ${d}: ${domainDescriptions[d]}`).join('\n');
  return [
    {
      name: 'paylocity_navigate',
      description:
        'Discover available Paylocity tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable directly — this is a help/discovery aid.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            enum: DOMAINS,
            description: `The domain to explore:\n${domainLines}`,
          },
        },
        required: ['domain'],
      },
    },
    {
      name: 'paylocity_status',
      description:
        'Show Paylocity credentials status, base URL, default companyId, and available domains. Use to verify connectivity before calling other tools.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ];
}
