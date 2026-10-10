// Command Center Tab 2 — IRC Channel (plan §3.2, docs/plans/2026-10-09-atlas-mod.md).
// Client surface module: register.tsx draws it inside a `Client` element with
// props { snapshot, columns, rows }; intents go out through surface.post.
// Mods have no Node APIs: pure over the snapshot, only ClientElements tags.

import type { ClientSurface, RenderElement } from 'claude-code';
import type {
  AgentState,
  AtlasSnapshot,
  ChannelNote,
  ChannelMember,
  SpriteState,
} from '../contract';
import { BRAND } from '../contract';
import { personaColor } from '../data/personas';
import { stateColor } from '../theme';
import { spriteFor } from '../sprites';
import { frameToRuns } from '../sprites/grid';

export type ChannelProps = {
  snapshot: AtlasSnapshot;
  columns: number;
  rows: number;
};

type PaneState = {
  text: string;           // composer draft
  channel: string | null; // picked channel; null = snapshot.channel
  tick: number;           // animation ticks (typing dots, sprite frames)
};

const NICK_W = 18; // nick panel width in cells
const FOLD = 3;    // body lines shown before a note folds

// ---- pure helpers (no DOM/Node; unit-testable) ----

/** `@target rest` -> addressed note; bare text broadcasts to `all`. */
export function parseMessage(raw: string): { to: string; text: string } {
  const trimmed = raw.trim();
  const m = /^@([\w.-]+)\s+([\s\S]+)$/.exec(trimmed);
  return m ? { to: m[1]!, text: m[2]! } : { to: 'all', text: trimmed };
}

/** Complete the trailing nick fragment against `nicks` (Tab completion). */
export function completeNick(text: string, nicks: readonly string[]): string {
  const m = /@?([\w.-]+)$/.exec(text);
  const frag = m?.[1];
  if (!frag) return text;
  const low = frag.toLowerCase();
  const hit = nicks.find((n) => n.toLowerCase().startsWith(low) && n.length > frag.length);
  if (!hit) return text;
  const hadAt = text[text.length - frag.length - 1] === '@';
  return text.slice(0, text.length - frag.length - (hadAt ? 1 : 0)) + (hadAt ? '@' : '') + hit + ' ';
}

const MENTION = /(^|[^\w])(lead|human)([^\w]|$)/;

function hhmm(ts: string): string {
  const m = /\b(\d{2}:\d{2})/.exec(ts);
  if (m?.[1]) return m[1];
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Line =
  | { k: 'msg'; note: ChannelNote; time: string }
  | { k: 'sys'; text: string };

/** Channel timeline: notes, joins (first appearance), exit notes + member parts. */
export function buildLines(snapshot: AtlasSnapshot, channel: string): Line[] {
  const lines: Line[] = [];
  const seen = new Set<string>();
  const quit = new Set<string>();
  for (const n of snapshot.notes) {
    if (n.channel !== channel) continue;
    if (!seen.has(n.owner)) {
      seen.add(n.owner);
      if (n.owner !== 'human') lines.push({ k: 'sys', text: `*** ${n.owner} has joined` });
    }
    if (n.kind === 'exit') {
      quit.add(n.owner);
      lines.push({ k: 'sys', text: `*** ${n.owner} has quit${n.text ? ` (${n.text})` : ''}` });
    } else {
      lines.push({ k: 'msg', note: n, time: hhmm(n.ts) });
    }
  }
  // Parts inferred from membership: a roster entry that ended and left no exit note.
  for (const m of snapshot.members) {
    if (m.ended_at && !quit.has(m.name) && seen.has(m.name)) {
      lines.push({ k: 'sys', text: `*** ${m.name} has quit (exit ${m.exit_code ?? '?'})` });
    }
  }
  return lines;
}

/** `body` fully wrapped in one fence -> its language and source. */
export function fencedBody(text: string): { language?: string; code: string } | null {
  const m = /^\s*```(\w*)\r?\n([\s\S]*?)\r?\n?\s*```\s*$/.exec(text);
  return m ? { language: m[1] || undefined, code: m[2]! } : null;
}

function spriteState(s: AgentState | undefined): SpriteState {
  switch (s) {
    case 'running': return 'working';
    case 'spawning': return 'spawn';
    case 'input': return 'input';
    case 'finished': return 'done';
    case 'failed': return 'failed';
    case 'stuck': return 'stuck';
    case 'parked':
    case 'dead': return 'killed';
    default: return 'idle';
  }
}

function nickNames(snapshot: AtlasSnapshot): string[] {
  const names = snapshot.members.map((m: ChannelMember) => m.name);
  if (!names.includes('lead')) names.push('lead');
  names.push('all');
  return names;
}

// ---- the surface module ----

const IrcChannel = (props: ChannelProps, surface: ClientSurface<PaneState>): RenderElement => {
  const { snapshot, columns, rows } = props;
  const { Box, Text, Input, Select, Code, Markdown } = surface.elements;

  const channels = [
    ...new Set([snapshot.channel, ...snapshot.notes.map((n) => n.channel)].filter(
      (c): c is string => !!c,
    )),
  ];
  const st = surface.state ?? { text: '', channel: null, tick: 0 };
  const active = st.channel ?? snapshot.channel ?? channels[0];

  if (surface.state === undefined) {
    // One-time: animation clock (typing dots + sprite frames) and Tab completion.
    // ponytail: ticks redraw the whole pane at ~1.6 Hz; fine for a sidebar pane.
    surface.every(600, () => {
      const s = surface.state;
      if (s) surface.setState({ ...s, tick: s.tick + 1 });
    });
    surface.onKey((e) => {
      const s = surface.state;
      if (!s || e.key !== 'tab') return;
      const next = completeNick(s.text, nickNames(snapshot));
      if (next !== s.text) surface.setState({ ...s, text: next });
    });
    surface.setState({ text: '', channel: null, tick: 0 });
  }

  const running = snapshot.squad.filter((a) => a.state === 'running');
  const dots = '.'.repeat(1 + (st.tick % 3));
  const typing =
    running.length === 0 ? null
    : running.length === 1
      ? `${running[0]!.name} is working${dots}`
      : running.length === 2
        ? `${running[0]!.name} and ${running[1]!.name} are working${dots}`
        : `${running.length} agents are working${dots}`;

  const showNicks = columns >= 56 && snapshot.members.length > 0;
  const nickW = showNicks ? NICK_W : 0;
  const logW = Math.max(12, columns - nickW);
  const chrome = 2 + (channels.length > 1 ? 1 : 0) + (typing ? 1 : 0); // header + composer + select + typing
  const logRows = Math.max(1, rows - chrome);

  const lines = active ? buildLines(snapshot, active) : [];
  const vis = lines.slice(-logRows); // auto-scroll: bottom-anchored to the newest
  const lastMsg = [...lines].reverse().find((l): l is { k: 'msg'; note: ChannelNote; time: string } => l.k === 'msg');
  const unreadOwner = snapshot.unread > 0 ? lastMsg?.note.owner : undefined;

  const renderNick = (m: ChannelMember): RenderElement => {
    const agent = snapshot.squad.find((a) => a.name === m.name);
    const persona = agent?.persona ?? m.name;
    const set = spriteFor(persona);
    const state = agent?.state;
    const frames = set.mini[spriteState(state)];
    const frame = frames[Math.floor(st.tick / 2) % frames.length] ?? frames[0] ?? [];
    const cellRows = frameToRuns(frame, set.palette);
    return (
      <Box key={m.name} flexDirection="row" gap={1} height={2} flexShrink={0}>
        <Box flexDirection="column" width={2} flexShrink={0}>
          {cellRows.map((runs, r) => (
            <Text key={`r${r}`}>
              {runs.map((run, c) => (
                <Text key={`c${c}`} color={run.color} backgroundColor={run.backgroundColor}>
                  {run.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text color={personaColor(persona)}>
            {m.name.length > 12 ? `${m.name.slice(0, 11)}…` : m.name}
          </Text>
          <Text>
            <Text color={stateColor(state ?? 'idle')}>●</Text>
            {unreadOwner === m.name ? <Text color={BRAND.input}> ✉{snapshot.unread}</Text> : null}
          </Text>
        </Box>
      </Box>
    );
  };

  const renderLine = (line: Line, i: number): RenderElement => {
    if (line.k === 'sys') {
      return <Text key={`s${i}`} dimColor>{line.text}</Text>;
    }
    const n = line.note;
    const pc = personaColor(snapshot.squad.find((a) => a.name === n.owner)?.persona ?? n.owner);
    const body = n.text;
    const plain = body.split('\n');
    const fence = fencedBody(body);
    const mention = n.to === 'lead' || MENTION.test(n.text);
    const fg = mention ? BRAND.bg : BRAND.text;

    const head = (
      <Text>
        <Text dimColor>{line.time} ⚒ </Text>
        <Text color={pc} bold={n.to === 'lead'}>{n.owner}</Text>
        <Text dimColor> → {n.to ?? 'all'} │ </Text>
      </Text>
    );

    if (fence) {
      return (
        <Box key={`m${n.seq}`} flexDirection="column" backgroundColor={mention ? BRAND.input : undefined}>
          {head}
          <Code source={fence.code} language={fence.language} />
        </Box>
      );
    }
    if (plain.length > 1) {
      return (
        <Box key={`m${n.seq}`} flexDirection="column" backgroundColor={mention ? BRAND.input : undefined}>
          {head}
          {plain.length > FOLD ? (
            <Box key={`fold${n.seq}`} flexDirection="column">
              {plain.slice(0, FOLD).map((l, j) => (
                <Text key={`v${j}`} color={fg} wrap="wrap">{l}</Text>
              ))}
              <Text color={BRAND.dim}>… +{plain.length - FOLD} lines</Text>
              <Box
                position="absolute"
                top={-FOLD}
                left={0}
                display="none"
                hover={{ display: 'flex' }}
                flexDirection="column"
                backgroundColor={BRAND.surface}
              >
                {plain.map((l, j) => (
                  <Text key={`h${j}`} color={fg} wrap="wrap">{l}</Text>
                ))}
              </Box>
            </Box>
          ) : (
            <Markdown text={body} />
          )}
        </Box>
      );
    }
    return (
      <Text
        key={`m${n.seq}`}
        wrap="wrap"
        color={fg}
        backgroundColor={mention ? BRAND.input : undefined}
      >
        <Text dimColor={!mention}>{line.time} ⚒ </Text>
        <Text color={pc} bold={n.to === 'lead'}>{n.owner}</Text>
        <Text dimColor={!mention}> → {n.to ?? 'all'} │ </Text>
        <Text color={fg}>{body}</Text>
      </Text>
    );
  };

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Text color={BRAND.accent} bold>⬢ IRC</Text>
        {active ? (
          <Text dimColor>
            {active.length > logW - 10 ? `${active.slice(0, Math.max(7, logW - 11))}…` : active}
          </Text>
        ) : null}
        {snapshot.unread > 0 ? <Text color={BRAND.input}>✉{snapshot.unread}</Text> : null}
      </Box>

      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Box flexDirection="column" width={logW} height={logRows} overflow="hidden" flexGrow={1}>
          {vis.length === 0 ? (
            <Text dimColor>{active ? `*** no notes in ${active} yet` : '*** no channel'}</Text>
          ) : (
            vis.map(renderLine)
          )}
        </Box>
        {showNicks ? (
          <Box flexDirection="column" width={nickW} height={logRows} overflow="hidden" flexShrink={0}>
            {snapshot.members.map(renderNick)}
          </Box>
        ) : null}
      </Box>

      {typing ? <Text color={BRAND.working}>{typing}</Text> : null}

      {active ? (
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {channels.length > 1 ? (
            <Select
              key="ch"
              label="ch"
              options={channels.map((c) => ({ value: c, label: c }))}
              value={active}
              onSelect={(v) => {
                const s = surface.state;
                if (s) surface.setState({ ...s, channel: v });
              }}
            />
          ) : null}
          <Input
            key="composer"
            label=">"
            placeholder="@nick message (Tab completes)"
            value={st.text}
            onInput={(v) => {
              const s = surface.state;
              if (s) surface.setState({ ...s, text: v });
            }}
            onSubmit={(v) => {
              const { to, text } = parseMessage(v);
              if (!text) return;
              surface.post({ t: 'note', channel: active, to, text });
              const s = surface.state;
              if (s) surface.setState({ ...s, text: '' });
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
};

export default IrcChannel;
