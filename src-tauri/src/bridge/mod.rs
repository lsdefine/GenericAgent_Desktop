//! Bridge lifecycle only: resolve environment, prepare, start, verify, stop.
//! No Tauri, navigation, Agent imports, or application runtime state.
pub(crate) mod environment;
use environment::*;
use std::{process::{Child, Command}, sync::Mutex, net::TcpStream, time::{Duration, Instant}, thread, path::PathBuf};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

static LIFECYCLE: Mutex<()> = Mutex::new(());
static BRIDGE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
type Report<'a> = &'a dyn Fn(i32, &str);

pub(crate) fn start(config: Option<(String, String)>, report: Report<'_>) -> Result<String, String> {
    let _operation = LIFECYCLE.lock().map_err(|e| e.to_string())?;
    start_inner(config, report)
}

pub(crate) fn restart(report: Report<'_>) -> Result<String, String> {
    let _operation = LIFECYCLE.lock().map_err(|e| e.to_string())?;
    stop_inner()?;
    start_inner(None, report)
}

pub(crate) fn stop() -> Result<(), String> {
    let _operation = LIFECYCLE.lock().map_err(|e| e.to_string())?;
    stop_inner()
}

fn start_inner(config: Option<(String, String)>, report: Report<'_>) -> Result<String, String> {
    let explicit = config.is_some();
    let (python, project) = config.unwrap_or_else(get_or_discover_config);
    if project.is_empty() { return Err("No bridge project directory configured".into()); }
    let expected = valid_ga_source_override().unwrap_or_else(|| project.clone());
    if bridge_identity_matches(&expected) { return Ok(project); }
    if is_bridge_running() { stop_inner()?; }
    if !explicit && needs_first_run_prepare(&python, &project) {
        report(5, "start");
        run_offline_prepare(&project, report)?;
    }
    report(95, "starting");
    spawn_bridge_process(&python, &project)?;
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if bridge_identity_matches(&expected) {
            if explicit {
                crate::settings::merge_settings(serde_json::json!({"python_path": python, "project_dir": project}));
            }
            return Ok(project);
        }
        if let Some(child) = BRIDGE_PROCESS.lock().unwrap().as_mut() {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                return Err(format!("Bridge exited before ready: {}", status));
            }
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err("Bridge did not report the expected identity within 60s".into())
}

fn stop_inner() -> Result<(), String> {
    if is_bridge_running() {
        // Never kill an unrelated listener merely because it occupies our port.
        if bridge_reported_identity().is_none() {
            return Err("Port 14168 is occupied by an unrecognized service".into());
        }
        request_bridge_shutdown();
        let deadline = Instant::now() + Duration::from_secs(10);
        while is_bridge_running() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(150));
        }
    }
    if let Some(mut child) = BRIDGE_PROCESS.lock().unwrap().take() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            child.kill().map_err(|e| format!("Cannot stop bridge: {}", e))?;
        }
        let _ = child.wait();
    }
    if is_bridge_running() { return Err("Bridge did not shut down; refusing to kill an unowned process".into()); }
    Ok(())
}

fn bridge_reported_identity() -> Option<serde_json::Value> {
    use std::io::{Read, Write};
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:14168".parse().unwrap(),
        Duration::from_millis(800),
    ).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = b"GET /services/identity HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    stream.write_all(req).ok()?;
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let body = text.split("\r\n\r\n").nth(1)?;
    serde_json::from_str(body.trim()).ok()
}

pub(crate) fn norm_path(p: &str) -> String {
    let normalized = std::fs::canonicalize(p)
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_else(|_| p.to_string());
    normalized.strip_prefix(r"\\?\").unwrap_or(&normalized).to_string()
}

/// Renderer upgrades must not restart a live bridge serving the same GA root.
fn bridge_identity_matches(project_dir: &str) -> bool {
    bridge_reported_identity().is_some_and(|id| identity_matches_root(&id, project_dir))
}

fn identity_matches_root(id: &serde_json::Value, project_dir: &str) -> bool {
    let Some(reported_root) = id.get("ga_root").and_then(|v| v.as_str()) else {
        return false;
    };
    if reported_root.is_empty() || project_dir.is_empty() { return false; }
    let (a, b) = (norm_path(reported_root), norm_path(project_dir));
    #[cfg(windows)]
    { a.eq_ignore_ascii_case(&b) }
    #[cfg(not(windows))]
    { a == b }
}
fn request_bridge_shutdown() {
    use std::io::{Read, Write};
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:14168".parse().unwrap(),
        Duration::from_millis(800),
    ) else {
        return;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = b"POST /services/bridge/exit HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(req);
    let _ = stream.read(&mut [0u8; 512]);
}

fn is_bridge_running() -> bool {
    TcpStream::connect(("127.0.0.1", 14168)).is_ok()
}

fn spawn_bridge_process(python_path: &str, project_dir: &str) -> Result<(), String> {
    if is_bridge_running() {
        return Ok(());
    }
    let py = PathBuf::from(python_path);
    let dir = PathBuf::from(project_dir);
    let script = dir.join("frontends").join("desktop_bridge.py");
    if !script.exists() {
        return Err(format!("desktop_bridge.py not found at {:?}", script));
    }

    let mut cmd = Command::new(&py);
    cmd.arg(&script).current_dir(&dir);
    sanitize_bundle_env(&mut cmd);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    *BRIDGE_PROCESS.lock().unwrap() = Some(child);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuse_same_root_independent_of_renderer_build() {
        let root = std::env::current_dir().unwrap();
        let root = root.to_str().unwrap();
        for build in [None, Some(""), Some("older-renderer-build")] {
            let mut id = serde_json::json!({"ga_root": root});
            if let Some(build) = build { id["build_id"] = build.into(); }
            assert!(identity_matches_root(&id, root));
        }
    }

    #[test]
    fn reject_missing_or_different_root() {
        assert!(!identity_matches_root(&serde_json::json!({}), "root"));
        assert!(!identity_matches_root(&serde_json::json!({"ga_root": ""}), ""));
        assert!(!identity_matches_root(&serde_json::json!({"ga_root": "root-a"}), "root-b"));
    }
}
