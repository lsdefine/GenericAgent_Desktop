use std::path::PathBuf;

/// Settings file path: ~/.ga_desktop_settings.json
pub(crate) fn settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ga_desktop_settings.json")
}

/// Read the settings file as a JSON object (empty object when missing/unparseable).
pub(crate) fn read_settings() -> serde_json::Map<String, serde_json::Value> {
    let path = settings_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(serde_json::Value::Object(m)) = serde_json::from_str(&content) {
            return m;
        }
    }
    serde_json::Map::new()
}

/// Merge `updates` into the existing settings file and write it back, preserving any keys
/// we don't touch. The old code rewrote the file with only python_path/project_dir, which
/// would silently drop sibling keys like `desktop_shortcut`. Always go through here.
pub(crate) fn merge_settings(updates: serde_json::Value) {
    let mut obj = read_settings();
    if let serde_json::Value::Object(m) = updates {
        for (k, v) in m {
            obj.insert(k, v);
        }
    }
    let val = serde_json::Value::Object(obj);
    if let Ok(text) = serde_json::to_string_pretty(&val) {
        let _ = std::fs::write(settings_path(), text);
    }
}

/// Remove a single key from the settings file (merge_settings can only add/overwrite).
pub(crate) fn remove_setting(key: &str) {
    let mut obj = read_settings();
    obj.remove(key);
    let val = serde_json::Value::Object(obj);
    if let Ok(text) = serde_json::to_string_pretty(&val) {
        let _ = std::fs::write(settings_path(), text);
    }
}
