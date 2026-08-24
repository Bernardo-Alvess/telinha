use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u32 = 2;
const CHUNK_FRAMES: usize = 1920;
const BUFFER_DURATION_HNS: i64 = 400_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
}

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
            open_system_loopback()?
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
fn open_system_loopback() -> Result<wasapi::AudioClient, String> {
    let device =
        wasapi::get_default_device(&wasapi::Direction::Render).map_err(|e| e.to_string())?;
    device.get_iaudioclient().map_err(|e| e.to_string())
}

fn drain_chunks(app: &AppHandle, sample_queue: &mut VecDeque<u8>, blockalign: usize) {
    let chunk_bytes = blockalign * CHUNK_FRAMES;
    while sample_queue.len() >= chunk_bytes {
        let mut chunk = vec![0u8; chunk_bytes];
        for byte in chunk.iter_mut() {
            *byte = sample_queue.pop_front().unwrap();
        }
        emit_audio(app, bytes_to_f32(&chunk));
    }
}

fn emit_silence(app: &AppHandle, stop: &AtomicBool) {
    let silent = vec![0.0f32; CHUNK_FRAMES * CHANNELS as usize];
    while !stop.load(Ordering::Relaxed) {
        emit_audio(app, silent.clone());
        thread::sleep(Duration::from_millis(20));
    }
}

fn emit_audio(app: &AppHandle, samples: Vec<f32>) {
    let _ = app.emit(
        "share-audio",
        ShareAudio {
            samples,
            sample_rate: SAMPLE_RATE,
            channels: CHANNELS,
        },
    );
}

fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    let (chunks, _) = bytes.as_chunks::<4>();
    chunks
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect()
}
