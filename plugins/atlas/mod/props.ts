// Client-props completeness for the Atlas mod (engine rule: the props walk
// refuses any undefined value it meets — an explicitly assigned undefined, an
// array hole, a missing value). ABSENT keys are legal: the walk only iterates
// present entries. Strip undefined recursively so optional snapshot fields
// (ChannelNote.to/item/kind, SquadAgent.lastNoteTs/paneId, TodoItem.owner, ...)
// can never break a Client mount. Lives beside contract.ts, which is locked.

/** A props tree after the undefined-strip; only engine-legal JSON values remain. */
type CleanJson = string | number | boolean | null | CleanJson[] | { [k: string]: CleanJson };

/** Strip undefined values (and array holes, which read as undefined) from a Client props tree. */
export function completeProps<T>(props: T): T {
	const walkObject = (v: Record<string, unknown>): CleanJson => {
		const out: { [k: string]: CleanJson } = {};
		for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = walk(x);
		return out;
	};
	const walk = (v: unknown): CleanJson => {
		if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(walk); // holes read undefined: drop them
		return v !== null && typeof v === 'object' ? walkObject(v as Record<string, unknown>) : (v as CleanJson);
	};
	return walk(props) as T;
}
