// Test preload (bunfig.toml): inert window/document defaults for dashboard modules that touch the DOM while they
// are evaluated (api.js, ui-overlays.js, herdr-actions.js, ...). bun runs every test file in one process, so without
// this a file's static imports only work when an earlier file happened to leave a DOM global behind (order-dependent,
// fails under --randomize). Files that need a real stub still assign their own globalThis.window/document over these.
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    hidden: false,
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
}
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421", search: "", hash: "" },
  };
}
