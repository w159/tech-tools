#!/usr/bin/env bash
# Codespace post-create setup. Mirrors the Linux deps from .github/workflows/ci.yml
# and gets you to a state where you can immediately test the full pipeline on the
# bundled demo.wav.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing Linux build + audio dev deps..."
# clang + libclang-dev: required by bindgen when pipewire-sys generates Rust
#   bindings from PipeWire's C headers (cpal pulls this in via the pipewire
#   feature on Linux). Without it, the Codespace setup fails ~120 crates in.
# cmake + build-essential: whisper.cpp's build script invokes cmake.
# libasound2-dev, libpipewire-0.3-dev, libspa-0.2-dev: same set CI installs
#   for cpal's ALSA + PipeWire backends.
# ffmpeg: preferred audio decoder for non-WAV inputs.
# pulseaudio-utils: lets us inspect a PipeWire/Pulse daemon if we ever start one.
sudo apt-get update
sudo apt-get install -y \
  clang \
  libclang-dev \
  cmake \
  build-essential \
  pkg-config \
  libasound2-dev \
  libpipewire-0.3-dev \
  libspa-0.2-dev \
  ffmpeg \
  pulseaudio-utils

echo "==> Building CLI in release mode (whisper + diarize, ~15–25 min on first run)..."
# Release build is slower to compile but produces the binary we'll actually
# exercise — debug whisper inference is ~10x slower at runtime. Default features
# include `diarize`, which pulls in pyannote-rs + ort, so this single build
# covers both transcription and diarization paths.
cargo build --release -p minutes-cli

echo "==> Installing CLI to ~/.local/bin..."
mkdir -p "$HOME/.local/bin"
cp target/release/minutes "$HOME/.local/bin/minutes"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
export PATH="$HOME/.local/bin:$PATH"

echo "==> Downloading small whisper model + Silero VAD..."
# Use 'small' (~466MB) because that's what Config::default() looks for. Tiny
# is faster but would require also writing a config.toml override.
"$HOME/.local/bin/minutes" setup --model small || true

echo "==> Downloading diarization models (~34MB)..."
"$HOME/.local/bin/minutes" setup --diarization || true

echo "==> Building MCP server..."
cd crates/mcp && npm install && npm run build && cd ../..

echo ""
echo "================================================================"
echo " Minutes Linux dev environment ready."
echo ""
echo " Quick sanity check:"
echo "   .devcontainer/test-linux.sh"
echo ""
echo " Or try individual commands:"
echo "   minutes --version"
echo "   minutes health --json"
echo "   minutes devices"
echo "   minutes sources"
echo "   minutes process crates/assets/demo.wav --content-type meeting"
echo "================================================================"
