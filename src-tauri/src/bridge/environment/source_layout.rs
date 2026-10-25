//! Source installs and self-contained releases share the same GA root.
use std::path::{Path, PathBuf};

pub(super) fn is_project(root: &Path) -> bool {
    root.join("agentmain.py").is_file() && root.join("frontends/desktop_bridge.py").is_file()
}

pub(super) fn project_from_anchor(anchor: &Path) -> Option<PathBuf> {
    // Local layouts only: never recurse through a disk or choose an arbitrary sibling repo.
    // Eight levels cover frontends/desktop/src-tauri/target/{debug,release} and .app internals.
    for dir in anchor.ancestors().take(8) {
        for relative in ["", "runtime/app", "Contents/Resources/runtime/app", "GenericAgent"] {
            let candidate = if relative.is_empty() { dir.to_path_buf() } else { dir.join(relative) };
            if is_project(&candidate) { return Some(candidate); }
        }
    }
    None
}

pub(super) fn legacy_runtime(project: &Path) -> Option<PathBuf> {
    let runtime = project.parent()?;
    (project.file_name()? == "app" && runtime.file_name()? == "runtime" && is_project(project))
        .then(|| runtime.to_path_buf())
}

pub(super) fn python_in_project(root: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    let executables = ["Scripts/python.exe", "python.exe"];
    #[cfg(not(windows))]
    let executables = ["bin/python3", "bin/python"];
    // An intentional project venv precedes a shipped base interpreter.
    for env in [".venv", "venv", "python", "runtime/python"] {
        for executable in executables {
            let path = root.join(env).join(executable);
            if path.is_file() { return Some(path); }
        }
    }
    if let Some(runtime) = legacy_runtime(root) {
        for executable in executables {
            let path = runtime.join("python").join(executable);
            if path.is_file() { return Some(path); }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_and_python_variants_have_identical_roots() {
        let root = std::env::temp_dir().join(format!("ga-layout-{}", std::process::id()));
        std::fs::create_dir_all(root.join("frontends")).unwrap();
        std::fs::write(root.join("agentmain.py"), "").unwrap();
        std::fs::write(root.join("frontends/desktop_bridge.py"), "").unwrap();
        assert_eq!(project_from_anchor(&root.join("frontends")), Some(root.clone()));
        assert_eq!(project_from_anchor(&root.join("other")), Some(root.clone()));
        assert_eq!(project_from_anchor(&root.join("frontends/desktop/target/release")), Some(root.clone()));
        assert!(python_in_project(&root).is_none());
        #[cfg(windows)]
        let py = root.join("python/python.exe");
        #[cfg(not(windows))]
        let py = root.join("python/bin/python3");
        std::fs::create_dir_all(py.parent().unwrap()).unwrap();
        std::fs::write(&py, "").unwrap();
        assert_eq!(python_in_project(&root), Some(py));
        assert_eq!(project_from_anchor(&root.join("frontends")), Some(root.clone()));
        let moved = root.with_extension("relocated");
        std::fs::rename(&root, &moved).unwrap();
        assert_eq!(project_from_anchor(&moved.join("frontends")), Some(moved.clone()));
        assert!(python_in_project(&moved).unwrap().starts_with(&moved));
        std::fs::remove_dir_all(moved).unwrap();
    }
    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("ga-discovery-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn make_project(root: &Path) {
        std::fs::create_dir_all(root.join("frontends")).unwrap();
        std::fs::write(root.join("agentmain.py"), "").unwrap();
        std::fs::write(root.join("frontends/desktop_bridge.py"), "").unwrap();
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "").unwrap();
    }

    #[test]
    fn discovery_layout_matrix() {
        let base = fixture("matrix");
        for (name, project_relative, anchor_relative) in [
            ("root", "", ""),
            ("frontend", "", "frontends"),
            ("build", "", "frontends/desktop/src-tauri/target/release"),
            ("old", "runtime/app", ""),
            ("mac-old", "GenericAgent.app/Contents/Resources/runtime/app", "GenericAgent.app/Contents/MacOS"),
            ("mac-source", "", "frontends/GenericAgent.app/Contents/MacOS"),
            ("wrapper", "GenericAgent", ""),
        ] {
            let layout = base.join(name);
            let project = layout.join(project_relative);
            make_project(&project);
            assert_eq!(project_from_anchor(&layout.join(anchor_relative)), Some(project), "{name}");
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn nearest_valid_project_wins_and_partial_projects_are_rejected() {
        let base = fixture("priority");
        make_project(&base);
        let inner = base.join("nested");
        make_project(&inner);
        assert_eq!(project_from_anchor(&inner.join("frontends")), Some(inner.clone()));
        std::fs::remove_file(inner.join("frontends/desktop_bridge.py")).unwrap();
        assert_eq!(project_from_anchor(&inner), Some(base.clone()));
        std::fs::remove_file(base.join("frontends/desktop_bridge.py")).unwrap();
        assert_eq!(project_from_anchor(&inner), None);
        make_project(&inner);
        assert_eq!(project_from_anchor(&base.join("unrelated")), None);
        let deep = inner.join("a/b/c/d/e/f/g/h");
        assert_eq!(project_from_anchor(&deep), None);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn python_follows_selected_project_and_prefers_venv() {
        let base = fixture("python");
        #[cfg(windows)]
        let (base_exe, venv_exe) = ("python.exe", "Scripts/python.exe");
        #[cfg(not(windows))]
        let (base_exe, venv_exe) = ("bin/python3", "bin/python3");
        let project = base.join("source");
        make_project(&project);
        let python = project.join("python").join(base_exe);
        touch(&python);
        assert_eq!(python_in_project(&project), Some(python));
        let venv = project.join(".venv").join(venv_exe);
        touch(&venv);
        assert_eq!(python_in_project(&project), Some(venv));
        assert_eq!(python_in_project(&base.join("other")), None);
        let old_project = base.join("old/runtime/app");
        make_project(&old_project);
        let old_python = base.join("old/runtime/python").join(base_exe);
        touch(&old_python);
        assert_eq!(legacy_runtime(&old_project), Some(base.join("old/runtime")));
        assert_eq!(python_in_project(&old_project), Some(old_python));
        assert_eq!(legacy_runtime(&project), None);
        std::fs::remove_dir_all(base).unwrap();
    }

}
