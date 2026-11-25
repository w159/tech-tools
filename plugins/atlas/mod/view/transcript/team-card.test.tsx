import { expect, test } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'
import { toolUseTree } from './restyle'
import { lookUi } from '../../design/look'
import type { AtlasSnapshot } from '../../contract'

// Collects pick(node) from a node, then from its children, depth first.
const walk = <T,>(n: unknown, pick: (n: unknown) => T[]): T[] => {
  if (n == null) return []
  if (Array.isArray(n)) return n.flatMap((c) => walk(c, pick))
  return [...pick(n), ...walk(Object(n).children, pick)]
}
const strings = (n: unknown): string[] => walk(n, (x) => (typeof x === 'string' ? [x] : []))
const colours = (n: unknown): unknown[] =>
  walk(n, (x) => {
    const props = Object(x).props as Record<string, unknown> | undefined
    return props && 'color' in props ? [props.color] : []
  })

const snap = {
  contract: { headerFirstLinePattern: '^x', phases: [], todoPhases: [], itemPhasePrefix: '' },
  personas: [], now: 0,
  squad: [
    { name: 'impl-a', persona: 'implementer', state: 'running', source: 'task', transport: 'tmux', task: 'edit a' },
    { name: 'ver-b', persona: 'verifier', state: 'idle', source: 'task', transport: 'tmux', task: '\nfirst line\nsecond' },
  ],
  todos: [
    { id: '1', content: 'write card', status: 'completed', owner: 'impl-a' },
    { id: '2', content: 'run tests', status: 'in_progress', owner: 'impl-a' },
    { id: '3', content: 'other', status: 'pending', owner: 'nobody' },
  ],
} as unknown as AtlasSnapshot

const spawn = (command: string) => ({ tool: 'Bash', input: { command }, output: '{"team_id":"t9z"}', isRunning: false, isErrored: false, isInterrupted: false })
const CMD = 'python3 x/atlas_mux.py spawn-team --class implement'

test('spawn-team draws a card with every member, role and todos', () => {
  const s = strings(toolUseTree(snap, spawn(CMD), [])).join('|')
  for (const w of ['team t9z', '2 workers', 'impl-a', 'implementer', 'ver-b', 'verifier', '✓ write card', '◐ run tests', 'first line']) expect(s).toContain(w)
  expect(s).not.toContain('other')
})

test('a second team running beside it stays off this card', () => {
  const out = 'team t9z ok: 1/1 spawned on tmux\n  impl-a implementer sonnet\nnext: atlas_mux.py wait --team t9z'
  const s = strings(toolUseTree(snap, { ...spawn(CMD), output: out }, [])).join('|')
  expect(s).toContain('impl-a')
  expect(s).toContain('1 workers')
  expect(s).not.toContain('ver-b')
})

test('NO_COLOR keeps the words and drops colour props', () => {
  const ui = { ...lookUi(), color: 'none' as const }
  const tree = toolUseTree(snap, spawn(CMD), [], 0, { ui }) as RenderElement
  expect(strings(tree).join('|')).toContain('impl-a')
  expect(colours(tree)).toEqual([])
})

test('a non-mux Bash call still goes to noisyTree', () => {
  const big = { ...spawn('ls'), output: 'x'.repeat(100000) }
  expect(strings(toolUseTree(snap, big, [])).join('')).not.toContain('team')
  expect(toolUseTree(snap, spawn('ls'), [])).toBeNull()
})
