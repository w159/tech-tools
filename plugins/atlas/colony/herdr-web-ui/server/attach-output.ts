/** herdr 0.9's terminal teardown immediately before its own stderr diagnostic. */
const TEARDOWN = "\x1b[?1049l\x1b[?25h\x1b[0 q";
const TAKEN = TEARDOWN + "herdr: server shut down: terminal attach taken over";

/** The attach's own final diagnostic, not these words in the pane's screen. */
export function isTakeoverExit(output: string): boolean {
  return output.trimEnd().endsWith(TAKEN);
}

/**
 * Hold only a possible trailing takeover diagnostic until exit confirms it. Everything else
 * passes through unchanged, including the same words in the pane's normal screen output.
 */
export class AttachOutputTail {
  private tail = "";

  get pending(): boolean { return this.tail.length > 0; }

  push(data: string): string {
    const text = this.tail + data;
    this.tail = "";
    const full = text.lastIndexOf(TAKEN);
    if (full !== -1 && /^[\r\n]{0,4}$/.test(text.slice(full + TAKEN.length))) {
      this.tail = text.slice(full);
      return text.slice(0, full);
    }
    // Reads may split at any byte in the teardown or diagnostic, including the first ESC.
    for (let length = Math.min(text.length, TAKEN.length - 1); length > 0; length--) {
      if (text.endsWith(TAKEN.slice(0, length))) {
        this.tail = text.slice(-length);
        return text.slice(0, -length);
      }
    }
    return text;
  }

  flush(taken = false): string {
    const data = taken && this.tail.startsWith(TAKEN) ? TEARDOWN : this.tail;
    this.tail = "";
    return data;
  }
}
