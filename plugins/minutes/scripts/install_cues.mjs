#!/usr/bin/env node
// Install chosen ElevenLabs candidates as the live capture cue WAVs.
//
// Reads MP3 candidates from scripts/cue-candidates/, runs them through ffmpeg
// to convert + loudness-normalize + downmix to mono 16-bit 44.1kHz WAV, then
// replaces the live files in tauri/src/audio/.
//
// The previous WAVs are backed up to tauri/src/audio/_backup/ on first run
// (the original Python-generated tones).
//
// Usage:
//   node scripts/install_cues.mjs start=2 stop=1 complete=3 error=1
//   node scripts/install_cues.mjs start=2                       (just one)
//
// Each arg is `cuename=index` matching files like `cue-candidates/start-2.mp3`.

import { mkdir, copyFile, access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CANDIDATES_DIR = join(REPO_ROOT, 'scripts', 'cue-candidates');
const TARGET_DIR = join(REPO_ROOT, 'tauri', 'src', 'audio');
const BACKUP_DIR = join(TARGET_DIR, '_backup');

const VALID_CUES = ['start', 'stop', 'complete', 'error'];

// ffmpeg pipeline:
//   1. loudnorm — short-term loudness target -16 LUFS, true peak -2 dBFS
//      (sounds sit consistently against meeting audio without clipping)
//   2. afade in 5ms / out 15ms — kill any digital edge clicks
//   3. mono 16-bit PCM at 44.1kHz — matches the existing cue WAV format
function buildFfmpegArgs(input, output) {
  return [
    '-y',
    '-i', input,
    '-af', 'loudnorm=I=-16:TP=-2:LRA=7,afade=t=in:st=0:d=0.005,afade=t=out:st=0.45:d=0.015',
    '-ar', '44100',
    '-ac', '1',
    '-sample_fmt', 's16',
    output,
  ];
}

function parseArgs(argv) {
  const picks = {};
  for (const arg of argv) {
    const m = arg.match(/^([a-z]+)=(\d+)$/);
    if (!m) {
      console.error(`Bad arg: ${arg}. Use cuename=index, e.g. start=2`);
      process.exit(1);
    }
    const [, cue, index] = m;
    if (!VALID_CUES.includes(cue)) {
      console.error(`Unknown cue: ${cue}. Valid: ${VALID_CUES.join(', ')}`);
      process.exit(1);
    }
    picks[cue] = parseInt(index, 10);
  }
  return picks;
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function backupOriginal(cue) {
  const original = join(TARGET_DIR, `cue-${cue}.wav`);
  const backup = join(BACKUP_DIR, `cue-${cue}.wav`);
  if (await fileExists(backup)) return; // already backed up
  if (!(await fileExists(original))) return;
  await mkdir(BACKUP_DIR, { recursive: true });
  await copyFile(original, backup);
  console.log(`        backed up original -> ${backup.replace(REPO_ROOT + '/', '')}`);
}

async function installOne(cue, index) {
  const input = join(CANDIDATES_DIR, `${cue}-${index}.mp3`);
  if (!(await fileExists(input))) {
    console.error(`[${cue}] candidate not found: ${input}`);
    return false;
  }
  const output = join(TARGET_DIR, `cue-${cue}.wav`);
  console.log(`[${cue}] installing ${cue}-${index}.mp3`);
  await backupOriginal(cue);

  const result = spawnSync('ffmpeg', buildFfmpegArgs(input, output), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.status !== 0) {
    console.error(`        ffmpeg failed (${result.status}):`);
    console.error(result.stderr.toString());
    return false;
  }
  console.log(`        wrote ${output.replace(REPO_ROOT + '/', '')}`);
  return true;
}

async function main() {
  const picks = parseArgs(process.argv.slice(2));
  if (Object.keys(picks).length === 0) {
    console.error('Usage: node scripts/install_cues.mjs start=2 stop=1 complete=3 error=1');
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (const [cue, index] of Object.entries(picks)) {
    if (await installOne(cue, index)) ok++;
    else fail++;
  }

  console.log(`\nInstalled ${ok} cue(s)${fail ? `, ${fail} failed` : ''}`);
  if (ok) {
    console.log('\nNext steps:');
    console.log('  1. Preview the live cues:');
    console.log('     for c in start stop complete error; do echo $c; afplay tauri/src/audio/cue-$c.wav; sleep 0.4; done');
    console.log('  2. Rebuild the dev app to dogfood with the new sounds:');
    console.log('     ./scripts/install-dev-app.sh');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
