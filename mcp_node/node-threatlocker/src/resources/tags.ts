import type { HttpClient } from '../http.js';
import type { LabelValue } from '../types/index.js';

// Source: https://threatlocker.kb.help/portalapitag/ and live swagger
// portalapi.b.threatlocker.com/swagger/public/swagger.json (TagGetDowndownOptionsByOrganizationId).

export class TagsResource {
  constructor(private readonly http: HttpClient) { }

  /** Tags as {label, value} options, same dropdown shape as computer groups. */
  async list(includeBuiltIns = false): Promise<LabelValue[]> {
    const response = await this.http.request<LabelValue[]>('/Tag/TagGetDowndownOptionsByOrganizationId', {
      params: { includeBuiltIns },
    });
    return Array.isArray(response) ? response : [];
  }
}