use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u32 = 2;
const CHUNK_FRAMES: usize = 1920;
const BUFFER_DURATION_HNS: i64 = 400_000;
const MAX_QUEUED_CHUNKS: usize = 8;

static AUDIO_CHUNKS: Mutex<VecDeque<Vec<u8>>> = Mutex::new(VecDeque::new());

pub fn start_share_audio(
    app: AppHandle,
    source_id: String,
    pid: Option<u32>,
    stop: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        if run_capture(&app, &source_id, pid, &stop).is_err() {
            emit_silence(&app, &stop);
        }
    });
}

fn run_capture(
    app: &AppHandle,
    source_id: &str,
    pid: Option<u32>,
    stop: &AtomicBool,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = (app, source_id, pid);
        return Err("Captura de áudio só está disponível no Windows".into());
    }

    #[cfg(windows)]
    {
        wasapi::initialize_mta()
            .ok()
            .map_err(|e| format!("Falha ao iniciar COM: {e:?}"))?;

        let mut audio_client = if source_id.starts_with("screen:") {
            open_desktop_loopback_without_discord()?
        } else if let Some(pid) = pid {
            wasapi::AudioClient::new_application_loopback_client(pid, true)
                .map_err(|e| e.to_string())?
        } else {
            return Err("PID do aplicativo não encontrado".into());
        };

        let format = wasapi::WaveFormat::new(
            32,
            32,
            &wasapi::SampleType::Float,
            SAMPLE_RATE as usize,
            CHANNELS as usize,
            None,
        );
        let mode = wasapi::StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: BUFFER_DURATION_HNS,
        };
        audio_client
            .initialize_client(&format, &wasapi::Direction::Capture, &mode)
            .map_err(|e| e.to_string())?;

        let h_event = audio_client
            .set_get_eventhandle()
            .map_err(|e| e.to_string())?;
        let capture_client = audio_client
            .get_audiocaptureclient()
            .map_err(|e| e.to_string())?;
        let blockalign = format.get_blockalign() as usize;
        let mut sample_queue: VecDeque<u8> = VecDeque::new();

        audio_client.start_stream().map_err(|e| e.to_string())?;

        while !stop.load(Ordering::Relaxed) {
            drain_chunks(app, &mut sample_queue, blockalign);

            match capture_client.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => {
                    let extra = (frames as usize * blockalign)
                        .saturating_sub(sample_queue.capacity() - sample_queue.len());
                    sample_queue.reserve(extra);
                    let _ = capture_client.read_from_device_to_deque(&mut sample_queue);
                }
                Ok(_) => {}
                Err(_) => {
                    let _ = capture_client.read_from_device_to_deque(&mut sample_queue);
                }
            }

            if h_event.wait_for_event(80).is_err() && stop.load(Ordering::Relaxed) {
                break;
            }
        }

        let _ = audio_client.stop_stream();
        Ok(())
    }
}

#[cfg(windows)]
fn open_desktop_loopback_without_discord() -> Result<wasapi::AudioClient, String> {
    let pid = discord_root_pid()
        .ok_or_else(|| "Discord não encontrado; áudio da live desativado".to_string())?;
    wasapi::AudioClient::new_application_loopback_client(pid, false).map_err(|e| e.to_string())
}

#[cfg(windows)]
#[derive(Clone)]
struct ProcessInfo {
    pid: u32,
    parent_pid: u32,
    executable: String,
}

#[cfg(windows)]
fn discord_root_pid() -> Option<u32> {
    use std::mem::size_of;
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut processes = Vec::new();

    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let end = entry
                .szExeFile
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(entry.szExeFile.len());
            processes.push(ProcessInfo {
                pid: entry.th32ProcessID,
                parent_pid: entry.th32ParentProcessID,
                executable: String::from_utf16_lossy(&entry.szExeFile[..end]),
            });
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    pick_discord_root(&processes)
}

#[cfg(windows)]
fn pick_discord_root(processes: &[ProcessInfo]) -> Option<u32> {
    let discord: Vec<&ProcessInfo> = processes
        .iter()
        .filter(|process| is_discord_executable(&process.executable))
        .collect();
    discord
        .iter()
        .filter(|candidate| {
            !discord
                .iter()
                .any(|other| other.pid == candidate.parent_pid)
        })
        .max_by_key(|candidate| descendant_count(candidate.pid, &discord))
        .map(|process| process.pid)
}

#[cfg(windows)]
fn descendant_count(pid: u32, processes: &[&ProcessInfo]) -> usize {
    processes
        .iter()
        .filter(|process| process.parent_pid == pid)
        .map(|process| 1 + descendant_count(process.pid, processes))
        .sum()
}

#[cfg(windows)]
fn is_discord_executable(executable: &str) -> bool {
    matches!(
        executable.to_ascii_lowercase().as_str(),
        "discord.exe" | "discordcanary.exe" | "discordptb.exe" | "vesktop.exe"
    )
}

fn drain_chunks(app: &AppHandle, sample_queue: &mut VecDeque<u8>, blockalign: usize) {
    let chunk_bytes = blockalign * CHUNK_FRAMES;
    while sample_queue.len() >= chunk_bytes {
        let chunk: Vec<u8> = sample_queue.drain(..chunk_bytes).collect();
        push_audio_bytes(app, chunk);
    }
}

fn emit_silence(app: &AppHandle, stop: &AtomicBool) {
    let silent = vec![0u8; CHUNK_FRAMES * CHANNELS as usize * 4];
    while !stop.load(Ordering::Relaxed) {
        push_audio_bytes(app, silent.clone());
        thread::sleep(Duration::from_millis(40));
    }
}

fn push_audio_bytes(app: &AppHandle, bytes: Vec<u8>) {
    if let Ok(mut queue) = AUDIO_CHUNKS.lock() {
        queue.push_back(bytes);
        while queue.len() > MAX_QUEUED_CHUNKS {
            queue.pop_front();
        }
    }
    let _ = app.emit("share-audio", ());
}

#[tauri::command]
pub fn read_share_audio() -> Result<Response, String> {
    let mut queue = AUDIO_CHUNKS.lock().map_err(|e| e.to_string())?;
    if queue.is_empty() {
        return Err("Nenhum áudio disponível".into());
    }
    if queue.len() == 1 {
        return Ok(Response::new(queue.pop_front().unwrap()));
    }
    let total: usize = queue.iter().map(Vec::len).sum();
    let mut out = Vec::with_capacity(total);
    while let Some(chunk) = queue.pop_front() {
        out.extend_from_slice(&chunk);
    }
    Ok(Response::new(out))
}

pub fn clear_share_audio() {
    if let Ok(mut queue) = AUDIO_CHUNKS.lock() {
        queue.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_chunks_keeps_pcm_bytes() {
        let mut queue = VecDeque::from(vec![1u8, 2, 3, 4, 5, 6, 7, 8, 9]);
        let chunk_bytes = 4;
        let mut taken = Vec::new();
        while queue.len() >= chunk_bytes {
            taken.extend(queue.drain(..chunk_bytes));
        }
        assert_eq!(taken, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(Vec::from(queue), vec![9]);
    }

    #[cfg(windows)]
    #[test]
    fn finds_root_of_discord_process_tree() {
        let processes = vec![
            ProcessInfo {
                pid: 10,
                parent_pid: 1,
                executable: "Discord.exe".into(),
            },
            ProcessInfo {
                pid: 11,
                parent_pid: 10,
                executable: "Discord.exe".into(),
            },
            ProcessInfo {
                pid: 12,
                parent_pid: 10,
                executable: "Discord.exe".into(),
            },
            ProcessInfo {
                pid: 20,
                parent_pid: 1,
                executable: "chrome.exe".into(),
            },
        ];
        assert_eq!(pick_discord_root(&processes), Some(10));
    }
}
