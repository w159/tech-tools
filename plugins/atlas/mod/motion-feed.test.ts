// motion-feed.ts: the keys the feed reports are the keys the surfaces look up, on a snapshot that carries a plan and workers.
import { describe, expect, test } from 'claude-code/testing';
import { hudAgents, hudLines, type HudInput } from './hud';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { hudPhases } from './band';
import { runsString, type Ui } from './atlas-ui';
import { busySnap, NOW } from './live_fixture';
import { Motion, windowOf } from './motion';
import { motionFeed } from './motion-feed';
import type { TodoItem } from './contract';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const todo = (id: string, content: string, status: string, extra: Partial<TodoItem> = {}): TodoItem => ({ id, content, status, session_id: 's', origin: 'session', ...extra }) as TodoItem;
const snapWith = (status: string) => busySnap({ todos: [todo('T1', 'wire the gate', status), todo('T2', 'write the tests', 'pending')] });

describe('motionFeed', () => {
  test('reports every surface with keys under its own prefix', () => {
    const f = motionFeed(snapWith('in_progress'), [], null, ui);
    expect(f['hud-todo'].map((i) => i.key)).toEqual(['todo:wire the gate', 'todo:write the tests']);
    expect(f.board.map((i) => i.key)).toEqual(['board:wire the gate', 'board:write the tests']);
    expect(f.panel.some((i) => i.key === 'task:T1')).toBe(true);
    expect(f.band.map((i) => i.key)).toEqual(['count:running', 'count:blocked', 'count:failed', 'count:waiting', 'count:queued', 'count:done']);
    expect(f['hud-agents'].length).toBeGreaterThan(0);
  });
  test('a status change moves the state the feed reports, and the HUD row for that key is drawn mid-transition', () => {
    const before = motionFeed(snapWith('in_progress'), [], null, ui);
    const s = snapWith('completed');
    const after = motionFeed(s, [], null, ui);
    expect(before['hud-todo'][0]!.state).toBe('running');
    expect(after['hud-todo'][0]!.state).toBe('done');
    const m = new Motion(true);
    for (const [k, v] of Object.entries(before)) m.observe(k, v, NOW);
    for (const [k, v] of Object.entries(after)) m.observe(k, v, NOW + 5000);
    expect(m.animating(NOW + 5000)).toBe(true);
    const input: HudInput = { todos: ownTodos(s.todos ?? [], s.sessionId), agents: hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), root: s.root, phases: hudPhases(s) };
    const view = { cols: 120, maxRows: 40, ui, now: s.now };
    const rest = hudLines(input, view);
    const frame = hudLines(input, { ...view, motion: m.ctx(NOW + 5000) });
    expect(frame.map(runsString)).not.toEqual(rest.map(runsString)); // the glyph pop opens on the open diamond
    expect(hudLines(input, { ...view, motion: m.ctx(NOW + 5000 + windowOf({ state: 'done' })) })).toEqual(rest);
  });
  test('an unchanged snapshot reports identical items', () => {
    expect(motionFeed(snapWith('in_progress'), [], null, ui)).toEqual(motionFeed(snapWith('in_progress'), [], null, ui));
  });
});
