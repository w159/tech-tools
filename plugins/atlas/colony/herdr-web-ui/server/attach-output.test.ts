import { expect, it } from "bun:test";
import { AttachOutputTail } from "./attach-output.ts";

const teardown = "\x1b[?1049l\x1b[?25h\x1b[0 q";
const diagnostic = "herdr: server shut down: terminal attach taken over\r\n";

it("drops only the confirmed trailing diagnostic across every read boundary, keeping terminal modes", () => {
  const output = "pane output" + teardown + diagnostic;
  for (let cut = 1; cut < output.length; cut++) {
    const tail = new AttachOutputTail();
    expect(tail.push(output.slice(0, cut)) + tail.push(output.slice(cut)) + tail.flush(true)).toBe("pane output" + teardown);
  }
  const tail = new AttachOutputTail();
  expect([...output].map((byte) => tail.push(byte)).join("") + tail.flush(true)).toBe("pane output" + teardown);
});

it("preserves ordinary pane output, incomplete diagnostics and diagnostics without a takeover exit", () => {
  for (const output of [diagnostic, teardown + diagnostic + "more output", teardown + "herdr: another error", teardown + diagnostic, teardown + diagnostic + "\n".repeat(1000)]) {
    const tail = new AttachOutputTail();
    expect(tail.push(output) + tail.flush()).toBe(output);
  }
  const tail = new AttachOutputTail();
  expect(tail.push(teardown + "herdr: server shut down: term") + tail.flush(true)).toBe(teardown + "herdr: server shut down: term");
});
