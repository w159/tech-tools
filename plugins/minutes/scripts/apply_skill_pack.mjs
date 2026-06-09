#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const packsDir = join(repoRoot, ".claude", "plugins", "minutes", "packs");

async function main() {
  const [packId] = process.argv.slice(2);
  if (!packId) {
    console.error("Usage: node scripts/apply_skill_pack.mjs <pack-id>");
    process.exit(1);
  }

  const packFiles = (await readdir(packsDir)).filter(
    (name) => name.endsWith(".json") && name !== "schema.json",
  );
  const packs = await Promise.all(
    packFiles.map(async (name) => JSON.parse(await readFile(join(packsDir, name), "utf8")))
  );
  const pack = packs.find((entry) => entry.pack_id === packId);
  if (!pack) {
    console.error(`Unknown pack: ${packId}`);
    process.exit(1);
  }

  const result = {
    pack_id: pack.pack_id,
    title: pack.title,
    description: pack.description,
    install_steps: [
      "claude plugin marketplace add silverstein/minutes",
      "claude plugin install minutes@minutes",
      "Restart Claude Code",
    ],
    apply_steps: [
      `Start with: ${pack.skill_names[0]}`,
      `Then use the rest of the pack skills as needed: ${pack.skill_names.join(", ")}`,
    ],
    skill_names: pack.skill_names,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
