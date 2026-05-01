mod local_server;

use local_server::LocalServerStatus;

#[tauri::command]
fn start_local_server(port: u16, server_name: Option<String>) -> Result<LocalServerStatus, String> {
    local_server::start(port, server_name)
}

#[tauri::command]
fn stop_local_server() -> Result<LocalServerStatus, String> {
    local_server::stop()
}

#[tauri::command]
fn local_server_status() -> LocalServerStatus {
    local_server::current_status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            start_local_server,
            stop_local_server,
            local_server_status,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Gestão Pro desktop app");
}
