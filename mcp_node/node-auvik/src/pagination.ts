import type { HttpClient } from './http.js';
import type { JsonApiResponse, JsonApiResource, Page, PaginationOptions } from './types/json-api.js';
import { mapJsonApiResourceArray } from './json-api-mapper.js';

// Fetch a single page and map each resource into a flat row.
// The default mapRow reproduces the `{ id, type, ...attributes }` shape every
// common list call site currently emits. Call sites that need extra fields
// (e.g. deviceId) pass an explicit mapRow.
export async function fetchPage<T, R = T & { id: string; type: string }>(
  client: HttpClient,
  path: string,
  options: PaginationOptions = {},
  mapRow: (item: JsonApiResource<T>) => R = (item) =>
    ({ id: item.id, type: item.type, ...item.attributes } as unknown as R),
): Promise<Page<R>> {
  const { pageSize, pageAfter, filters = {} } = options;
  const params = {
    ...filters,
    ...(pageSize && { 'page[first]': pageSize }),
    ...(pageAfter && { 'page[after]': pageAfter }),
  };

  const response = await client.request<JsonApiResponse<T>>(path, { params });
  const data = Array.isArray(response.data) ? response.data : [response.data];

  return {
    data: data.map(mapRow),
    links: response.links || {},
    meta: response.meta || {},
  };
}

export async function* paginate<T>(
  client: HttpClient,
  initialUrl: string,
  params: Record<string, unknown> = {}
): AsyncIterable<Page<T>> {
  let url: string | null = initialUrl;

  while (url) {
    const response: JsonApiResponse<T> = await client.request<JsonApiResponse<T>>(url, { params });

    const page: Page<T> = {
      data: mapJsonApiResourceArray(response.data) as T[],
      links: response.links || {},
      meta: response.meta || {},
    };

    yield page;

    // Get next page URL from links
    url = response.links?.next || null;
    // Clear params for subsequent requests as they're encoded in the next URL
    params = {};
  }
}