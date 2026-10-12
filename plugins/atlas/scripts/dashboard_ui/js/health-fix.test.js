import { test, expect } from "bun:test";
import { fixCommands, staleInstallCommand } from "./health-fix.js";

const subs = [{ id: "hooks", evidence: ["stale plugin install 11.0.0 is producing faults: run python3 /x/scripts/atlas_doctor.py --fix, then /reload-plugins"] }];

test("hook_crash from a stale install uses the doctor command", () => {
  expect(staleInstallCommand(subs)).toBe("python3 /x/scripts/atlas_doctor.py --fix");
  expect(fixCommands({ kind: "hook_crash", next: "x" }, subs)).toEqual(["python3 /x/scripts/atlas_doctor.py --fix"]);
});

test("ingest_stalled gives both backfill commands", () => {
  expect(fixCommands({ kind: "ingest_stalled" }, []).length).toBe(2);
});

test("command is pulled from next text, none when absent", () => {
  expect(fixCommands({ kind: "hook_crash", next: "or run: tail -n 5 ~/.atlas/hook-faults.jsonl" }, [])).toEqual(["tail -n 5 ~/.atlas/hook-faults.jsonl"]);
  expect(fixCommands({ kind: "x", next: "Read the sample." }, [])).toEqual([]);
});

test("non-stale hook_crash, null subs and missing row fall back safely", () => {
  expect(staleInstallCommand(null)).toBe(null);
  expect(staleInstallCommand([{ evidence: ["unrelated"] }, {}])).toBe(null);
  expect(fixCommands({ kind: "hook_crash", next: "run: tail -n 5 f" }, [{ evidence: ["x"] }])).toEqual(["tail -n 5 f"]);
  expect(fixCommands(undefined, undefined)).toEqual([]);
  expect(fixCommands({ kind: "chronicle_gap" }, [])).toHaveLength(2);
});
