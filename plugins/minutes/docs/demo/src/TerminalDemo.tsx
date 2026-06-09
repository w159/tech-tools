import { AbsoluteFill, useCurrentFrame, interpolate, Sequence } from "remotion";

// ── Terminal colors ──────────────────────────────────────────
const BG = "#1e1e2e";
const FG = "#cdd6f4";
const GREEN = "#a6e3a1";
const BLUE = "#89b4fa";
const YELLOW = "#f9e2af";
const DIM = "#6c7086";
const TEAL = "#94e2d5";
const PINK = "#f5c2e7";

// ── Typing animation ────────────────────────────────────────
function typeText(text: string, frame: number, startFrame: number, charsPerFrame = 1.5): string {
  const elapsed = Math.max(0, frame - startFrame);
  const chars = Math.min(text.length, Math.floor(elapsed * charsPerFrame));
  return text.slice(0, chars);
}

function isTypingDone(text: string, frame: number, startFrame: number, charsPerFrame = 1.5): boolean {
  const elapsed = Math.max(0, frame - startFrame);
  return Math.floor(elapsed * charsPerFrame) >= text.length;
}

// ── Cursor ───────────────────────────────────────────────────
const Cursor: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 18,
        backgroundColor: FG,
        marginLeft: 1,
        animation: "none",
        opacity: 1,
      }}
    />
  );
};

// ── Line components ──────────────────────────────────────────
const Prompt: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span>
    <span style={{ color: GREEN }}>$</span>{" "}
    <span style={{ color: FG }}>{children}</span>
  </span>
);

const OutputLine: React.FC<{
  children: React.ReactNode;
  color?: string;
  indent?: number;
}> = ({ children, color = FG, indent = 0 }) => (
  <div style={{ color, paddingLeft: indent * 16 }}>
    {children}
  </div>
);

// ── Main composition ────────────────────────────────────────
export const TerminalDemo: React.FC = () => {
  const frame = useCurrentFrame();

  // ── Scene timing (frames at 30fps) ──
  const SCENE_1_START = 0;       // Type: minutes record
  const SCENE_1_OUTPUT = 30;     // Show recording output
  const SCENE_2_START = 100;     // Type: minutes stop
  const SCENE_2_OUTPUT = 130;    // Show processing output
  const SCENE_3_START = 220;     // Type: minutes search "pricing"
  const SCENE_3_OUTPUT = 270;    // Show search results
  const SCENE_4_START = 340;     // Type: minutes actions
  const SCENE_4_OUTPUT = 375;    // Show action items
  const FADE_OUT = 430;

  const opacity = frame >= FADE_OUT
    ? interpolate(frame, [FADE_OUT, 450], [1, 0])
    : interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  const cmd1 = 'minutes record --context "Q2 pricing with Alex"';
  const cmd2 = "minutes stop";
  const cmd3 = 'minutes search "pricing"';
  const cmd4 = "minutes actions --assignee mat";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
        fontSize: 14,
        lineHeight: 1.6,
        padding: 24,
        opacity,
      }}
    >
      {/* ── Window chrome ── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#ff5f57" }} />
        <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#febc2e" }} />
        <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#28c840" }} />
        <span style={{ color: DIM, fontSize: 12, marginLeft: 8 }}>Terminal — minutes</span>
      </div>

      {/* ── Scene 1: Record ── */}
      <Sequence from={SCENE_1_START}>
        <div>
          <Prompt>
            {typeText(cmd1, frame, SCENE_1_START)}
            <Cursor visible={!isTypingDone(cmd1, frame, SCENE_1_START) && frame < SCENE_1_OUTPUT} />
          </Prompt>
        </div>
      </Sequence>

      {frame >= SCENE_1_OUTPUT && (
        <div>
          <OutputLine color={TEAL}>Recording... (Ctrl-C or `minutes stop` to finish)</OutputLine>
          <OutputLine color={DIM} indent={1}>Tip: add notes with `minutes note "your note"`</OutputLine>
          {frame >= SCENE_1_OUTPUT + 15 && (
            <OutputLine color={DIM}>
              <span style={{ color: YELLOW }}>&#9679;</span> 00:{String(Math.min(42, Math.floor((frame - SCENE_1_OUTPUT - 15) * 0.7))).padStart(2, "0")} recording
            </OutputLine>
          )}
        </div>
      )}

      {/* ── Scene 2: Stop ── */}
      {frame >= SCENE_2_START && (
        <div style={{ marginTop: 8 }}>
          <Prompt>
            {typeText(cmd2, frame, SCENE_2_START)}
            <Cursor visible={!isTypingDone(cmd2, frame, SCENE_2_START) && frame < SCENE_2_OUTPUT} />
          </Prompt>
        </div>
      )}

      {frame >= SCENE_2_OUTPUT && (
        <div>
          <OutputLine color={FG}>Stopping recording...</OutputLine>
          {frame >= SCENE_2_OUTPUT + 10 && (
            <OutputLine color={TEAL}>Transcribing{".".repeat(Math.min(5, Math.floor((frame - SCENE_2_OUTPUT - 10) / 5)))}</OutputLine>
          )}
          {frame >= SCENE_2_OUTPUT + 40 && (
            <OutputLine color={GREEN}>
              Saved: ~/meetings/2026-03-17-q2-pricing-discussion-with-alex.md
            </OutputLine>
          )}
        </div>
      )}

      {/* ── Scene 3: Search ── */}
      {frame >= SCENE_3_START && (
        <div style={{ marginTop: 8 }}>
          <Prompt>
            {typeText(cmd3, frame, SCENE_3_START)}
            <Cursor visible={!isTypingDone(cmd3, frame, SCENE_3_START) && frame < SCENE_3_OUTPUT} />
          </Prompt>
        </div>
      )}

      {frame >= SCENE_3_OUTPUT && (
        <div>
          <OutputLine color={BLUE}>2026-03-17 — Q2 Pricing Discussion with Alex</OutputLine>
          <OutputLine color={DIM} indent={1}>
            [4:20] I think monthly billing makes more sense for independent advisors...
          </OutputLine>
        </div>
      )}

      {/* ── Scene 4: Actions ── */}
      {frame >= SCENE_4_START && (
        <div style={{ marginTop: 8 }}>
          <Prompt>
            {typeText(cmd4, frame, SCENE_4_START)}
            <Cursor visible={!isTypingDone(cmd4, frame, SCENE_4_START) && frame < SCENE_4_OUTPUT} />
          </Prompt>
        </div>
      )}

      {frame >= SCENE_4_OUTPUT && (
        <div>
          <OutputLine color={YELLOW}>Open action items (2):</OutputLine>
          <OutputLine color={PINK} indent={1}>@mat: Send pricing doc (by Friday)</OutputLine>
          <OutputLine color={DIM} indent={2}>from: Q2 Pricing Discussion with Alex</OutputLine>
          <OutputLine color={PINK} indent={1}>@mat: Set up monthly billing experiment</OutputLine>
          <OutputLine color={DIM} indent={2}>from: Q2 Pricing Discussion with Alex</OutputLine>
        </div>
      )}
    </AbsoluteFill>
  );
};
