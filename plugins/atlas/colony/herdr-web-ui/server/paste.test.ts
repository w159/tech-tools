import { afterEach, describe, expect, it } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { pasteDirectory } from "./paste.ts";

describe("pasteDirectory", () => {
  const previous = process.env["HERDR_WEB_PASTE_DIR"];
  afterEach(() => {
    if (previous === undefined) delete process.env["HERDR_WEB_PASTE_DIR"]; else process.env["HERDR_WEB_PASTE_DIR"] = previous;
  });

  it("keeps attachments next to the pane, or in the temp dir without a cwd", () => {
    delete process.env["HERDR_WEB_PASTE_DIR"];
    expect(pasteDirectory("/work/repo")).toBe(join("/work/repo", ".herdr-web-ui"));
    expect(pasteDirectory(null)).toBe(join(tmpdir(), "herdr-web-ui", ".herdr-web-ui"));
  });

  it("uses HERDR_WEB_PASTE_DIR for every pane when set, as an absolute path", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "/var/tmp/pastes";
    expect(pasteDirectory("/work/repo")).toBe(resolve("/var/tmp/pastes"));
    expect(pasteDirectory(undefined)).toBe(resolve("/var/tmp/pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "pastes";
    expect(pasteDirectory("/work/repo")).toBe(resolve("pastes"));
  });

  it("expands a leading ~ to the home directory", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "~/pastes";
    expect(pasteDirectory("/work/repo")).toBe(join(homedir(), "pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "~";
    expect(pasteDirectory("/work/repo")).toBe(homedir());
    process.env["HERDR_WEB_PASTE_DIR"] = "~/";
    expect(pasteDirectory("/work/repo")).toBe(homedir());
  });

  it("stays under the home directory with a doubled or a Windows separator after ~", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "~//pastes";
    expect(pasteDirectory("/work/repo")).toBe(join(homedir(), "pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "~\\pastes";
    expect(pasteDirectory("/work/repo")).toBe(join(homedir(), "pastes"));
    // a name that only starts with ~ is a folder of that name, not the home directory
    process.env["HERDR_WEB_PASTE_DIR"] = "~pastes";
    expect(pasteDirectory("/work/repo")).toBe(resolve("~pastes"));
  });

  it("ignores spaces around the value, and a value of only spaces", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "  /var/tmp/pastes  ";
    expect(pasteDirectory("/work/repo")).toBe(resolve("/var/tmp/pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "   ";
    expect(pasteDirectory("/work/repo")).toBe(join("/work/repo", ".herdr-web-ui"));
  });

  it("treats an empty HERDR_WEB_PASTE_DIR as unset", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "";
    expect(pasteDirectory("/work/repo")).toBe(join("/work/repo", ".herdr-web-ui"));
  });
});
