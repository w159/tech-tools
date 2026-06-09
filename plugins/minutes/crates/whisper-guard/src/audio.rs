//! Pre-transcription audio preparation for whisper.
//!
//! These functions prepare raw audio samples for optimal whisper transcription:
//! silence stripping to prevent hallucination loops, normalization for quiet
//! microphones, and high-quality resampling.

/// Strip silence from audio using energy detection, replacing long gaps with short padding.
///
/// Whisper hallucinates repeating text when fed long silence segments,
/// especially on non-English audio. This function:
/// 1. Computes RMS energy per 100ms chunk with adaptive noise floor
/// 2. Keeps all speech chunks plus context padding
/// 3. Replaces silence gaps >500ms with 300ms of zero padding (enough for
///    whisper to detect a segment boundary without triggering hallucination)
///
/// Accepts any sample rate (must be >= 100 Hz). Chunk sizes and timing
/// thresholds are scaled proportionally from a 16kHz baseline (100ms chunks,
/// 500ms max silence, 300ms padding, 200ms context, 500ms hangover).
pub fn strip_silence(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    if sample_rate < 100 {
        return samples.to_vec();
    }
    let rate = sample_rate as usize;
    let chunk_size = rate / 10; // 100ms chunks
    let max_silence_chunks: usize = 5; // 500ms
    let pad_chunks: usize = 3; // 300ms
    let context_chunks: usize = 2; // 200ms
    const ENERGY_MULTIPLIER: f32 = 4.0; // speech must be 4x above noise floor

    if samples.len() < chunk_size * 3 {
        return samples.to_vec();
    }

    let num_chunks = samples.len() / chunk_size;

    // Phase 1: compute RMS per chunk
    let rms_values: Vec<f32> = (0..num_chunks)
        .map(|i| {
            let start = i * chunk_size;
            let end = (start + chunk_size).min(samples.len());
            let chunk = &samples[start..end];
            (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt()
        })
        .collect();

    // Phase 2: estimate noise floor from the quietest 20% of chunks
    let mut sorted_rms = rms_values.clone();
    sorted_rms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let quiet_count = (num_chunks / 5).max(1);
    let noise_floor =
        (sorted_rms[..quiet_count].iter().sum::<f32>() / quiet_count as f32).clamp(0.0001, 0.02);
    let threshold = noise_floor * ENERGY_MULTIPLIER;

    // Phase 3: classify chunks as speech (with hangover to avoid flapping)
    let mut is_speech = vec![false; num_chunks];
    let mut hangover = 0u32;
    let hangover_chunks: u32 = 5; // 500ms hangover
    for (i, rms) in rms_values.iter().enumerate() {
        if *rms > threshold {
            is_speech[i] = true;
            hangover = hangover_chunks;
        } else if hangover > 0 {
            is_speech[i] = true;
            hangover -= 1;
        }
    }

    // Phase 4: expand speech regions by context_chunks in each direction
    let mut keep = is_speech.clone();
    for (i, &speech) in is_speech.iter().enumerate() {
        if speech {
            let from = i.saturating_sub(context_chunks);
            let to = (i + context_chunks + 1).min(num_chunks);
            for k in &mut keep[from..to] {
                *k = true;
            }
        }
    }

    // Phase 5: assemble output — keep speech, replace long silence with short pad
    let mut output = Vec::with_capacity(samples.len());
    let mut consecutive_silence = 0usize;
    let silence_pad: Vec<f32> = vec![0.0; pad_chunks * chunk_size];

    for (i, &kept) in keep.iter().enumerate() {
        let start = i * chunk_size;
        let end = (start + chunk_size).min(samples.len());

        if kept {
            if consecutive_silence > max_silence_chunks {
                output.extend_from_slice(&silence_pad);
            }
            consecutive_silence = 0;
            output.extend_from_slice(&samples[start..end]);
        } else {
            consecutive_silence += 1;
            if consecutive_silence <= max_silence_chunks {
                output.extend_from_slice(&samples[start..end]);
            }
        }
    }

    // Include any trailing partial chunk
    let remainder_start = num_chunks * chunk_size;
    if remainder_start < samples.len() {
        output.extend_from_slice(&samples[remainder_start..]);
    }

    let original_secs = samples.len() as f64 / rate as f64;
    let stripped_secs = output.len() as f64 / rate as f64;
    if stripped_secs < original_secs * 0.95 {
        tracing::info!(
            original_secs = format!("{:.1}", original_secs),
            stripped_secs = format!("{:.1}", stripped_secs),
            removed_pct = format!("{:.0}", (1.0 - stripped_secs / original_secs) * 100.0),
            "VAD stripped silence from audio"
        );
    }

    output
}

/// Normalize audio to a target peak level for consistent whisper input.
/// Only boosts quiet audio — already-loud recordings are left untouched.
pub fn normalize_audio(samples: &[f32]) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

    // Target peak: 0.5 (leaves headroom, loud enough for whisper)
    // Only normalize if peak is below 0.1 (quiet mic) and above noise floor
    const TARGET_PEAK: f32 = 0.5;
    const QUIET_THRESHOLD: f32 = 0.1;
    const NOISE_FLOOR: f32 = 0.0001;

    if peak < QUIET_THRESHOLD && peak > NOISE_FLOOR {
        let gain = (TARGET_PEAK / peak).min(100.0);
        tracing::info!(
            peak = format!("{:.4}", peak),
            gain = format!("{:.1}x", gain),
            "auto-normalizing quiet audio"
        );
        samples
            .iter()
            .map(|s| (s * gain).clamp(-1.0, 1.0))
            .collect()
    } else {
        samples.to_vec()
    }
}

/// Windowed-sinc resampler for high-quality rate conversion.
///
/// Linear interpolation introduces aliasing when downsampling (e.g. 44100->16000)
/// because it doesn't low-pass filter first. This matters for whisper: aliased
/// artifacts confuse the decoder and contribute to hallucination loops on
/// non-English audio.
///
/// This uses a sinc kernel with a Hann window (width=32 taps). The cutoff
/// frequency is set to the Nyquist of the lower rate, preventing aliasing.
/// Quality is comparable to ffmpeg's default SWR resampler.
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    // Cutoff at Nyquist of the lower rate to prevent aliasing
    let cutoff = if to_rate < from_rate {
        to_rate as f64 / from_rate as f64
    } else {
        1.0
    };

    const HALF_WIDTH: i32 = 16; // 32-tap kernel

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_center = src_pos as i32;

        let mut sum = 0.0f64;
        let mut weight_sum = 0.0f64;

        for j in (src_center - HALF_WIDTH + 1)..=(src_center + HALF_WIDTH) {
            if j < 0 || j >= samples.len() as i32 {
                continue;
            }

            let delta = src_pos - j as f64;

            // Sinc function with cutoff
            let sinc = if delta.abs() < 1e-10 {
                cutoff
            } else {
                let x = std::f64::consts::PI * delta * cutoff;
                (x.sin() / (std::f64::consts::PI * delta)) * cutoff
            };

            // Hann window
            let window_pos = (delta / HALF_WIDTH as f64 + 1.0) * 0.5;
            let window = if (0.0..=1.0).contains(&window_pos) {
                0.5 * (1.0 - (2.0 * std::f64::consts::PI * window_pos).cos())
            } else {
                0.0
            };

            let w = sinc * window;
            sum += samples[j as usize] as f64 * w;
            weight_sum += w;
        }

        let sample = if weight_sum.abs() > 1e-10 {
            sum / weight_sum
        } else {
            0.0
        };

        output.push(sample as f32);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_preserves_length_proportionally() {
        let samples: Vec<f32> = (0..44100).map(|i| (i as f32 / 44100.0).sin()).collect();
        let resampled = resample(&samples, 44100, 16000);
        let expected = 16000;
        assert!(
            (resampled.len() as i64 - expected as i64).unsigned_abs() < 10,
            "expected ~{} samples, got {}",
            expected,
            resampled.len()
        );
    }

    #[test]
    fn resample_noop_at_same_rate() {
        let samples = vec![1.0f32, 2.0, 3.0, 4.0];
        let resampled = resample(&samples, 16000, 16000);
        assert_eq!(samples, resampled);
    }

    #[test]
    fn normalize_boosts_quiet_audio() {
        let samples = vec![0.005f32, -0.008, 0.01, -0.003, 0.007];
        let normalized = normalize_audio(&samples);
        let peak = normalized.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(peak > 0.4, "expected peak > 0.4, got {}", peak);
        assert!(peak <= 0.5, "expected peak <= 0.5, got {}", peak);
    }

    #[test]
    fn normalize_leaves_loud_audio_untouched() {
        let samples = vec![0.3f32, -0.5, 0.2, -0.1];
        let normalized = normalize_audio(&samples);
        assert_eq!(samples, normalized);
    }

    #[test]
    fn normalize_ignores_noise_floor() {
        let samples = vec![0.00001f32, -0.00002, 0.00001];
        let normalized = normalize_audio(&samples);
        assert_eq!(samples, normalized);
    }

    #[test]
    fn strip_silence_preserves_speech() {
        let speech: Vec<f32> = (0..16000)
            .map(|i| 0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin())
            .collect();
        let result = strip_silence(&speech, 16000);
        assert_eq!(result.len(), speech.len());
    }

    #[test]
    fn strip_silence_trims_long_silence() {
        let mut samples = Vec::new();
        for i in 0..16000 {
            samples.push(0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin());
        }
        samples.extend(vec![0.0f32; 16000 * 5]);
        for i in 0..16000 {
            samples.push(0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin());
        }

        let result = strip_silence(&samples, 16000);
        let original_secs = samples.len() as f64 / 16000.0;
        let result_secs = result.len() as f64 / 16000.0;
        assert!(
            result_secs < original_secs * 0.7,
            "expected significant trimming: {:.1}s -> {:.1}s",
            original_secs,
            result_secs
        );
        assert!(
            result_secs > 2.0,
            "should preserve both speech segments: {:.1}s",
            result_secs
        );
    }

    #[test]
    fn strip_silence_keeps_short_pauses() {
        let mut samples = Vec::new();
        for i in 0..16000 {
            samples.push(0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin());
        }
        samples.extend(vec![0.0f32; 6400]);
        for i in 0..16000 {
            samples.push(0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin());
        }

        let result = strip_silence(&samples, 16000);
        let ratio = result.len() as f64 / samples.len() as f64;
        assert!(
            ratio > 0.9,
            "short pauses should be preserved: ratio {:.2}",
            ratio
        );
    }

    #[test]
    fn strip_silence_handles_all_silence() {
        let samples = vec![0.0f32; 16000 * 10];
        let result = strip_silence(&samples, 16000);
        assert!(result.len() < samples.len() / 2, "should trim most silence");
    }

    #[test]
    fn sinc_resample_no_aliasing() {
        let n = 44100;
        let samples: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 44100.0).sin())
            .collect();
        let resampled = resample(&samples, 44100, 16000);

        let peak = resampled.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(
            peak > 0.8,
            "440Hz tone should survive resampling with peak > 0.8, got {}",
            peak
        );
    }
}
