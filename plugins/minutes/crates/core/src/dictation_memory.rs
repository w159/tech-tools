use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};

const SCHEMA_VERSION: u32 = 1;
const MAX_HISTORY_RECORDS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictationMemoryRecord {
    pub schema_version: u32,
    pub id: String,
    pub captured_at: DateTime<Local>,
    pub raw_text: String,
    pub cleaned_text: String,
    pub duration_secs: f64,
    pub engine_id: String,
    pub engine_descriptor_version: Option<String>,
    pub vocabulary_mode: Option<String>,
    pub vocabulary_used: Vec<String>,
    pub destination: String,
    pub insertion: DictationInsertionMemory,
    pub target_context: Option<DictationTargetContext>,
    pub file_path: Option<PathBuf>,
    pub daily_note_appended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DictationInsertionMemory {
    pub outcome: String,
    pub method: String,
    pub verified: bool,
    pub clipboard_restored: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DictationTargetContext {
    pub platform: String,
    pub app_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DictationMemoryInput {
    pub raw_text: String,
    pub cleaned_text: String,
    pub duration_secs: f64,
    pub engine_id: String,
    pub engine_descriptor_version: Option<String>,
    pub vocabulary_mode: Option<String>,
    pub vocabulary_used: Vec<String>,
    pub destination: String,
    pub insertion: DictationInsertionMemory,
    pub target_context: Option<DictationTargetContext>,
    pub file_path: Option<PathBuf>,
    pub daily_note_appended: bool,
}

impl DictationMemoryRecord {
    pub fn new(input: DictationMemoryInput) -> Self {
        let captured_at = Local::now();
        Self::from_parts(captured_at, input)
    }

    fn from_parts(captured_at: DateTime<Local>, input: DictationMemoryInput) -> Self {
        let id = record_id(
            &captured_at,
            &input.cleaned_text,
            input.duration_secs,
            &input.engine_id,
        );
        Self {
            schema_version: SCHEMA_VERSION,
            id,
            captured_at,
            raw_text: input.raw_text,
            cleaned_text: input.cleaned_text,
            duration_secs: input.duration_secs,
            engine_id: input.engine_id,
            engine_descriptor_version: input.engine_descriptor_version,
            vocabulary_mode: input.vocabulary_mode,
            vocabulary_used: input.vocabulary_used,
            destination: input.destination,
            insertion: input.insertion,
            target_context: input.target_context,
            file_path: input.file_path,
            daily_note_appended: input.daily_note_appended,
        }
    }
}

pub fn history_path() -> PathBuf {
    crate::config::Config::minutes_dir().join("dictation-history.json")
}

pub fn load_recent(limit: usize) -> io::Result<Vec<DictationMemoryRecord>> {
    load_recent_from(&history_path(), limit)
}

pub fn find_record(id: &str) -> io::Result<Option<DictationMemoryRecord>> {
    Ok(load_recent(MAX_HISTORY_RECORDS)?
        .into_iter()
        .find(|record| record.id == id))
}

pub fn append_record(record: DictationMemoryRecord) -> io::Result<()> {
    append_record_to(&history_path(), record, MAX_HISTORY_RECORDS)
}

fn load_recent_from(path: &Path, limit: usize) -> io::Result<Vec<DictationMemoryRecord>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(path)?;
    if data.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut records: Vec<DictationMemoryRecord> = serde_json::from_str(&data)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    records.sort_by_key(|r| std::cmp::Reverse(r.captured_at));
    if limit > 0 && records.len() > limit {
        records.truncate(limit);
    }
    Ok(records)
}

fn append_record_to(
    path: &Path,
    record: DictationMemoryRecord,
    max_records: usize,
) -> io::Result<()> {
    let mut records = load_recent_from(path, max_records.max(1)).unwrap_or_default();
    records.retain(|existing| existing.id != record.id);
    records.insert(0, record);
    records.sort_by_key(|r| std::cmp::Reverse(r.captured_at));
    if records.len() > max_records {
        records.truncate(max_records);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(&mut tmp, &records).map_err(io::Error::other)?;
        tmp.persist(path).map_err(|error| error.error)?;
    }
    Ok(())
}

fn record_id(
    captured_at: &DateTime<Local>,
    cleaned_text: &str,
    duration_secs: f64,
    engine_id: &str,
) -> String {
    let mut hasher = DefaultHasher::new();
    captured_at
        .timestamp_nanos_opt()
        .unwrap_or_default()
        .hash(&mut hasher);
    cleaned_text.hash(&mut hasher);
    duration_secs.to_bits().hash(&mut hasher);
    engine_id.hash(&mut hasher);
    format!(
        "dict-{}-{:016x}",
        captured_at.format("%Y%m%d%H%M%S"),
        hasher.finish()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use tempfile::TempDir;

    fn sample_record(offset: i64, text: &str) -> DictationMemoryRecord {
        let captured_at = Local.timestamp_opt(1_700_000_000 + offset, 0).unwrap();
        DictationMemoryRecord::from_parts(
            captured_at,
            DictationMemoryInput {
                raw_text: text.into(),
                cleaned_text: text.into(),
                duration_secs: 1.5,
                engine_id: "whisper:base".into(),
                engine_descriptor_version: Some("base".into()),
                vocabulary_mode: None,
                vocabulary_used: Vec::new(),
                destination: "clipboard".into(),
                insertion: DictationInsertionMemory {
                    outcome: "copied".into(),
                    method: "clipboard_only".into(),
                    verified: true,
                    clipboard_restored: false,
                    message: "Copied dictation to the clipboard.".into(),
                },
                target_context: Some(DictationTargetContext {
                    platform: "macos".into(),
                    app_name: Some("Notes".into()),
                }),
                file_path: None,
                daily_note_appended: false,
            },
        )
    }

    #[test]
    fn append_record_keeps_newest_first_and_truncates() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("history.json");

        append_record_to(&path, sample_record(0, "old"), 2).unwrap();
        append_record_to(&path, sample_record(2, "new"), 2).unwrap();
        append_record_to(&path, sample_record(1, "middle"), 2).unwrap();

        let records = load_recent_from(&path, 10).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].cleaned_text, "new");
        assert_eq!(records[1].cleaned_text, "middle");
    }

    #[test]
    fn append_record_replaces_duplicate_id() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("history.json");
        let mut record = sample_record(0, "first");
        let id = record.id.clone();

        append_record_to(&path, record.clone(), 10).unwrap();
        record.cleaned_text = "updated".into();
        append_record_to(&path, record, 10).unwrap();

        let records = load_recent_from(&path, 10).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, id);
        assert_eq!(records[0].cleaned_text, "updated");
    }
}
