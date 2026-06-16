/**
 * MSW request handlers for mocking the NinjaOne API
 */

import { http, HttpResponse } from 'msw';
import * as fixtures from '../fixtures/index.js';

const BASE_URL = 'https://app.ninjarmm.com';

export const handlers = [
  // OAuth token endpoint
  http.post(`${BASE_URL}/ws/oauth/token`, async ({ request }) => {
    const body = await request.text();

    // Check for bad credentials
    if (body.includes('bad-client-id') || body.includes('bad-client-secret')) {
      return HttpResponse.json(
        { error: 'invalid_client', error_description: 'Bad credentials' },
        { status: 400 }
      );
    }

    return HttpResponse.json(fixtures.auth.tokenSuccess);
  }),

  // Organizations endpoints
  http.get(`${BASE_URL}/v2/organizations`, () => {
    return HttpResponse.json(fixtures.organizations.list);
  }),

  http.get(`${BASE_URL}/v2/organization/:id`, ({ params }) => {
    const id = Number(params['id']);
    if (id === 999) {
      return HttpResponse.json(
        { error: 'not_found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(fixtures.organizations.single);
  }),

  http.get(`${BASE_URL}/v2/organization/:id/detailed`, () => {
    return HttpResponse.json(fixtures.organizations.detailed);
  }),

  http.post(`${BASE_URL}/v2/organizations`, () => {
    return HttpResponse.json(fixtures.organizations.created);
  }),

  http.patch(`${BASE_URL}/v2/organization/:id`, () => {
    return HttpResponse.json(fixtures.organizations.updated);
  }),

  http.delete(`${BASE_URL}/v2/organization/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Devices endpoints
  http.get(`${BASE_URL}/v2/devices`, () => {
    return HttpResponse.json(fixtures.devices.list);
  }),

  http.get(`${BASE_URL}/v2/organization/:orgId/devices`, () => {
    return HttpResponse.json(fixtures.devices.list);
  }),

  http.get(`${BASE_URL}/v2/device/:id`, ({ params }) => {
    const id = Number(params['id']);
    if (id === 999) {
      return HttpResponse.json(
        { error: 'not_found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(fixtures.devices.single);
  }),

  http.patch(`${BASE_URL}/v2/device/:id`, () => {
    return HttpResponse.json(fixtures.devices.updated);
  }),

  http.delete(`${BASE_URL}/v2/device/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE_URL}/v2/device/:id/reboot`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE_URL}/v2/device/:id/activities`, () => {
    return HttpResponse.json(fixtures.devices.activities);
  }),

  http.get(`${BASE_URL}/v2/device/:id/windows-services`, () => {
    return HttpResponse.json(fixtures.devices.services);
  }),

  http.get(`${BASE_URL}/v2/device/:id/software`, () => {
    return HttpResponse.json(fixtures.devices.software);
  }),

  http.get(`${BASE_URL}/v2/device/:id/inventory`, () => {
    return HttpResponse.json(fixtures.devices.inventory);
  }),

  // Alerts endpoints
  http.get(`${BASE_URL}/v2/alerts`, () => {
    return HttpResponse.json(fixtures.alerts.list);
  }),

  http.get(`${BASE_URL}/v2/device/:deviceId/alerts`, () => {
    return HttpResponse.json(fixtures.alerts.list);
  }),

  http.get(`${BASE_URL}/v2/alert/:uid`, ({ params }) => {
    const uid = params['uid'];
    if (uid === 'not-found') {
      return HttpResponse.json(
        { error: 'not_found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(fixtures.alerts.single);
  }),

  http.delete(`${BASE_URL}/v2/alert/:uid`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE_URL}/v2/alert/:uid/reset`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Tickets endpoints
  http.post(`${BASE_URL}/v2/ticketing/trigger/board/:boardId/run`, () => {
    return HttpResponse.json(fixtures.tickets.list);
  }),

  http.get(`${BASE_URL}/v2/ticketing/ticket/:id`, ({ params }) => {
    const id = Number(params['id']);
    if (id === 999) {
      return HttpResponse.json(
        { error: 'not_found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(fixtures.tickets.single);
  }),

  http.post(`${BASE_URL}/v2/ticketing/ticket`, () => {
    return HttpResponse.json(fixtures.tickets.created);
  }),

  http.put(`${BASE_URL}/v2/ticketing/ticket/:id`, () => {
    return HttpResponse.json(fixtures.tickets.updated);
  }),

  http.delete(`${BASE_URL}/v2/ticketing/ticket/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE_URL}/v2/ticketing/ticket/:id/log-entry`, () => {
    return HttpResponse.json(fixtures.tickets.comments);
  }),

  http.post(`${BASE_URL}/v2/ticketing/ticket/:id/comment`, () => {
    return HttpResponse.json(fixtures.tickets.commentCreated);
  }),

  http.get(`${BASE_URL}/v2/ticketing/trigger/board`, () => {
    return HttpResponse.json([{ id: 1, name: 'All Tickets' }]);
  }),

  http.get(`${BASE_URL}/v2/ticketing/ticket-form`, () => {
    return HttpResponse.json(fixtures.tickets.forms);
  }),

  // Webhooks endpoints
  http.get(`${BASE_URL}/v2/webhook`, () => {
    return HttpResponse.json(fixtures.webhooks.list);
  }),

  http.get(`${BASE_URL}/v2/webhook/:id`, () => {
    return HttpResponse.json(fixtures.webhooks.single);
  }),

  http.post(`${BASE_URL}/v2/webhook`, () => {
    return HttpResponse.json(fixtures.webhooks.created);
  }),

  http.put(`${BASE_URL}/v2/webhook/:id`, () => {
    return HttpResponse.json(fixtures.webhooks.updated);
  }),

  http.delete(`${BASE_URL}/v2/webhook/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Error test endpoints
  http.get(`${BASE_URL}/v2/rate-limited`, () => {
    return HttpResponse.json(
      { error: 'rate_limit_exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }),

  http.get(`${BASE_URL}/v2/unauthorized`, () => {
    return HttpResponse.json(
      { error: 'unauthorized' },
      { status: 401 }
    );
  }),

  http.get(`${BASE_URL}/v2/forbidden`, () => {
    return HttpResponse.json(
      { error: 'forbidden', message: 'Access denied' },
      { status: 403 }
    );
  }),

  http.get(`${BASE_URL}/v2/server-error`, () => {
    return HttpResponse.json(
      { error: 'internal_server_error' },
      { status: 500 }
    );
  }),

  http.post(`${BASE_URL}/v2/validation-error`, () => {
    return HttpResponse.json(
      {
        errors: [
          { field: 'subject', message: 'Subject is required' },
          { field: 'organizationId', message: 'Organization ID must be a positive number' },
        ],
      },
      { status: 400 }
    );
  }),
];
