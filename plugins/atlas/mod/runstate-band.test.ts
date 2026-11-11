// Band adapter side of the one run-state model: the checks row and the last-run count come from the same data as the other surfaces.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree } from './band';
import type { Ui } from './atlas-ui';
import { busySnap } from './live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const idleSnap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], ...over } as never);
const render = (snapshot: ReturnType<typeof busySnap>, gates: unknown[], columns = 120): string => {
  const node = bandTree(els, { snapshot, live: [], gates, columns, tick: 0, maxRows: 12, ui } as never) as unknown as Node;
  return (node.props.children as Node[]).map(text).join('\n');
};
const grp = (id: string, ok: boolean) => ({ id, title: id, lines: [{ id: `${id}-l`, label: id, ok }] });

describe('band: one run state', () => {
  test('the checks row lists the same groups as the gates tab, header included', () => {
    const out = render(idleSnap(), [grp('completion', true), grp('tripwire', false), grp('routing', true), grp('header', true)]);
    for (const id of ['completion', 'tripwire', 'routing', 'header']) expect(out).toContain(id);
  });
  test('last run counts the dispatches that ran, not the workers still listed', () => {
    const rows = ['alpha', 'beta', 'gamma', 'delta'].map((owner, n) => ({ id: `d${n}`, content: `dispatch ${owner}`, status: 'completed', origin: 'dispatch', owner }));
    expect(render(idleSnap({ todos: rows }), [])).toContain('4 workers');
  });
});
