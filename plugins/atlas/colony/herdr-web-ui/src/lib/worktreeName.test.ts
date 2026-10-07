import { describe, expect, it } from "bun:test";

import { suggestWorktreeBranch, worktreeLabel } from "./worktreeName.ts";

describe("worktree name suggestion", () => {
  it("has the shape of herdr's own suggestion", () => {
    for (let run = 0; run < 200; run += 1) {
      expect(suggestWorktreeBranch()).toMatch(/^worktree\/(brave|clear|green|lucky|rapid|silver)-(river|cloud|field|forest|harbor|meadow|stone|valley)-[0-9a-f]{4}$/);
    }
  });

  it("stays inside the word lists at both ends of the random range", () => {
    expect(suggestWorktreeBranch(() => 0)).toBe("worktree/brave-river-0000");
    expect(suggestWorktreeBranch(() => 1)).toBe("worktree/silver-valley-ffff");
  });

  it("names the workspace after the branch, slashes as dashes", () => {
    expect(worktreeLabel("worktree/brave-valley-07f8")).toBe("worktree-brave-valley-07f8");
    expect(worktreeLabel(" feature/a/b ")).toBe("feature-a-b");
    expect(worktreeLabel("main")).toBe("main");
  });
});
