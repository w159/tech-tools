import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { FolderOpen, X } from "lucide-react";

import "./NewSessionDialog.css";

import type { AgentKind } from "../../shared/protocol.ts";
import { ApiError } from "../lib/api.ts";
import { AgentPicker, rememberAgent, rememberedAgent } from "./AgentPicker.tsx";
import { DirectoryBrowser } from "./DirectoryBrowser.tsx";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { useT } from "../lib/i18n.ts";

/** The dialog as New tab: the workspace the tab joins, whose folder it uses, and the number herdr will give it. */
export interface NewTabTarget {
  workspaceId: string;
  workspaceLabel: string;
  cwd: string | null;
  number: number;
}

export interface NewSessionDialogProps {
  open: boolean;
  machineName?: string;
  defaultCwd: string | null;
  /** set, the dialog makes a tab in that workspace instead of a workspace */
  tab?: NewTabTarget | null;
  onClose: () => void;
  onCreated: (paneId: string) => void;
}

function directoryBasename(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.split("/").pop() ?? "";
}

export function NewSessionDialog({ open, defaultCwd, tab = null, onClose, onCreated, machineName }: NewSessionDialogProps) {
  const t = useT();
  const machineId = useMachineId();
  const { createTab, createWorkspace, fetchAgentKinds } = useMachineApi();
  const [agents, setAgents] = useState<AgentKind[]>([]);
  const [agentKind, setAgentKind] = useState(rememberedAgent);
  const [cwd, setCwd] = useState(defaultCwd ?? "");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPaneId, setCreatedPaneId] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const firstFieldRef = useRef<HTMLButtonElement>(null);
  const defaultCwdRef = useRef(defaultCwd);
  defaultCwdRef.current = defaultCwd;

  useEffect(() => {
    if (!open) return;
    setCwd(defaultCwdRef.current ?? "");
    setName("");
    setError(null);
    setPending(false);
    setCreatedPaneId(null);
    setBrowsing(false);
    const stored = rememberedAgent();
    setAgentKind(stored);
    let cancelled = false;
    void fetchAgentKinds()
      .then((next) => {
        if (cancelled) return;
        setAgents(next);
        if (stored && !next.some((agent) => agent.kind === stored)) setAgentKind("");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!pending) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, pending]);

  if (!open) return null;

  const selectedAgent = agents.find((agent) => agent.kind === agentKind);
  const pendingLabel = selectedAgent ? t("Starting {agent}… up to 60s", { agent: selectedAgent.label }) : t("Starting shell…");
  const fieldsDisabled = pending || createdPaneId !== null;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    if (createdPaneId !== null) { onCreated(createdPaneId); return; }
    setPending(true);
    setError(null);
    try {
      rememberAgent(agentKind);
      const agent = agentKind ? { kind: agentKind } : null;
      // a tab keeps the workspace's folder, which the dialog shows and does not ask for
      const result = tab
        ? await createTab({ workspace_id: tab.workspaceId, cwd: tab.cwd, label: name.trim() || null, agent })
        : await createWorkspace({ cwd: cwd.trim() || null, label: name.trim() || null, agent });
      if (agentKind && !result.agent_started && result.error?.message) {
        setPending(false);
        setError(result.error.message);
        setCreatedPaneId(result.pane_id);
        return;
      }
      // the dialog closes on this: left pending, its next opening would start a frame with the
      // fields disabled and Escape ignored, until the open effect's reset has rendered
      setPending(false);
      onCreated(result.pane_id);
    } catch (reason: unknown) {
      setPending(false);
      if (reason instanceof ApiError && reason.code === "invalid_cwd") setError(t("Directory not found"));
      else setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const closeFromScrim = (event: MouseEvent<HTMLDivElement>): void => {
    if (!pending && event.target === event.currentTarget) onClose();
  };

  return (
    <div className="modal-scrim new-session-scrim" onMouseDown={closeFromScrim}>
      <form className="modal new-session-modal" role="dialog" aria-modal="true" aria-labelledby="new-session-title" onSubmit={(event) => void submit(event)}>
        <header className="modal-header">
          <h2 className="modal-title" id="new-session-title">{tab ? `${t("New tab")} · ${tab.workspaceLabel}` : `${t("New workspace")} · ${machineName ?? machineId}`}</h2>
          <button type="button" className="icon-button" aria-label={t("Close dialog")} disabled={pending} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">
          <div className="field">
            <span className="field-label" id="new-session-agent">{t("Agent")}</span>
            <AgentPicker ref={firstFieldRef} agents={agents} value={agentKind} disabled={fieldsDisabled} labelledBy="new-session-agent" onChange={setAgentKind} />
          </div>
          {tab ? (
            <div className="field">
              <span className="field-label">{t("Directory")}</span>
              <div className="new-session-folder">
                <FolderOpen aria-hidden="true" />
                <span>{tab.cwd ?? tab.workspaceLabel}</span>
              </div>
              <span className="field-hint">{t("Uses the workspace's folder")}</span>
            </div>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor="new-session-cwd">{t("Directory")}</label>
              <div className="new-session-cwd">
                <input id="new-session-cwd" className="input" value={cwd} disabled={fieldsDisabled} autoComplete="off" onChange={(event) => setCwd(event.target.value)} />
                <button type="button" className="btn" aria-expanded={browsing} disabled={fieldsDisabled} onClick={() => setBrowsing((open) => !open)}>
                  <FolderOpen aria-hidden="true" />
                  {t("Browse")}
                </button>
              </div>
              {browsing && <DirectoryBrowser start={cwd} onPick={(picked) => { setCwd(picked); setBrowsing(false); }} />}
              <span className="field-hint">{t("absolute path or ~/…")}</span>
            </div>
          )}
          <label className="field">
            <span className="field-label">{t("Name")}</span>
            <input
              className="input"
              value={name}
              disabled={fieldsDisabled}
              autoComplete="off"
              placeholder={tab ? String(tab.number) : directoryBasename(cwd)}
              onChange={(event) => setName(event.target.value)}
            />
            <span className="field-hint">{t(tab ? "Tab name (optional)" : "Optional workspace label")}</span>
          </label>
          {pending && <p className="new-session-note" role="status">{pendingLabel}</p>}
          {error && <p className="field-hint new-session-error" role="alert">{error}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>{t(pending ? "Starting…" : createdPaneId !== null ? "Open" : "Start")}</button>
        </footer>
      </form>
    </div>
  );
}
