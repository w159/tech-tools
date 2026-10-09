import { expect, it } from "bun:test";
import { headerCrumb, showsChat } from "./headerCrumb.ts";

const base = { machine: "workstation", workspace: "checkout-api", title: "Idempotent payments" };

it("leaves the folder out when the workspace already says its name", () => {
  const crumb = headerCrumb({ ...base, cwd: "/tmp/herdr-demo/checkout-api" });
  expect(crumb.folder).toBeNull();
  expect(crumb.place).toBe("workstation › checkout-api");
  expect(crumb.path).toBe("/tmp/herdr-demo/checkout-api");
});

it("shows the folder as its last name when it tells something the rest does not", () => {
  expect(headerCrumb({ ...base, cwd: "/home/me/dev/checkout-api/.worktrees/retry-flag/" }).folder).toBe("retry-flag");
  expect(headerCrumb({ ...base, cwd: "~/dev/api" }).folder).toBe("api");
  expect(headerCrumb({ ...base, cwd: "C:\\work\\site" }).folder).toBe("site");
});

it("leaves the folder out when the title or the PC already says its name", () => {
  expect(headerCrumb({ ...base, title: "api", cwd: "/home/me/dev/api" }).folder).toBeNull();
  expect(headerCrumb({ ...base, machine: "api", cwd: "/home/me/dev/api" }).folder).toBeNull();
  // a different spelling is a different name: nothing is guessed
  expect(headerCrumb({ ...base, cwd: "/home/me/dev/Checkout-API" }).folder).toBe("Checkout-API");
});

it("has no folder and no path for a pane herdr reports no folder for", () => {
  for (const cwd of [null, undefined, "", "  "]) {
    const crumb = headerCrumb({ ...base, cwd });
    expect(crumb.folder).toBeNull();
    expect(crumb.path).toBeNull();
    expect(crumb.tooltip).toBe("checkout-api › Idempotent payments");
  }
});

it("keeps the whole path for the tooltip and the menu, whatever the line shows", () => {
  const shown = headerCrumb({ ...base, cwd: "/srv/checkout/worktrees/retry-flag" });
  expect(shown.path).toBe("/srv/checkout/worktrees/retry-flag");
  expect(shown.tooltip).toBe("checkout-api › Idempotent payments · /srv/checkout/worktrees/retry-flag");
  const hidden = headerCrumb({ ...base, cwd: "/tmp/herdr-demo/checkout-api" });
  expect(hidden.tooltip).toBe("checkout-api › Idempotent payments · /tmp/herdr-demo/checkout-api");
  expect(headerCrumb({ ...base, cwd: "/" }).folder).toBe("/");
});

it("keeps a folder name that ends in a space as it is", () => {
  const crumb = headerCrumb({ ...base, cwd: "/repo/branch " });
  expect(crumb.folder).toBe("branch ");
  expect(crumb.path).toBe("/repo/branch ");
  expect(crumb.tooltip).toBe("checkout-api › Idempotent payments · /repo/branch ");
  // "branch " is not the folder "branch": the title does not say it
  expect(headerCrumb({ ...base, title: "branch", cwd: "/repo/branch " }).folder).toBe("branch ");
});

it("takes the chat's surface only when the chat is what the pane column draws", () => {
  expect(showsChat({}, "chat")).toBe(true);
  expect(showsChat({ restore_error: null }, "chat")).toBe(true);
  expect(showsChat({}, "terminal")).toBe(false);
  expect(showsChat(null, "chat")).toBe(false);
  // a pane herdr could not restore draws the placeholder on the terminal's surface, not the chat
  expect(showsChat({ restore_error: "no such session" }, "chat")).toBe(false);
});
