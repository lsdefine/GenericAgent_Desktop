mod message_target;
mod settings;
mod bridge;
#[tauri::command]
fn edit_mykey() -> Result<(), String> {
    let root = PathBuf::from(get_or_discover_config().1);
    if !root.join("agentmain.py").is_file() { return Err("GA source directory not found".into()); }
    let path = root.join("mykey.py");
    if !path.exists() {
        let mut source = std::fs::File::open(root.join("mykey_template.py")).map_err(|e| e.to_string())?;
        let mut target = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
        std::io::copy(&mut source, &mut target).map_err(|e| e.to_string())?;
    }
    let path = norm_path(&std::fs::canonicalize(&path).map_err(|e| e.to_string())?.to_string_lossy());
    #[cfg(windows)]
    {
        // Query the user's text editor, NOT the executable association for .py.
        #[link(name = "shlwapi")]
        extern "system" { fn AssocQueryStringW(flags: u32, kind: u32, assoc: *const u16, verb: *const u16, out: *mut u16, len: *mut u32) -> i32; }
        let mut buf = [0u16; 32768]; let mut len = buf.len() as u32;
        let assoc: Vec<u16> = ".txt\0".encode_utf16().collect();
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let result = unsafe { AssocQueryStringW(0, 2, assoc.as_ptr(), verb.as_ptr(), buf.as_mut_ptr(), &mut len) };
        let editor = if result == 0 { String::from_utf16_lossy(&buf[..len.saturating_sub(1) as usize]) } else { "notepad.exe".into() };
        return Command::new(editor).arg(&path).spawn().map(|_| ()).map_err(|e| format!("Could not launch text editor: {e}"));
    }
    #[cfg(target_os = "macos")]
    let launched = Command::new("open").args(["-t"]).arg(&path).spawn().is_ok();
    #[cfg(all(unix, not(target_os = "macos")))]
    let launched = ["gnome-text-editor", "gedit", "kate", "mousepad", "xed", "code"]
        .iter().any(|editor| Command::new(editor).arg(&path).spawn().is_ok());
    #[cfg(not(windows))]
    if launched { Ok(()) } else { Err("Could not launch a text editor".into()) }
}
use settings::{read_settings, merge_settings, remove_setting};
use bridge::{norm_path, environment::{bundle_root, get_or_discover_config, sanitize_bundle_env}};
use std::{process::Command, path::PathBuf};
use tauri::{Manager, Emitter};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Desktop-shortcut preference stored in settings under `desktop_shortcut`.
/// None  = never asked (first run)
/// Some(true)/Some(false) = user's remembered choice.
fn read_shortcut_pref() -> Option<bool> {
    read_settings().get("desktop_shortcut").and_then(|v| v.as_bool())
}

fn write_shortcut_pref(enabled: bool) {
    merge_settings(serde_json::json!({ "desktop_shortcut": enabled }));
}

/// Create (or overwrite) a desktop shortcut pointing at the CURRENT exe. Overwriting on every
/// enabled launch is what makes the portable bundle relocatable: move the folder, relaunch, and
/// the shortcut is rewritten to the new path. Windows-only (uses a .lnk via WScript.Shell).
#[cfg(windows)]
fn ensure_desktop_shortcut() {
    let Ok(exe) = std::env::current_exe() else { return; };
    let Some(desktop) = dirs::desktop_dir() else { return; };
    let lnk = desktop.join("GenericAgent.lnk");
    let work_dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| exe.clone());

    let exe_s = exe.to_string_lossy().replace('\'', "''");
    let lnk_s = lnk.to_string_lossy().replace('\'', "''");
    let work_s = work_dir.to_string_lossy().replace('\'', "''");

    // Build the shortcut via WScript.Shell COM, consistent with the existing powershell usage
    // elsewhere in this file. No extra crate needed.
    let script = format!(
        "$ws = New-Object -ComObject WScript.Shell; \
         $sc = $ws.CreateShortcut('{lnk}'); \
         $sc.TargetPath = '{exe}'; \
         $sc.WorkingDirectory = '{work}'; \
         $sc.IconLocation = '{exe}'; \
         $sc.Save()",
        lnk = lnk_s, exe = exe_s, work = work_s
    );

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let _ = cmd.status();
}

#[cfg(target_os = "linux")]
fn ensure_desktop_shortcut() {
    // Launch target: the AppImage path when running as one, else the current exe. Writing the
    // current path on every enabled launch keeps a relocated bundle's launcher valid.
    let Some(target) = std::env::var_os("APPIMAGE").map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok()) else { return; };
    let exec = target.to_string_lossy().replace('"', "");
    // Linux .desktop Icon= needs an image file (or themed name), not the AppImage path. The CI
    // ships GenericAgent.png next to the AppImage; fall back to a generic themed icon otherwise.
    let icon = bridge::environment::bundle_anchor_dir()
        .map(|d| d.join("GenericAgent.png"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "application-x-executable".to_string());
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=GenericAgent\nComment=GenericAgent Desktop\n\
         Exec=\"{exec}\"\nIcon={icon}\nTerminal=false\nCategories=Utility;Development;\n",
        exec = exec, icon = icon
    );
    let write_desktop = |path: &std::path::Path| {
        if std::fs::write(path, &entry).is_ok() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
        }
    };
    if let Some(home) = dirs::home_dir() {
        let apps = home.join(".local/share/applications");
        let _ = std::fs::create_dir_all(&apps);
        write_desktop(&apps.join("GenericAgent.desktop"));
    }
    if let Some(desktop) = dirs::desktop_dir() {
        let _ = std::fs::create_dir_all(&desktop);
        let f = desktop.join("GenericAgent.desktop");
        write_desktop(&f);
        // GNOME marks unknown launchers "untrusted"; flag ours so it runs on double-click. Best effort.
        let _ = Command::new("gio")
            .args(["set", &f.to_string_lossy(), "metadata::trusted", "true"])
            .status();
    }
}

#[cfg(target_os = "macos")]
fn ensure_desktop_shortcut() {
    // The .app is the launchable unit; drop a symlink to it on the Desktop.
    let Ok(exe) = std::env::current_exe() else { return; };
    let mut app: Option<PathBuf> = None;
    let mut d = exe.parent();
    while let Some(dir) = d {
        if dir.extension().and_then(|s| s.to_str()) == Some("app") { app = Some(dir.to_path_buf()); break; }
        d = dir.parent();
    }
    let (Some(app), Some(desktop)) = (app, dirs::desktop_dir()) else { return; };
    let link = desktop.join("GenericAgent.app");
    let _ = std::fs::remove_file(&link);
    let _ = std::os::unix::fs::symlink(&app, &link);
}

#[cfg(all(not(windows), not(target_os = "linux"), not(target_os = "macos")))]
fn ensure_desktop_shortcut() {}

/// First-run shortcut handling for portable bundles (all platforms). Self-heals the shortcut
/// path on every enabled launch (cheap, no UI). The first-run ASK is driven by the frontend
/// (see the `shortcut_should_ask` / `shortcut_decide` commands): a native dialog from this
/// background startup thread has no parent window and gets buried behind the main window on
/// first launch, so the prompt is owned by the web UI instead, which always renders on top.
fn maybe_setup_shortcut() {
    if bundle_root().is_none() {
        return;
    }
    // Only self-heal when the user already opted in. Never prompt here.
    if read_shortcut_pref() == Some(true) {
        ensure_desktop_shortcut();
    }
}

/// Frontend asks whether to show the first-run "create desktop shortcut?" prompt.
/// True only on a portable bundle whose preference has never been set.
#[tauri::command]
fn shortcut_should_ask() -> bool {
    bundle_root().is_some() && read_shortcut_pref().is_none()
}

#[tauri::command]
fn shortcut_decide(create: bool) {
    write_shortcut_pref(create);
    if create {
        ensure_desktop_shortcut();
    }
}

fn show_bridge_window(app_handle: &tauri::AppHandle) {
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let url = tauri::Url::parse("tauri://localhost/index.html").unwrap();
        let _ = main_win.navigate(url);
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }
}

// IPC adapters only. All entry points use the same serialized lifecycle.
async fn run_bridge_action(app: tauri::AppHandle, action: &'static str, config: Option<(String, String)>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let report = |pct, key: &str| {
            let _ = app.emit("bootstrap", serde_json::json!({"type":"stage", "key":key, "state":"running", "pct":pct}));
        };
        match action {
            "stop" => bridge::stop().map(|_| String::new()),
            "restart" => bridge::restart(&report),
            _ => bridge::start(config, &report),
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_bridge(app_handle: tauri::AppHandle) -> Result<String, String> {
    run_bridge_action(app_handle, "start", None).await
}
#[tauri::command]
async fn start_bridge_with_config(app_handle: tauri::AppHandle, python_path: String, project_dir: String) -> Result<String, String> {
    run_bridge_action(app_handle, "start", Some((python_path, project_dir))).await
}
#[tauri::command]
async fn restart_bridge(app_handle: tauri::AppHandle) -> Result<String, String> {
    run_bridge_action(app_handle, "restart", None).await
}
#[tauri::command]
async fn stop_bridge(app_handle: tauri::AppHandle) -> Result<String, String> {
    run_bridge_action(app_handle, "stop", None).await
}
#[tauri::command]
async fn bootstrap_bridge(app_handle: tauri::AppHandle) -> Result<String, String> {
    if std::env::args().any(|arg| arg == "--no-autostart") {
        return Err("Automatic startup is disabled; start the bridge manually".into());
    }
    start_bridge(app_handle).await
}

#[tauri::command]
fn get_config() -> (String, String) {
    get_or_discover_config()
}

#[tauri::command]
fn export_mykey(content: String) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_file_name("mykey.py")
        .add_filter("Python", &["py"])
        .save_file();
    match path {
        Some(p) => {
            std::fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())?;
            Ok(Some(p.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn pick_directory(title: Option<String>) -> Option<String> {
    let mut dlg = rfd::FileDialog::new();
    if let Some(t) = title {
        if !t.is_empty() {
            dlg = dlg.set_title(&t);
        }
    }
    dlg.pick_folder().map(|p| p.to_string_lossy().into_owned())
}

fn switch_bridge(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let project = bridge::restart(&|_, _| {})?;
    show_bridge_window(app_handle);
    Ok(project)
}

#[tauri::command]
fn get_ga_source() -> String {
    read_settings()
        .get("ga_source_override")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Run the desktop-owned, embedded contract probe against a
/// target ga_root using the bundle python. Returns Ok(()) if the核 satisfies the bridge/conductor
/// contract, or Err(message) listing what's missing / why it's incompatible.
fn probe_ga_source(dir: &str) -> Result<(), String> {
    let (py, _) = get_or_discover_config();
    if py.is_empty() {
        return Err("no python available to run the compatibility probe".into());
    }
    let mut cmd = Command::new(&py);
    cmd.arg("-c").arg(include_str!("../../scripts/ga_contract_probe.py")).arg(dir);
    sanitize_bundle_env(&mut cmd);
    // If switching from one external core to another, validate the candidate core, not the
    // previously saved GA_ROOT that sanitize_bundle_env may have injected.
    cmd.env("GA_ROOT", dir);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let out = cmd.output().map_err(|e| format!("probe failed to run: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // The probe prints a JSON line: {"ok":bool,"missing":[..],"error":".."}.
    if let Some(line) = stdout.lines().rev().find(|l| l.trim_start().starts_with('{')) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false) {
                return Ok(());
            }
            let missing = v.get("missing")
                .and_then(|m| m.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
            let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("");
            let mut msg = String::from("this GenericAgent core is not compatible");
            if !missing.is_empty() { msg = format!("{}: missing {}", msg, missing); }
            if !err.is_empty() { msg = format!("{} ({})", msg, err); }
            return Err(msg);
        }
    }
    Err(format!("compatibility probe returned no verdict: {}",
        String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")))
}

#[tauri::command]
fn set_ga_source(app_handle: tauri::AppHandle, dir: String) -> Result<String, String> {
    let p = PathBuf::from(&dir);
    if !p.join("agentmain.py").exists() {
        return Err("not a GenericAgent source: agentmain.py not found".into());
    }
    // 方案三: we do NOT copy files into 本体. We run the bundle's own bridge/frontend and point
    // its ga_root at this external核 via GA_ROOT. Verify the核 satisfies the contract first so a
    // stale/incompatible核 fails up front with a clear message instead of a runtime crash.
    probe_ga_source(&dir)?;
    merge_settings(serde_json::json!({ "ga_source_override": dir }));
    switch_bridge(&app_handle)
}

#[tauri::command]
fn move_ga_runtime(
    app_handle: tauri::AppHandle,
    target_parent: String,
) -> Result<String, String> {
    let bundled_project = get_or_discover_config().1;
    let old_override = read_settings()
        .get("ga_source_override")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let source = old_override
        .clone()
        .unwrap_or_else(|| bundled_project.clone());
    let source_path = PathBuf::from(&source);

    if !source_path.join("agentmain.py").exists() {
        return Err("active GenericAgent runtime is missing agentmain.py".into());
    }

    let parent_path = PathBuf::from(&target_parent);
    std::fs::create_dir_all(&parent_path)
        .map_err(|error| format!("cannot create target directory: {}", error))?;
    let target_path = parent_path.join("GenericAgent");
    if norm_path(&source) == norm_path(&target_path.to_string_lossy()) {
        return Ok(norm_path(&source));
    }
    if target_path.exists() {
        return Err(format!("target already exists: {}", target_path.display()));
    }

    std::fs::create_dir_all(&target_path)
        .map_err(|error| format!("cannot create target runtime: {}", error))?;
    if let Err(error) = copy_runtime_tree(&source_path, &target_path) {
        let _ = std::fs::remove_dir_all(&target_path);
        return Err(error);
    }

    let target_root = norm_path(&target_path.to_string_lossy());
    merge_settings(serde_json::json!({ "ga_source_override": target_root }));
    match switch_bridge(&app_handle) {
        Ok(_) => {
            let source_is_external_override = old_override
                .as_ref()
                .map(|old| {
                    norm_path(old) == norm_path(&source)
                        && norm_path(old) != norm_path(&bundled_project)
                        && norm_path(old) != target_root
                })
                .unwrap_or(false);
            if source_is_external_override {
                if let Some(old) = old_override {
                    if let Err(error) = std::fs::remove_dir_all(&old) {
                        eprintln!("[tauri] failed to remove old external runtime {}: {}", old, error);
                    }
                }
            }
            Ok(target_root)
        }
        Err(switch_error) => {
            if let Some(old) = old_override {
                merge_settings(serde_json::json!({ "ga_source_override": old }));
            } else {
                remove_setting("ga_source_override");
            }
            let restore_result = switch_bridge(&app_handle);
            let _ = std::fs::remove_dir_all(&target_path);
            match restore_result {
                Ok(_) => Err(format!("{}; previous runtime restored", switch_error)),
                Err(restore_error) => Err(format!(
                    "{}; failed to restore previous runtime: {}",
                    switch_error, restore_error
                )),
            }
        }
    }
}

fn copy_runtime_tree(
    source: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), String> {
    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("cannot read runtime: {}", error))?
    {
        let entry = entry.map_err(|error| format!("cannot read runtime entry: {}", error))?;
        let source_entry = entry.path();
        let target_entry = target.join(entry.file_name());

        if source_entry.is_dir() {
            std::fs::create_dir_all(&target_entry)
                .map_err(|error| format!("cannot create copied directory: {}", error))?;
            copy_runtime_tree(&source_entry, &target_entry)?;
        } else {
            std::fs::copy(&source_entry, &target_entry)
                .map_err(|error| format!("cannot copy runtime file: {}", error))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn clear_ga_source(app_handle: tauri::AppHandle) -> Result<String, String> {
    remove_setting("ga_source_override");
    switch_bridge(&app_handle)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![message_target::open_message_target, bootstrap_bridge, start_bridge_with_config, start_bridge, stop_bridge, restart_bridge, get_config, export_mykey, edit_mykey, pick_directory, get_ga_source, set_ga_source, clear_ga_source, move_ga_runtime, shortcut_should_ask, shortcut_decide])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                if std::env::args().any(|arg| arg == "--dev") { w.open_devtools(); }
            }
            // The loading page subscribes before requesting bootstrap; no lost progress events.
            maybe_setup_shortcut();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Closing the UI deliberately leaves the bridge running for warm reattachment.
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
