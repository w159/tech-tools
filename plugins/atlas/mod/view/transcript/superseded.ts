// superseded.ts: which `⚑ DONE` header chips a Stop refusal overturned (critique 21: the chip printed directly above the refusal that overruled it and nothing marked it).
// The chips the transcript drew are recorded in order; when the last Stop verdict flips to refused, every done chip drawn so far is superseded, and a done chip drawn after the
// refusal (the lead's real finish) is not. Plain module state, no host calls: the pane feeds the verdict (mod/pane/sidebar.tsx), the AssistantMessage site reads it (restyle.tsx).

const MAX = 200;
const drawn: string[] = []; // ids of the done chips drawn, oldest first
const dead = new Set<string>();
let refused = false;
let flipped: (() => void) | null = null;

/** `fn` runs when a Stop refusal supersedes done chips already drawn (the transcript drops their cached answers). One listener: the last registration. */
export const onSuperseded = (fn: (() => void) | null): void => { flipped = fn; };

/** Record that the done chip `id` was drawn; whether a Stop refusal has already superseded it. Without an id nothing can be told apart: never superseded. */
export function noteDoneChip(id: string | undefined): boolean {
  if (!id) return false;
  if (!drawn.includes(id)) { drawn.push(id); if (drawn.length > MAX) dead.delete(drawn.shift()!); }
  return dead.has(id);
}

/** The last Stop verdict as the panel reads it. A flip to refused supersedes every done chip drawn so far; each later reading of the same verdict changes nothing. */
export function noteStopVerdict(blocked: boolean): void {
  if (blocked && !refused && drawn.length) { for (const id of drawn) dead.add(id); try { flipped?.(); } catch { /* display only */ } }
  refused = blocked;
}

export const forgetSuperseded = (): void => { drawn.length = 0; dead.clear(); refused = false; };
