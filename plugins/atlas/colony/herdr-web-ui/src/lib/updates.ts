import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateCommand, UpdateStatus } from "../../shared/update.ts";
import { fetchUpdateStatus, requestUpdate } from "./api.ts";
import { usePageVisible } from "./visibility.ts";

declare const __APP_REVISION__: string | null;

export function useUpdates(enabled: boolean) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // the component's own lifetime, not the poll's: a page hidden while the request is on its way
  // (a phone app sent to the background) stops the poll, and the answer must still land, or
  // the buttons stay disabled until the next sign-in
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // a hidden page keeps the last status and polls again once it is back
  const visible = usePageVisible();
  useEffect(() => {
    if (!enabled) { setStatus(null); setPending(false); setError(null); return; }
    if (!visible) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function poll() {
      let delay = 2000;
      try {
        const next = await fetchUpdateStatus();
        if (!stopped) setStatus((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        if (next.phase === "idle" && !next.available) delay = 30_000;
      } catch { /* a restart/offline period must not erase the last known status */ }
      if (!stopped) timer = setTimeout(() => void poll(), delay);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled, refresh, visible]);

  const request = useCallback(async (command: UpdateCommand) => {
    setPending(true); setError(null);
    try {
      await requestUpdate(command);
      if (mounted.current) {
        setStatus(previous => previous ? { ...previous, phase: "checking", error: null } : previous);
        setRefresh(value => value + 1);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally { if (mounted.current) setPending(false); }
  }, []);
  const busy = pending || status?.phase === "checking" || status?.phase === "building" || status?.phase === "restarting";
  const needsReload = typeof __APP_REVISION__ === "string" && !!status?.current_revision &&
    __APP_REVISION__ !== status.current_revision && !busy;
  return { status, error, busy, needsReload, request };
}

export type UpdatesModel = ReturnType<typeof useUpdates>;
