// Name-to-record resolution so tools take hostnames, not GUIDs.
// Every ID-only PortalAPI endpoint (computer detail, check-ins, maintenance,
// file history) goes through resolveComputer; approvals go through
// resolveApprovalRequest. Ambiguity fails closed with the candidate names.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Plain boolean on purpose: a type predicate would narrow a string needle to
// `never` on the non-GUID branch.
export const isGuid = (value: unknown): boolean => typeof value === 'string' && GUID.test(value);

export class ResolutionError extends Error {
  constructor(message: string, public readonly candidates: string[] = []) {
    super(message);
    this.name = 'ResolutionError';
  }
}

interface ComputerRow { computerId: string; hostname?: string; computerName?: string; [k: string]: unknown }

/**
 * Resolve a hostname (case-insensitive exact match on hostname or computerName)
 * to the computer row. A GUID is accepted as-is for callers that already have one.
 */
export async function resolveComputer(client: any, hostnameOrId: string, childOrganizations = true): Promise<ComputerRow> {
  const needle = hostnameOrId.trim();
  if (!needle) throw new ResolutionError('A hostname is required.');
  if (isGuid(needle)) return { computerId: needle };

  const page = await client.computers.list({ searchText: needle, pageSize: 50, childOrganizations });
  const rows: ComputerRow[] = page.items ?? [];
  const lower = needle.toLowerCase();
  const exact = rows.filter(r => (r.hostname ?? '').toLowerCase() === lower || (r.computerName ?? '').toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new ResolutionError(
      `Hostname "${needle}" matches ${exact.length} computers (${exact.map(r => `${r.hostname} in ${r.organization ?? 'unknown org'}`).join('; ')}). Narrow it with includeChildOrganizations:false or use the organization name.`,
      exact.map(r => String(r.hostname)),
    );
  }
  const names = rows.map(r => String(r.hostname ?? r.computerName)).filter(Boolean);
  throw new ResolutionError(
    names.length
      ? `No computer named "${needle}". Closest matches: ${names.slice(0, 10).join(', ')}.`
      : `No computer named "${needle}" in ThreatLocker (searched hostname and computer name).`,
    names,
  );
}

/** Resolve a computer group name to its GUID via the dropdown list (case-insensitive exact). */
export async function resolveComputerGroup(client: any, groupName: string): Promise<{ value: string; label: string }> {
  const needle = groupName.trim();
  if (isGuid(needle)) return { value: needle, label: needle };
  const groups: { label: string; value: string }[] = await client.computerGroups.list({});
  const match = groups.find(g => g.label.toLowerCase() === needle.toLowerCase());
  if (match) return match;
  throw new ResolutionError(
    `No computer group named "${needle}". Groups: ${groups.map(g => g.label).join(', ')}.`,
    groups.map(g => g.label),
  );
}

interface ApprovalRow { approvalRequestId: string; hostname?: string; path?: string; username?: string; [k: string]: unknown }

/**
 * Resolve an approval request by hostname plus a fragment of the file path or
 * name, against the given status (default Pending). Exactly one match or it
 * fails closed, since the caller may be about to approve it.
 */
export async function resolveApprovalRequest(
  client: any,
  selector: { approvalRequestId?: string; hostname?: string; pathContains?: string; statusId?: number },
): Promise<ApprovalRow> {
  if (isGuid(selector.approvalRequestId)) return { approvalRequestId: selector.approvalRequestId as string };
  if (!selector.hostname && !selector.pathContains) {
    throw new ResolutionError('Give a hostname and/or a fragment of the file path (or the approvalRequestId).');
  }
  const page = await client.approvalRequests.list({ statusId: selector.statusId ?? 1, pageSize: 100, showChildOrganizations: true });
  const host = selector.hostname?.toLowerCase();
  const frag = selector.pathContains?.toLowerCase();
  const matches: ApprovalRow[] = (page.items ?? []).filter((r: ApprovalRow) =>
    (!host || (r.hostname ?? '').toLowerCase() === host) &&
    (!frag || (r.path ?? '').toLowerCase().includes(frag)));
  if (matches.length === 1) return matches[0];
  const describe = (r: ApprovalRow) => `${r.hostname}: ${r.path} (${r.username}, ${r.dateTime})`;
  if (matches.length === 0) {
    throw new ResolutionError(`No approval request matched hostname "${selector.hostname ?? '*'}" and path containing "${selector.pathContains ?? '*'}".`);
  }
  throw new ResolutionError(
    `${matches.length} approval requests match; add more of the path to pick one: ${matches.slice(0, 10).map(describe).join(' | ')}`,
    matches.map(describe),
  );
}
