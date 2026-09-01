use tauri::webview::PlatformWebview;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    },
    PermissionRequestedEventHandler,
};

pub fn allow_media_capture(webview: &PlatformWebview) {
    let controller = webview.controller();
    let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
        return;
    };

    let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
        let Some(args) = args else {
            return Ok(());
        };

        let mut kind = COREWEBVIEW2_PERMISSION_KIND(0);
        unsafe {
            args.PermissionKind(&mut kind)?;
        }

        if is_media_permission(kind) {
            unsafe {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
        }

        Ok(())
    }));

    let mut token = 0i64;
    let _ = unsafe { core.add_PermissionRequested(&handler, &mut token) };
}

fn is_media_permission(kind: COREWEBVIEW2_PERMISSION_KIND) -> bool {
    kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_microphone_and_camera_permissions() {
        assert!(is_media_permission(COREWEBVIEW2_PERMISSION_KIND_MICROPHONE));
        assert!(is_media_permission(COREWEBVIEW2_PERMISSION_KIND_CAMERA));
        assert!(!is_media_permission(COREWEBVIEW2_PERMISSION_KIND(13)));
        assert!(!is_media_permission(COREWEBVIEW2_PERMISSION_KIND(99)));
    }
}
