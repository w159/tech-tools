import type { HttpClient } from '../http.js';
import type {
  DacResult, DacResultListParams, DacAnalysisItem, PaginatedResponse,
} from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

// Source: https://threatlocker.kb.help/portalapidadalysisresult/ and live swagger
// portalapi.b.threatlocker.com/swagger/public/swagger.json (DACAnalysisResult...).
// Note: neither Storage Control nor Network Control policies have a
// documented list/get endpoint in the KB or the live public swagger
// (checked on two instances, 2026-09-28) -- but the swagger is a known
// partial subset (it also omits Policy/PolicyGetByParameters, which this
// library does use, since it is KB-documented), so this is unprobed, not
// proven absent. DACAnalysisResult is the closest available read surface
// for both (categoryId 2 = StoragePolicy, 1 = NetworkPolicy).

export class DacResource {
  constructor(private readonly http: HttpClient) { }

  async listResults(params: DacResultListParams = {}): Promise<PaginatedResponse<DacResult>> {
    const body = {
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      appliesToId: params.appliesToId,
      categoryId: params.categoryId,
      criticalityId: params.criticalityId,
      entityTypeId: params.entityTypeId,
      includeChildOrgs: params.includeChildOrgs,
      searchText: params.searchText,
      sortBy: params.sortBy,
    };
    // Response is a bare array (swagger DACAnalysisResultsGetByParameters).
    const response = await this.http.request<DacResult[]>('/DACAnalysisResult/DACAnalysisResultsGetByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<DacResult>(response, body.pageNumber, body.pageSize);
  }

  /** Detail for one analysis item. NOTE: integer ID, not a GUID. */
  async getItem(analysisItemId: number): Promise<DacAnalysisItem> {
    return this.http.request<DacAnalysisItem>('/DACAnalysisItem/DACAnalysisItemGetById', {
      params: { analysisItemId },
    });
  }
}