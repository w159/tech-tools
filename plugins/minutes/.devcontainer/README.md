# Minutes — Linux Codespace

A GitHub Codespace for testing Minutes on Linux without needing a Linux machine.

## Launch

From the repo on github.com: **Code → Codespaces → Create codespace on main**

Or from the CLI:

```bash
gh codespace create --repo silverstein/minutes
gh codespace code
```

The first launch takes 15–25 minutes — it installs ALSA/PipeWire dev headers,
builds `minutes-core` + the CLI in release mode (whisper.cpp + ONNX Runtime
are heavy first-time compiles on a 4-core box), and pre-downloads the tiny
whisper model and the diarization ONNX models. Subsequent shells in the same
codespace are instant.

## What's installed

- Rust stable (from the base image)
- Node 22 (for the MCP server)
- `libasound2-dev`, `libpipewire-0.3-dev`, `libspa-0.2-dev` — same Linux deps as CI
- `ffmpeg` — preferred audio decoder for non-WAV inputs
- `pulseaudio-utils` — for inspecting Pulse/PipeWire if you start a daemon
- The `minutes` CLI installed at `~/.local/bin/minutes`
- Small whisper model at `~/.minutes/models/ggml-small.bin` (matches `Config::default()`)
- Silero VAD at `~/.minutes/models/ggml-silero-v6.2.0.bin`
- Diarization models at `~/.minutes/models/diarize/`

## Run the sanity check

```bash
.devcontainer/test-linux.sh
```

This exercises the full pipeline on `crates/assets/demo.wav` — whisper
transcription, diarization, action item extraction, search, and the unit
tests for core, whisper-guard, reader, and the diarize feature.

## What works in a Codespace

- ✅ Building everything (core, CLI, MCP, diarize feature)
- ✅ Whisper transcription on file inputs (`minutes process file.wav -t meeting`)
- ✅ Diarization with pyannote-rs ONNX models
- ✅ Markdown output, search, action items, frontmatter parsing
- ✅ MCP server (TypeScript build + smoke tests)
- ✅ All unit + integration tests that don't need a real mic
- ✅ Audio device enumeration code paths (will return empty list — that's fine)

## What doesn't work

- ❌ Live recording (`minutes record`) — no audio input device in the container
- ❌ Live transcription (`minutes live`) — same reason
- ❌ Tauri desktop app — no display server (and we'd want a real Linux machine for that)
- ❌ Global hotkeys — TCC/permission concepts don't apply, but no display anyway
- ❌ Calendar / Screen recording features

If you need to test live capture on Linux, use a real Linux machine (or a
local VM with audio passthrough). The Codespace is for everything else.

## Testing PipeWire device detection

The Codespace has the PipeWire dev headers installed, so cpal will compile
with PipeWire support. If you want to test enumeration against a running
PipeWire daemon (relevant to Dieter's contribution), you can start one
manually:

```bash
sudo apt-get install -y pipewire pipewire-pulse
pipewire &
pipewire-pulse &
wpctl status            # confirm it's running
minutes devices         # see what cpal reports
```

Without a real audio backend behind it the device list will still be empty,
but you can verify that the enumeration code doesn't crash and that the
right code paths execute.
