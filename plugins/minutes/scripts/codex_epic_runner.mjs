#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const DEFAULT_CODEX_BIN = "codex";

function emitNudgeStatus(payload) {
  const enrichedPayload = {
    ...payload,
    timestamp: new Date().toISOString(),
  };
  const encoded = JSON.stringify(enrichedPayload);
  console.log(`NUDGE_STATUS ${encoded}`);

  const statusFile = process.env.NUDGE_STATUS_FILE;
  if (statusFile) {
    mkdirSync(dirname(statusFile), { recursive: true });
    writeFileSync(statusFile, encoded);
  }
}

export function buildIssueMaps(issues) {
  const byId = new Map();
  const childrenByParent = new Map();

  for (const issue of issues) {
    byId.set(issue.id, issue);

    if (!issue.parent) continue;
    const children = childrenByParent.get(issue.parent) ?? [];
    children.push(issue.id);
    childrenByParent.set(issue.parent, children);
  }

  return { byId, childrenByParent };
}

export function collectDescendantIds(rootId, childrenByParent) {
  const descendants = new Set();
  const queue = [...(childrenByParent.get(rootId) ?? [])];

  while (queue.length > 0) {
    const issueId = queue.shift();
    if (descendants.has(issueId)) continue;

    descendants.add(issueId);
    for (const childId of childrenByParent.get(issueId) ?? []) {
      queue.push(childId);
    }
  }

  return descendants;
}

function compareIssues(left, right) {
  const leftPriority = Number(left.priority ?? 99);
  const rightPriority = Number(right.priority ?? 99);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftCreated = Date.parse(left.created_at ?? "");
  const rightCreated = Date.parse(right.created_at ?? "");
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }

  return left.id.localeCompare(right.id);
}

export function selectReadyLeafIssues({ epicId, allIssues, readyIssues }) {
  const { byId, childrenByParent } = buildIssueMaps(allIssues);
  if (!byId.has(epicId)) {
    throw new Error(`Unknown epic: ${epicId}`);
  }

  const descendants = collectDescendantIds(epicId, childrenByParent);

  return readyIssues
    .filter((issue) => descendants.has(issue.id))
    .filter((issue) => issue.issue_type !== "epic")
    .sort(compareIssues);
}

export function summarizeEpicState({ epicId, allIssues, readyIssues }) {
  const { byId, childrenByParent } = buildIssueMaps(allIssues);
  if (!byId.has(epicId)) {
    throw new Error(`Unknown epic: ${epicId}`);
  }

  const descendants = collectDescendantIds(epicId, childrenByParent);
  const readyIds = new Set(readyIssues.map((issue) => issue.id));
  const descendantIssues = [...descendants].map((id) => byId.get(id)).filter(Boolean);
  const actionable = descendantIssues.filter((issue) => issue.issue_type !== "epic");
  const unfinished = actionable.filter((issue) => issue.status !== "closed");
  const inProgress = unfinished.filter((issue) => issue.status === "in_progress").sort(compareIssues);
  const ready = unfinished.filter((issue) => readyIds.has(issue.id)).sort(compareIssues);
  const blockedOrWaiting = unfinished
    .filter((issue) => issue.status !== "in_progress" && !readyIds.has(issue.id))
    .sort(compareIssues);

  return {
    unfinished,
    inProgress,
    ready,
    blockedOrWaiting,
  };
}

export function deriveWaitState(summary) {
  if (summary.unfinished.length === 0) {
    return {
      state: "complete",
      reason: "all actionable descendant beads are closed",
    };
  }

  if (summary.blockedOrWaiting.length > 0) {
    return {
      state: "waiting_blocked",
      reason: "remaining descendant beads are blocked or otherwise not ready",
    };
  }

  return {
    state: "waiting_no_ready",
    reason: "another descendant bead is already in progress",
  };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    input: options.input,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function runJson(command, args, options = {}) {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${command} ${args.join(" ")}: ${error.message}`);
  }
}

function readPromptAppend(pathValue) {
  if (!pathValue) return "";
  const resolved = resolve(pathValue);
  if (!existsSync(resolved)) {
    throw new Error(`Prompt file not found: ${resolved}`);
  }
  return readFileSync(resolved, "utf8").trim();
}

function formatIssueForPrompt(issue) {
  const lines = [
    `Issue ID: ${issue.id}`,
    `Title: ${issue.title}`,
    `Type: ${issue.issue_type}`,
    `Priority: ${issue.priority}`,
  ];

  if (issue.description) {
    lines.push("Description:");
    lines.push(issue.description.trim());
  }

  if (issue.acceptance_criteria) {
    lines.push("Acceptance criteria:");
    lines.push(issue.acceptance_criteria.trim());
  }

  return lines.join("\n");
}

export function buildPrompt({ epic, issue, promptAppend = "" }) {
  const basePrompt = [
    `You are working inside bd epic ${epic.id}: ${epic.title}`,
    "",
    "Focus only on this single child bead for this invocation. The outer epic runner will decide whether to continue to another bead after you exit.",
    "",
    "Current bead:",
    formatIssueForPrompt(issue),
    "",
    "Execution rules:",
    "- Use bd as the source of truth for issue state and dependencies.",
    "- Implement the work, run the right verification, and update any code/docs/tests needed for this bead.",
    "- If the bead is fully complete, close it in bd with a clear reason before finishing.",
    "- If you discover additional follow-up work, create linked bd issues instead of leaving TODOs in prose.",
    "- If the bead is blocked, ambiguous, or needs a human decision, leave it open and explain the blocker clearly in your final message.",
    "- Do not start a different bead on your own, even if you notice another ready issue.",
    "",
    "Final message contract:",
    `- If you closed the bead, include: BEAD_CLOSED: ${issue.id}`,
    `- If you are blocked, include: BEAD_BLOCKED: ${issue.id} <short reason>`,
    `- If you need human input, include: BEAD_NEEDS_HUMAN: ${issue.id} <short reason>`,
  ];

  if (promptAppend) {
    basePrompt.push("", "Additional operator instructions:", promptAppend);
  }

  return `${basePrompt.join("\n")}\n`;
}

function printUsage() {
  console.log(`Usage: node scripts/codex_epic_runner.mjs <epic-id> [options] [-- <codex exec args...>]

Options:
  --dry-run             Show the next ready issue order without running Codex
  --max-issues <n>      Stop after closing at most <n> descendant beads
  --codex-bin <path>    Codex executable to run (default: codex)
  --taskmaster          Prefer codex-taskmaster as the executable
  --prompt-file <path>  Append extra instructions to every child-bead prompt
  --no-claim            Do not claim the selected bead before invoking Codex
  --help                Show this help

Examples:
  node scripts/codex_epic_runner.mjs minutes-ylql.2 -- --full-auto
  node scripts/codex_epic_runner.mjs minutes-ylql.2 --taskmaster -- --sandbox danger-full-access -a never
  node scripts/codex_epic_runner.mjs minutes-ylql --dry-run
`);
}

function claimIssue(issueId) {
  const result = runCommand("bd", ["update", issueId, "--claim", "--json"]);
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(`Failed to claim ${issueId}: ${stderr}`);
  }
}

function fetchIssue(issueId) {
  const payload = runJson("bd", ["show", issueId, "--json"]);
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  return payload[0];
}

function fetchAllIssues() {
  return runJson("bd", ["list", "--all", "--json", "--limit", "0"]);
}

function fetchReadyIssues() {
  return runJson("bd", ["ready", "--json"]);
}

function describeIssue(issue) {
  return `${issue.id} [P${issue.priority}] ${issue.title}`;
}

function resolveCodexBin(options) {
  if (options.taskmaster && options.codexBin) {
    throw new Error("Choose either --taskmaster or --codex-bin, not both.");
  }

  if (options.taskmaster) return "codex-taskmaster";
  return options.codexBin || process.env.CODEX_EPIC_CODEX_BIN || DEFAULT_CODEX_BIN;
}

function printPauseSummary(epic, summary) {
  console.log(`No ready descendant beads remain under ${epic.id} (${epic.title}).`);

  if (summary.inProgress.length > 0) {
    console.log("");
    console.log("In progress:");
    for (const issue of summary.inProgress.slice(0, 5)) {
      console.log(`- ${describeIssue(issue)}`);
    }
  }

  if (summary.blockedOrWaiting.length > 0) {
    console.log("");
    console.log("Open but not ready:");
    for (const issue of summary.blockedOrWaiting.slice(0, 8)) {
      console.log(`- ${describeIssue(issue)} (${issue.status})`);
    }
  }

  if (summary.unfinished.length === 0) {
    console.log("");
    console.log(`All actionable descendants are closed. If the epic should close too, run: bd epic close-eligible --json`);
  }
}

function main() {
  const dividerIndex = process.argv.indexOf("--");
  const ownArgv =
    dividerIndex >= 0 ? process.argv.slice(2, dividerIndex) : process.argv.slice(2);
  const codexArgs =
    dividerIndex >= 0 ? process.argv.slice(dividerIndex + 1) : [];

  const { values, positionals } = parseArgs({
    args: ownArgv,
    allowPositionals: true,
    options: {
      "codex-bin": { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean" },
      "max-issues": { type: "string" },
      "no-claim": { type: "boolean" },
      "prompt-file": { type: "string" },
      taskmaster: { type: "boolean" },
    },
  });

  if (values.help || positionals.length === 0) {
    printUsage();
    return;
  }

  const epicId = positionals[0];
  const maxIssues =
    values["max-issues"] !== undefined ? Number(values["max-issues"]) : Number.POSITIVE_INFINITY;
  if (values["max-issues"] !== undefined && (!Number.isFinite(maxIssues) || maxIssues <= 0)) {
    throw new Error("--max-issues must be a positive number");
  }

  const promptAppend = readPromptAppend(values["prompt-file"]);
  const codexBin = resolveCodexBin({
    codexBin: values["codex-bin"],
    taskmaster: values.taskmaster,
  });

  let closedCount = 0;

  while (closedCount < maxIssues) {
    const allIssues = fetchAllIssues();
    const readyIssues = fetchReadyIssues();
    const epic = allIssues.find((issue) => issue.id === epicId);

    if (!epic) {
      throw new Error(`Epic not found: ${epicId}`);
    }

    if (epic.issue_type !== "epic") {
      throw new Error(`${epicId} is a ${epic.issue_type}, not an epic`);
    }

    const readyCandidates = selectReadyLeafIssues({ epicId, allIssues, readyIssues });

    if (values["dry-run"]) {
      if (readyCandidates.length === 0) {
        const summary = summarizeEpicState({ epicId, allIssues, readyIssues });
        printPauseSummary(epic, summary);
      } else {
        console.log(`Ready descendant beads for ${epic.id} (${epic.title}):`);
        for (const issue of readyCandidates) {
          console.log(`- ${describeIssue(issue)}`);
        }
      }
      return;
    }

    if (readyCandidates.length === 0) {
      const summary = summarizeEpicState({ epicId, allIssues, readyIssues });
      const waitState = deriveWaitState(summary);
      emitNudgeStatus({
        state: waitState.state,
        epic: epic.id,
        reason: waitState.reason,
      });
      printPauseSummary(epic, summary);
      return;
    }

    const issue = readyCandidates[0];
    emitNudgeStatus({
      state: "running",
      epic: epic.id,
      issue: issue.id,
    });
    console.log(`\n==> Working next bead: ${describeIssue(issue)}\n`);

    if (!values["no-claim"]) {
      claimIssue(issue.id);
    }

    const prompt = buildPrompt({ epic, issue, promptAppend });
    const result = runCommand(codexBin, ["exec", ...codexArgs, "-"], {
      cwd: process.cwd(),
      stdio: ["pipe", "inherit", "inherit"],
      input: prompt,
    });

    if (result.status !== 0) {
      emitNudgeStatus({
        state: "crashed",
        epic: epic.id,
        issue: issue.id,
        exitCode: result.status ?? 1,
        reason: `${codexBin} exec exited non-zero`,
      });
      console.error(`\n${codexBin} exited with status ${result.status}. Leaving ${issue.id} as-is and stopping.`);
      process.exit(result.status ?? 1);
    }

    const refreshedIssue = fetchIssue(issue.id);
    if (refreshedIssue.status !== "closed") {
      emitNudgeStatus({
        state: "waiting_human",
        epic: epic.id,
        issue: issue.id,
        reason: "child bead returned without closing",
      });
      console.log(
        `\n${issue.id} is now ${refreshedIssue.status}. Stopping so a human can review before the runner advances.`
      );
      return;
    }

    closedCount += 1;
    console.log(`\n${issue.id} closed. Epic runner will look for the next ready descendant bead.`);
  }

  emitNudgeStatus({
    state: "waiting_human",
    epic: epicId,
    reason: "max_issues limit reached",
  });
  console.log(`\nStopped after closing ${closedCount} bead(s) because --max-issues was reached.`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
