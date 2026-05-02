mod db;
mod local_server;

use local_server::LocalServerStatus;

#[tauri::command]
fn start_local_server(
    port: u16,
    server_name: Option<String>,
    server_id: Option<String>,
    upstream_url: Option<String>,
    upstream_anon_key: Option<String>,
) -> Result<LocalServerStatus, String> {
    local_server::start(port, server_name, server_id, upstream_url, upstream_anon_key)
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
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_local_server,
            stop_local_server,
            local_server_status,
        ])
        .setup(|_app| {
            // Inicializa o banco local SQLite. Se falhar, loga e segue —
            // o servidor continua subindo, apenas sem persistência local.
            if let Err(e) = db::init() {
                eprintln!("[gestao-pro] falha ao iniciar banco local: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gestão Pro desktop app");
}
