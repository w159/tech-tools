import { createHash } from "crypto";
import { basename } from "path";
import { readFile, rename, rm } from "fs/promises";

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number }
) => Promise<unknown>;

export type Sha256Entry = {
  filename: string;
  sha256: string;
};

export function parseSha256Sums(raw: string): Sha256Entry[] {
  const entries: Sha256Entry[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([a-fA-F0-9]{64})[ \t]+[* ]?(.+)$/);
    if (!match) continue;

    const [, sha256, filename] = match;
    entries.push({
      filename: filename.trim(),
      sha256: sha256.toLowerCase(),
    });
  }

  return entries;
}

export function findSha256ForAsset(raw: string, assetName: string): string | null {
  for (const entry of parseSha256Sums(raw)) {
    if (entry.filename === assetName || basename(entry.filename) === assetName) {
      return entry.sha256;
    }
  }
  return null;
}

export async function computeFileSha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyDownloadedAsset(
  path: string,
  expectedSha256: string
): Promise<void> {
  const actual = await computeFileSha256(path);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `checksum mismatch: expected ${expectedSha256.toLowerCase()}, got ${actual}`
    );
  }
}

export async function downloadReleaseBinaryWithChecksum(options: {
  binaryName: string;
  targetPath: string;
  execFileAsync: ExecFileAsync;
  baseUrl?: string;
}): Promise<void> {
  const { binaryName, targetPath, execFileAsync } = options;
  const baseUrl =
    options.baseUrl ?? "https://github.com/silverstein/minutes/releases/latest/download";
  const sumsUrl = `${baseUrl}/SHA256SUMS.txt`;
  const binaryUrl = `${baseUrl}/${binaryName}`;
  const tempSumsPath = `${targetPath}.SHA256SUMS.tmp`;
  const tempBinaryPath = `${targetPath}.download`;

  try {
    await execFileAsync("curl", ["-fSL", "-o", tempSumsPath, sumsUrl], {
      timeout: 30000,
    });
    const sums = await readFile(tempSumsPath, "utf8");
    const expectedSha256 = findSha256ForAsset(sums, binaryName);
    if (!expectedSha256) {
      throw new Error(`SHA256SUMS.txt has no entry for ${binaryName}`);
    }

    await execFileAsync("curl", ["-fSL", "-o", tempBinaryPath, binaryUrl], {
      timeout: 120000,
    });
    await verifyDownloadedAsset(tempBinaryPath, expectedSha256);
    await rename(tempBinaryPath, targetPath);
  } catch (error) {
    await rm(tempBinaryPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await rm(tempSumsPath, { force: true }).catch(() => {});
  }
}
