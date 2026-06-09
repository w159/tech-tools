use serde::Serialize;

pub const OPENAI_COMPATIBLE_API_KEY_ENV: &str =
    minutes_core::config::OPENAI_COMPATIBLE_DESKTOP_API_KEY_ENV;

const OPENAI_COMPATIBLE_SERVICE: &str = "Minutes OpenAI-compatible Summaries";
const OPENAI_COMPATIBLE_ACCOUNT: &str = "default";
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleSecretStatus {
    pub supported: bool,
    pub key_set: bool,
    pub stored_key_set: bool,
    pub storage_label: &'static str,
    pub env_var: &'static str,
    pub message: String,
}

pub fn hydrate_openai_compatible_api_key_env() -> OpenAiCompatibleSecretStatus {
    let existing_env_key = std::env::var(OPENAI_COMPATIBLE_API_KEY_ENV).is_ok();
    let stored_key = load_openai_compatible_api_key().ok().flatten();

    if !existing_env_key {
        if let Some(key) = stored_key.as_deref() {
            std::env::set_var(OPENAI_COMPATIBLE_API_KEY_ENV, key);
        }
    }

    openai_compatible_secret_status()
}

pub fn openai_compatible_secret_status() -> OpenAiCompatibleSecretStatus {
    let env_key_set = std::env::var(OPENAI_COMPATIBLE_API_KEY_ENV).is_ok();
    let stored_key_set = load_openai_compatible_api_key().ok().flatten().is_some();
    let key_set = env_key_set || stored_key_set;

    OpenAiCompatibleSecretStatus {
        supported: keychain_supported(),
        key_set,
        stored_key_set,
        storage_label: storage_label(),
        env_var: OPENAI_COMPATIBLE_API_KEY_ENV,
        message: secret_status_message(key_set, stored_key_set),
    }
}

pub fn save_openai_compatible_api_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("Paste an API key first.".into());
    }

    save_secret(api_key)
}

pub fn clear_openai_compatible_api_key() -> Result<(), String> {
    clear_secret()
}

fn secret_status_message(key_set: bool, stored_key_set: bool) -> String {
    if stored_key_set {
        return "Key saved in macOS Keychain.".into();
    }
    if key_set {
        return format!(
            "Using {} from this app environment.",
            OPENAI_COMPATIBLE_API_KEY_ENV
        );
    }
    if keychain_supported() {
        return "Paste a key once. Minutes stores it in macOS Keychain.".into();
    }

    format!(
        "Keychain storage is unavailable on this OS. Set {} before launching Minutes.",
        OPENAI_COMPATIBLE_API_KEY_ENV
    )
}

#[cfg(target_os = "macos")]
fn keychain_supported() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
fn keychain_supported() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn storage_label() -> &'static str {
    "macOS Keychain"
}

#[cfg(not(target_os = "macos"))]
fn storage_label() -> &'static str {
    "environment variable"
}

#[cfg(target_os = "macos")]
pub fn load_openai_compatible_api_key() -> Result<Option<String>, String> {
    let password = match security_framework::passwords::get_generic_password(
        OPENAI_COMPATIBLE_SERVICE,
        OPENAI_COMPATIBLE_ACCOUNT,
    ) {
        Ok(password) => password,
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => return Ok(None),
        Err(error) => return Err(format!("Could not read Keychain: {}", error)),
    };

    let key = String::from_utf8(password)
        .map_err(|error| format!("Keychain returned invalid UTF-8: {}", error))?
        .trim_end_matches(['\r', '\n'])
        .to_string();

    if key.is_empty() {
        Ok(None)
    } else {
        Ok(Some(key))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn load_openai_compatible_api_key() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn save_secret(api_key: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        OPENAI_COMPATIBLE_SERVICE,
        OPENAI_COMPATIBLE_ACCOUNT,
        api_key.as_bytes(),
    )
    .map_err(|error| format!("Could not save API key to Keychain: {}", error))
}

#[cfg(not(target_os = "macos"))]
fn save_secret(_api_key: &str) -> Result<(), String> {
    Err(format!(
        "Keychain storage is unavailable on this OS. Set {} before launching Minutes.",
        OPENAI_COMPATIBLE_API_KEY_ENV
    ))
}

#[cfg(target_os = "macos")]
fn clear_secret() -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(
        OPENAI_COMPATIBLE_SERVICE,
        OPENAI_COMPATIBLE_ACCOUNT,
    ) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(format!("Could not update Keychain: {}", error)),
    }
}

#[cfg(not(target_os = "macos"))]
fn clear_secret() -> Result<(), String> {
    Ok(())
}
