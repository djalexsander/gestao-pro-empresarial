mod backup;
mod db;
mod local_server;
mod printers;

use bcrypt::hash;
use chrono::Utc;
use local_server::LocalServerStatus;
use printers::PrinterInfo;
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read_to_string, write, OpenOptions};
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const CAIXA_ABERTO_EXIT_MESSAGE: &str =
    "Existe um caixa aberto. Feche o caixa antes de encerrar o aplicativo.";

const DIAGNOSTIC_LOG_FILE: &str = "gestao-pro-errors.jsonl";
const DIAGNOSTIC_MAX_RECORDS: usize = 500;

#[cfg(target_os = "windows")]
fn windows_registry_key_exists(subkey: &str) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use winapi::um::winnt::KEY_READ;
    use winapi::um::winreg::{RegCloseKey, RegOpenKeyExW, HKEY_CLASSES_ROOT};

    let subkey: Vec<u16> = OsStr::new(subkey)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut key = null_mut();
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CLASSES_ROOT,
            subkey.as_ptr(),
            0,
            KEY_READ,
            &mut key,
        )
    };
    if status != 0 {
        return false;
    }
    unsafe {
        RegCloseKey(key);
    }
    true
}

#[cfg(target_os = "windows")]
fn windows_whatsapp_protocol_registered() -> bool {
    windows_registry_key_exists(r"whatsapp\shell\open\command")
        || windows_registry_key_exists(
            r"Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\PackageRepository\Extensions\windows.protocol\whatsapp",
        )
}

#[tauri::command]
fn whatsapp_protocol_registered() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_whatsapp_protocol_registered()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticContext {
    pid: u32,
    log_path: String,
}

fn diagnostic_log_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    Ok(log_dir.join(DIAGNOSTIC_LOG_FILE))
}

#[tauri::command]
fn diagnostic_context(app: tauri::AppHandle) -> Result<DiagnosticContext, String> {
    let log_path = diagnostic_log_path(&app)?;
    Ok(DiagnosticContext {
        pid: std::process::id(),
        log_path: log_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn append_diagnostic_log(app: tauri::AppHandle, entry: String) -> Result<String, String> {
    let log_path = diagnostic_log_path(&app)?;
    if let Ok(existing) = read_to_string(&log_path) {
        let lines: Vec<&str> = existing.lines().collect();
        if lines.len() >= DIAGNOSTIC_MAX_RECORDS {
            let keep_from = lines.len().saturating_sub(DIAGNOSTIC_MAX_RECORDS - 1);
            let rotated = lines[keep_from..].join("\n") + "\n";
            write(&log_path, rotated).map_err(|e| e.to_string())?;
        }
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{entry}").map_err(|e| e.to_string())?;
    Ok(log_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_diagnostic_log(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = diagnostic_log_path(&app)?;
    if !log_path.exists() {
        return Ok(String::new());
    }
    read_to_string(log_path).map_err(|e| e.to_string())
}

#[derive(Default)]
struct DesktopExitGuardState {
    initialized: AtomicBool,
    has_caixa_aberto: AtomicBool,
    snapshot: Mutex<Option<DesktopExitGuardSnapshot>>,
}

#[derive(Debug, Clone)]
struct DesktopExitGuardSnapshot {
    caixa_id: Option<String>,
    owner_id: Option<String>,
    operador_id: Option<String>,
    terminal_id: Option<String>,
    source: Option<String>,
}

#[tauri::command]
async fn start_local_server(
    port: u16,
    server_name: Option<String>,
    server_id: Option<String>,
    upstream_url: Option<String>,
    upstream_anon_key: Option<String>,
    auth_token: Option<String>,
) -> Result<LocalServerStatus, String> {
    eprintln!(
        "[gestao-pro] start_local_server invoked port={port} name={:?} id={:?}",
        server_name, server_id
    );
    let res = local_server::start(
        port,
        server_name,
        server_id,
        upstream_url,
        upstream_anon_key,
        auth_token,
    )
    .await;
    match &res {
        Ok(st) => eprintln!(
            "[gestao-pro] start_local_server OK running={} port={:?}",
            st.running, st.port
        ),
        Err(e) => eprintln!("[gestao-pro] start_local_server ERROR: {e}"),
    }
    res
}

#[tauri::command]
async fn stop_local_server(requested_by: Option<String>) -> Result<LocalServerStatus, String> {
    eprintln!(
        "[gestao-pro] stop_local_server invoked requested_by={}",
        requested_by.as_deref().unwrap_or("unknown")
    );
    let res = local_server::stop().await;
    match &res {
        Ok(st) => eprintln!(
            "[gestao-pro] stop_local_server OK running={} port={:?}",
            st.running, st.port
        ),
        Err(e) => eprintln!("[gestao-pro] stop_local_server ERROR: {e}"),
    }
    res
}

#[tauri::command]
async fn local_server_status() -> LocalServerStatus {
    eprintln!("[gestao-pro] local_server_status invoked");
    let status = local_server::current_status_checked().await;
    eprintln!(
        "[gestao-pro] local_server_status result running={} port={:?} uptime={:?}",
        status.running, status.port, status.started_at
    );
    status
}

#[tauri::command]
fn desktop_has_caixa_aberto(
    owner_id: Option<String>,
    operador_id: Option<String>,
    terminal_id: Option<String>,
) -> Result<bool, String> {
    let Some(owner_id) = owner_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        eprintln!("[gestao-pro] desktop_has_caixa_aberto sem owner_id; liberando fechamento");
        return Ok(false);
    };
    let operador = operador_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let terminal = terminal_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let result = db::existe_caixa_local_aberto(Some(owner_id), operador, terminal);
    eprintln!(
        "[gestao-pro] desktop_has_caixa_aberto diagnostico owner_id={} operador_id={:?} terminal_id={:?} result={:?}",
        owner_id,
        operador,
        terminal,
        result.as_ref().ok()
    );
    result.map_err(|e| e.0)
}

#[tauri::command]
fn desktop_set_caixa_exit_guard(
    state: State<'_, DesktopExitGuardState>,
    has_caixa_aberto: bool,
    caixa_id: Option<String>,
    owner_id: Option<String>,
    operador_id: Option<String>,
    terminal_id: Option<String>,
    source: Option<String>,
) {
    state
        .has_caixa_aberto
        .store(has_caixa_aberto, Ordering::SeqCst);
    state.initialized.store(true, Ordering::SeqCst);
    let snapshot = DesktopExitGuardSnapshot {
        caixa_id,
        owner_id,
        operador_id,
        terminal_id,
        source,
    };
    eprintln!(
        "[gestao-pro] desktop_set_caixa_exit_guard react_state has_caixa_aberto={} caixa_id={:?} owner_id={:?} operador_id={:?} terminal_id={:?} source={:?}",
        has_caixa_aberto,
        snapshot.caixa_id.as_deref(),
        snapshot.owner_id.as_deref(),
        snapshot.operador_id.as_deref(),
        snapshot.terminal_id.as_deref(),
        snapshot.source.as_deref()
    );
    if let Ok(mut guard) = state.snapshot.lock() {
        *guard = Some(snapshot);
    }
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
fn desktop_funcionarios_cache(funcionarios: Vec<DesktopFuncionarioLocalRow>) -> Result<(), String> {
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
    let k = if k == "auto" || k == "manual" {
        k
    } else {
        "manual".into()
    };
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
    let bytes = printers::build_escpos_receipt(&text, width_mm.unwrap_or(80), cut.unwrap_or(true));
    printers::print_raw(&printer_name, "Gestao Pro Cupom", &bytes)
}

/// Pipeline central de cupom: Automatico, ESC/POS RAW ou driver nativo.
/// O modo Automatico nunca usa PDF como fallback.
#[tauri::command]
fn print_receipt(
    text: String,
    printer_name: String,
    mode: String,
    width_mm: u32,
    cut: bool,
) -> Result<printers::ReceiptPrintResult, String> {
    printers::print_receipt(&text, &printer_name, &mode, width_mm, cut)
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

/// Imprime uma FOLHA de etiquetas: cada item de `pages` é uma linha da
/// bobina (já composta pelo motor de layout do frontend com todas as
/// colunas lado a lado), enviada como página própria de UM único job —
/// pipeline central para qualquer perfil de bobina (1, 2, 3+ colunas).
#[tauri::command]
fn print_label_sheet(
    pages: Vec<Vec<u8>>,
    printer_name: String,
    copies: Option<u32>,
) -> Result<String, String> {
    let refs: Vec<&[u8]> = pages.iter().map(|p| p.as_slice()).collect();
    printers::print_image_pngs(
        &printer_name,
        "Gestao Pro Etiquetas",
        &refs,
        copies.unwrap_or(1),
    )
}

/// Consulta o DPI relatado pelo driver desta impressora — usado pelo modo
/// "Automático" do perfil de bobina. Genérico: qualquer driver Windows,
/// sem hardcode de fabricante/modelo.
#[tauri::command]
fn get_printer_dpi(printer_name: String) -> Result<printers::PrinterDpi, String> {
    printers::query_printer_dpi(&printer_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopExitGuardState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            diagnostic_context,
            append_diagnostic_log,
            read_diagnostic_log,
            whatsapp_protocol_registered,
            start_local_server,
            stop_local_server,
            local_server_status,
            desktop_has_caixa_aberto,
            desktop_set_caixa_exit_guard,
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
            print_receipt,
            print_label_image,
            print_label_sheet,
            get_printer_dpi,
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopExitGuardState>();
                let react_initialized = state.initialized.load(Ordering::SeqCst);
                let react_has_caixa = state.has_caixa_aberto.load(Ordering::SeqCst);
                let snapshot = state
                    .snapshot
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone());
                let backend_has_caixa = snapshot.as_ref().and_then(|s| {
                    db::existe_caixa_local_aberto(
                        s.owner_id.as_deref(),
                        s.operador_id.as_deref(),
                        s.terminal_id.as_deref(),
                    )
                    .ok()
                });
                let snapshot_caixa_id = snapshot.as_ref().and_then(|s| s.caixa_id.as_deref());
                let snapshot_owner_id = snapshot.as_ref().and_then(|s| s.owner_id.as_deref());
                let snapshot_operador_id =
                    snapshot.as_ref().and_then(|s| s.operador_id.as_deref());
                let snapshot_terminal_id =
                    snapshot.as_ref().and_then(|s| s.terminal_id.as_deref());
                let snapshot_source = snapshot.as_ref().and_then(|s| s.source.as_deref());
                eprintln!(
                    "[gestao-pro] CloseRequested caixa_exit_guard react_initialized={} react_has_caixa={} caixa_id={:?} owner_id={:?} operador_id={:?} terminal_id={:?} source={:?} backend_has_caixa_local={:?}",
                    react_initialized,
                    react_has_caixa,
                    snapshot_caixa_id,
                    snapshot_owner_id,
                    snapshot_operador_id,
                    snapshot_terminal_id,
                    snapshot_source,
                    backend_has_caixa
                );
                let should_block = react_initialized && react_has_caixa;
                if should_block {
                    eprintln!(
                        "[gestao-pro] CloseRequested bloqueado pela fonte React/canonica; backend local e apenas diagnostico"
                    );
                    api.prevent_close();
                    let _ = window.emit("gp://caixa-close-blocked", CAIXA_ABERTO_EXIT_MESSAGE);
                    window
                        .dialog()
                        .message(CAIXA_ABERTO_EXIT_MESSAGE)
                        .title("Caixa aberto")
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::Ok)
                        .parent(window)
                        .show(|_| {});
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Gestão Pro desktop app");
}
