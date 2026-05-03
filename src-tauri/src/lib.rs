mod db;
mod backup;
mod local_server;
mod printers;

use local_server::LocalServerStatus;
use printers::PrinterInfo;

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

// ---- Backup / restauração / exportação ----

#[tauri::command]
fn backup_create(kind: Option<String>) -> Result<backup::BackupEntry, String> {
    let k = kind.unwrap_or_else(|| "manual".into());
    let k = if k == "auto" || k == "manual" { k } else { "manual".into() };
    backup::create_backup(&k).map_err(|e| e.0)
}

#[tauri::command]
fn backup_status() -> Result<backup::BackupStatus, String> {
    backup::status().map_err(|e| e.0)
}

#[tauri::command]
fn backup_list() -> Result<Vec<backup::BackupFile>, String> {
    backup::list_backup_files().map_err(|e| e.0)
}

#[tauri::command]
fn backup_log(limit: Option<i64>) -> Result<Vec<backup::BackupEntry>, String> {
    backup::recent_log(limit.unwrap_or(50)).map_err(|e| e.0)
}

#[tauri::command]
fn backup_export(source_path: String, dest_path: String) -> Result<backup::BackupEntry, String> {
    backup::export_backup(&source_path, &dest_path).map_err(|e| e.0)
}

#[tauri::command]
fn backup_schedule_restore(source_path: String) -> Result<backup::BackupEntry, String> {
    backup::schedule_restore(&source_path).map_err(|e| e.0)
}

#[tauri::command]
fn backup_cancel_restore() -> Result<bool, String> {
    backup::cancel_restore().map_err(|e| e.0)
}

// ---- Impressoras ----

#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    printers::list_printers()
}

#[tauri::command]
fn print_pdf_bytes(bytes: Vec<u8>, printer_name: String) -> Result<String, String> {
    let path = printers::write_temp_pdf(&bytes)?;
    printers::print_pdf(&path, &printer_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_local_server,
            stop_local_server,
            local_server_status,
            backup_create,
            backup_status,
            backup_list,
            backup_log,
            backup_export,
            backup_schedule_restore,
            backup_cancel_restore,
        ])
        .setup(|_app| {
            // Aplica restauração pendente ANTES de abrir o banco. Se houver
            // staging válido, troca o arquivo principal pelo backup escolhido
            // e arquiva o estado anterior.
            match backup::apply_pending_restore_on_boot() {
                Ok(true) => eprintln!("[gestao-pro] restauração de backup aplicada no boot"),
                Ok(false) => {}
                Err(e) => eprintln!("[gestao-pro] falha ao aplicar restore pendente: {e}"),
            }

            if let Err(e) = db::init() {
                eprintln!("[gestao-pro] falha ao iniciar banco local: {e}");
            } else {
                // Agora que o banco está aberto, garante schema do log e fecha
                // qualquer flag de restore pendente.
                if let Err(e) = backup::ensure_schema() {
                    eprintln!("[gestao-pro] falha ao garantir schema de backup: {e}");
                }
                if let Err(e) = backup::mark_restore_completed_after_boot() {
                    eprintln!("[gestao-pro] falha ao marcar restore concluído: {e}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gestão Pro desktop app");
}
