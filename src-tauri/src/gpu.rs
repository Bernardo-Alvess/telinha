use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuEncodeInfo {
    pub available: bool,
    pub vendor: String,
    pub name: String,
}

#[tauri::command]
pub fn gpu_encode_info() -> GpuEncodeInfo {
    #[cfg(windows)]
    {
        detect_windows_gpu()
    }

    #[cfg(not(windows))]
    {
        GpuEncodeInfo {
            available: false,
            vendor: "none".into(),
            name: String::new(),
        }
    }
}

#[cfg(windows)]
fn detect_windows_gpu() -> GpuEncodeInfo {
    match list_adapters() {
        Ok(adapters) => pick_encoder_gpu(adapters),
        Err(_) => GpuEncodeInfo {
            available: false,
            vendor: "none".into(),
            name: String::new(),
        },
    }
}

struct AdapterInfo {
    vendor_id: u32,
    name: String,
}

#[cfg(windows)]
fn list_adapters() -> windows::core::Result<Vec<AdapterInfo>> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};

    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut adapters = Vec::new();
    let mut index = 0;
    loop {
        let adapter = unsafe { factory.EnumAdapters1(index) };
        let Ok(adapter) = adapter else {
            break;
        };
        let desc = unsafe { adapter.GetDesc1()? };
        let end = desc
            .Description
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..end]);
        adapters.push(AdapterInfo {
            vendor_id: desc.VendorId,
            name,
        });
        index += 1;
    }
    Ok(adapters)
}

fn pick_encoder_gpu(adapters: Vec<AdapterInfo>) -> GpuEncodeInfo {
    const NVIDIA: u32 = 0x10DE;
    const AMD: u32 = 0x1002;
    const INTEL: u32 = 0x8086;
    const MICROSOFT: u32 = 0x1414;

    let ranked = adapters
        .into_iter()
        .filter(|adapter| adapter.vendor_id != MICROSOFT)
        .min_by_key(|adapter| match adapter.vendor_id {
            NVIDIA => 0u8,
            AMD => 1,
            INTEL => 2,
            _ => 9,
        });

    match ranked {
        Some(adapter) if adapter.vendor_id == NVIDIA => GpuEncodeInfo {
            available: true,
            vendor: "nvidia".into(),
            name: adapter.name,
        },
        Some(adapter) if adapter.vendor_id == AMD => GpuEncodeInfo {
            available: true,
            vendor: "amd".into(),
            name: adapter.name,
        },
        Some(adapter) if adapter.vendor_id == INTEL => GpuEncodeInfo {
            available: true,
            vendor: "intel".into(),
            name: adapter.name,
        },
        Some(adapter) => GpuEncodeInfo {
            available: false,
            vendor: "other".into(),
            name: adapter.name,
        },
        None => GpuEncodeInfo {
            available: false,
            vendor: "none".into(),
            name: String::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_nvidia_over_basic_render() {
        let info = pick_encoder_gpu(vec![
            AdapterInfo {
                vendor_id: 0x1414,
                name: "Microsoft Basic Render Driver".into(),
            },
            AdapterInfo {
                vendor_id: 0x10DE,
                name: "NVIDIA GeForce RTX 5060 Ti".into(),
            },
        ]);
        assert!(info.available);
        assert_eq!(info.vendor, "nvidia");
        assert!(info.name.contains("5060"));
    }

    #[test]
    fn empty_adapters_are_unavailable() {
        let info = pick_encoder_gpu(Vec::new());
        assert!(!info.available);
        assert_eq!(info.vendor, "none");
    }
}
