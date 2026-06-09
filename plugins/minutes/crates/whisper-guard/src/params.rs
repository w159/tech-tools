//! Whisper parameter presets for stable transcription.
//!
//! These presets match whisper.cpp CLI defaults and include integrated
//! Silero VAD support. Without these, whisper-rs with default `Greedy { best_of: 1 }`
//! can loop indefinitely on non-English or noisy audio.

/// Build whisper FullParams with sane defaults matching whisper.cpp CLI.
///
/// Uses `best_of=5`, entropy/logprob thresholds, and temperature fallback
/// to prevent decoder loops. When a Silero VAD model path is provided,
/// enables integrated VAD so whisper only transcribes speech segments.
///
/// Use this for batch transcription. For latency-sensitive streaming,
/// use [`streaming_whisper_params`] instead.
pub fn default_whisper_params<'a, 'b>(
    vad_model_path: Option<&str>,
) -> whisper_rs::FullParams<'a, 'b> {
    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 5 });

    // Match whisper.cpp CLI defaults for stable decoding
    params.set_temperature(0.0);
    params.set_temperature_inc(0.2); // retry at higher temp on high-entropy segments
    params.set_entropy_thold(2.4); // flag segments with entropy above this
    params.set_logprob_thold(-1.0); // flag segments with avg logprob below this
    params.set_no_speech_thold(0.6); // probability threshold for silence detection
    params.set_suppress_blank(true); // suppress blank/repeated token hallucinations

    // Enable Silero VAD if model is available
    if let Some(path) = vad_model_path {
        params.set_vad_model_path(Some(path));
        params.enable_vad(true);
        params.set_vad_params(whisper_rs::WhisperVadParams::default());
        tracing::info!("Silero VAD enabled for transcription");
    }

    // Suppress noisy output
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    params
}

/// Lighter whisper params for streaming/dictation where latency matters.
///
/// Keeps `best_of=1` and disables temperature fallback to stay within
/// the ~200ms (base) / ~500ms (small) budget for partial transcription.
/// Still sets entropy/logprob/no-speech thresholds and suppress_blank
/// to catch the worst hallucinations without the 5x cost of best_of=5.
pub fn streaming_whisper_params<'a, 'b>() -> whisper_rs::FullParams<'a, 'b> {
    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });

    params.set_temperature(0.0);
    params.set_temperature_inc(0.0); // no retry — latency budget too tight
    params.set_entropy_thold(2.4);
    params.set_logprob_thold(-1.0);
    params.set_no_speech_thold(0.6);
    params.set_suppress_blank(true);

    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    params
}

/// Get number of CPU threads to use for whisper.
/// Caps at 8 — diminishing returns beyond that.
pub fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|p| p.get() as i32)
        .unwrap_or(4)
        .min(8)
}
