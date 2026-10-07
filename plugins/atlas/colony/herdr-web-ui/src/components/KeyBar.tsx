import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { Keyboard } from "lucide-react";

import "./KeyBar.css";

import type { KeyBarExtra, KeyBarKey } from "../lib/keys.ts";
import { useT } from "../lib/i18n.ts";

export type { KeyBarKey };

export interface KeyBarProps {
  disabled?: boolean;
  /** Fires for every key except Control, which toggles the one-shot modifier instead. */
  onKey: (key: KeyBarKey) => void;
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
  altArmed: boolean;
  onToggleAlt: () => void;
  /** the optional keys chosen in Settings, drawn in their fixed places */
  extras: readonly KeyBarExtra[];
  /** on a touch screen: whether the keyboard types straight into the terminal (else the input line) */
  directTyping?: boolean;
  onToggleDirect?: () => void;
}

/**
 * Cancelling pointerdown AND mousedown keeps focus, and with it the soft
 * keyboard, on xterm's textarea; the click still fires.
 */
function keepFocus(event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

interface KeyProps {
  disabled?: boolean;
  dataKey: string;
  label?: string;
  pressed?: boolean;
  onPress: () => void;
  children: ReactNode;
}

function Key({ dataKey, label, pressed, onPress, children, disabled }: KeyProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`key${pressed ? " is-armed" : ""}`}
      data-key={dataKey}
      aria-label={label}
      aria-pressed={pressed}
      tabIndex={-1}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

type Direction = "up" | "down" | "left" | "right";

const CHEVRON: Record<Direction, string> = {
  up: "M5 12.5l5-5 5 5",
  down: "M5 7.5l5 5 5-5",
  left: "M12.5 5l-5 5 5 5",
  right: "M7.5 5l5 5-5 5",
};

function Chevron({ direction }: { direction: Direction }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CHEVRON[direction]} />
    </svg>
  );
}

export const ARROWS: ReadonlyArray<{ key: KeyBarKey; label: string; direction: Direction }> = [
  { key: "ArrowUp", label: "Up", direction: "up" },
  { key: "ArrowDown", label: "Down", direction: "down" },
  { key: "ArrowLeft", label: "Left", direction: "left" },
  { key: "ArrowRight", label: "Right", direction: "right" },
];

/** Settings' name for each optional key: its cap, and a spoken name where the cap does not read as one. */
export const EXTRA_KEY_CAPS: Record<KeyBarExtra, { cap: string; label?: string }> = {
  alt: { cap: "Alt" },
  "shift-tab": { cap: "⇧Tab", label: "Shift Tab" },
  "home-end": { cap: "Home End" },
  "page-up-down": { cap: "PgUp PgDn", label: "Page up and Page down" },
  "ctrl-d": { cap: "^D", label: "Control D" },
  "ctrl-z": { cap: "^Z", label: "Control Z" },
  pipe: { cap: "|" },
  tilde: { cap: "~" },
  slash: { cap: "/" },
};

/**
 * Touch key bar under the terminal. Keys are tabIndex -1 on purpose: they exist
 * for touch, a hardware keyboard already has all of them. Hence role="group", not
 * toolbar: a toolbar promises arrow-key navigation between items, which these skip.
 */
export function KeyBar({ onKey, ctrlArmed, onToggleCtrl, altArmed, onToggleAlt, extras, directTyping, onToggleDirect, disabled }: KeyBarProps) {
  const t = useT();
  const has = (extra: KeyBarExtra): boolean => extras.includes(extra);
  return (
    <div className="key-bar" role="group" aria-label={t("Terminal keys")}>
      {/* first: on a narrow cover screen the row scrolls, and the mode toggle must not be the key cut off */}
      {onToggleDirect && (
        <Key disabled={disabled} dataKey="direct" label={t("Type straight into the terminal")} pressed={directTyping} onPress={onToggleDirect}>
          <Keyboard aria-hidden="true" />
        </Key>
      )}
      <Key disabled={disabled} dataKey="Escape" onPress={() => onKey("Escape")}>
        Esc
      </Key>
      <Key disabled={disabled} dataKey="Tab" onPress={() => onKey("Tab")}>
        Tab
      </Key>
      {has("shift-tab") && (
        <Key disabled={disabled} dataKey="BackTab" label={t("Shift Tab")} onPress={() => onKey("BackTab")}>
          ⇧Tab
        </Key>
      )}
      <Key disabled={disabled} dataKey="Control" pressed={ctrlArmed} onPress={onToggleCtrl}>
        Ctrl
      </Key>
      {has("alt") && (
        <Key disabled={disabled} dataKey="Alt" pressed={altArmed} onPress={onToggleAlt}>
          Alt
        </Key>
      )}
      {ARROWS.map((arrow) => (
        <Key disabled={disabled} key={arrow.key} dataKey={arrow.key} label={t(arrow.label)} onPress={() => onKey(arrow.key)}>
          <Chevron direction={arrow.direction} />
        </Key>
      ))}
      {has("home-end") && (
        <>
          <Key disabled={disabled} dataKey="Home" onPress={() => onKey("Home")}>Home</Key>
          <Key disabled={disabled} dataKey="End" onPress={() => onKey("End")}>End</Key>
        </>
      )}
      {has("page-up-down") && (
        <>
          <Key disabled={disabled} dataKey="PageUp" label={t("Page up")} onPress={() => onKey("PageUp")}>PgUp</Key>
          <Key disabled={disabled} dataKey="PageDown" label={t("Page down")} onPress={() => onKey("PageDown")}>PgDn</Key>
        </>
      )}
      <Key disabled={disabled} dataKey="ctrl-c" label={t("Control C")} onPress={() => onKey("ctrl-c")}>
        ^C
      </Key>
      {has("ctrl-d") && <Key disabled={disabled} dataKey="ctrl-d" label={t("Control D")} onPress={() => onKey("ctrl-d")}>^D</Key>}
      {has("ctrl-z") && <Key disabled={disabled} dataKey="ctrl-z" label={t("Control Z")} onPress={() => onKey("ctrl-z")}>^Z</Key>}
      {has("pipe") && <Key disabled={disabled} dataKey="pipe" onPress={() => onKey("pipe")}>|</Key>}
      {has("tilde") && <Key disabled={disabled} dataKey="tilde" onPress={() => onKey("tilde")}>~</Key>}
      {has("slash") && <Key disabled={disabled} dataKey="slash" onPress={() => onKey("slash")}>/</Key>}
    </div>
  );
}
