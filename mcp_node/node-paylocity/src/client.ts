import type { PaylocityClientConfig } from './types/common.js';
import { HttpClient } from './http.js';
import { RateLimiter } from './rate-limiter.js';
import { PaylocityAuthManager } from './auth.js';
import { EmployeesResource } from './resources/employees.js';
import { LegacyEmployeesResource } from './resources/legacy-employees.js';
import { CostCentersResource } from './resources/cost-centers.js';
import { PayGradesResource } from './resources/pay-grades.js';
import { JobCodesResource } from './resources/job-codes.js';
import { EarningsResource } from './resources/earnings.js';
import { DeductionsResource } from './resources/deductions.js';
import { LocalTaxesResource } from './resources/local-taxes.js';
import { DirectDepositResource } from './resources/direct-deposit.js';
import { PayStatementsResource } from './resources/pay-statements.js';
import { LookupCodesResource } from './resources/lookup-codes.js';

const PROD_BASE = 'https://api.paylocity.com';
const SANDBOX_BASE = 'https://apisandbox.paylocity.com';
const DEFAULT_SCOPE = 'WebLinkAPI';

// Linear scan; a /\/+$/ regex backtracks quadratically on long slash runs.
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}

function stripApiSuffix(s: string): string {
  const t = stripTrailingSlashes(s);
  return t.toLowerCase().endsWith('/api') ? t.slice(0, -4) : t;
}

export class PaylocityClient {
  readonly employees: EmployeesResource;
  readonly legacyEmployees: LegacyEmployeesResource;
  readonly costCenters: CostCentersResource;
  readonly payGrades: PayGradesResource;
  readonly jobCodes: JobCodesResource;
  readonly earnings: EarningsResource;
  readonly deductions: DeductionsResource;
  readonly localTaxes: LocalTaxesResource;
  readonly directDeposit: DirectDepositResource;
  readonly payStatements: PayStatementsResource;
  readonly lookupCodes: LookupCodesResource;

  readonly auth: PaylocityAuthManager;
  readonly baseUrl: string;
  readonly defaultCompanyId?: string;

  constructor(config: PaylocityClientConfig) {
    const root =
      config.baseUrl ??
      (config.sandbox ? SANDBOX_BASE : PROD_BASE);
    // Strip trailing slashes and a trailing "/api" segment if the caller
    // pasted one in — Paylocity's modern endpoints (e.g. /coreHr/v1/...) and
    // the OAuth token endpoint both live at the host root, not under /api.
    this.baseUrl = stripApiSuffix(root);
    const tokenUrl =
      config.tokenUrl ?? `${this.baseUrl}/IdentityServer/connect/token`;
    const scope = config.scope ?? DEFAULT_SCOPE;
    this.defaultCompanyId = config.defaultCompanyId;

    this.auth = new PaylocityAuthManager({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tokenUrl,
      scope,
    });

    const rateLimiter = new RateLimiter(config.rateLimitPerSecond ?? 10);
    const http = new HttpClient({
      baseUrl: this.baseUrl,
      auth: this.auth,
      maxRetries: config.maxRetries ?? 5,
      rateLimiter,
    });

    this.employees = new EmployeesResource(http, this.defaultCompanyId);
    this.legacyEmployees = new LegacyEmployeesResource(http, this.defaultCompanyId);
    this.costCenters = new CostCentersResource(http, this.defaultCompanyId);
    this.payGrades = new PayGradesResource(http, this.defaultCompanyId);
    this.jobCodes = new JobCodesResource(http, this.defaultCompanyId);
    this.earnings = new EarningsResource(http, this.defaultCompanyId);
    this.deductions = new DeductionsResource(http, this.defaultCompanyId);
    this.localTaxes = new LocalTaxesResource(http, this.defaultCompanyId);
    this.directDeposit = new DirectDepositResource(http, this.defaultCompanyId);
    this.payStatements = new PayStatementsResource(http, this.defaultCompanyId);
    this.lookupCodes = new LookupCodesResource(http, this.defaultCompanyId);
  }
}
