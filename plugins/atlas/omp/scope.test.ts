import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { PROJECT_MARKERS, SCRATCH_ROOTS, gatesArmed } from "./scope";

const REPO = resolve(import.meta.dir, "..", "..", "..");

test("scratch dirs are unarmed, even with a marker", () => {
	const d = mkdtempSync(join(tmpdir(), "atlas-scope-"));
	try {
		mkdirSync(join(d, ".git"));
		expect(gatesArmed(d, {})).toBe(false);
		for (const root of SCRATCH_ROOTS) expect(gatesArmed(`${root}/x`, {})).toBe(false);
	} finally {
		rmSync(d, { recursive: true, force: true });
	}
});

test("repo dir is armed; markerless dir under home is not; ancestor marker arms", () => {
	expect(gatesArmed(REPO, {})).toBe(true);
	const d = mkdtempSync(join(homedir(), ".atlas-scope-test-"));
	try {
		expect(gatesArmed(d, {})).toBe(false);
		writeFileSync(join(d, PROJECT_MARKERS[4]), "{}");
		mkdirSync(join(d, "a", "b"), { recursive: true });
		expect(gatesArmed(join(d, "a", "b"), {})).toBe(true);
	} finally {
		rmSync(d, { recursive: true, force: true });
	}
});

test("ATLAS_GATES overrides; missing cwd reads as armed", () => {
	expect(gatesArmed("/tmp/x", { ATLAS_GATES: "always" })).toBe(true);
	expect(gatesArmed(REPO, { ATLAS_GATES: "off" })).toBe(false);
	expect(gatesArmed(undefined, {})).toBe(true);
});

function seedDb(dbPath: string, root: string, dispatches: number): void {
	const db = new Database(dbPath);
	db.run("PRAGMA journal_mode=WAL");
	db.run("CREATE TABLE projects (id INTEGER PRIMARY KEY, root_path TEXT UNIQUE NOT NULL)");
	db.run("CREATE TABLE runs (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL)");
	db.run("CREATE TABLE dispatches (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL)");
	db.run("INSERT INTO projects(id, root_path) VALUES (1, ?)", [root]);
	db.run("INSERT INTO runs(id, project_id) VALUES (1, 1)");
	for (let i = 0; i < dispatches; i++) db.run("INSERT INTO dispatches(run_id) VALUES (1)");
	db.close();
}

test("DB dispatch history arms a markerless dir; never home or scratch; errors ignored", () => {
	const d = mkdtempSync(join(homedir(), ".atlas-scope-test-"));
	const store = mkdtempSync(join(tmpdir(), "atlas-scope-db-"));
	try {
		const root = realpathSync(d);
		const env = { ATLAS_DB: join(store, "atlas.db") };
		expect(gatesArmed(d, env)).toBe(false);
		seedDb(env.ATLAS_DB, root, 0);
		expect(gatesArmed(d, env)).toBe(false);
		rmSync(env.ATLAS_DB);
		seedDb(env.ATLAS_DB, root, 1);
		expect(gatesArmed(d, env)).toBe(true);
		rmSync(env.ATLAS_DB);
		seedDb(env.ATLAS_DB, realpathSync(homedir()), 1);
		expect(gatesArmed(homedir(), env)).toBe(false);
		const bad = join(store, "bad.db");
		writeFileSync(bad, "not sqlite");
		expect(gatesArmed(d, { ATLAS_DB: bad })).toBe(false);
	} finally {
		rmSync(d, { recursive: true, force: true });
		rmSync(store, { recursive: true, force: true });
	}
});
