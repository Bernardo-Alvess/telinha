use std::fs;
use std::path::{Path, PathBuf};

const PLUGIN_SOURCE: &str = include_str!("../../vencord-plugin/telinha/index.ts");

fn default_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = PathBuf::from(home);
        dirs.push(home.join("Vencord"));
        dirs.push(home.join("Documents").join("Vencord"));
        dirs.push(home.join("source").join("Vencord"));
        dirs.push(home.join("code").join("Vencord"));
        dirs.push(home.join("dev").join("Vencord"));
    }
    dirs
}

fn write_plugin(vencord_root: &Path) -> Result<PathBuf, String> {
    let dest_dir = vencord_root.join("src").join("userplugins").join("telinha");
    if !vencord_root.join("src").is_dir() {
        return Err("Essa pasta não parece um Vencord compilado da source (falta src/).".into());
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join("index.ts");
    fs::write(&dest, PLUGIN_SOURCE).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[tauri::command]
pub fn install_vencord_plugin(vencord_path: Option<String>) -> Result<String, String> {
    if let Some(path) = vencord_path.filter(|value| !value.trim().is_empty()) {
        let dest = write_plugin(Path::new(path.trim()))?;
        return Ok(dest.to_string_lossy().into_owned());
    }

    for root in default_candidates() {
        if root.join("src").is_dir() {
            let dest = write_plugin(&root)?;
            return Ok(dest.to_string_lossy().into_owned());
        }
    }

    Err("Não achei um Vencord da source. Passe a pasta do clone ou siga vencord-plugin/README.md.".into())
}
