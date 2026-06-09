import { mkdtemp, readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import {
  downloadReleaseBinaryWithChecksum,
  findSha256ForAsset,
  parseSha256Sums,
} from "./autoInstall.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("parseSha256Sums", () => {
  it("parses standard sha256sum output", () => {
    const mac = "a".repeat(64);
    const linux = "b".repeat(64);

    expect(
      parseSha256Sums(`
${mac}  minutes-macos-arm64
${linux} *minutes-linux-x64
`)
    ).toEqual([
      { filename: "minutes-macos-arm64", sha256: mac },
      { filename: "minutes-linux-x64", sha256: linux },
    ]);
  });

  it("ignores blank, comment, and malformed lines", () => {
    const windows = "C".repeat(64);
    expect(
      parseSha256Sums(`
# release checksums
not a checksum

${windows}  minutes-windows-x64.exe
`)
    ).toEqual([{ filename: "minutes-windows-x64.exe", sha256: windows.toLowerCase() }]);
  });

  it("finds entries by basename for nested artifact paths", () => {
    const checksum = "d".repeat(64);
    expect(
      findSha256ForAsset(
        `${checksum}  dist/minutes-linux-x64\n`,
        "minutes-linux-x64"
      )
    ).toBe(checksum);
  });
});

describe("downloadReleaseBinaryWithChecksum", () => {
  it("downloads the sums first, verifies the binary, and installs it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "minutes-mcp-install-"));
    const targetPath = join(dir, "minutes");
    const payload = "verified cli";
    const checksum = sha256(payload);
    const calls: string[] = [];

    const execFileAsync = async (_file: string, args: readonly string[]) => {
      const outputPath = args[2] as string;
      const url = args[3] as string;
      calls.push(url);
      if (url.endsWith("/SHA256SUMS.txt")) {
        await writeFile(outputPath, `${checksum}  minutes-linux-x64\n`);
      } else if (url.endsWith("/minutes-linux-x64")) {
        await writeFile(outputPath, payload);
      }
    };

    await downloadReleaseBinaryWithChecksum({
      binaryName: "minutes-linux-x64",
      targetPath,
      execFileAsync,
      baseUrl: "https://example.test/download",
    });

    expect(calls).toEqual([
      "https://example.test/download/SHA256SUMS.txt",
      "https://example.test/download/minutes-linux-x64",
    ]);
    await expect(readFile(targetPath, "utf8")).resolves.toBe(payload);
  });

  it("aborts and leaves no target binary when checksum verification fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "minutes-mcp-install-"));
    const targetPath = join(dir, "minutes");

    const execFileAsync = async (_file: string, args: readonly string[]) => {
      const outputPath = args[2] as string;
      const url = args[3] as string;
      if (url.endsWith("/SHA256SUMS.txt")) {
        await writeFile(outputPath, `${"0".repeat(64)}  minutes-linux-x64\n`);
      } else if (url.endsWith("/minutes-linux-x64")) {
        await writeFile(outputPath, "bad payload");
      }
    };

    await expect(
      downloadReleaseBinaryWithChecksum({
        binaryName: "minutes-linux-x64",
        targetPath,
        execFileAsync,
        baseUrl: "https://example.test/download",
      })
    ).rejects.toThrow("checksum mismatch");
    await expect(stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
