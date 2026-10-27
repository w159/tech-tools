// Google Workspace group membership through the Cloud Identity API.
// Sources: Cloud Identity REST reference, groups.memberships.searchTransitiveGroups
// (GET /v1/groups/-/memberships:searchTransitiveGroups, query/pageSize/pageToken,
// response memberships[].groupKey.id and nextPageToken); Compute Engine docs
// for the metadata server token endpoint and its Metadata-Flavor header.

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const SEARCH_URL = "https://cloudidentity.googleapis.com/v1/groups/-/memberships:searchTransitiveGroups";
const MAX_PAGES = 20;
const TIMEOUT_MS = 5000;

// Single quotes and backslashes would break out of the CEL string literal.
const SAFE_EMAIL_RE = /^[^\s'"\\]+@[^\s'"\\]+$/;

export interface GroupLookupOptions {
  fetchImpl?: FetchLike;
  // Overrides the metadata server (tests, non-GCE hosts).
  getAccessToken?: () => Promise<string>;
}

// The token carries the VM service account's configured scopes. The
// documented endpoint has no scopes parameter, so the account must be granted
// cloud-identity.groups.readonly (or a broader Cloud Identity scope).
export function metadataTokenProvider(fetchImpl: FetchLike = globalThis.fetch as FetchLike): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`metadata server returned ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new Error("metadata server returned an unexpected token response");
    }
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  };
}

// Returns the group email addresses (discussion forum groups, transitive) the
// user belongs to. Throws on any failure: the caller decides whether sign-in
// proceeds without groups.
export async function lookupGoogleGroups(email: string, opts: GroupLookupOptions = {}): Promise<string[]> {
  if (!SAFE_EMAIL_RE.test(email)) throw new Error("email not usable in a groups query");
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const token = await (opts.getAccessToken ?? metadataTokenProvider(fetchImpl))();
  const query = `member_key_id == '${email}' && 'cloudidentity.googleapis.com/groups.discussion_forum' in labels`;

  const groups: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ query, pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetchImpl(`${SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`groups lookup returned ${res.status}`);
    const body = (await res.json()) as { memberships?: Array<{ groupKey?: { id?: unknown } }>; nextPageToken?: unknown };
    for (const m of body.memberships ?? []) {
      const id = m.groupKey?.id;
      if (typeof id === "string" && id) groups.push(id);
    }
    pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
    if (!pageToken) return groups;
  }
  throw new Error("groups lookup exceeded the page limit");
}
