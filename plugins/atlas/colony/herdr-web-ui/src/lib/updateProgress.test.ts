import { describe, expect, it } from "bun:test";

import { describeUpdate } from "./updateProgress.ts";

describe("app update progress", () => {
  it("says the step and how far along the install is", () => {
    expect(describeUpdate({ phase: "building", step: "download" })).toEqual({ step: "Step 1 of 5", label: "Downloading the update", percent: 10 });
    expect(describeUpdate({ phase: "building", step: "build" })).toEqual({ step: "Step 4 of 5", label: "Building the app", percent: 70 });
    expect(describeUpdate({ phase: "restarting", step: "restart" })).toEqual({ step: "Step 5 of 5", label: "Restarting the app", percent: 90 });
  });

  it("has nothing to say outside an install, or for a server that names no step", () => {
    expect(describeUpdate(null)).toBeNull();
    expect(describeUpdate({ phase: "idle", step: null })).toBeNull();
    expect(describeUpdate({ phase: "checking", step: "download" })).toBeNull();
    expect(describeUpdate({ phase: "building" })).toBeNull();
  });
});
