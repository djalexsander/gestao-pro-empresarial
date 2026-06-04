mod db;
mod backup;
mod local_server;
mod printers;

use local_server::LocalServerStatus;
use printers::PrinterInfo;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use bcrypt::hash;

#[tauri::command]
async fn start_local_server(
    port: u16,
    server_name: Option<String>,
    server_id: Option<String>,
    upstream_url: Option<String>,
    upstream_anon_key: Option<String>,
    auth_token: Option<String>,
) -> Result<LocalServerStatus, String> {
    eprintln!("[gestao-pro] start_local_server invoked port={port} name={:?} id={:?}", server_name, server_id);
    let res = local_server::start(port, server_name, server_id, upstream_url, upstream_anon_key, auth_token).await;
    match &res {
        Ok(st) => eprintln!("[gestao-pro] start_local_server OK running={} port={:?}", st.running, st.port),
        Err(e) => eprintln!("[gestao-pro] start_local_server ERROR: {e}"),
    }
    res
}

#[tauri::command]
async fn stop_local_server() -> Result<LocalServerStatus, String> {
    local_server::stop()
}

#[tauri::command]
fn local_server_status() -> LocalServerStatus {
    local_server::current_status()
}

#[derive(Debug, Serialize)]
pub struct DesktopAuthorizedUser {
    pub user_id: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct DesktopAuthorizedUserStatus {
    pub exists: bool,
    pub user_id: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopFuncionarioLocalRow {
    pub funcionario_id: String,
    pub nome: String,
    pub login: String,
    pub role: String,
    pub ativo: bool,
    pub synced_at_ms: i64,
}

#[tauri::command]
fn desktop_authorized_user_save(
    email: String,
    user_id: String,
    password: String,
) -> Result<(), String> {
    let password_hash = hash(&password, 10).map_err(|e| e.to_string())?;
    db::upsert_authorized_user(
        &user_id,
        &email,
        &password_hash,
        Utc::now().timestamp_millis(),
    )
    .map_err(|e| e.0)
}

#[tauri::command]
fn desktop_authorized_user_verify(
    email: String,
    password: String,
) -> Result<Option<DesktopAuthorizedUser>, String> {
    let user = db::verify_authorized_user(&email, &password).map_err(|e| e.0)?;
    Ok(user.map(|u| DesktopAuthorizedUser {
        user_id: u.user_id,
        email: u.email,
    }))
}

#[tauri::command]
fn desktop_authorized_user_status(email: String) -> Result<DesktopAuthorizedUserStatus, String> {
    let user = db::authorized_user_by_email(&email).map_err(|e| e.0)?;
    Ok(DesktopAuthorizedUserStatus {
        exists: user.is_some(),
        user_id: user.as_ref().map(|u| u.user_id.clone()),
        email: user.map(|u| u.email),
    })
}

#[tauri::command]
fn desktop_funcionario_pin_save(
    funcionario_id: String,
    nome: String,
    login: String,
    role: String,
    ativo: bool,
    pin: String,
) -> Result<(), String> {
    let pin_hash = hash(&pin, 10).map_err(|e| e.to_string())?;
    db::upsert_funcionario_local(
        &funcionario_id,
        &nome,
        &login,
        &role,
        ativo,
        Some(&pin_hash),
        Utc::now().timestamp_millis(),
    )
    .map_err(|e| e.0)
}

#[tauri::command]
fn desktop_funcionarios_cache(
    funcionarios: Vec<DesktopFuncionarioLocalRow>,
) -> Result<(), String> {
    for funcionario in funcionarios {
        db::upsert_funcionario_local(
            &funcionario.funcionario_id,
            &funcionario.nome,
            &funcionario.login,
            &funcionario.role,
            funcionario.ativo,
            None,
            Utc::now().timestamp_millis(),
        )
        .map_err(|e| e.0)?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_funcionarios_ativos() -> Result<Vec<DesktopFuncionarioLocalRow>, String> {
    let rows = db::list_funcionarios_ativos_local().map_err(|e| e.0)?;
    Ok(rows
        .into_iter()
        .map(|row| DesktopFuncionarioLocalRow {
            funcionario_id: row.funcionario_id,
            nome: row.nome,
            login: row.login,
            role: row.role,
            ativo: row.ativo,
            synced_at_ms: row.synced_at_ms,
        })
        .collect())
}

#[tauri::command]
fn desktop_funcionario_pin_verify(
    funcionario_id: String,
    pin: String,
) -> Result<Option<DesktopFuncionarioLocalRow>, String> {
    let row = db::verify_funcionario_pin_local(&funcionario_id, &pin).map_err(|e| e.0)?;
    Ok(row.map(|row| DesktopFuncionarioLocalRow {
        funcionario_id: row.funcionario_id,
        nome: row.nome,
        login: row.login,
        role: row.role,
        ativo: row.ativo,
        synced_at_ms: row.synced_at_ms,
    }))
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
fn backup_schedule_restore(
    source_path: String,
    force: Option<bool>,
) -> Result<backup::BackupEntry, String> {
    backup::schedule_restore(&source_path, force.unwrap_or(false)).map_err(|e| e.0)
}

#[tauri::command]
fn backup_restore_preflight() -> Result<backup::RestorePreflight, String> {
    backup::restore_preflight().map_err(|e| e.0)
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

/// Imprime bytes ESC/POS RAW em uma impressora térmica (Windows: WinAPI
/// OpenPrinter+WritePrinter; Unix: `lp -o raw`). Não usa Start-Process.
#[tauri::command]
fn print_raw_escpos(bytes: Vec<u8>, printer_name: String) -> Result<String, String> {
    printers::print_raw(&printer_name, "Gestao Pro Cupom", &bytes)
}

/// Constrói cupom ESC/POS a partir de um texto plano e imprime na térmica.
/// `width_mm` deve ser 58 ou 80. `cut` = true envia GS V 1 no final.
#[tauri::command]
fn print_receipt_text(
    text: String,
    printer_name: String,
    width_mm: Option<u32>,
    cut: Option<bool>,
) -> Result<String, String> {
    let bytes = printers::build_escpos_receipt(
        &text,
        width_mm.unwrap_or(80),
        cut.unwrap_or(true),
    );
    printers::print_raw(&printer_name, "Gestao Pro Cupom", &bytes)
}

/// Imprime uma etiqueta como imagem PNG via GDI (Windows) ou `lp` (Unix).
/// Caminho separado do cupom: usa o spooler normal do Windows, compatível
/// com PT260 e qualquer driver GDI (não usa RAW/ESC-POS).
#[tauri::command]
fn print_label_image(
    bytes: Vec<u8>,
    printer_name: String,
    copies: Option<u32>,
) -> Result<String, String> {
    printers::print_image_png(
        &printer_name,
        "Gestao Pro Etiqueta",
        &bytes,
        copies.unwrap_or(1),
    )
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
            backup_restore_preflight,
            backup_cancel_restore,
            desktop_authorized_user_save,
            desktop_authorized_user_verify,
            desktop_authorized_user_status,
            desktop_funcionario_pin_save,
            desktop_funcionarios_cache,
            desktop_funcionarios_ativos,
            desktop_funcionario_pin_verify,
            list_printers,
            print_pdf_bytes,
            print_raw_escpos,
            print_receipt_text,
            print_label_image,
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
