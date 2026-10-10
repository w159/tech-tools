// SnapshotBuilder: composes the mod data-plane readers into one AtlasSnapshot.
// Pure over FsLike (see contract.ts); register.ts feeds it $.fs + hook state.
// Never throws: init and build fall back to a valid idle snapshot whenever the
// underlying data is missing, unreadable or corrupt. Plan §2.
import type {
  AtlasSnapshot, ChannelMember, ChannelNote, Contract, FsLike, Persona, PhaseId, SquadAgent,
} from './contract';
import { boardRoot, leadChannelName } from './data/root';
import { computeCounts, currentPhase, readTodos, type TodosCache } from './data/todos';
import { NoteReader, readRoster, unreadCount } from './data/channels';
import { loadContract, loadPersonas } from './data/personas';
import { mergeSquad, parseHerdrStatus } from './data/herdr';

/** Contract stand-in when <pluginRoot>/contracts/operating-contract.json is missing/corrupt. */
const EMPTY_CONTRACT: Contract = {
  phases: [],
  headerFirstLinePattern: '',
  itemPhasePrefix: '[<phase>] ',
  todoPhases: [],
};

/**
 * Incremental AtlasSnapshot builder for one session. init() resolves the data
 * root and loads the plugin-level assets once; every build() re-reads what
 * changed (todos via an instance-held mtime cache, board notes via the
 * NoteReader byte cursors) and merges the live hook state on top.
 */
export class SnapshotBuilder {
  private root: string | null = null;
  private sessionId = '';
  private candidates: string[] = [];
  private personas: Persona[] = [];
  private contract: Contract = EMPTY_CONTRACT;
  private channel: string | null = null;
  private members: ChannelMember[] = [];
  private notes: NoteReader | null = null;
  private todoCache: TodosCache | undefined; // mtime cache kept on the instance across builds

  constructor(private readonly fs: FsLike, private readonly pluginRoot: string) {}

  /**
   * Resolve the Atlas root for `cwd` (ATLAS_PROJECT_ROOT override, else nearest
   * ancestor with `.atlas`), load personas + operating contract, and find the
   * lead channel from the session roster. Safe to call with no Atlas tree.
   */
  async init(
    cwd: string,
    env: { ATLAS_PROJECT_ROOT?: string },
    sessionId: string,
    folder: string,
    branch: string,
  ): Promise<void> {
    this.sessionId = sessionId;
    this.candidates = leadChannelName(sessionId, folder, branch);
    this.root = await boardRoot(this.fs, cwd, env).catch(() => null);
    try {
      this.personas = await loadPersonas(this.fs, this.pluginRoot);
    } catch {
      this.personas = [];
    }
    try {
      this.contract = await loadContract(this.fs, this.pluginRoot);
    } catch {
      this.contract = EMPTY_CONTRACT;
    }
    if (this.root !== null) {
      const fs: FsLike = this.fs;
      // NoteReader joins entries onto the board dir, so feed it bare names;
      // memFs/real list() may return full paths (basename of a name is the name).
      this.notes = new NoteReader(
        { ...fs, list: async (dir) => (await fs.list(dir)).map((p) => p.slice(p.lastIndexOf('/') + 1)) },
        this.root,
      );
      const roster = await readRoster(this.fs, this.root, this.candidates).catch(() => ({
        channel: null as string | null,
        members: [] as ChannelMember[],
      }));
      this.channel = roster.channel;
      this.members = roster.members;
    }
  }

  /** Rebuild every AtlasSnapshot field from disk state + live hook state. Never throws. */
  async build(live: {
    headerPhase: PhaseId | null;
    headerMisses: number;
    taskAgents: SquadAgent[];
    herdrStdout?: string;
    tokens: number;
    costUsd: number;
    contextPct: number;
    lastSeenSeq: number;
    now: number;
  }): Promise<AtlasSnapshot> {
    const passthrough = {
      root: this.root,
      sessionId: this.sessionId,
      contract: this.contract,
      personas: this.personas,
      tokens: live.tokens,
      costUsd: live.costUsd,
      contextPct: live.contextPct,
      headerMisses: live.headerMisses,
      now: live.now,
    };
    // No usable root (init never found one, or failed): idle snapshot.
    if (this.root === null) {
      return {
        ...passthrough,
        channel: null,
        todos: [],
        counts: computeCounts([], this.contract),
        phase: 'research',
        phaseSource: 'default',
        notes: [],
        members: [],
        squad: [],
        unread: 0,
      };
    }
    const memberNames = this.members.map((m) => m.name);
    const read = await readTodos(this.fs, this.root, this.sessionId, memberNames, this.contract, this.todoCache);
    this.todoCache = read.cache;
    const notes: ChannelNote[] = this.channel !== null && this.notes !== null
      ? await this.notes.read(this.channel)
      : [];
    const { panes } = parseHerdrStatus(live.herdrStdout ?? '');
    const phase = currentPhase(read.items, live.headerPhase);
    return {
      ...passthrough,
      channel: this.channel,
      todos: read.items,
      counts: computeCounts(read.items, this.contract),
      phase: phase.phase,
      phaseSource: phase.source,
      notes,
      members: this.members,
      squad: mergeSquad(this.members, notes, panes, live.taskAgents, live.now),
      unread: unreadCount(notes, live.lastSeenSeq, [this.candidates[0] ?? '']),
    };
  }
}