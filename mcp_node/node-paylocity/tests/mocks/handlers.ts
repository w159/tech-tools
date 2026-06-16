import { http, HttpResponse } from 'msw';

const BASE = 'https://api.paylocity.com';
const TOKEN_URL = `${BASE}/IdentityServer/connect/token`;
const COMPANY = 'C123';

export const tokenStats = {
  mints: 0,
  lastBody: '' as string,
  lastContentType: '' as string,
  reset() {
    this.mints = 0;
    this.lastBody = '';
    this.lastContentType = '';
  },
};

export const rateLimitStats = {
  hits: 0,
  reset() {
    this.hits = 0;
  },
};

export const handlers = [
  // OAuth token endpoint — form-urlencoded body.
  http.post(TOKEN_URL, async ({ request }) => {
    tokenStats.lastContentType = request.headers.get('content-type') || '';
    tokenStats.lastBody = await request.text();
    const params = new URLSearchParams(tokenStats.lastBody);
    if (params.get('client_id') === 'bad') {
      return HttpResponse.json({ error: 'invalid_client' }, { status: 401 });
    }
    tokenStats.mints++;
    return HttpResponse.json({
      access_token: `tok-${tokenStats.mints}`,
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }),

  // Modern employees list (paginated).
  http.get(
    `${BASE}/corehr/v1/companies/${COMPANY}/employees`,
    ({ request }) => {
      const url = new URL(request.url);
      const next = url.searchParams.get('nextToken');
      if (next === 'page-2') {
        return HttpResponse.json({
          data: [{ employeeId: 'E2', firstName: 'Bob' }],
          pagination: { nextToken: null },
        });
      }
      return HttpResponse.json({
        data: [{ employeeId: 'E1', firstName: 'Alice' }],
        pagination: { nextToken: 'page-2' },
      });
    }
  ),

  // Modern employee get
  http.get(`${BASE}/corehr/v1/companies/${COMPANY}/employees/E1`, () =>
    HttpResponse.json({ employeeId: 'E1', firstName: 'Alice', lastName: 'Z' })
  ),

  // Legacy employees — raw array
  http.get(`${BASE}/api/v2/companies/${COMPANY}/employees`, () =>
    HttpResponse.json([
      { employeeId: 'LE1', firstName: 'Carol' },
      { employeeId: 'LE2', firstName: 'Dave' },
    ])
  ),

  // Legacy deductions — raw array
  http.get(
    `${BASE}/api/v1/companies/${COMPANY}/employees/E1/deductions`,
    () =>
      HttpResponse.json([
        { deductionCode: '401K', amount: 100, frequency: 'EVERY_PAY' },
      ])
  ),

  // Modern company earnings
  http.get(`${BASE}/apihub-payroll/v1/companies/${COMPANY}/earnings`, () =>
    HttpResponse.json({
      data: [{ earningCode: 'REG', earningName: 'Regular' }],
      pagination: { nextToken: null },
    })
  ),

  // 429-then-200 to validate retry
  http.get(`${BASE}/__ratelimit_then_ok`, () => {
    rateLimitStats.hits++;
    if (rateLimitStats.hits === 1) {
      return new HttpResponse(null, {
        status: 429,
        headers: { 'retry-after': '0' },
      });
    }
    return HttpResponse.json({ data: [{ ok: true }], pagination: {} });
  }),

  // 401 on every call (to test refresh-and-give-up)
  http.get(`${BASE}/__always_401`, () =>
    HttpResponse.json(
      { title: 'Unauthorized', detail: 'token rejected', traceId: 'trace-abc' },
      { status: 401 }
    )
  ),

  // Modern error envelope (404)
  http.get(`${BASE}/__modern_404`, () =>
    HttpResponse.json(
      {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Employee not found',
        traceId: 'trace-xyz',
      },
      { status: 404 }
    )
  ),

  // Legacy error envelope (400)
  http.get(`${BASE}/__legacy_400`, () =>
    HttpResponse.json(
      {
        errors: [
          { field: 'firstName', input: '', message: 'Required', statusCode: 400 },
        ],
      },
      { status: 400 }
    )
  ),
];
