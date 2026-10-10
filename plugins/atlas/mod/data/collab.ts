// Pure collaboration logic over contract types: claims, conflicts, events, summary.
import type { ChannelNote, SquadAgent } from '../contract';

/** CLI-side claim notes carry paths; contract's ChannelNote does not, so read defensively. */
type ClaimNote = ChannelNote & { paths?: string[] };

export interface ActiveClaim { owner: string; paths: string[]; ts: string }
export interface Conflict { a: string; b: string; path: string }
export interface CollabEvent {
  kind: 'handoff' | 'blocked' | 'conflict' | 'claim';
  from: string;
  to?: string;
  text: string;
  seq: number;
}
export interface CollabSummary {
  claims: number;
  conflicts: number;
  blocked: number;
  handoffs: number;
  idleWithWork: string[];
}

/** Latest claim per owner (notes are seq-sorted, so last wins); drop exited or finished/dead owners. */
export function activeClaims(notes: ChannelNote[], squad: SquadAgent[]): ActiveClaim[] {
  const claims = new Map<string, ClaimNote>();
  const exited = new Set<string>();
  for (const n of notes) {
    if (n.kind === 'exit') exited.add(n.owner);
    else if (n.kind === 'claim') claims.set(n.owner, n);
  }
  const done = new Set(
    squad.filter(a => a.state === 'finished' || a.state === 'dead').map(a => a.name),
  );
  return [...claims.entries()]
    .filter(([owner]) => !exited.has(owner) && !done.has(owner))
    .map(([owner, n]) => ({ owner, paths: n.paths ?? [], ts: n.ts }));
}

/** Cross-owner path conflicts, deterministic i<j order, deduped per (a,b,path). */
export function findConflicts(claims: ActiveClaim[]): Conflict[] {
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const ci = claims[i];
      const cj = claims[j];
      if (!ci || !cj || ci.owner === cj.owner) continue;
      const { owner: a, paths: pa } = ci;
      const { owner: b, paths: pb } = cj;
      for (const x of pa) {
        for (const y of pb) {
          const hit = x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
          if (!hit) continue;
          const path = x.length <= y.length ? x : y;
          const key = `${a}\u0000${b}\u0000${path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ a, b, path });
        }
      }
    }
  }
  return out;
}

/** Claim/handoff/blocked notes past sinceSeq, plus conflicts synthesized from the full note set. */
export function collabEvents(notes: ChannelNote[], sinceSeq: number): CollabEvent[] {
  const events: CollabEvent[] = [];
  for (const n of notes) {
    if (n.seq <= sinceSeq) continue;
    if (n.kind === 'handoff' || n.kind === 'blocked' || n.kind === 'claim') {
      events.push({ kind: n.kind, from: n.owner, to: n.to, text: n.text, seq: n.seq });
    }
  }
  const claims = new Map<string, ClaimNote>();
  for (const n of notes) if (n.kind === 'claim') claims.set(n.owner, n);
  const actives = [...claims.entries()].map(([owner, n]) => ({ owner, paths: n.paths ?? [], ts: n.ts }));
  for (const c of findConflicts(actives)) {
    const a = claims.get(c.a)!;
    const b = claims.get(c.b)!;
    const seq = Math.max(a.seq, b.seq);
    if (seq <= sinceSeq) continue;
    events.push({ kind: 'conflict', from: c.a, to: c.b, text: c.path, seq });
  }
  return events.sort((x, y) => x.seq - y.seq);
}

/** Counts over active claims plus raw blocked/handoff note counts; idle agents still holding work. */
export function collabSummary(notes: ChannelNote[], squad: SquadAgent[]): CollabSummary {
  const actives = activeClaims(notes, squad);
  const idle = new Set(squad.filter(a => a.state === 'idle').map(a => a.name));
  return {
    claims: actives.length,
    conflicts: findConflicts(actives).length,
    blocked: notes.filter(n => n.kind === 'blocked').length,
    handoffs: notes.filter(n => n.kind === 'handoff').length,
    idleWithWork: actives.filter(c => idle.has(c.owner)).map(c => c.owner),
  };
}
