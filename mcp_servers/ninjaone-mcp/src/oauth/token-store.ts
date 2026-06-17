// On-disk token storage for NinjaOne user-OAuth tokens.
//
// Refresh tokens are stored at `~/.tech-tools/ninjaone-tokens.json` with
// 0600 file permissions. The data is NOT encrypted at rest — OS file
// permissions are the practical control, matching the pattern used by Slack,
// Discord, gcloud, and rclone. If your home directory is shared, treat the
// refresh token as you would an API key.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms since epoch
  scope: string;
  /** Region the tokens were minted against — switches must re-auth. */
  region: string;
}

const STORAGE_DIR = join(homedir(), ".tech-tools");
const STORAGE_FILE = join(STORAGE_DIR, "ninjaone-tokens.json");

async function ensureDir(): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
}

export async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredTokens;
    if (!parsed.refreshToken || !parsed.accessToken) return null;
    return parsed;
  } catch (err: any) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await ensureDir();
  const tmp = STORAGE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  await fs.rename(tmp, STORAGE_FILE);
}

export async function clearTokens(): Promise<void> {
  try {
    await fs.unlink(STORAGE_FILE);
  } catch (err: any) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
}

export function storagePath(): string {
  return STORAGE_FILE;
}
