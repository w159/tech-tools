#!/usr/bin/env node
// Generate ElevenLabs sound effect candidates for the Minutes app capture cues.
//
// Reads `elevenlabs_api_key` from .env.local at the repo root, then asks the
// ElevenLabs Sound Effect V2 API to render N candidates per cue. Saves all
// candidates as MP3 to scripts/cue-candidates/ for previewing.
//
// This script does NOT touch the live cue WAVs in tauri/src/audio/. Once you
// pick a favorite for each cue, run scripts/install_cues.mjs to convert + install.
//
// Usage:
//   node scripts/generate_cues_elevenlabs.mjs
//   node scripts/generate_cues_elevenlabs.mjs --count 5      (more candidates)
//   node scripts/generate_cues_elevenlabs.mjs --only start   (one cue only)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENV_PATH = join(REPO_ROOT, '.env.local');
const OUT_DIR = join(REPO_ROOT, 'scripts', 'cue-candidates');

const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_192';
const PROMPT_INFLUENCE = 0.7; // 0-1, higher sticks closer to the prompt
const DURATION_SECONDS = 0.6; // API minimum is 0.5s

// Sound design direction: warm wood + glass + soft acoustic percussion.
// Unobtrusive, premium, "considered tool" — fits a meeting/dictation app
// where cues must acknowledge actions without intruding on a live conversation.
const CUES = {
  start: {
    description: 'Recording / dictation begins. Attentive, ready, slightly rising.',
    prompt:
      'Single soft wooden mallet strike on small crystal singing bowl, warm bell-like resonance with brief natural decay, intimate close-mic recording, dry no reverb, premium minimal UI confirmation sound, subtle and unobtrusive',
  },
  stop: {
    description: 'Recording ends. Settled, complete, lower energy than start.',
    prompt:
      'Single felt mallet tap on hollow wooden block, soft muted percussive thump with very short warm decay, intimate close-mic recording, dry no reverb, calm minimal UI confirmation sound, subtle and unobtrusive',
  },
  complete: {
    description: 'Transcript saved / success. Closed-loop, satisfying, non-pitched.',
    // Non-tonal on purpose — pitched success cues fight the pitched start/stop
    // cues for the same auditory space and tend to read as "notification arrived"
    // (airplane chime / Slack ping) rather than "your action completed".
    prompt:
      'Soft thumb tap on small leather-bound book closing, single warm percussive paf with no resonance, intimate close-mic recording, dry no reverb, satisfying minimal UI completion sound',
  },
  error: {
    description: 'Something failed. Gentle "didn\'t work", not alarming.',
    prompt:
      'Soft muted low wooden knock, single dampened thud with almost no resonance, intimate close-mic recording, dry no reverb, gentle minimal UI error feedback sound, calm not alarming',
  },
};

function parseArgs(argv) {
  const args = { count: 3, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count' && argv[i + 1]) {
      args.count = parseInt(argv[++i], 10);
    } else if (argv[i] === '--only' && argv[i + 1]) {
      args.only = argv[++i];
    }
  }
  return args;
}

async function loadApiKey() {
  const text = await readFile(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key.toLowerCase() === 'elevenlabs_api_key') return value;
  }
  throw new Error(`elevenlabs_api_key not found in ${ENV_PATH}`);
}

async function generate(apiKey, prompt) {
  const url = `https://api.elevenlabs.io/v1/sound-generation?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: DURATION_SECONDS,
      prompt_influence: PROMPT_INFLUENCE,
      model_id: MODEL_ID,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = await loadApiKey();
  await mkdir(OUT_DIR, { recursive: true });

  const cueNames = args.only ? [args.only] : Object.keys(CUES);
  for (const name of cueNames) {
    if (!CUES[name]) {
      console.error(`Unknown cue: ${name}. Valid: ${Object.keys(CUES).join(', ')}`);
      process.exit(1);
    }
  }

  let okCount = 0;
  let failCount = 0;
  for (const name of cueNames) {
    const { description, prompt } = CUES[name];
    console.log(`\n[${name}] ${description}`);
    console.log(`        prompt: ${prompt}`);
    for (let i = 1; i <= args.count; i++) {
      const filename = `${name}-${i}.mp3`;
      const path = join(OUT_DIR, filename);
      process.stdout.write(`        ${filename}... `);
      try {
        const buffer = await generate(apiKey, prompt);
        await writeFile(path, buffer);
        console.log(`ok (${(buffer.length / 1024).toFixed(1)}KB)`);
        okCount++;
      } catch (err) {
        console.log(`FAIL: ${err.message}`);
        failCount++;
      }
    }
  }

  console.log(`\nGenerated ${okCount} candidates in scripts/cue-candidates/`);
  if (failCount) console.log(`${failCount} failed`);
  console.log('\nPreview all candidates in order:');
  console.log('  for f in scripts/cue-candidates/*.mp3; do echo "$f"; afplay "$f"; sleep 0.4; done');
  console.log('\nOr preview one cue at a time:');
  console.log('  for f in scripts/cue-candidates/start-*.mp3; do echo "$f"; afplay "$f"; sleep 0.4; done');
  console.log('\nWhen ready, install the chosen candidates with:');
  console.log('  node scripts/install_cues.mjs start=2 stop=1 complete=3 error=1');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
