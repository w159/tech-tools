/**
 * The host's side of the Atlas Command Center frame (`/atlas/#/herdr` frames `/?chrome=full`
 * from the same origin). Everything here is same-origin only: a parent on another origin
 * neither receives the host's messages nor is believed.
 */

/** This window sits inside another page. */
export const FRAMED: boolean = typeof window !== "undefined" && window.self !== window.top;

/**
 * The legacy `?embed=1` entry is gone: with a pane it is the chrome-less pane frame, without
 * one the full host. The address is rewritten in place, nothing reloads.
 */
export function retireEmbedParam(search: string): string | null {
  const query = new URLSearchParams(search);
  if (query.get("embed") !== "1" || query.has("chrome")) return null;
  query.delete("embed");
  query.set("chrome", query.get("pane") ? "pane" : "full");
  return `?${query.toString()}`;
}

/** `?chrome=full` only means the rail-less host inside the Command Center frame: a top-level visit keeps the normal UI. */
export function isChromeFull(search: string, framed: boolean): boolean {
  return framed && new URLSearchParams(search).get("chrome") === "full";
}

/** Messages to the parent page, delivered only if it shares this origin. */
export function postToParent(message: { type: "herdr:selected-pane"; pane_id: string | null; machine_id: string } | { type: "herdr:attention"; count: number }): void {
  if (!FRAMED) return;
  try { window.parent.postMessage(message, window.location.origin); } catch { /* a detached parent */ }
}

export type ParentMessage =
  | { type: "atlas:theme"; theme: "dark" | "light" }
  | { type: "atlas:select-pane"; pane_id: string; machine_id: string | null };

/** The parent's messages: only from the parent window, and only from this origin. */
export function parseParentMessage(event: Pick<MessageEvent, "origin" | "source" | "data">, origin: string, parent: unknown): ParentMessage | null {
  if (event.origin !== origin || event.source !== parent) return null;
  const data = event.data as { type?: unknown; theme?: unknown; pane_id?: unknown; machine_id?: unknown } | null;
  if (data?.type === "atlas:theme" && (data.theme === "dark" || data.theme === "light")) return { type: "atlas:theme", theme: data.theme };
  if (data?.type === "atlas:select-pane" && typeof data.pane_id === "string") {
    return { type: "atlas:select-pane", pane_id: data.pane_id, machine_id: typeof data.machine_id === "string" ? data.machine_id : null };
  }
  return null;
}

/** Listen to the parent; returns the unsubscribe. */
export function onParentMessage(handler: (message: ParentMessage) => void): () => void {
  if (!FRAMED) return () => undefined;
  const listener = (event: MessageEvent): void => {
    const message = parseParentMessage(event, window.location.origin, window.parent);
    if (message) handler(message);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
