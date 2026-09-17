import { PanosApiError } from './errors.js';
import type { RestLocation } from './types.js';

export interface RestClientContext {
  host: string;
  apiKey: string;
  restVersion: string;
  target?: string;
  transport(url: string, init: { method: string; headers: Record<string, string>; body?: BodyInit }): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
}

/** REST sub-client for object/policy resources (design doc: node-panos client contract). */
export function createRestClient(ctx: RestClientContext) {
  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    category: string,
    resource: string,
    body: unknown,
    loc: RestLocation,
    name?: string,
  ): Promise<unknown> {
    const url = new URL(`https://${ctx.host}/restapi/${ctx.restVersion}/${category}/${resource}`);
    url.searchParams.set('location', loc.location);
    if (loc.vsys !== undefined) url.searchParams.set('vsys', loc.vsys);
    if (loc['device-group'] !== undefined) url.searchParams.set('device-group', loc['device-group']);
    if (loc.template !== undefined) url.searchParams.set('template', loc.template);
    const target = loc.target ?? ctx.target;
    if (target !== undefined) url.searchParams.set('target', target);
    if (name !== undefined) url.searchParams.set('name', name);

    const headers: Record<string, string> = { 'X-PAN-KEY': ctx.apiKey };
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await ctx.transport(url.toString(), { method, headers, body: payload });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new PanosApiError(`PAN-OS REST API error (HTTP ${res.status})`, {
        code: String(res.status),
        httpStatus: res.status,
        responseText: text,
      });
    }
    return text ? JSON.parse(text) : undefined;
  }

  return {
    list: (category: string, resource: string, loc: RestLocation) => call('GET', category, resource, undefined, loc),
    get: (category: string, resource: string, name: string, loc: RestLocation) =>
      call('GET', category, resource, undefined, loc, name),
    create: (category: string, resource: string, name: string, body: unknown, loc: RestLocation) =>
      call('POST', category, resource, body, loc, name),
    update: (category: string, resource: string, name: string, body: unknown, loc: RestLocation) =>
      call('PUT', category, resource, body, loc, name),
    remove: (category: string, resource: string, name: string, loc: RestLocation) =>
      call('DELETE', category, resource, undefined, loc, name),
  };
}
