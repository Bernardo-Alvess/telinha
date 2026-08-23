use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ColorType, DynamicImage, RgbaImage};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::Duration;
use crate::audio;
use tauri::{AppHandle, Emitter, Manager};
use xcap::{Monitor, Window};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSource {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub thumbnail: String,
    pub pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFrame {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

struct CaptureSession {
    stop: std::sync::Arc<AtomicBool>,
}

static CAPTURE: Mutex<Option<CaptureSession>> = Mutex::new(None);

fn encode_jpeg(img: &RgbaImage, quality: u8) -> Result<String, String> {
    let rgb = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), ColorType::Rgb8.into())
        .map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(buf)))
}

fn fit_width(img: RgbaImage, max_width: u32) -> RgbaImage {
    if img.width() <= max_width || max_width == 0 {
        return img;
    }
    let height = ((img.height() as f32) * (max_width as f32) / (img.width() as f32)).round() as u32;
    image::imageops::resize(&img, max_width, height.max(1), FilterType::Triangle)
}

fn capture_source_image(id: &str) -> Result<RgbaImage, String> {
    if let Some(screen_id) = id.strip_prefix("screen:") {
        let target: u32 = screen_id.parse().map_err(|_| "Tela inválida".to_string())?;
        for monitor in Monitor::all().map_err(|e| e.to_string())? {
            if monitor.id().unwrap_or_default() == target {
                return monitor.capture_image().map_err(|e| e.to_string());
            }
        }
        return Err("Tela não encontrada".into());
    }

    if let Some(window_id) = id.strip_prefix("window:") {
        let target: u32 = window_id.parse().map_err(|_| "Janela inválida".to_string())?;
        for window in Window::all().map_err(|e| e.to_string())? {
            if window.id().unwrap_or_default() == target {
                return window.capture_image().map_err(|e| e.to_string());
            }
        }
        return Err("Janela não encontrada".into());
    }

    Err("Fonte inválida".into())
}

fn should_skip_window(window: &Window) -> bool {
    let title = window.title().unwrap_or_default();
    let app_name = window.app_name().unwrap_or_default();
    if title.trim().is_empty() {
        return true;
    }
    if window.is_minimized().unwrap_or(false) {
        return true;
    }
    if window.width().unwrap_or(0) < 40 || window.height().unwrap_or(0) < 40 {
        return true;
    }
    let haystack = format!("{title} {app_name}").to_lowercase();
    haystack.contains("telinha")
}

#[tauri::command]
pub fn list_share_sources() -> Result<Vec<ShareSource>, String> {
    let mut sources = Vec::new();

    for monitor in Monitor::all().map_err(|e| e.to_string())? {
        let id = format!("screen:{}", monitor.id().unwrap_or_default());
        let name = monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| "Tela".into());
        let thumbnail = monitor
            .capture_image()
            .ok()
            .map(|img| encode_jpeg(&fit_width(img, 560), 70).unwrap_or_default())
            .unwrap_or_default();
        sources.push(ShareSource {
            id,
            name,
            kind: "screen".into(),
            thumbnail,
            pid: None,
        });
    }

    for window in Window::all().map_err(|e| e.to_string())? {
        if should_skip_window(&window) {
            continue;
        }
        let id = format!("window:{}", window.id().unwrap_or_default());
        let title = window.title().unwrap_or_else(|_| "Janela".into());
        let thumbnail = window
            .capture_image()
            .ok()
            .map(|img| encode_jpeg(&fit_width(img, 560), 70).unwrap_or_default())
            .unwrap_or_default();
        sources.push(ShareSource {
            id,
            name: title,
            kind: "window".into(),
            thumbnail,
            pid: window.pid().ok(),
        });
    }

    Ok(sources)
}

#[tauri::command]
pub fn start_share_capture(
    app: AppHandle,
    id: String,
    fps: u32,
    max_width: u32,
    include_audio: Option<bool>,
) -> Result<(), String> {
    stop_share_capture();

    let stop = std::sync::Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let source_id = id.clone();
    let frame_interval = Duration::from_millis((1000 / fps.max(5).min(60)) as u64);
    let video_app = app.clone();

    thread::spawn(move || {
        while !stop_flag.load(Ordering::Relaxed) {
            match capture_source_image(&source_id) {
                Ok(image) => {
                    let fitted = fit_width(image, max_width.max(640));
                    let width = fitted.width();
                    let height = fitted.height();
                    if let Ok(data_url) = encode_jpeg(&fitted, 85) {
                        let _ = video_app.emit(
                            "share-frame",
                            ShareFrame {
                                data_url,
                                width,
                                height,
                            },
                        );
                    }
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(200));
                }
            }
            thread::sleep(frame_interval);
        }
    });

    if include_audio.unwrap_or(true) {
        audio::start_share_audio(app, id.clone(), resolve_window_pid(&id), stop.clone());
    }

    *CAPTURE.lock().map_err(|e| e.to_string())? = Some(CaptureSession { stop });
    Ok(())
}

fn resolve_window_pid(id: &str) -> Option<u32> {
    let window_id = id.strip_prefix("window:")?;
    let target: u32 = window_id.parse().ok()?;
    for window in Window::all().ok()? {
        if window.id().unwrap_or_default() == target {
            return window.pid().ok();
        }
    }
    None
}

#[tauri::command]
pub fn stop_share_capture() {
    if let Ok(mut guard) = CAPTURE.lock() {
        if let Some(session) = guard.take() {
            session.stop.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn set_window_layout(app: AppHandle, layout: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;

    match layout.as_str() {
        "watch" => {
            let _ = window.set_always_on_top(false);
            window
                .set_min_size(Some(tauri::LogicalSize::new(800.0, 500.0)))
                .map_err(|e| e.to_string())?;
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
        }
        "host" => {
            apply_window_size(&window, 400.0, 300.0, 460.0, 360.0)?;
        }
        "home" => {
            apply_window_size(&window, 360.0, 420.0, 400.0, 500.0)?;
        }
        "picker" => {
            apply_window_size(&window, 640.0, 480.0, 760.0, 620.0)?;
        }
        _ => {
            apply_window_size(&window, 380.0, 440.0, 440.0, 560.0)?;
        }
    }
    Ok(())
}

fn apply_window_size(
    window: &tauri::WebviewWindow,
    min_w: f64,
    min_h: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    let _ = window.unmaximize();
    window
        .set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}
