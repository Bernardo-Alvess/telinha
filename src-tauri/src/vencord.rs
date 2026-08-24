use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[cfg(windows)]
const INSTALLER_URL: &str =
    "https://github.com/Vencord/Installer/releases/download/v1.4.0/VencordInstallerCli.exe";
#[cfg(windows)]
const INSTALLER_SHA256: &str = "466d2a0be1f380ddffed052df3cc132125fa34dc1af29312e14f13f358c8d2a2";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VencordInstall {
    pub dest: String,
    pub message: String,
}

#[tauri::command]
pub async fn install_vencord_plugin(
    app: tauri::AppHandle,
    _vencord_path: Option<String>,
) -> Result<VencordInstall, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || install_sync(&resource_dir))
        .await
        .map_err(|error| error.to_string())?
}

fn install_sync(resource_dir: &Path) -> Result<VencordInstall, String> {
    #[cfg(not(windows))]
    {
        let _ = resource_dir;
        return Err("A instalação automática do Vencord está disponível no Windows.".into());
    }

    #[cfg(windows)]
    {
        let bundled_dist = find_vencord_dist(resource_dir).ok_or_else(|| {
            "Não achei o plugin do Vencord neste executável. Use o Telinha instalado pelo setup, ou rode o .exe de dentro da pasta completa do app — copiar só o .exe deixa os arquivos do plugin para trás.".to_string()
        })?;
        let plugin_dir = find_userplugin_dir(resource_dir);

        let vencord_root = roaming_dir()?.join("Vencord");
        let installed_dist = vencord_root.join("dist");
        let installer = installer_path()?;
        download_installer(&installer)?;
        inject_vencord(&installer, &vencord_root)?;
        copy_bundle(&bundled_dist, &installed_dist)?;
        if let Some(plugin_dir) = plugin_dir {
            install_userplugin(&plugin_dir, &vencord_root)?;
        }
        enable_telinha(&vencord_root)?;

        Ok(VencordInstall {
            dest: vencord_root.to_string_lossy().into_owned(),
            message: "Pronto. Feche o Discord pela bandeja e abra de novo — o botão Telinha fica na barra da call.".into(),
        })
    }
}

#[cfg(windows)]
fn find_vencord_dist(resource_dir: &Path) -> Option<PathBuf> {
    bundled_candidates(resource_dir)
        .into_iter()
        .map(|root| root.join("vencord-dist"))
        .chain(bundled_candidates(resource_dir))
        .find(|dir| dir.join("renderer.js").is_file())
}

#[cfg(windows)]
fn find_userplugin_dir(resource_dir: &Path) -> Option<PathBuf> {
    bundled_candidates(resource_dir)
        .into_iter()
        .map(|root| root.join("vencord-plugin").join("telinha"))
        .find(|dir| dir.is_dir())
}

#[cfg(windows)]
fn bundled_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![resource_dir.to_path_buf(), resource_dir.join("resources")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            dirs.push(dir.join("resources"));
            if let Some(parent) = dir.parent() {
                dirs.push(parent.to_path_buf());
                dirs.push(parent.join("resources"));
            }
        }
    }
    dirs
}

#[cfg(windows)]
fn copy_bundle(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source = entry.path();
        if source.is_file() {
            fs::copy(&source, to.join(entry.file_name()))
                .map_err(|error| format!("Não consegui copiar {}: {error}", source.display()))?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn install_userplugin(plugin_dir: &Path, vencord_root: &Path) -> Result<(), String> {
    copy_dir(
        plugin_dir,
        &vencord_root.join("src").join("userplugins").join("telinha"),
    )
}

#[cfg(windows)]
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source = entry.path();
        if source.is_file() {
            fs::copy(&source, to.join(entry.file_name()))
                .map_err(|error| format!("Não consegui copiar {}: {error}", source.display()))?;
        }
    }
    Ok(())
}

fn enable_telinha(vencord_root: &Path) -> Result<(), String> {
    let settings_dir = vencord_root.join("settings");
    let settings_path = settings_dir.join("settings.json");
    fs::create_dir_all(&settings_dir).map_err(|error| error.to_string())?;

    let mut settings: Value = if settings_path.is_file() {
        fs::read_to_string(&settings_path)
            .ok()
            .and_then(|contents| serde_json::from_str(&contents).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };

    let root = settings
        .as_object_mut()
        .ok_or("As configurações do Vencord estão inválidas.")?;
    root.insert("autoUpdate".into(), Value::Bool(false));

    let plugins = root
        .entry("plugins")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("A lista de plugins do Vencord está inválida.")?;
    plugins.insert("Telinha".into(), json!({ "enabled": true }));

    let encoded = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(settings_path, encoded).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(windows)]
fn file_matches_installer(path: &Path) -> bool {
    fs::read(path)
        .ok()
        .is_some_and(|bytes| sha256_hex(&bytes).eq_ignore_ascii_case(INSTALLER_SHA256))
}

#[cfg(windows)]
fn download_installer(destination: &Path) -> Result<(), String> {
    if destination.is_file() && file_matches_installer(destination) {
        return Ok(());
    }
    if destination.is_file() {
        let _ = fs::remove_file(destination);
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = destination.with_extension("download");
    let _ = fs::remove_file(&temporary);

    run_hidden(
        "curl.exe",
        &[
            "-fL",
            "--retry",
            "2",
            "--connect-timeout",
            "20",
            "-o",
            temporary.to_str().ok_or("Caminho temporário inválido.")?,
            INSTALLER_URL,
        ],
        &[],
    )
    .map_err(|error| format!("Não consegui baixar o instalador oficial do Vencord. {error}"))?;

    if !file_matches_installer(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err("O instalador do Vencord não passou na verificação de integridade.".into());
    }

    let _ = fs::remove_file(destination);
    fs::rename(temporary, destination).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn inject_vencord(installer: &Path, vencord_root: &Path) -> Result<(), String> {
    let root = vencord_root.to_string_lossy().into_owned();
    run_hidden(
        installer
            .to_str()
            .ok_or("Caminho do instalador inválido.")?,
        &["-install", "-branch", "auto"],
        &[
            ("VENCORD_USER_DATA_DIR", root.as_str()),
            ("VENCORD_DEV_INSTALL", "1"),
        ],
    )
    .map_err(|error| format!("O instalador oficial do Vencord falhou. {error}"))
}

#[cfg(windows)]
fn run_hidden(program: &str, args: &[&str], envs: &[(&str, &str)]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = Command::new(program)
        .args(args)
        .envs(envs.iter().copied())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Falha ao executar {program}: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = [stderr.trim(), stdout.trim()]
        .into_iter()
        .find(|text| !text.is_empty())
        .unwrap_or("erro desconhecido");
    Err(detail.to_string())
}

#[cfg(windows)]
fn roaming_dir() -> Result<PathBuf, String> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or("Não encontrei a pasta AppData do Windows.".into())
}

#[cfg(windows)]
fn installer_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("TEMP"))
        .map(PathBuf::from)
        .ok_or("Não encontrei a pasta temporária do Windows.")?;
    Ok(base
        .join("Telinha")
        .join("installer")
        .join("VencordInstallerCli.exe"))
}
