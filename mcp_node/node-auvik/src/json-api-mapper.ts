import type { JsonApiResource } from './types/json-api.js';

function mapJsonApiResource<T>(item: JsonApiResource<T>): T & { id: string } {
  return {
    id: item.id,
    ...item.attributes,
  } as T & { id: string };
}

export function mapJsonApiResourceArray<T>(data: JsonApiResource<T> | JsonApiResource<T>[]): (T & { id: string })[] {
  const items = Array.isArray(data) ? data : [data];
  return items.map(mapJsonApiResource);
}