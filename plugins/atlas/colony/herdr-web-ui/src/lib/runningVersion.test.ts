import { describe, expect, test } from "bun:test";
import { runningAppVersion, runningHerdrVersion, staleClientVersion, versionLabel } from "./runningVersion.ts";

describe("versionLabel", () => {
  test("names the version and the commit's first twelve characters", () => {
    expect(versionLabel("0.3.49", "1c4ad6a0e5021234abcd")).toBe("v0.3.49 (1c4ad6a0e502)");
    expect(versionLabel("0.3.49", null)).toBe("v0.3.49");
    expect(versionLabel(null, "1c4ad6a0e5021234abcd")).toBe("1c4ad6a0e502");
    expect(versionLabel(null, null)).toBeNull();
  });
});

describe("runningAppVersion", () => {
  test("is the server's version and commit when it names them", () => {
    expect(runningAppVersion({ current_version: "0.3.49", current_revision: "1c4ad6a0e5021234abcd" }, "0.3.48")).toBe("v0.3.49 (1c4ad6a0e502)");
  });

  test("keeps the client's own build beside the commit from a server that names no version", () => {
    expect(runningAppVersion({ current_version: null, current_revision: "1c4ad6a0e5021234abcd" }, "0.3.48")).toBe("v0.3.48 (1c4ad6a0e502)");
    expect(staleClientVersion({ current_version: null }, "0.3.48")).toBeNull();
  });

  test("is the server's version without a commit, as an install outside git answers", () => {
    expect(runningAppVersion({ current_version: "0.3.49", current_revision: null }, "0.3.48")).toBe("v0.3.49");
  });

  test("is the client's own build before the server answers and when it names nothing", () => {
    expect(runningAppVersion(null, "0.3.48")).toBe("v0.3.48");
    expect(runningAppVersion({ current_version: null, current_revision: null }, "0.3.48")).toBe("v0.3.48");
  });
});

describe("runningHerdrVersion", () => {
  test("is the running server's, then the installed binary's", () => {
    expect(runningHerdrVersion({ server_version: "0.9.3", binary_version: "0.9.4" }, "0.9.0")).toBe("0.9.3");
    expect(runningHerdrVersion({ server_version: null, binary_version: "0.9.4" }, "0.9.0")).toBe("0.9.4");
  });

  test("is the health check's where the update status names none", () => {
    expect(runningHerdrVersion({ server_version: null, binary_version: null }, "0.9.0")).toBe("0.9.0");
    expect(runningHerdrVersion(null, "0.9.0")).toBe("0.9.0");
  });

  test("is nothing when herdr has not said", () => {
    expect(runningHerdrVersion(null, null)).toBeNull();
    expect(runningHerdrVersion({ server_version: null, binary_version: null }, null)).toBeNull();
  });
});

describe("staleClientVersion", () => {
  test("names this tab's build while the server runs another version", () => {
    expect(staleClientVersion({ current_version: "0.3.50" }, "0.3.49")).toBe("v0.3.49");
  });

  test("is nothing when both run the same version, or the server names none", () => {
    expect(staleClientVersion({ current_version: "0.3.49" }, "0.3.49")).toBeNull();
    expect(staleClientVersion({ current_version: null }, "0.3.49")).toBeNull();
    expect(staleClientVersion(null, "0.3.49")).toBeNull();
  });
});
