use std::path::PathBuf;

fn resolve_file(target: &str, cwd: Option<&str>) -> Result<PathBuf, String> {
    let path = if target.to_ascii_lowercase().starts_with("file:") {
        tauri::Url::parse(target).map_err(|e| e.to_string())?
            .to_file_path().map_err(|_| "Invalid file URL".to_string())?
    } else {
        if !PathBuf::from(target).is_absolute() && target.contains(':') && !(target.as_bytes().get(1) == Some(&b':') &&
            matches!(target.as_bytes().get(2), Some(b'\\' | b'/'))) {
            return Err("Unsupported link protocol".into());
        }
        PathBuf::from(target)
    };
    let path = if path.is_absolute() { path } else {
        let base = PathBuf::from(cwd.ok_or("Session working directory unavailable")?);
        if !base.is_absolute() { return Err("Session working directory is not absolute".into()); }
        // GA tools default to ./temp; explicit project-relative paths remain supported.
        let tool_path = base.join("temp").join(&path);
        if tool_path.exists() { tool_path } else { base.join(path) }
    };
    std::fs::canonicalize(&path).map_err(|e| format!("{}: {}", path.display(), e))
}

#[tauri::command]
pub fn open_message_target(target: String, cwd: Option<String>) -> Result<(), String> {
    if target.to_ascii_lowercase().starts_with("http:") || target.to_ascii_lowercase().starts_with("https:") {
        let url = tauri::Url::parse(&target).map_err(|e| e.to_string())?;
        if url.host_str().is_none() { return Err("Invalid web URL".into()); }
        return tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string());
    }
    let path = resolve_file(&target, cwd.as_deref())?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_existing_files_without_opening_them() {
        let cwd = std::env::current_dir().unwrap();
        let expected = cwd.join("Cargo.toml").canonicalize().unwrap();
        assert_eq!(resolve_file("Cargo.toml", cwd.to_str()).unwrap(), expected);
        assert_eq!(resolve_file(expected.to_str().unwrap(), None).unwrap(), expected);
        let url = tauri::Url::from_file_path(&expected).unwrap();
        assert_eq!(resolve_file(url.as_str(), None).unwrap(), expected);
    }
    #[test]
    fn rejects_unknown_protocols_missing_files_and_missing_cwd() {
        for path in ["javascript:alert(1)", "shell:AppsFolder", "sandbox:/tmp/test", "missing-file.zip"] {
            assert!(resolve_file(path, None).is_err());
        }
    }
}
