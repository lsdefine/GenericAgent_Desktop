//! Python discovery and packaged-runtime preparation. No windows or Agent objects.
use std::{path::PathBuf, process::{Command, Stdio}, io::{BufRead, BufReader}, sync::Mutex, thread};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use crate::settings::{read_settings, merge_settings};
mod source_layout;

fn source_project() -> Option<PathBuf> {
    source_layout::project_from_anchor(&bundle_anchor_dir()?)
}

/// Directory next to which a self-contained bundle keeps its runtime/ folder.
/// Windows: the exe's folder. Linux: the .AppImage's folder ($APPIMAGE) when launched as an
/// AppImage (current_exe would otherwise point inside the read-only squashfs mount).
/// macOS portable package: the folder containing GenericAgent.app and runtime/.
pub(crate) fn bundle_anchor_dir() -> Option<PathBuf> {
    #[cfg(not(windows))]
    {
        if let Some(p) = std::env::var_os("APPIMAGE") {
            if let Some(d) = PathBuf::from(p).parent() {
                return Some(d.to_path_buf());
            }
        }
    }

    let exe = std::env::current_exe().ok()?;

    #[cfg(target_os = "macos")]
    {
        // current_exe() inside a bundle is:
        //   <package>/GenericAgent.app/Contents/MacOS/GenericAgent
        // Prefer the standard macOS layout where runtime is embedded in the app:
        //   GenericAgent.app/Contents/Resources/runtime/app/agentmain.py
        // Fall back to the old portable layout for compatibility:
        //   <package>/runtime/app/agentmain.py
        let mut d = exe.parent();
        while let Some(dir) = d {
            if dir.extension().and_then(|s| s.to_str()) == Some("app") {
                let resources = dir.join("Contents").join("Resources");
                if resources.join("runtime").join("app").join("agentmain.py").exists() {
                    return Some(resources);
                }
                if let Some(parent) = dir.parent() {
                    return Some(parent.to_path_buf());
                }
            }
            d = dir.parent();
        }
    }

    Some(exe.parent()?.to_path_buf())
}

/// Interpreter associated with the executable's discovered project, never an unrelated checkout.
pub(crate) fn bundle_python() -> Option<PathBuf> {
    source_layout::python_in_project(&source_project()?)
}

/// Executable-adjacent layouts win; launcher working directory is the final fallback.
pub(crate) fn find_project_dir() -> Option<String> {
    source_project()
        .or_else(|| source_layout::project_from_anchor(&std::env::current_dir().ok()?))
        .map(|p| p.to_string_lossy().into_owned())
}

/// User-set external GenericAgent source directory (方案三: bundle shell + external core).
/// Returns the path only when it still looks like a GA core checkout (agentmain.py exists).
/// The bundle's own bridge/frontend/conductor are used; the saved source only becomes GA_ROOT.
/// An invalid/missing override returns None so callers fall back to the bundle runtime/app.
pub(crate) fn valid_ga_source_override() -> Option<String> {
    let s = read_settings()
        .get("ga_source_override")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if s.is_empty() {
        return None;
    }
    let p = PathBuf::from(&s);
    if p.join("agentmain.py").exists() {
        Some(p.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Explicit settings win per field. Discovery only fills missing values.
/// Invalid non-empty paths stay selected so startup reports an error, not another GA.
fn resolve_config(
    settings: &serde_json::Map<String, serde_json::Value>,
    discover_project: impl FnOnce() -> String,
    discover_python: impl FnOnce(&str) -> String,
) -> (String, String) {
    let saved = |key: &str| settings.get(key).and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty()).map(str::to_owned);
    let project = saved("project_dir").unwrap_or_else(discover_project);
    let python = saved("python_path").unwrap_or_else(|| discover_python(&project));
    (python, project)
}

pub(crate) fn get_or_discover_config() -> (String, String) {
    let settings = read_settings();
    let (python, project) = resolve_config(
        &settings,
        || find_project_dir().unwrap_or_default(),
        |project| source_layout::python_in_project(&PathBuf::from(project))
            .map(|p| p.to_string_lossy().into_owned())
            // A selected external project must not inherit this shell's bundled Python.
            .unwrap_or_else(|| if cfg!(windows) { "python".into() } else { "python3".into() }),
    );
    // Existing explicit fields are preserved verbatim; only discovered fields are added.
    if !python.is_empty() && !project.is_empty() {
        merge_settings(serde_json::json!({"python_path": python, "project_dir": project}));
    }
    (python, project)
}

/// Self-contained bundle support dir: holds python/, wheels/, install_windows.ps1 and app/.
/// Typical portable layout keeps only the exe (+README) at the top level and tucks everything
/// else under <exe dir>/runtime/. Returns None when this is not a bundle (e.g. dev build).
pub(crate) fn bundle_root() -> Option<PathBuf> {
    source_layout::legacy_runtime(&source_project()?)
}

/// Marker written after a successful offline prepare. Lives under runtime/ so it travels
/// with the bundle: a relocated folder stays "prepared" (deps live in the embedded python,
/// which is itself relocatable) and won't re-run prepare.
pub(crate) fn prepared_marker() -> Option<PathBuf> {
    Some(bundle_root()?.join(".prepared"))
}

/// True when this is a self-contained bundle whose python env has not been prepared yet
/// (embedded python present but deps not yet installed into it).
pub(crate) fn needs_first_run_prepare(python: &str, project_dir: &str) -> bool {
    let (Some(root), Some(bundled_python)) = (bundle_root(), bundle_python()) else {
        return false;
    };
    prepare_matches_selection(python, project_dir, &bundled_python, &root.join("app"))
        && prepared_marker().map(|m| !m.exists()).unwrap_or(false)
}

fn prepare_matches_selection(python: &str, project: &str, bundled_python: &std::path::Path,
                             bundled_project: &std::path::Path) -> bool {
    super::norm_path(python) == super::norm_path(&bundled_python.to_string_lossy())
        && super::norm_path(project) == super::norm_path(&bundled_project.to_string_lossy())
}

/// Clear env vars a host launcher injects pointing at its own runtime. The Linux AppImage exports
/// PYTHONHOME/PYTHONPATH (-> bundled python crashes with "No module named 'encodings'") and
/// LD_LIBRARY_PATH (-> wrong shared libs). Our bundled python / prepare / bridge must run clean.
pub(crate) fn sanitize_bundle_env(cmd: &mut Command) {
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");
    cmd.env_remove("LD_LIBRARY_PATH");
    if bundle_python().is_some_and(|p| p.as_os_str() == cmd.get_program()) {
        cmd.env("PYTHONNOUSERSITE", "1");
    }
    cmd.env_remove("GA_PROJECT_DIR");
    cmd.env("PYTHONDONTWRITEBYTECODE", "1");
    // Build id is diagnostic only; bridge reuse is based on the GA root.
    cmd.env("GA_BUILD_ID", env!("GA_BUILD_ID"));
    // 方案三: when the user has set a valid external GA source, inject it as GA_ROOT so the
    // (bundle's own) bridge + conductor import the external核 and read/write its data. When
    // unset/invalid we leave GA_ROOT unset → the bridge falls back to its own bundle runtime.
    match valid_ga_source_override() {
        Some(src) => { cmd.env("GA_ROOT", src); }
        None => { cmd.env_remove("GA_ROOT"); }
    }
}

/// Run the offline prepare (install_windows.ps1 -Mode PrepareOnly) using bundled python + wheels.
/// Streams the script's stdout and forwards GAPROGRESS markers to `report(pct, message)`.
/// Blocking; intended to run on a background thread. Writes ~/.ga_desktop_settings.json.
pub(crate) fn run_offline_prepare(project_dir: &str, report: &dyn Fn(i32, &str)) -> Result<(), String> {
    let root = bundle_root().ok_or("cannot locate bundle root")?;
    let wheels = root.join("wheels");

    #[cfg(windows)]
    let (script, py) = (
        root.join("install_windows.ps1"),
        root.join("python").join("python.exe"),
    );
    #[cfg(target_os = "macos")]
    let (script, py) = (
        root.join("install_macos.sh"),
        root.join("python").join("bin").join("python3"),
    );
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let (script, py) = (
        root.join("install_linux.sh"),
        root.join("python").join("bin").join("python3"),
    );

    if !script.exists() || !py.exists() || !wheels.exists() {
        return Err(format!("prepare resources missing under {:?}", root));
    }

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .arg("-PythonPath").arg(&py)
            .arg("-ProjectDir").arg(project_dir)
            .arg("-WheelDir").arg(&wheels)
            .arg("-ExtraPipPackages").arg("fastapi uvicorn websockets")
            // -NoVenv: install deps straight into the embedded python (no venv) so the
            // bundle is relocatable. See prepared_marker / bundle_python.
            .args(["-Mode", "PrepareOnly", "-SkipNpmInstall", "-NoVenv"]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("bash");
        c.arg(&script)
            .arg("--python-path").arg(&py)
            .arg("--project-dir").arg(project_dir)
            .arg("--wheel-dir").arg(&wheels)
            .arg("--extra-packages").arg("fastapi uvicorn websockets")
            // --no-venv: install deps straight into the embedded python (no venv) so the
            // bundle is relocatable. See prepared_marker / bundle_python.
            .args(["--mode", "PrepareOnly", "--no-venv"]);
        c
    };

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    sanitize_bundle_env(&mut cmd);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| format!("failed to launch prepare: {}", e))?;

    // Keep only the last N lines of a stream (pip errors are at the end; a full capture
    // could be huge and the setup window only needs the tail to explain the failure).
    const TAIL: usize = 40;
    fn push_tail(buf: &mut Vec<String>, line: String) {
        if buf.len() >= TAIL {
            buf.remove(0);
        }
        buf.push(line);
    }

    // Drain stderr on a helper thread (both pipes must be drained concurrently or the child
    // can deadlock on a full pipe buffer). pip/install errors land here.
    let stderr_tail = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_thread = child.stderr.take().map(|err| {
        let tail = std::sync::Arc::clone(&stderr_tail);
        thread::spawn(move || {
            for line in BufReader::new(err).lines().flatten() {
                push_tail(&mut tail.lock().unwrap(), line);
            }
        })
    });

    // Forward the script's ASCII progress keys to the loading window, which localizes them
    // (the loading UI localizes these keys). Non-progress stdout is
    // kept (tail only) so a failure can show what the script was doing when it died.
    let mut stdout_tail: Vec<String> = Vec::new();
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().flatten() {
            if let Some(key) = line.trim().strip_prefix("GAPROGRESS|") {
                match key.trim() {
                    "venv" => report(15, "venv"),
                    "deps" => report(45, "deps"),
                    "done" => report(90, "done"),
                    _ => {}
                }
            } else if !line.trim().is_empty() {
                push_tail(&mut stdout_tail, line);
            }
        }
    }

    let status = child.wait().map_err(|e| format!("prepare wait failed: {}", e))?;
    if let Some(h) = stderr_thread {
        let _ = h.join();
    }
    if !status.success() {
        // Surface the real installer output, not just the exit code (shown in the setup
        // window via get_prepare_error and written to prepare_error.log).
        let mut msg = format!("prepare exited with status {:?}", status.code());
        let err_lines = stderr_tail.lock().unwrap();
        if !err_lines.is_empty() {
            msg.push_str("\n\n--- stderr (tail) ---\n");
            msg.push_str(&err_lines.join("\n"));
        }
        if !stdout_tail.is_empty() {
            msg.push_str("\n\n--- output (tail) ---\n");
            msg.push_str(&stdout_tail.join("\n"));
        }
        return Err(msg);
    }
    // Record success so later launches (and relocated copies) skip the prepare step.
    if let Some(marker) = prepared_marker() {
        let _ = std::fs::write(&marker, b"ok\n");
    }
    Ok(())
}

#[cfg(test)]
mod config_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn explicit_settings_skip_all_discovery_even_if_paths_are_missing() {
        let settings = json!({"python_path": "missing/custom-python", "project_dir": "missing/custom-ga"});
        assert_eq!(resolve_config(settings.as_object().unwrap(),
            || panic!("must not discover project"),
            |_| panic!("must not discover Python")),
            ("missing/custom-python".into(), "missing/custom-ga".into()));
    }

    #[test]
    fn saved_project_only_discovers_python_for_that_project() {
        let settings = json!({"project_dir": "selected-ga"});
        let result = resolve_config(settings.as_object().unwrap(),
            || panic!("must not discover project"),
            |project| { assert_eq!(project, "selected-ga"); "selected-python".into() });
        assert_eq!(result, ("selected-python".into(), "selected-ga".into()));
    }

    #[test]
    fn saved_python_survives_project_discovery() {
        let settings = json!({"python_path": "selected-python"});
        assert_eq!(resolve_config(settings.as_object().unwrap(),
            || "adjacent-ga".into(), |_| panic!("must not discover Python")),
            ("selected-python".into(), "adjacent-ga".into()));
    }

    #[test]
    fn absent_and_blank_settings_allow_discovery() {
        for settings in [json!({}), json!({"python_path": " ", "project_dir": ""})] {
            assert_eq!(resolve_config(settings.as_object().unwrap(),
                || "adjacent-ga".into(), |project| format!("{project}/python")),
                ("adjacent-ga/python".into(), "adjacent-ga".into()));
        }
    }

    #[test]
    fn legacy_prepare_does_not_replace_selected_python_or_project() {
        let python = PathBuf::from("bundle/python");
        let project = PathBuf::from("bundle/app");
        assert!(prepare_matches_selection("bundle/python", "bundle/app", &python, &project));
        assert!(!prepare_matches_selection("custom/python", "bundle/app", &python, &project));
        assert!(!prepare_matches_selection("bundle/python", "custom/app", &python, &project));
    }
}
