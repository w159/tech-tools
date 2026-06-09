import type { Metadata } from "next";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PublicFooter } from "@/components/public-footer";

export const metadata: Metadata = {
  title: "Minutes Dojo",
  description:
    "Starter workflow packs and source-backed skill metadata for Minutes. Discover recommended packs by role and context.",
  alternates: { canonical: "/dojo" },
};

function loadDojoData() {
  const repoRoot = join(process.cwd(), "..");
  const skillMetadataPath = join(
    repoRoot,
    ".claude",
    "plugins",
    "minutes",
    "skill-metadata.generated.json",
  );
  const packsDir = join(repoRoot, ".claude", "plugins", "minutes", "packs");

  const skillMetadata = JSON.parse(readFileSync(skillMetadataPath, "utf8"));
  const packs = readdirSync(packsDir)
    .filter((name) => name.endsWith(".json") && name !== "schema.json")
    .sort()
    .map((name) => JSON.parse(readFileSync(join(packsDir, name), "utf8")));

  return { skillMetadata, packs };
}

export default function DojoPage() {
  const { skillMetadata, packs } = loadDojoData();

  return (
    <div className="mx-auto max-w-[920px] px-6 pb-16 pt-10 sm:px-8 sm:pt-14">
      <div className="mb-10 flex items-center justify-between border-b border-[color:var(--border)] pb-4">
        <a href="/" className="font-mono text-[15px] font-medium text-[var(--text)]">
          minutes
        </a>
        <div className="flex gap-5 text-sm text-[var(--text-secondary)]">
          <a href="/docs" className="hover:text-[var(--accent)]">
            docs
          </a>
          <a href="/for-agents" className="hover:text-[var(--accent)]">
            for agents
          </a>
        </div>
      </div>

      <section className="max-w-[760px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
          Dojo
        </p>
        <h1 className="mt-4 font-serif text-[42px] leading-[0.98] tracking-[-0.045em] text-[var(--text)] sm:text-[56px]">
          Workflow packs for Minutes
        </h1>
        <p className="mt-5 text-[17px] leading-8 text-[var(--text-secondary)]">
          This is the first public Dojo surface: a curated set of starter workflow
          packs plus source-backed skill metadata generated from the live plugin
          tree. The goal is discoverability, not a giant marketplace.
        </p>
      </section>

      <section className="mt-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
          Packs
        </p>
        <div className="mt-5 grid gap-4">
          {packs.map((pack: any) => (
            <div
              key={pack.pack_id}
              className="rounded-[8px] border border-[color:var(--border)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-panel)]"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">
                {pack.pack_id}
              </p>
              <h2 className="mt-3 text-[20px] font-medium text-[var(--text)]">{pack.title}</h2>
              <p className="mt-2 text-[15px] leading-8 text-[var(--text-secondary)]">
                {pack.description}
              </p>
              <p className="mt-3 text-[14px] leading-7 text-[var(--text-secondary)]">
                <span className="font-medium text-[var(--text)]">Recommended for:</span>{" "}
                {[...(pack.recommended_for?.roles || []), ...(pack.recommended_for?.contexts || [])].join(", ")}
              </p>
              <p className="mt-3 text-[14px] leading-7 text-[var(--text-secondary)]">
                <span className="font-medium text-[var(--text)]">Skills:</span>{" "}
                {pack.skill_names.join(", ")}
              </p>
              <p className="mt-3 font-mono text-[12px] text-[var(--text)]">
                node scripts/apply_skill_pack.mjs {pack.pack_id}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
          Skill Metadata
        </p>
        <div className="mt-5 grid gap-3">
          {skillMetadata.skills.map((skill: any) => (
            <div
              key={skill.skill_name}
              className="rounded-[8px] border border-[color:var(--border)] bg-[var(--bg-elevated)] p-5"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">
                {skill.category}
              </p>
              <h3 className="mt-2 text-[17px] font-medium text-[var(--text)]">
                {skill.skill_name}
              </h3>
              <p className="mt-2 text-[14px] leading-7 text-[var(--text-secondary)]">
                {skill.description}
              </p>
              {skill.pack_ids.length > 0 ? (
                <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
                  Pack fit: {skill.pack_ids.join(", ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
