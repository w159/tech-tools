#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discover, summarize, type OrgModel } from "./discover.js";
import { DEFAULT_GRAPH_BASE_URL, GraphClient, GraphError, resolveToken } from "./graph.js";
import { AnswersError, makePlan, parsePlan, renderPlanSummary } from "./plan.js";
import { followUp, provision, ProvisionError } from "./provision.js";

const USAGE = `Usage:
  node dist/admin/cli.js discover --out org-model.json
  node dist/admin/cli.js plan --org org-model.json --answers answers.yaml --out plan.json --policy policy.yaml
  node dist/admin/cli.js provision --plan plan.json [--apply] [--prune] [--managed-identity-principal-id <id>]

Environment: GRAPH_TOKEN (else the Azure CLI is used), GRAPH_BASE_URL (default ${DEFAULT_GRAPH_BASE_URL}).`;

export interface CliIo {
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

class UsageError extends Error {}

function parseFlags(args: string[], valued: readonly string[], boolean: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) throw new UsageError(`unexpected argument "${a}"`);
    const name = a.slice(2);
    if (boolean.includes(name)) out[name] = true;
    else if (valued.includes(name)) {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      out[name] = v;
    } else throw new UsageError(`unknown option --${name}`);
  }
  return out;
}

function required(flags: Record<string, string | true>, name: string): string {
  const v = flags[name];
  if (typeof v !== "string") throw new UsageError(`--${name} is required`);
  return v;
}

function writeOut(path: string, text: string): void {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}

async function makeClient(io: CliIo, readOnly: boolean): Promise<GraphClient> {
  const token = await resolveToken(io.env);
  return new GraphClient({ baseUrl: io.env.GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL, token, readOnly });
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "discover": {
        const flags = parseFlags(rest, ["out"], []);
        const out = required(flags, "out");
        const model = await discover(await makeClient(io, true));
        writeOut(out, `${JSON.stringify(model, null, 2)}\n`);
        io.stdout(`${summarize(model)}\nWrote ${out}\n`);
        return 0;
      }
      case "plan": {
        const flags = parseFlags(rest, ["org", "answers", "out", "policy"], []);
        const orgPath = required(flags, "org");
        const answersPath = required(flags, "answers");
        const out = required(flags, "out");
        const policyOut = required(flags, "policy");
        const org = JSON.parse(readFileSync(orgPath, "utf8")) as OrgModel;
        const { answers, plan, policyYaml } = makePlan(org, readFileSync(answersPath, "utf8"));
        writeOut(out, `${JSON.stringify(plan, null, 2)}\n`);
        writeOut(policyOut, policyYaml);
        io.stdout(`${renderPlanSummary(answers, plan, org)}\nWrote ${out}\nWrote ${policyOut}\n`);
        return 0;
      }
      case "provision": {
        const flags = parseFlags(rest, ["plan", "managed-identity-principal-id"], ["apply", "prune"]);
        const mi = flags["managed-identity-principal-id"];
        if (typeof mi === "string" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mi)) throw new UsageError("--managed-identity-principal-id must be a GUID");
        const plan = parsePlan(readFileSync(required(flags, "plan"), "utf8"));
        const apply = flags.apply === true;
        io.stdout(apply ? "APPLY: performing writes in order\n" : "DRY RUN: no changes will be made (add --apply to perform them)\n");
        const client = await makeClient(io, !apply);
        const result = await provision(client, plan, {
          apply,
          prune: flags.prune === true,
          ...(typeof mi === "string" ? { managedIdentityPrincipalId: mi } : {}),
          onStep: (s) => io.stdout(`${s.method} ${s.path}  ${s.description}\n`),
        });
        for (const n of result.notes) io.stdout(`NOTE ${n}\n`);
        if (result.steps.length === 0) io.stdout("Entra already matches the plan; nothing to do.\n");
        else io.stdout(`${apply ? "Applied" : "Would apply"} ${result.steps.length} write(s).\n`);
        for (const line of followUp(plan, result.appId, result.servicePrincipalId)) io.stdout(`${line}\n`);
        return 0;
      }
      default:
        if (command === undefined || command === "--help" || command === "-h" || command === "help") {
          io.stdout(`${USAGE}\n`);
          return command === undefined ? 2 : 0;
        }
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`error: ${err.message}\n${USAGE}\n`);
      return 2;
    }
    if (err instanceof AnswersError || err instanceof GraphError || err instanceof ProvisionError) {
      io.stderr(`error: ${err.message}\n`);
      return 1;
    }
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url))) {
  void runCli(process.argv.slice(2), {
    env: process.env,
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
  }).then((code) => {
    process.exitCode = code;
  });
}
