#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const packsDir = join(repoRoot, ".claude", "plugins", "minutes", "packs");

function scorePack(pack, options) {
  let score = 0;
  const roles = new Set(pack.recommended_for?.roles || []);
  const contexts = new Set(pack.recommended_for?.contexts || []);

  if (options.role && roles.has(options.role)) score += 3;
  if (options.context && contexts.has(options.context)) score += 3;
  if (options.skill_name && Array.isArray(pack.skill_names) && pack.skill_names.includes(options.skill_name)) score += 2;
  if (!options.role && !options.context) score += 1;

  return score;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--role") options.role = args[++i];
    else if (arg === "--context") options.context = args[++i];
    else if (arg === "--skill") options.skill_name = args[++i];
  }

  const packFiles = (await readdir(packsDir))
    .filter((name) => name.endsWith(".json") && name !== "schema.json")
    .sort();
  const packs = await Promise.all(
    packFiles.map(async (name) => JSON.parse(await readFile(join(packsDir, name), "utf8")))
  );

  const ranked = packs
    .map((pack) => ({
      pack_id: pack.pack_id,
      title: pack.title,
      description: pack.description,
      score: scorePack(pack, options),
      recommended_for: pack.recommended_for || {},
      skill_names: pack.skill_names || [],
    }))
    .filter((pack) => pack.score > 0)
    .sort((a, b) => b.score - a.score || a.pack_id.localeCompare(b.pack_id));

  console.log(JSON.stringify({ options, packs: ranked }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
