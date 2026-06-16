import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlertsResource } from '../../src/resources/alerts.js';
import { HttpClient } from '../../src/http.js';

describe('AlertsResource', () => {
  let alertsResource: AlertsResource;
  let mockFetch: ReturnType<typeof vi.fn>;
  let httpClient: HttpClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    httpClient = new HttpClient({
      baseUrl: 'https://api.example.com/v1',
      username: 'test@example.com',
      apiKey: 'test-key',
      timeout: 5000,
      maxRetries: 1,
      fetchImpl: mockFetch,
    });
    alertsResource = new AlertsResource(async () => httpClient);
    vi.clearAllMocks();
  });

  it('should list alert history', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: '1',
            type: 'alert',
            attributes: {
              alertType: 'device-offline',
              alertState: 'active',
              priority: 'high',
              subject: 'Device offline',
              description: 'Device has gone offline',
              createdDate: '2023-01-01T00:00:00Z',
              tenantId: 'tenant-1',
            },
          },
        ],
        links: {},
        meta: { totalRecords: 1 },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    };

    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await alertsResource.listHistory();

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: '1',
      alertType: 'device-offline',
      alertState: 'active',
      priority: 'high',
      subject: 'Device offline',
    });
  });

  it('should get single alert history', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: '1',
          type: 'alert',
          attributes: {
            alertType: 'device-offline',
            alertState: 'active',
            priority: 'high',
            subject: 'Device offline',
            description: 'Device has gone offline',
            createdDate: '2023-01-01T00:00:00Z',
            tenantId: 'tenant-1',
          },
        },
        links: {},
        meta: {},
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    };

    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await alertsResource.getHistory('1');

    expect(result).toMatchObject({
      id: '1',
      alertType: 'device-offline',
      alertState: 'active',
      priority: 'high',
      subject: 'Device offline',
    });
  });

  it('should dismiss alert', async () => {
    const mockResponse = {
      ok: true,
      status: 204,
      json: async () => ({}),
      headers: new Headers(),
    };

    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(alertsResource.dismiss('1', { reason: 'False positive' })).resolves.not.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/alert/dismiss/1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'False positive' }),
      })
    );
  });

  it('should list all alerts via async iterator', async () => {
    const page1Response = {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: '1', type: 'alert', attributes: { subject: 'Alert 1' } },
          { id: '2', type: 'alert', attributes: { subject: 'Alert 2' } },
        ],
        links: { next: '/alert/history?page[after]=cursor2' },
        meta: {},
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    };

    const page2Response = {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: '3', type: 'alert', attributes: { subject: 'Alert 3' } },
        ],
        links: {},
        meta: {},
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    };

    mockFetch
      .mockResolvedValueOnce(page1Response)
      .mockResolvedValueOnce(page2Response);

    const alerts = [];
    for await (const alert of alertsResource.listHistoryAll()) {
      alerts.push(alert);
    }

    expect(alerts).toHaveLength(3);
    expect(alerts[0].subject).toBe('Alert 1');
    expect(alerts[1].subject).toBe('Alert 2');
    expect(alerts[2].subject).toBe('Alert 3');
  });
});