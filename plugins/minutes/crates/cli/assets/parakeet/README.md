Bundled file: `silero_vad_v5.safetensors`

Purpose:
- enables parakeet.cpp native Silero VAD via `--vad`
- installed by `minutes setup --parakeet`

Provenance:
- source project: `snakers4/silero-vad`
- source license: MIT
- conversion script: `parakeet.cpp/scripts/convert_silero_vad.py`
- generated SHA-256: `7cb8e62277440413ed6a13f38db71b615b33f43ee3da767a36c21ec6486d9887`

Why it is bundled:
- the runtime now supports native Parakeet VAD
- setup needs a supported, no-Python-required path to activate that behavior
- this artifact is small enough to ship directly
