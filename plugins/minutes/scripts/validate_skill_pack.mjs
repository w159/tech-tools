#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const pluginPath = join(repoRoot, ".claude", "plugins", "minutes", "plugin.json");
const schemaPath = join(repoRoot, ".claude", "plugins", "minutes", "packs", "schema.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function validatePack(pack, knownSkills, file) {
  ensure(pack && typeof pack === "object" && !Array.isArray(pack), `${file}: pack must be a JSON object`);
  ensure(pack.schema_version === 1, `${file}: schema_version must be 1`);
  ensure(typeof pack.pack_id === "string" && /^[a-z0-9][a-z0-9-]{2,63}$/.test(pack.pack_id), `${file}: invalid pack_id`);
  ensure(typeof pack.title === "string" && pack.title.length >= 3, `${file}: title is required`);
  ensure(typeof pack.description === "string" && pack.description.length >= 10, `${file}: description is required`);
  ensure(Array.isArray(pack.skill_names) && pack.skill_names.length > 0, `${file}: skill_names must be a non-empty array`);

  const seen = new Set();
  for (const skill of pack.skill_names) {
    ensure(typeof skill === "string" && /^[a-z0-9-]+$/.test(skill), `${file}: invalid skill name ${JSON.stringify(skill)}`);
    ensure(!seen.has(skill), `${file}: duplicate skill ${skill}`);
    seen.add(skill);
    ensure(knownSkills.has(skill), `${file}: unknown Minutes skill ${skill}`);
  }

  if (pack.recommended_surface != null) {
    ensure(pack.recommended_surface === "claude-code-plugin", `${file}: recommended_surface must be claude-code-plugin`);
  }

  if (pack.entrypoints != null) {
    ensure(Array.isArray(pack.entrypoints), `${file}: entrypoints must be an array`);
    for (const [index, entry] of pack.entrypoints.entries()) {
      ensure(entry && typeof entry === "object", `${file}: entrypoints[${index}] must be an object`);
      ensure(typeof entry.trigger === "string" && entry.trigger.length >= 3, `${file}: entrypoints[${index}].trigger is required`);
      ensure(typeof entry.skill_name === "string", `${file}: entrypoints[${index}].skill_name is required`);
      ensure(knownSkills.has(entry.skill_name), `${file}: entrypoints[${index}] references unknown skill ${entry.skill_name}`);
    }
  }

  if (pack.recommended_for != null) {
    ensure(pack.recommended_for && typeof pack.recommended_for === "object", `${file}: recommended_for must be an object`);
    for (const field of ["roles", "contexts"]) {
      if (pack.recommended_for[field] != null) {
        ensure(Array.isArray(pack.recommended_for[field]), `${file}: recommended_for.${field} must be an array`);
        const seenValues = new Set();
        for (const value of pack.recommended_for[field]) {
          ensure(typeof value === "string" && /^[a-z0-9-]+$/.test(value), `${file}: invalid recommended_for.${field} value ${JSON.stringify(value)}`);
          ensure(!seenValues.has(value), `${file}: duplicate recommended_for.${field} value ${value}`);
          seenValues.add(value);
        }
      }
    }
  }
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    fail("Usage: node scripts/validate_skill_pack.mjs <pack.json> [more-pack.json]");
  }

  const [pluginRaw, schemaRaw] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(schemaPath, "utf8"),
  ]);
  const plugin = JSON.parse(pluginRaw);
  JSON.parse(schemaRaw); // sanity check: schema file itself is valid JSON

  const knownSkills = new Set((plugin.skills || []).map((skill) => skill.name));
  ensure(knownSkills.size > 0, "plugin.json exposes no skills");

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const pack = JSON.parse(raw);
    validatePack(pack, knownSkills, file);
    console.log(`validated ${file}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
