/**
 * Origin: the user's omp usage statusline, shipped with the atlas omp extension.
 * Config stays in ~/.omp/agent/usage-statusline.json. Set ATLAS_STATUSLINE=off
 * to skip registration (see index.ts).
 *
 * usage-statusline — dynamic multi-provider usage statusline for omp.
 *
 * Renders a two-area grid widget below the editor (color emoji icons, one
 * vertical rule at a fixed column on every row):
 *
 *   📁 project                                   │  🤖 Claude Opus 5.5  ·  🧠 high
 *   🦊 ···✦🐇··  2m14s · 38 tok/s · 🔧 7         │  💰 session    $10.26  391.7M tok  cache 99%
 *   📚 ctx  51% ▅▅▅▅▅▅▅▁▁▁▁▁▁▁  513.3k / 1M       │  🔌 anthropic     plan  350.1M tok  claude-opus-5-5
 *   ⏳ 5h   62% ▅▅▅▅▅▅▅▅▅▁▁▁▁▁  ↻4h40m anthropic  │  🔌 openrouter $10.26   41.6M tok  glm-5.3-flashx
 *   📅 7d   18% ▅▅▅▁▁▁▁▁▁▁▁▁▁▁  ↻6d15h anthropic  │
 *
 * Left: activity lane (a critter hops across a trail for the whole run, from
 * prompt admission to the agent fully stopping; it naps when idle) over the
 * meters (heat-gradient bars). Right: spend table with fixed column floors;
 * >3 providers collapse the tail into `+N more`. Subscription (OAuth)
 * providers show `plan` instead of a dollar figure and are excluded from the
 * session total, which counts metered API spend only.
 * Colors: magenta = money only, blue = model, cyan = identity, green/yellow/red = thresholds.
 *
 * Data sources:
 * - per-response usage: persisted assistant messages carry
 *   `usage` {input,output,cacheRead,cacheWrite,totalTokens,cost{*,total}} plus
 *   `provider`/`model` — tallied by scanning ctx.sessionManager.getBranch(),
 *   which stays correct across restarts, switches, and branch navigations.
 * - billing mode: ctx.modelRegistry.authStorage.credentials.hasOAuth(provider),
 *   the same check omp's built-in status line uses (ModelRegistry.isUsingOAuth).
 * - context: ctx.getContextUsage() (undefined before the first response).
 * - provider rate limits (5h/7d): ctx.modelRegistry.authStorage.usage.reports()
 *   (cache-backed; the poll interval throttles display, not API calls),
 *   scoped per render to the session's provider, active OAuth account, and
 *   model tier (see scopedWindows).
 * - run span: before_agent_start (fires once per admitted user prompt) opens
 *   it; agent_end without willContinue closes it. Retries, compaction, and
 *   other continuations start a fresh agent loop (a new agent_start) without
 *   a before_agent_start — those resume the same span instead of resetting it.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { classifyModel } from "@oh-my-pi/pi-catalog";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const WIDGET_KEY = "usage-statusline";
export const USAGE_STATUSLINE_WIDGET_KEY = WIDGET_KEY;

/** True when the user already runs their own copy, which would race this one on the same widget key. */
export function userStatuslineCopyExists(cwd: string, home = homedir()): boolean {
  return (
    existsSync(join(home, ".omp", "agent", "extensions", "usage-statusline.ts")) ||
    existsSync(join(cwd, ".omp", "extensions", "usage-statusline.ts"))
  );
}
let RENDER_MS = 1_000; // live timer granularity (config: renderMs; needs omp restart)
let USAGE_POLL_MS = 60_000; // config: pollS
let MAX_PROVIDER_ROWS = 3; // right table: session + up to N provider rows (config: provRows)

// ANSI (widget rows keep colors; the setStatus surface would strip them).
const R = "\u001b[0m";
const CYAN = "\u001b[1;36m";
const MAGENTA = "\u001b[1;35m";
const GREEN = "\u001b[1;32m";
const YELLOW = "\u001b[1;33m";
const RED = "\u001b[1;31m";
const DIM = "\u001b[1;90m";
const BOLD = "\u001b[1m";

let BAR_CELLS = 14; // ~7% per cell (config: barCells)
// Heat-gradient meter: each filled cell is colored by its position along the
// bar (green → yellow → orange → red), so the fill shows how hot it runs.
// Lower 5/8 blocks on a one-eighth baseline track leave the top of every
// cell empty, which buys visible breathing room between stacked rows (a
// program can't change the terminal's line height).
let BAR_FILL = "▅";
let BAR_TRACK = "▁";
const TRACK = "\u001b[38;5;238m";
const HEAT: ReadonlyArray<readonly [number, number, number]> = [
 [80, 250, 123],
 [241, 250, 140],
 [255, 184, 108],
 [255, 85, 85],
];
// Color emoji (Emoji_Presentation=Yes, no VS16 needed): 2 cells wide, full
// color and legible at any font size; `visibleWidth` (omp's own width
// function) counts them as 2 cells, so columns stay aligned. Only Unicode
// ≤8.0 emoji: iTerm's "Unicode Version" profile setting is pinned at 8, so
// any glyph introduced later (🤖 robot face and 🧠 brain are both 9.0/10.0,
// 🦊 fox 9.0, 🦔 hedgehog 10.0) gets treated as 1-cell-wide by the terminal's
// own width table while visibleWidth() still assumes 2 — the mismatch is
// what silently drifted the column separator on those specific rows.
let I_DIR = "📁"; // project/cwd
let I_MODEL = "👾"; // model identity
let I_CTX = "📚"; // context fill
let I_5H = "⏳"; // 5h window
let I_7D = "📅"; // 7d window
let I_COST = "💰"; // session cost row
let I_PROV = "🔌"; // provider row
// I_TOOLS/I_NAP intentionally not emoji: iTerm's "Unicode Version 8" profile
// setting renders every Emoji_Presentation glyph as 1 cell (Wide only from
// Unicode 9+), regardless of the emoji's own introduction version. Each
// work-cell already carries exactly one emoji (the critter/lane); a second
// or third emoji in the same cell compounds that shear by one column each,
// which is what broke the header row's separator. Plain text avoids it.
let I_READY = "🌱"; // nothing run yet this session
// One critter per run, rotating: it hops across the activity lane while the
// agent works and naps there once the run ends.
const CRITTERS = ["🐸", "🐇", "🐢", "🐝", "🦄", "🐙", "🐌", "🐧"];
const LANE_CELLS = 10;

/** Per-response usage shape from @oh-my-pi/pi-catalog (`Usage`), as persisted
 * on assistant messages in the session branch. Named shape + single boundary
 * read: the branch entry type erases the assistant-message payload. */
interface AssistantUsage {
 input?: number;
 output?: number;
 cacheRead?: number;
 cacheWrite?: number;
 totalTokens?: number;
 cost?: { total?: number };
}

/** One provider's accumulated usage for this session. */
interface ProviderTally {
 provider: string;
 input: number;
 output: number;
 cacheRead: number;
 cacheWrite: number;
 cost: number;
 /** model id with the most output tokens on this provider */
 topModel: string;
 topModelTokens: number;
 /** output tokens per model id — dynamic keys, grows with usage */
 modelOutput: Map<string, number>;
 /** billed through a subscription (OAuth) login: no per-token spend */
 subscription: boolean;
}

interface Tallies {
 providers: ProviderTally[];
 totalTokens: number;
 /** spend on metered (API-key) providers only */
 meteredCost: number;
 cacheRead: number;
 promptish: number;
 modelCount: number;
 outputTokens: number;
}

type Window = { percent: number; resetsAt?: number; provider?: string };

// --- state ---
let latest: ExtensionContext | undefined;
// Raw provider reports from the last poll; windows are scoped per render
// (session provider, account, model) so a model/account switch shows at once.
let usageReports: UsageReportLike[] = [];
let usageFetchedAt = 0;
let usageInFlight = false;

// run span: one user prompt, from admission until the agent fully stops
let spanStart = 0; // epoch ms the current run began; 0 = idle
let endedSpanStart = 0; // start of the last closed span, for resuming continuations
let spanOutput = 0; // output-token snapshot at run start
let spanCost = 0; // metered-cost snapshot at run start
let spanTools = 0; // tool results seen this run
let lastSpanMs = 0;
let runCount = 0;
let critter = CRITTERS[0];

// last successful context-usage snapshot (some event ctx frames lack
// getContextUsage; the 1s tick harvests whenever the method exists)
let lastUsage: { tokens: number; contextWindow: number; percent?: number } | undefined;

// thinking effort lives on the ExtensionAPI, not the per-event ctx
let api: ExtensionAPI | undefined;

// The CONFIGURED thinking selector is not exposed by the ExtensionAPI:
// `getThinkingLevel()` returns the effective, clamped level, which diverges
// from the selector while it sits on `off` or `auto` (Shift+Tab cycles
// off → auto → levels). Every cycle persists a `thinking_level_change` branch
// entry carrying the selector in `configured`, so harvest it from the same
// branch scan computeTallies already performs each render.
// undefined = no/legacy entry → display the effective level (old behavior).
let configuredEffort: string | undefined;

// Hook-status key for the blank row beneath the last status line. The status
// line sorts entries with localeCompare, so "zzz-" lands after "pi-lens-lsp".
const BELOW_SPACER_KEY = "zzz-usage-statusline-spacer";

// --- formatting helpers (bc-style truncation, matching the mirror script) ---

function formatTokens(t: number): string {
 if (t >= 1_000_000) return (Math.floor(t / 100_000) / 10).toFixed(1) + "M";
 if (t >= 1_000) return (Math.floor(t / 100) / 10).toFixed(1) + "k";
 return String(Math.floor(t));
}

/** Context-window size, whole units (matches the original script: 1M, 200k). */
function formatSize(s: number): string {
 if (s >= 1_000_000) return `${Math.floor(s / 1_000_000)}M`;
 if (s >= 1_000) return `${Math.floor(s / 1_000)}k`;
 return String(s);
}

function formatCost(c: number): string {
 if (c >= 100) return "$" + Math.floor(c);
 if (c >= 0.01) return "$" + c.toFixed(2);
 if (c === 0) return "$0.00";
 return "<$0.01";
}

function formatDuration(ms: number): string {
 const s = Math.floor(ms / 1000);
 if (s >= 86400) return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
 if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
 const m = Math.floor(s / 60);
 if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
 return `${m}m${String(s % 60).padStart(2, "0")}s`;
}

/** Position-based heat color, f in [0, 1]: interpolates the HEAT stops. */
function heatColor(f: number): string {
 const x = Math.min(0.9999, Math.max(0, f)) * (HEAT.length - 1);
 const i = Math.floor(x);
 const t = x - i;
 const [r, g, b] = HEAT[i].map((a, k) => Math.round(a + (HEAT[i + 1][k] - a) * t));
 return `\u001b[38;2;${r};${g};${b}m`;
}

/** `undefined` = no reading yet: an empty track. */
function buildBar(pct: number | undefined): string {
 if (pct === undefined) return `${TRACK}${BAR_TRACK.repeat(BAR_CELLS)}${R}`;
 const clamped = Math.max(0, Math.min(100, pct));
 // any nonzero reading shows at least one cell
 const filled = clamped > 0 ? Math.max(1, Math.round((clamped / 100) * BAR_CELLS)) : 0;
 let cellsOut = "";
 for (let i = 0; i < filled; i++) cellsOut += (HEAT_ON ? heatColor(i / (BAR_CELLS - 1)) : pctColor(clamped)) + BAR_FILL;
 return `${cellsOut}${TRACK}${BAR_TRACK.repeat(BAR_CELLS - filled)}${R}`;
}

/** Activity lane: the critter one cell further along each tick, a sparkle
 * right behind it, a cyan trail where it has been, dim dots ahead. */
function lane(elapsedMs: number, glyph: string): string {
 const pos = Math.floor(elapsedMs / RENDER_MS) % (LANE_CELLS - 1);
 const behind = pos > 0 ? `${CYAN}${"·".repeat(pos - 1)}${BOLD}${YELLOW}✦${R}` : "";
 return `${behind}${glyph}${DIM}${"·".repeat(Math.max(0, LANE_CELLS - ICON_W - pos))}${R}`;
}

function padEnd(s: string, w: number): string {
 return s + " ".repeat(Math.max(0, w - visibleWidth(s)));
}

function padStart(s: string, w: number): string {
 return " ".repeat(Math.max(0, w - visibleWidth(s))) + s;
}

function pctColor(pct: number): string {
 if (pct <= 50) return GREEN;
 if (pct <= 75) return YELLOW;
 return RED;
}

/** Context fills normally during a session; only warn as compaction nears. */
function ctxColor(pct: number): string {
 if (pct <= 60) return GREEN;
 if (pct <= 85) return YELLOW;
 return RED;
}

function timeLeft(resetsAt: number | undefined, allowDays: boolean): string {
 if (!resetsAt) return "";
 const s = Math.max(0, Math.floor((resetsAt - Date.now()) / 1000));
 if (s === 0) return "";
 if (s >= 86400 && allowDays) return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
 const m = Math.floor(s / 60);
 if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
 return `${m}m`;
}

// --- usage tallies ---

function emptyTally(provider: string): ProviderTally {
 return {
  provider,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  topModel: "",
  topModelTokens: 0,
  modelOutput: new Map(),
  subscription: false,
 };
}

type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];
type AssistantPayload = { provider?: unknown; model?: unknown; usage?: AssistantUsage };

/** Assistant-message payload of a branch entry, undefined for any other entry. */
function assistantPayload(entry: BranchEntry): AssistantPayload | undefined {
 if (entry.type !== "message" || !("message" in entry)) return undefined;
 const msg: unknown = entry.message;
 if (!msg || typeof msg !== "object" || !("role" in msg)) return undefined;
 if (msg.role !== "assistant") return undefined;
 // Boundary read: the branch entry type erases the assistant payload.
 // Shape per @oh-my-pi/pi-ai AssistantMessage / pi-catalog Usage.
 return msg as AssistantPayload;
}

function providerName(m: AssistantPayload): string {
 return typeof m.provider === "string" && m.provider
  ? m.provider
  : typeof m.model === "string" && m.model.includes("/")
   ? m.model.split("/")[0]
   : "unknown";
}

interface MessageUsage {
 provider: string;
 model: string;
 inp: number;
 out: number;
 cr: number;
 cw: number;
 cost: number;
 totalTokens: number;
}

/** Normalized billable usage of one message; undefined when there is none. */
function readMessageUsage(m: AssistantPayload): MessageUsage | undefined {
 const usage = m.usage;
 if (!usage) return undefined;
 const inp = usage.input || 0;
 const out = usage.output || 0;
 const cr = usage.cacheRead || 0;
 const cw = usage.cacheWrite || 0;
 // a failed/aborted request can persist a message with an all-zero
 // usage block; it carries no billable usage to display
 if (inp === 0 && out === 0 && cr === 0 && cw === 0) return undefined;
 return {
  provider: providerName(m),
  model: typeof m.model === "string" ? m.model : "",
  inp,
  out,
  cr,
  cw,
  cost: usage.cost?.total || 0,
  totalTokens: usage.totalTokens || inp + out + cr + cw,
 };
}

function addToTally(t: ProviderTally, u: MessageUsage, models: Set<string>): void {
 t.input += u.inp;
 t.output += u.out;
 t.cacheRead += u.cr;
 t.cacheWrite += u.cw;
 t.cost += u.cost;
 if (u.model) {
  models.add(u.model);
  const mt = (t.modelOutput.get(u.model) || 0) + u.out;
  t.modelOutput.set(u.model, mt);
  if (mt > t.topModelTokens) {
   t.topModelTokens = mt;
   t.topModel = u.model;
  }
 }
}

/** Mark OAuth providers as subscription; returns the metered (API-key) spend. */
function settleBilling(byProvider: Map<string, ProviderTally>, ctx: ExtensionContext): number {
 const credentials = ctx.modelRegistry?.authStorage?.credentials;
 let meteredCost = 0;
 for (const p of byProvider.values()) {
  try {
   p.subscription = credentials?.hasOAuth(p.provider) ?? false;
  } catch {
   // unknown billing mode: treat as metered, never hide real spend
  }
  if (!p.subscription) meteredCost += p.cost;
 }
 return meteredCost;
}

/** Scan the session branch and group assistant-message usage by provider. */
function computeTallies(ctx: ExtensionContext): Tallies {
 const byProvider = new Map<string, ProviderTally>();
 const models = new Set<string>();
 let totalTokens = 0;
 let cacheRead = 0;
 let promptish = 0;
 let outputTokens = 0;
 let sawThinking = false;
 let lastConfigured: string | undefined;
 try {
  for (const entry of ctx.sessionManager.getBranch()) {
   if (entry.type === "thinking_level_change") {
    sawThinking = true;
    // `configured` is the selector; legacy entries only carry the level.
    lastConfigured =
     typeof entry.configured === "string" ? entry.configured : typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : undefined;
    continue;
   }
   const m = assistantPayload(entry);
   if (!m) continue;
   const u = readMessageUsage(m);
   if (!u) continue;
   let t = byProvider.get(u.provider);
   if (!t) {
    t = emptyTally(u.provider);
    byProvider.set(u.provider, t);
   }
   addToTally(t, u, models);
   totalTokens += u.totalTokens;
   cacheRead += u.cr;
   promptish += u.inp + u.cr + u.cw;
   outputTokens += u.out;
  }
  configuredEffort = sawThinking ? lastConfigured : undefined;
 } catch {
  // branch unreadable — render with what we have
 }
 const meteredCost = settleBilling(byProvider, ctx);
 const providers = [...byProvider.values()].sort((a, b) => {
  const ta = a.input + a.output + a.cacheRead + a.cacheWrite;
  const tb = b.input + b.output + b.cacheRead + b.cacheWrite;
  return tb - ta;
 });
 return {
  providers,
  totalTokens,
  meteredCost,
  cacheRead,
  promptish,
  modelCount: models.size,
  outputTokens,
 };
}

// --- rate limits (public, cache-backed AuthStorage on the model registry) ---

function fractionUsed(amount: unknown): number | undefined {
 if (!amount || typeof amount !== "object") return undefined;
 const a = amount as {
  usedFraction?: unknown;
  remainingFraction?: unknown;
  used?: unknown;
  limit?: unknown;
  unit?: unknown;
 };
 if (typeof a.usedFraction === "number") return a.usedFraction;
 if (typeof a.remainingFraction === "number") return 1 - a.remainingFraction;
 if (typeof a.used === "number" && typeof a.limit === "number" && a.limit > 0)
  return a.used / a.limit;
 if (a.unit === "percent" && typeof a.used === "number") return a.used / 100;
 return undefined;
}

interface UsageReportLike {
 provider?: string;
 metadata?: { accountId?: unknown; email?: unknown };
 limits?: Array<{
  window?: { id?: string; resetsAt?: number; durationMs?: number };
  scope?: { shared?: boolean; tier?: string };
  amount?: unknown;
 }>;
}

// Provider rate-limit reports come from AuthStorage.usage (UsageApi.reports) —
// the same call AgentSession.fetchUsageReports makes. AuthStorage itself has
// no fetchUsageReports method.
function refreshUsage(ctx: ExtensionContext): void {
 if (usageInFlight || Date.now() - usageFetchedAt < USAGE_POLL_MS) return;
 const authStorage = ctx.modelRegistry?.authStorage;
 if (!authStorage?.usage?.reports) return;
 usageInFlight = true;
 authStorage.usage
  .reports()
  .then((reports: UsageReportLike[] | null | undefined) => {
   usageFetchedAt = Date.now();
   if (reports) usageReports = reports;
  })
  .catch(() => {
   // keep stale reports on error
   usageFetchedAt = Date.now();
  })
  .finally(() => {
   usageInFlight = false;
  });
}

const FIVE_HOURS_MS = 5 * 3_600_000;
const SEVEN_DAYS_MS = 7 * 86_400_000;

/** The 5h/7d windows that gate THIS session, scoped the way omp's Claude
 * ranking does (pi-ai usage/claude.ts scopeClaudeLimitsForModel): only the
 * session model's provider, only the session's active OAuth account, and
 * only shared limits plus the tier matching the model (a Fable weekly cap
 * never shows on Opus). Windows match by duration so `1w`/`300m` providers
 * (xAI, Muse) fill the 7d/5h meters too. Several survivors: the tightest. */
type UsageLimit = NonNullable<UsageReportLike["limits"]>[number];

/** Reports to scan: the session's OAuth account when identifiable, else every account of the provider. */
function sessionReports(ctx: ExtensionContext, provider: string | undefined): UsageReportLike[] {
 const ofProvider = usageReports.filter((r) => r.provider === provider);
 let identity: { accountId?: string; email?: string } | undefined;
 try {
  identity = provider ? ctx.modelRegistry?.authStorage?.oauth?.identity(provider, ctx.sessionManager.getSessionId()) : undefined;
 } catch {
  // no identity: fall back to every account of the provider
 }
 const mine = ofProvider.filter(
  (r) =>
   (identity?.accountId !== undefined && r.metadata?.accountId === identity.accountId) ||
   (identity?.email !== undefined && r.metadata?.email === identity.email),
 );
 return mine.length > 0 ? mine : ofProvider;
}

function scopedWindows(ctx: ExtensionContext): { fiveHour?: Window; sevenDay?: Window } {
 const provider = ctx.model?.provider;
 const family = provider && ctx.model?.id ? classifyModel(provider, ctx.model.id).family : undefined;
 const out: { fiveHour?: Window; sevenDay?: Window } = {};
 for (const report of sessionReports(ctx, provider)) {
  for (const limit of report.limits || []) foldLimit(out, report, limit, family);
 }
 return out;
}

/** Fold one limit into `out`, keeping the tightest window per slot. */
function foldLimit(out: { fiveHour?: Window; sevenDay?: Window }, report: UsageReportLike, limit: UsageLimit, family: string | undefined): void {
 const tier = limit.scope?.tier;
 if (tier && limit.scope?.shared !== true && tier !== family) return;
 const dur = limit.window?.durationMs;
 const id = limit.window?.id;
 const key = dur === FIVE_HOURS_MS || id === "5h" ? "fiveHour" : dur === SEVEN_DAYS_MS || id === "7d" ? "sevenDay" : undefined;
 if (!key) return;
 const fraction = fractionUsed(limit.amount);
 if (fraction === undefined) return;
 const w = { percent: fraction * 100, resetsAt: limit.window?.resetsAt, provider: report.provider };
 if (!out[key] || w.percent > out[key].percent) out[key] = w;
}

// --- render ---

const HSEP = `  ${DIM}·${R}  `;
let HSEP_TIGHT = ` ${DIM}·${R} `; // activity row: every cell counts
let COL_GAP = `  ${DIM}│${R}  `; // one vertical rule, every row, same column
const BLUE = "\u001b[1;34m"; // model identity (magenta is reserved for money)
const WHITE = "\u001b[1;37m";
const SOFT = "\u001b[37m"; // secondary header text (effort qualifies the model)
const MONEY = "\u001b[35m"; // provider costs; the session total is bold MAGENTA

// Right-table column floors: stable columns across renders; only widen when a
// value genuinely exceeds them.
let NAME_W = 10;
const COST_W = 7;
const TOK_W = 7;
let EXTRA_W = 15;

// Cost/token widths only ever grow within a process, so columns never jitter
// back and forth as providers rotate through the visible rows.
let costHigh = COST_W;
let tokHigh = TOK_W;

/** Truncate to `w` terminal cells (not code points: emoji are 2 cells). */
function clip(s: string, w: number): string {
 if (visibleWidth(s) <= w) return s;
 let out = "";
 for (const ch of s) {
  if (visibleWidth(out + ch) > w - 1) break;
  out += ch;
 }
 return `${out}…`;
}

/** Model id for the table: drop the vendor prefix and a trailing date stamp
 * (`-20250805`) so clipping never eats the version that tells models apart. */
function shortModel(id: string): string {
 return (id.split("/").pop() ?? id).replace(/-\d{8}$/, "");
}

/** Left grid cell: `<icon> <label> <pct> <bar>  <detail>`, fixed width. */
function meter(
 icon: string,
 label: string,
 pct: number | undefined,
 detail: string,
 colorFor: (p: number) => string = pctColor,
): string {
 if (pct === undefined) {
  // no reading yet: keep the icon bright so the row still reads as a live
  // meter, and dim only the placeholder values
  const head = `${BOLD}${CYAN}${icon}${R}${ICON_GAP}${DIM}${label.padEnd(3)}${R} `;
  return padEnd(`${head}${DIM}${"--%".padStart(4)}${R} ${buildBar(undefined)}  ${DIM}${detail}${R}`, METER_W);
 }
 const p = Math.max(0, Math.min(100, Math.round(pct)));
 const color = colorFor(p);
 const head = `${BOLD}${color}${icon}${R}${ICON_GAP}${DIM}${label.padEnd(3)}${R} `;
 return padEnd(`${head}${BOLD}${color}${`${p}%`.padStart(4)}${R} ${buildBar(p)}  ${DIM}${clip(detail, DETAIL_W)}${R}`, METER_W);
}
let DETAIL_W = 16;
let ICON_GAP = "  "; // spaces after each icon (config: glyphGap)
let ICON_W = 2; // cells an icon occupies: 2 emoji, 1 text
// icon+gap+label(3)+space + pct(4) + space + bar + 2 + detail
let METER_W = ICON_W + ICON_GAP.length + 3 + 1 + 4 + 1 + BAR_CELLS + 2 + DETAIL_W;

/** `4h40m anthropic`: when it resets, and whose limit it is. */
function resetDetail(w: Window | undefined, allowDays: boolean): string {
 if (!w) return "";
 const left = timeLeft(w.resetsAt, allowDays);
 return [left, w.provider ?? ""].filter(Boolean).join(" ");
}

// --- user config: ~/.omp/agent/usage-statusline.json (written by statusline-editor.html) ---
type Line1Mode = "cwd-activity-model" | "cwd-activity" | "activity-model" | "cwd-model";
interface Cfg {
 glyphGap: number; lineGap: number; colGap: number; blankLine: boolean; spacerPipe: boolean;
 line1Mode: Line1Mode; showEffort: boolean; line1Pipe: boolean; cwdWidth: number; modelWidth: number;
 mCtx: boolean; m5h: boolean; m7d: boolean; barCells: number; barStyle: "lower" | "full" | "seg" | "line";
 heat: boolean; detailW: number; showRight: boolean; provRows: number; showCache: boolean;
 nameW: number; extraW: number; iconStyle: "emoji" | "text"; showTools: boolean; showRunCount: boolean;
 renderMs: number; pollS: number;
}
const CFG_DEFAULTS: Cfg = {
 glyphGap: 2, lineGap: 4, colGap: 2, blankLine: true, spacerPipe: false,
 line1Mode: "cwd-activity-model", showEffort: true, line1Pipe: false, cwdWidth: 24, modelWidth: 28,
 mCtx: true, m5h: true, m7d: true, barCells: 14, barStyle: "lower",
 heat: true, detailW: 16, showRight: true, provRows: 3, showCache: true,
 nameW: 10, extraW: 15, iconStyle: "emoji", showTools: true, showRunCount: true,
 renderMs: 1000, pollS: 60,
};
const CFG_PATH = `${homedir()}/.omp/agent/usage-statusline.json`;
const BAR_STYLES: Record<Cfg["barStyle"], [string, string]> = { lower: ["▅", "▁"], full: ["█", "░"], seg: ["▰", "▱"], line: ["━", "─"] };
const TEXT_ICONS = { dir: "d", model: "m", ctx: "c", h5: "5", d7: "7", cost: "$", prov: "p", ready: "~" };
let CFG: Cfg = { ...CFG_DEFAULTS };
let cfgMtime = -1;
let HEAT_ON = true;

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Re-read the JSON when its mtime changes (one stat per render) and rebind the layout globals. */
function applyCfg(): void {
 let mtime = 0;
 try {
  mtime = statSync(CFG_PATH).mtimeMs;
 } catch {
  mtime = 0;
 }
 if (mtime === cfgMtime) return;
 cfgMtime = mtime;
 let raw: Record<string, unknown> = {};
 if (mtime > 0) {
  try {
   const parsed = JSON.parse(readFileSync(CFG_PATH, "utf8"));
   // the editor exports { statusLine, widget }; a bare widget object also works
   raw = (parsed?.widget ?? parsed) as Record<string, unknown>;
  } catch {
   raw = {}; // unreadable file: fall back to defaults rather than break the line
  }
 }
 const d = CFG_DEFAULTS;
 const b = (k: keyof Cfg): boolean => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : (d[k] as boolean));
 const oneOf = <T extends string>(k: keyof Cfg, opts: readonly T[]): T => (opts.includes(raw[k] as T) ? (raw[k] as T) : (d[k] as T));
 CFG = {
  glyphGap: num(raw.glyphGap, 1, 4, d.glyphGap), lineGap: num(raw.lineGap, 1, 8, d.lineGap), colGap: num(raw.colGap, 1, 4, d.colGap),
  blankLine: b("blankLine"), spacerPipe: b("spacerPipe"),
  line1Mode: oneOf("line1Mode", ["cwd-activity-model", "cwd-activity", "activity-model", "cwd-model"] as const),
  showEffort: b("showEffort"), line1Pipe: b("line1Pipe"), cwdWidth: num(raw.cwdWidth, 8, 40, d.cwdWidth), modelWidth: num(raw.modelWidth, 10, 40, d.modelWidth),
  mCtx: b("mCtx"), m5h: b("m5h"), m7d: b("m7d"), barCells: num(raw.barCells, 4, 24, d.barCells),
  barStyle: oneOf("barStyle", ["lower", "full", "seg", "line"] as const),
  heat: b("heat"), detailW: num(raw.detailW, 8, 24, d.detailW), showRight: b("showRight"), provRows: num(raw.provRows, 0, 4, d.provRows), showCache: b("showCache"),
  nameW: num(raw.nameW, 6, 18, d.nameW), extraW: num(raw.extraW, 8, 24, d.extraW),
  iconStyle: oneOf("iconStyle", ["emoji", "text"] as const), showTools: b("showTools"), showRunCount: b("showRunCount"),
  renderMs: num(raw.renderMs, 250, 10_000, d.renderMs), pollS: num(raw.pollS, 15, 600, d.pollS),
 };
 RENDER_MS = CFG.renderMs;
 USAGE_POLL_MS = CFG.pollS * 1000;
 MAX_PROVIDER_ROWS = CFG.provRows;
 BAR_CELLS = CFG.barCells;
 [BAR_FILL, BAR_TRACK] = BAR_STYLES[CFG.barStyle];
 HEAT_ON = CFG.heat;
 const text = CFG.iconStyle === "text";
 ICON_W = text ? 1 : 2;
 ICON_GAP = " ".repeat(CFG.glyphGap);
 I_DIR = text ? TEXT_ICONS.dir : "📁";
 I_MODEL = text ? TEXT_ICONS.model : "👾";
 I_CTX = text ? TEXT_ICONS.ctx : "📚";
 I_5H = text ? TEXT_ICONS.h5 : "⏳";
 I_7D = text ? TEXT_ICONS.d7 : "📅";
 I_COST = text ? TEXT_ICONS.cost : "💰";
 I_PROV = text ? TEXT_ICONS.prov : "🔌";
 I_READY = text ? TEXT_ICONS.ready : "🌱";
 const pad = " ".repeat(CFG.colGap);
 COL_GAP = `${pad}${DIM}│${R}${pad}`;
 DETAIL_W = CFG.detailW;
 NAME_W = CFG.nameW;
 EXTRA_W = CFG.extraW;
 METER_W = ICON_W + ICON_GAP.length + 3 + 1 + 4 + 1 + BAR_CELLS + 2 + DETAIL_W;
}

/** Selected-effort label for the first line, or undefined when hidden. */
function effortLabelFor(effort: string | undefined): string | undefined {
 if (!CFG.showEffort) return undefined;
 // Show what the user SELECTED only where the effective level can't convey it
 // (Shift+Tab cycles off → auto → levels): `off`, `auto · <resolved>`. For any
 // concrete or inherited selector, the effective level is always truthful
 // (it equals the selector unless the model clamps it).
 if (configuredEffort === "auto") return effort ? `auto · ${effort}` : "auto";
 if (configuredEffort === "off") return "off";
 return effort;
}

/** Activity segments for the first line: running, napping or ready. */
function activitySegments(t: Tallies, crit: string): string[] {
 let segments: string[];
 if (spanStart > 0) {
  const elapsed = Math.max(0, Date.now() - spanStart);
  // average output rate over the run; too noisy to show in the first seconds
  const tokPerSec = elapsed >= 3000 ? Math.round((t.outputTokens - spanOutput) / (elapsed / 1000)) : 0;
  const runCost = t.meteredCost - spanCost;
  segments = [
   `${lane(elapsed, crit)}  ${BOLD}${GREEN}${formatDuration(elapsed)}${R}`,
   tokPerSec > 0 ? `${CYAN}${tokPerSec} tok/s${R}` : `${DIM}thinking…${R}`,
   CFG.showTools && spanTools > 0 ? `${DIM}tools ${spanTools}${R}` : "",
   runCost >= 0.01 ? `${MONEY}${formatCost(runCost)}${R}` : "",
  ];
 } else if (runCount > 0) {
  segments = [
   `${crit}${ICON_GAP}${DIM}napping${R}`,
   `${DIM}last run ${formatDuration(lastSpanMs)}${R}`,
   CFG.showTools && spanTools > 0 ? `${DIM}tools ${spanTools}${R}` : "",
   CFG.showRunCount ? `${DIM}${runCount} run${runCount === 1 ? "" : "s"}${R}` : "",
  ];
 } else {
  segments = [`${I_READY}${ICON_GAP}${DIM}ready${R}`];
 }
 return segments.filter(Boolean);
}

/** Join cwd, activity and model per `line1Mode`. */
function composeFirstLine(cwdPart: string, work: string, modelPart: string, lineGap: string): string {
 switch (CFG.line1Mode) {
  case "cwd-activity":
   return `${cwdPart}${work}`;
  case "activity-model":
   return `${work}${lineGap}${modelPart}`;
  case "cwd-model":
   return `${cwdPart.trimEnd()}${lineGap}${modelPart}`;
  default:
   return CFG.line1Pipe
    ? `${padEnd(`${cwdPart}${work}`, METER_W)}${COL_GAP}${modelPart}`
    : `${cwdPart}${work}${lineGap}${modelPart}`;
 }
}

function buildFirstLine(ctx: ExtensionContext, t: Tallies, crit: string, rowCols: number): string {
 // ── First line: cwd + activity flow together, no column rule — a single
 // unbroken status line, not a two-column row. ──
 const project = ctx.cwd.split("/").filter(Boolean).pop() ?? ctx.cwd;
 const model = ctx.model?.name ?? ctx.model?.id ?? "unknown";
 let effort: string | undefined;
 try {
  effort = api?.getThinkingLevel();
 } catch {
  // no effort segment
 }
 const effortLabel = effortLabelFor(effort);
 const segments = activitySegments(t, crit);
 const FIRST_LINE_LEFT_W = METER_W + visibleWidth(COL_GAP); // aligns model under the right column's start, no jitter
 const cwdPart = `${CYAN}${I_DIR}${ICON_GAP}${clip(project, CFG.cwdWidth)}${R}   `;
 const modelPart = `${BLUE}${I_MODEL}${ICON_GAP}${clip(model, CFG.modelWidth)}${R}` + (effortLabel ? `${HSEP}${SOFT}${effortLabel}${R}` : "");
 const lineGap = " ".repeat(CFG.lineGap);
 // Budget what the activity row may spend: with the pipe the first line lives
 // inside the meter column; without it the line spans the terminal, so budget
 // from the real width (cwd + gap + model all claim the same line). Panes under
 // 62 cols budget from their actual width: the 60-col floor would overfill them.
 const workBudget = CFG.line1Pipe
  ? Math.max(0, FIRST_LINE_LEFT_W - visibleWidth(cwdPart))
  : Math.max(0, rowCols - visibleWidth(cwdPart) - lineGap.length - visibleWidth(modelPart));
 // drop trailing segments rather than spill past the line width
 while (segments.length > 1 && visibleWidth(segments.join(HSEP_TIGHT)) > workBudget) segments.pop();
 const work = segments.join(HSEP_TIGHT);
 let firstLine = composeFirstLine(cwdPart, work, modelPart, lineGap);
 // Narrow panes: drop rather than overflow. Activity segments already shrank to
 // the real-width budget above; if the composed line still can't fit (piped
 // layout pins the model after the meter column; the flat line ends with it),
 // drop the model segment too.
 if (visibleWidth(firstLine) > rowCols && firstLine.endsWith(modelPart)) {
  firstLine = firstLine.slice(0, firstLine.length - modelPart.length).trimEnd();
 }
 return firstLine;
}

/** ctx/5h/7d meters (up to 3 rows), model/effort live on the first line. */
function buildLeftColumn(ctx: ExtensionContext): string[] {
 // Some event-context frames lack getContextUsage; harvest when present and
 // fall back to the last successful snapshot.
 if (typeof ctx.getContextUsage === "function") {
  try {
   const snap = ctx.getContextUsage();
   if (snap) lastUsage = snap;
  } catch {
   // keep lastUsage
  }
 }
 const cu = lastUsage;
 const windows = scopedWindows(ctx);
 const windowSize = cu?.contextWindow || ctx.model?.contextWindow || 0;
 return [
  CFG.mCtx
   ? cu && cu.contextWindow > 0
    ? meter(I_CTX, "ctx", (cu.tokens / cu.contextWindow) * 100, `${formatTokens(cu.tokens)} / ${formatSize(cu.contextWindow)}`, ctxColor)
    : meter(I_CTX, "ctx", undefined, windowSize > 0 ? `0 / ${formatSize(windowSize)}` : "")
   : "",
  CFG.m5h ? meter(I_5H, "5h", windows.fiveHour?.percent, resetDetail(windows.fiveHour, false)) : "",
  CFG.m7d ? meter(I_7D, "7d", windows.sevenDay?.percent, resetDetail(windows.sevenDay, true)) : "",
 ].filter(Boolean);
}

type SpendRow = { icon: string; name: string; cost: string; tok: string; extra: string; total: boolean; plan: boolean };

/** Right column rows: session total, then providers (overflow folded into `+N more`). */
function buildSpendTable(t: Tallies): SpendRow[] {
 // Subscription providers have no per-token spend: they show `plan` and stay
 // out of the session total, which is metered API spend only.
 const cachePct = t.promptish > 0 ? Math.round((t.cacheRead / t.promptish) * 100) : 0;
 const anyMetered = t.providers.some((p) => !p.subscription);
 const table: SpendRow[] = [
  {
   icon: I_COST,
   name: "session",
   cost: anyMetered || t.providers.length === 0 ? formatCost(t.meteredCost) : "plan",
   tok: formatTokens(t.totalTokens),
   extra: CFG.showCache ? `cache ${cachePct}%` : "",
   total: true,
   plan: !anyMetered && t.providers.length > 0,
  },
 ];
 const overflow = t.providers.length > MAX_PROVIDER_ROWS;
 const listed = MAX_PROVIDER_ROWS === 0 ? [] : overflow ? t.providers.slice(0, MAX_PROVIDER_ROWS - 1) : t.providers;
 for (const p of listed) {
  table.push({
   icon: I_PROV,
   name: p.provider,
   cost: p.subscription ? "plan" : formatCost(p.cost),
   tok: formatTokens(p.input + p.output + p.cacheRead + p.cacheWrite),
   extra: shortModel(p.topModel),
   total: false,
   plan: p.subscription,
  });
 }
 if (overflow && MAX_PROVIDER_ROWS > 0) {
  const rest = t.providers.slice(MAX_PROVIDER_ROWS - 1);
  const restMetered = rest.filter((p) => !p.subscription);
  table.push({
   icon: I_PROV,
   name: `+${rest.length} more`,
   cost: restMetered.length > 0 ? formatCost(restMetered.reduce((s, p) => s + p.cost, 0)) : "plan",
   tok: formatTokens(rest.reduce((s, p) => s + p.input + p.output + p.cacheRead + p.cacheWrite, 0)),
   extra: rest.map((p) => p.provider).join(" + "),
   total: false,
   plan: restMetered.length === 0,
  });
 }
 return table;
}

/** Format spend rows into aligned strings; also reports the widest row head. */
function formatRightRows(table: SpendRow[], rightBudget: number): { right: string[]; widestHead: number } {
 const nameW = Math.min(NAME_W + 4, Math.max(NAME_W, ...table.map((r) => visibleWidth(r.name))));
 costHigh = Math.max(costHigh, ...table.map((r) => visibleWidth(r.cost)));
 tokHigh = Math.max(tokHigh, ...table.map((r) => visibleWidth(r.tok)));
 const costW = costHigh;
 const tokW = tokHigh;
 let widestHead = 0;
 const right = CFG.showRight
  ? table.map((r) => {
   const name = r.total ? `${WHITE}${padEnd(clip(r.name, nameW), nameW)}${R}` : `${CYAN}${padEnd(clip(r.name, nameW), nameW)}${R}`;
   const costColor = r.plan ? GREEN : r.total ? `${BOLD}${MAGENTA}` : MONEY;
   const cost = `${costColor}${padStart(r.cost, costW)}${R}`;
   const tok = r.total ? `${WHITE}${padStart(r.tok, tokW)}${R}` : padStart(r.tok, tokW);
   const head = `${r.icon}${ICON_GAP}${name} ${cost}  ${tok} ${DIM}tok${R}`;
   widestHead = Math.max(widestHead, visibleWidth(head));
   const extraW = Math.min(EXTRA_W, rightBudget - visibleWidth(head) - 2);
   return extraW >= 3 && r.extra ? `${head}  ${DIM}${clip(r.extra, extraW)}${R}` : head;
  })
  : [];
 return { right, widestHead };
}

function render(ctx: ExtensionContext): void {
 applyCfg();
 const t = computeTallies(ctx);
 const crit = CFG.iconStyle === "text" ? "*" : critter;
 const realCols = process.stdout.columns || 120;
 const termCols = Math.max(60, realCols - 2);
 const rowCols = Math.min(termCols, realCols - 1); // widest any row may be without wrapping
 const firstLine = buildFirstLine(ctx, t, crit, rowCols);
 const left = buildLeftColumn(ctx);
 const rightBudget = termCols - METER_W - visibleWidth(COL_GAP);
 const { right, widestHead } = formatRightRows(buildSpendTable(t), rightBudget);
 // Narrow pane: a two-column row needs the meter column + gap + the widest right
 // head. When the REAL column count can't hold that, drop the right column (the
 // same assembly the showRight=false path uses) so rows never wrap.
 const twoColMin = METER_W + visibleWidth(COL_GAP) + widestHead;
 const rightRows = right.length > 0 && realCols - 1 >= twoColMin ? right : [];
 const height = Math.max(left.length, rightRows.length);
 const SPACER = "\u200b"; // invisible, non-empty so the widget doesn't collapse it — a truly blank gap, no pipe
 const rows = [firstLine];
 if (CFG.blankLine) rows.push(CFG.spacerPipe ? `${" ".repeat(METER_W)}${COL_GAP}`.trimEnd() : SPACER);
 for (let i = 0; i < height; i++) {
  rows.push(rightRows.length > 0 ? `${padEnd(clip(left[i] ?? "", METER_W), METER_W)}${COL_GAP}${rightRows[i] ?? ""}`.trimEnd() : (left[i] ?? "").trimEnd());
 }
 // Last resort: hard-clip any row still wider than the real width (row 1 with a
 // very long cwd/model, meter rows from an oversized barCells/detailW) so no row
 // ever wraps. Rows that already fit — every wide-pane row — pass through as-is.
 for (let i = 0; i < rows.length; i++) {
  if (visibleWidth(rows[i]) > rowCols) rows[i] = clip(rows[i], rowCols);
 }
 // Trailing blank row: keeps the widget clear of the hook-status lines (e.g.
 // pi-lens "LSP Inactive") that omp renders directly beneath belowEditor widgets.
 rows.push(SPACER);

 try {
  ctx.ui.setWidget(WIDGET_KEY, rows, { placement: "belowEditor" });
  // Blank row BELOW the last hook status: the status line renders every
  // setStatus entry as its own row, sorted by key, so a ZWSP-only entry keyed
  // after the other statuses reserves one clean row under them (no omp patch).
  ctx.ui.setStatus(BELOW_SPACER_KEY, SPACER);
  mergeStatusRow(ctx);
 } catch {
  // cosmetic only — never fail the session over a statusline
 }
}

// --- ponytail on the pi-lens LSP row ---
// omp renders every setStatus entry as its own row, so ponytail's indicator
// would sit on a row of its own under "LSP Active". All extensions share ONE
// ui object, so wrap its setStatus: capture both texts, drop ponytail's own
// row, and emit one pi-lens row with ponytail in the widget's right column.
// omp collapses runs of spaces in status text, so the gap is NBSP-padded.
const LENS_KEY = "pi-lens-lsp";
const PONY_KEY = "ponytail";
const NBSP = "\u00a0";
let lensText: string | undefined;
let ponyText: string | undefined;
let lensSeen = false; // a row is only rewritten once its text came through the wrapper: never clobber unknown text
let ponySeen = false;
type SetStatus = (key: string, text: string | undefined) => void;
// Wrap each underlying ui ONCE. omp hands every handler a fresh Proxy over the
// shared ui whose get trap returns functions re-bound (runner.ts
// createHandlerUIContext), so a per-proxy WeakSet or a tag on the wrapper
// function never matched: each call wrapped the previous wrapper, the "raw"
// setter pointed back at a wrapper, and the merged-row emit recursed until
// "Maximum call stack size exceeded" (surfaced against ponytail, whose
// setStatus call entered it). The marker is a plain object, which the trap
// returns as-is, and the assignment falls through to the shared target.
const RAW_SETTER = Symbol.for("usageStatuslineRawSetStatus");

// Fallow Impact third column: cached from an async `fallow impact statusline`
// (never blocks render); failures / unexpected output hide the column.
let fallowText: string | undefined;
let fallowAt = 0;
let fallowBusy = false;
const FALLOW_BIN = Bun.which("fallow");

function refreshFallow(ctx: ExtensionContext, force: boolean): void {
 if (!FALLOW_BIN) return;
 try {
  if (fallowBusy || (!force && Date.now() - fallowAt < 60_000)) return;
  fallowBusy = true;
  fallowAt = Date.now();
  execFile(FALLOW_BIN, ["--root", ctx.cwd, "impact", "statusline"], { timeout: 5_000 }, (err, stdout) => {
   fallowBusy = false;
   try {
    const line = String(stdout ?? "").trim().split("\n")[0] ?? "";
    const next = !err && line.startsWith("fallow impact") ? line : undefined;
    // store only: the next wrapped write (pi-lens/ponytail) emits it. Emitting
    // here would resend cached lens text over a fresh unwrapped repaint.
    fallowText = next;
   } catch {
    // cosmetic only
   }
  });
 } catch {
  fallowBusy = false;
 }
}

function emitMergedRow(rawSetStatus: SetStatus): void {
 if (!lensSeen) {
  // lens row unknown: nothing to merge into; leave ponytail's row as drawn
  if (ponySeen) rawSetStatus(PONY_KEY, ponyText);
  return;
 }
 // ponytail unknown (e.g. not loaded): leave its row alone, still show fallow
 if (ponySeen) rawSetStatus(PONY_KEY, undefined);
 const cols = [ponySeen ? ponyText : undefined, fallowText].filter(Boolean).map((t) => t!.replace(/ /g, NBSP));
 if (cols.length === 0) {
  rawSetStatus(LENS_KEY, lensText);
  return;
 }
 const lens = lensText ?? "";
 // plain spacing, no │ rule: same width as COL_GAP so columns stay aligned
 const gap = NBSP.repeat(visibleWidth(COL_GAP));
 const left = lens + NBSP.repeat(Math.max(0, METER_W - visibleWidth(lens)));
 rawSetStatus(LENS_KEY, `${left}${gap}${cols.join(gap)}`);
}

function mergeStatusRow(ctx: ExtensionContext): void {
 const ui = ctx.ui as unknown as { setStatus: SetStatus;[RAW_SETTER]?: { fn: SetStatus } };
 if (!ui[RAW_SETTER]) {
  const raw = ui.setStatus.bind(ui);
  ui[RAW_SETTER] = { fn: raw };
  ui.setStatus = (key, text) => {
   if (key === LENS_KEY) {
    lensText = text;
    lensSeen = true;
   } else if (key === PONY_KEY) {
    ponyText = text;
    ponySeen = true;
   } else return raw(key, text);
   emitMergedRow(raw);
  };
 }
 // Emit ONLY on writes that come through the wrapper, never on the render tick:
 // pi-lens's onServerReady repaint may hold the unwrapped setter, and a timed
 // re-emit would overwrite its fresh "LSP Active" with cached text. A raw write
 // just shows plain LSP text until the next wrapped write (pi-lens turn_end).
}

// --- extension wiring ---

export function registerUsageStatusline(pi: ExtensionAPI): void {
 api = pi;
 let bound = false;

 const resetRuns = () => {
  spanStart = 0;
  endedSpanStart = 0;
  spanTools = 0;
  lastSpanMs = 0;
  runCount = 0;
 };

 const beginRun = (ctx: ExtensionContext) => {
  const t = computeTallies(ctx);
  spanOutput = t.outputTokens;
  spanCost = t.meteredCost;
  spanTools = 0;
  spanStart = Date.now();
  runCount += 1;
  critter = CRITTERS[(runCount - 1) % CRITTERS.length];
 };

 pi.on("session_start", async (_event, ctx) => {
  latest = ctx;
  resetRuns();
  refreshUsage(ctx);
  render(ctx);
  refreshFallow(ctx, true);
  if (!bound) {
   bound = true;
   const timer = ctx.setInterval(() => {
    if (!latest) return;
    refreshUsage(latest);
    render(latest);
    refreshFallow(latest, false);
   }, RENDER_MS);
   pi.on("session_shutdown", () => {
    ctx.clearTimer(timer);
    try {
     ctx.ui.setStatus(BELOW_SPACER_KEY, undefined);
    } catch {
     // cosmetic only
    }
   });
  }
 });

 pi.on("session_switch", async (_event, ctx) => {
  // new session: run history resets
  resetRuns();
  latest = ctx;
  render(ctx);
 });

 pi.on("before_agent_start", async (_event, ctx) => {
  // fires once per admitted user prompt (never for retries/continuations):
  // the only true start of a run. A queued prompt admitted mid-run folds
  // into the running span.
  latest = ctx;
  if (spanStart === 0) beginRun(ctx);
  render(ctx);
 });

 pi.on("agent_start", async (_event, ctx) => {
  // fires once per agent *loop*: retries, compaction, and stop-time
  // continuations each start a new loop. Without a preceding
  // before_agent_start this is a continuation of the last run, so resume
  // that span instead of restarting the clock.
  latest = ctx;
  if (spanStart === 0) {
   if (endedSpanStart > 0) spanStart = endedSpanStart;
   else beginRun(ctx); // extension loaded mid-run
  }
  render(ctx);
 });

 pi.on("turn_end", async (event, ctx) => {
  latest = ctx;
  if (spanStart > 0) spanTools += event.toolResults?.length ?? 0;
  render(ctx);
 });

 pi.on("agent_end", async (event, ctx) => {
  latest = ctx;
  // willContinue: a continuation is already scheduled — not a settle
  if (!event.willContinue && spanStart > 0) {
   lastSpanMs = Date.now() - spanStart;
   endedSpanStart = spanStart;
   spanStart = 0;
  }
  render(ctx);
  refreshFallow(ctx, true);
 });

 pi.on("message_end", async (_event, ctx) => {
  // usage landed; the tick picks it up — keep the freshest ctx around
  latest = ctx;
 });
}
