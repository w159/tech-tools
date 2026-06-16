import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type {
  StatisticsOptions,
  DeviceStatistics,
  InterfaceStatistics,
  ServiceStatistics,
  ComponentStatistics,
  SnmpPollerStatistics
} from '../types/statistics.js';
import { paginate } from '../pagination.js';

// Auvik statistics endpoints take the statistic id (and, for components, the
// component type) as PATH segments, and the time window + interval as
// filter[...] query params:
//   GET /stat/device/{statId}?filter[fromTime]=...&filter[thruTime]=...&filter[interval]=...
//   GET /stat/deviceAvailability/{statId}?...
//   GET /stat/interface/{statId}?...
//   GET /stat/service/{statId}?...
//   GET /stat/component/{componentType}/{statId}?...
//   GET /stat/oid/{statId}?...
// fromTime + interval are required by the API; thruTime defaults to "now".
function statParams(options: StatisticsOptions & Partial<PaginationOptions>): Record<string, unknown> {
  const { fromTime, thruTime, interval, tenantId, tenants, pageSize, pageAfter, filters = {}, ...rest } = options;
  return {
    'filter[fromTime]': fromTime,
    ...(thruTime && { 'filter[thruTime]': thruTime }),
    ...(interval && { 'filter[interval]': interval }),
    ...(tenants && { tenants }),
    ...(tenantId && { tenants: tenantId }),
    ...filters,
    ...rest,
    ...(pageSize && { 'page[first]': pageSize }),
    ...(pageAfter && { 'page[after]': pageAfter }),
  };
}

function mapStatRows<T>(response: JsonApiResponse<T>): Page<T> {
  const data = Array.isArray(response.data) ? response.data : [response.data];
  return {
    data: data.map(item => ({ id: item.id, type: item.type, ...item.attributes })) as T[],
    links: response.links || {},
    meta: response.meta || {},
  };
}

export class StatisticsResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async getDeviceStatistics(statId: string, options: StatisticsOptions & PaginationOptions): Promise<Page<DeviceStatistics>> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<DeviceStatistics>>(`/stat/device/${statId}`, { params: statParams(options) });
    return mapStatRows(response);
  }

  async *getDeviceStatisticsAll(statId: string, options: StatisticsOptions): AsyncIterable<DeviceStatistics> {
    const client = await this.getClient();
    for await (const page of paginate<DeviceStatistics>(client, `/stat/device/${statId}`, statParams(options))) {
      for (const stat of page.data) {
        yield stat;
      }
    }
  }

  async getDeviceAvailabilityStatistics(statId: string, options: StatisticsOptions & PaginationOptions): Promise<Page<DeviceStatistics>> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<DeviceStatistics>>(`/stat/deviceAvailability/${statId}`, { params: statParams(options) });
    return mapStatRows(response);
  }

  async getInterfaceStatistics(statId: string, options: StatisticsOptions & PaginationOptions): Promise<Page<InterfaceStatistics>> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<InterfaceStatistics>>(`/stat/interface/${statId}`, { params: statParams(options) });
    return mapStatRows(response);
  }

  async *getInterfaceStatisticsAll(statId: string, options: StatisticsOptions): AsyncIterable<InterfaceStatistics> {
    const client = await this.getClient();
    for await (const page of paginate<InterfaceStatistics>(client, `/stat/interface/${statId}`, statParams(options))) {
      for (const stat of page.data) {
        yield stat;
      }
    }
  }

  async getServiceStatistics(statId: string, options: StatisticsOptions & PaginationOptions): Promise<Page<ServiceStatistics>> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<ServiceStatistics>>(`/stat/service/${statId}`, { params: statParams(options) });
    return mapStatRows(response);
  }

  async *getServiceStatisticsAll(statId: string, options: StatisticsOptions): AsyncIterable<ServiceStatistics> {
    const client = await this.getClient();
    for await (const page of paginate<ServiceStatistics>(client, `/stat/service/${statId}`, statParams(options))) {
      for (const stat of page.data) {
        yield stat;
      }
    }
  }

  async getComponentStatistics(componentType: string, statId: string, options: StatisticsOptions & PaginationOptions): Promise<Page<ComponentStatistics>> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<ComponentStatistics>>(`/stat/component/${componentType}/${statId}`, { params: statParams(options) });
    return mapStatRows(response);
  }

  async *getComponentStatisticsAll(componentType: string, statId: string, options: StatisticsOptions): AsyncIterable<ComponentStatistics> {
    const client = await this.getClient();
    for await (const page of paginate<ComponentStatistics>(client, `/stat/component/${componentType}/${statId}`, statParams(options))) {
      for (const stat of page.data) {
        yield stat;
      }
    }
  }

  async getOidStatistics(statId: string, options: StatisticsOptions & PaginationOptions): Promise<Page<SnmpPollerStatistics>> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<SnmpPollerStatistics>>(`/stat/oid/${statId}`, { params: statParams(options) });
    return mapStatRows(response);
  }

  async *getOidStatisticsAll(statId: string, options: StatisticsOptions): AsyncIterable<SnmpPollerStatistics> {
    const client = await this.getClient();
    for await (const page of paginate<SnmpPollerStatistics>(client, `/stat/oid/${statId}`, statParams(options))) {
      for (const stat of page.data) {
        yield stat;
      }
    }
  }
}
