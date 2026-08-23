use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};

static PRESENCE: Mutex<Option<String>> = Mutex::new(None);

fn app_id() -> Option<String> {
    std::env::var("TELINHA_DISCORD_APP_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "your_discord_app_id")
}

#[tauri::command]
pub fn set_discord_presence(code: Option<String>) -> Result<(), String> {
    let mut current = PRESENCE.lock().map_err(|e| e.to_string())?;
    *current = code.filter(|value| !value.trim().is_empty());
    Ok(())
}

pub fn start_presence_loop() {
    thread::spawn(|| {
        let Some(id) = app_id() else {
            return;
        };
        loop {
            let Ok(mut client) = DiscordIpcClient::new(&id) else {
                thread::sleep(Duration::from_secs(15));
                continue;
            };
            if client.connect().is_err() {
                thread::sleep(Duration::from_secs(8));
                continue;
            }

            loop {
                let code = PRESENCE.lock().ok().and_then(|guard| guard.clone());
                let result = if let Some(code) = code {
                    let state = format!("Sala {code}");
                    let activity = Activity::new()
                        .state(&state)
                        .details("Na Telinha")
                        .assets(Assets::new().large_text("Telinha"))
                        .timestamps(Timestamps::new().start(now_secs()));
                    client.set_activity(activity)
                } else {
                    client.clear_activity()
                };
                if result.is_err() {
                    let _ = client.close();
                    break;
                }
                thread::sleep(Duration::from_secs(8));
            }
        }
    });
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
