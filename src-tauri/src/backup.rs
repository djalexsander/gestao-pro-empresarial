// ============================================================================
// Backup / Restauração / Exportação do banco local — Bloco de Segurança
// ============================================================================
//
// Estratégia (resumo — etapa 10 offline-first):
//
//   * BACKUP MANUAL / AUTOMÁTICO: usa `VACUUM INTO 'path'` do SQLite. É um
//     comando nativo, atômico, não bloqueia leituras/escritas concorrentes
//     além do que uma transação curta normal já bloqueia, e gera um arquivo
//     de banco LIMPO (compactado, sem páginas livres). Junto do .db é gerado
//     um arquivo sidecar `.meta.json` com:
//       - empresa_id (tenant)
//       - schema_version
//       - app_version
//       - hostname
//       - data/hora (UTC)
//       - size_bytes
//       - sha256 do arquivo .db
//
//   * PASTA PADRÃO: `Documentos/GestaoPro/Backups` (preferido) com fallback
//     para a antiga pasta interna `<AppData>/gestao-pro/backups` se a pasta
//     de Documentos não puder ser resolvida. Fica fora da pasta temporária
//     do app e sobrevive a updates.
//
//   * RESTAURAÇÃO: NÃO substitui o banco em uso. Em vez disso:
//       1. Valida arquivo: abre read-only, checa meta.schema_version, checa
//          checksum se houver sidecar.
//       2. Confere `empresa_id` do backup vs. instância atual; se divergir,
//          BLOQUEIA por padrão (a UI pode reenviar com `force_other_tenant`).
//       3. Gera pre-backup automático do estado atual.
//       4. Copia para `local.db.restore-pending` ao lado do banco principal.
//       5. Marca flag `restore_pending=1` em `meta`.
//       6. Pede ao usuário para reiniciar o app desktop.
//       7. No próximo boot, ANTES de abrir a conexão,
//          `apply_pending_restore_on_boot()` troca atomicamente os arquivos.
//
//   * RETENÇÃO (auto): mantém os últimos 7 backups diários (até 1 por dia)
//     + os últimos 4 backups semanais (1 por semana ISO). Backups MANUAIS
//     nunca são apagados automaticamente.
//
//   * HISTÓRICO: tabela `backup_log` com toda operação.
//
//   * LOGS DEV (prefixos):
//       [LOCAL_BACKUP]            — criação
//       [LOCAL_RESTORE]           — restauração
//       [LOCAL_BACKUP_VALIDATE]   — validação
//       [LOCAL_BACKUP_RETENTION]  — retenção/limpeza

use chrono::{DateTime, Datelike, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Serialize, Deserialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tokio::sync::oneshot;

use crate::db::{self, DbError, DbResult};

const PENDING_SUFFIX: &str = ".restore-pending";
const AUTO_DAILY_KEEP: usize = 7;
const AUTO_WEEKLY_KEEP: usize = 4;
const AUTO_BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const SCHEDULER_TICK_MS: u64 = 30 * 60 * 1000; // 30 min
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn backups_dir() -> PathBuf {
    // Preferência: ~/Documents/GestaoPro/Backups (sobrevive a updates do app
    // e fica visível para o usuário). Fallback: pasta interna ao lado do .db.
    if let Some(docs) = dirs::document_dir() {
        return docs.join("GestaoPro").join("Backups");
    }
    db::db_file()
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"))
}

fn legacy_backups_dir() -> PathBuf {
    db::db_file()
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"))
}

fn ensure_backups_dir() -> DbResult<PathBuf> {
    let dir = backups_dir();
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupEntry {
    pub id: i64,
    pub kind: String,           // "manual" | "auto" | "pre_restore" | "export" | "restore"
    pub path: String,
    pub status: String,         // "ok" | "error" | "scheduled" | "applied" | "cancelled"
    pub size_bytes: Option<i64>,
    pub message: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupMetadata {
    pub empresa_id: Option<String>,
    pub schema_version: Option<String>,
    pub app_version: String,
    pub hostname: String,
    pub created_at_ms: i64,
    pub size_bytes: i64,
    pub sha256: String,
    pub source_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupFile {
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub modified_ms: i64,
    pub kind: String,
    pub has_metadata: bool,
    pub empresa_id: Option<String>,
    pub schema_version: Option<String>,
    pub app_version: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupStatus {
    pub backups_dir: String,
    pub db_path: String,
    pub last_backup_ms: Option<i64>,
    pub last_auto_backup_ms: Option<i64>,
    pub last_restore_ms: Option<i64>,
    pub restore_pending: bool,
    pub auto_retention_daily: i64,
    pub auto_retention_weekly: i64,
    pub auto_interval_ms: i64,
    pub total_backups: i64,
    pub total_size_bytes: i64,
    pub current_empresa_id: Option<String>,
    pub current_schema_version: Option<String>,
    pub app_version: String,
    pub hostname: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupValidationReport {
    pub valid: bool,
    pub path: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub sha256_match: Option<bool>,      // None se não houver meta sidecar
    pub schema_version: Option<String>,
    pub empresa_id: Option<String>,
    pub current_empresa_id: Option<String>,
    pub tenant_match: Option<bool>,
    pub app_version: Option<String>,
    pub hostname: Option<String>,
    pub has_metadata: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

// ----------------------------------------------------------------------------
// Migração leve (v13 lógica): tabela `backup_log`.
// ----------------------------------------------------------------------------

pub fn ensure_schema() -> DbResult<()> {
    db::with_raw_conn(|conn| {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS backup_log (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                kind          TEXT NOT NULL,
                path          TEXT NOT NULL,
                status        TEXT NOT NULL,
                size_bytes    INTEGER,
                message       TEXT,
                created_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backup_log_created
                ON backup_log(created_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_backup_log_kind
                ON backup_log(kind, created_at_ms DESC);
            "#,
        )?;
        Ok(())
    })
}

fn now_ms() -> i64 { Utc::now().timestamp_millis() }

fn host() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "desconhecido".into())
}

fn meta_get(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key=?1", params![key], |r| r.get(0))
        .optional()?;
    Ok(v)
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn log_entry(kind: &str, path: &Path, status: &str, message: Option<&str>) -> DbResult<i64> {
    let size = fs::metadata(path).ok().map(|m| m.len() as i64);
    let id = db::with_raw_conn(|conn| {
        conn.execute(
            "INSERT INTO backup_log(kind, path, status, size_bytes, message, created_at_ms)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![kind, path.to_string_lossy().to_string(), status, size, message, now_ms()],
        )?;
        Ok(conn.last_insert_rowid())
    })?;
    Ok(id)
}

fn current_empresa_id() -> Option<String> {
    db::with_raw_conn(|c| meta_get(c, "empresa_id")).ok().flatten()
}

fn current_schema_version() -> Option<String> {
    db::with_raw_conn(|c| meta_get(c, "schema_version")).ok().flatten()
}

fn sha256_of_file(path: &Path) -> DbResult<String> {
    let mut f = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| DbError(e.to_string()))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(hex(&digest))
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn meta_sidecar_path(db_path: &Path) -> PathBuf {
    let mut s = db_path.to_string_lossy().to_string();
    s.push_str(".meta.json");
    PathBuf::from(s)
}

fn write_metadata_sidecar(db_path: &Path) -> DbResult<BackupMetadata> {
    let size = fs::metadata(db_path).map(|m| m.len() as i64).unwrap_or(0);
    let sha = sha256_of_file(db_path).unwrap_or_default();
    let meta = BackupMetadata {
        empresa_id: current_empresa_id(),
        schema_version: current_schema_version(),
        app_version: APP_VERSION.to_string(),
        hostname: host(),
        created_at_ms: now_ms(),
        size_bytes: size,
        sha256: sha,
        source_path: db_path.to_string_lossy().to_string(),
    };
    let json = serde_json::to_vec_pretty(&meta)
        .map_err(|e| DbError(format!("falha ao serializar metadata: {e}")))?;
    fs::write(meta_sidecar_path(db_path), json)?;
    Ok(meta)
}

fn read_metadata_sidecar(db_path: &Path) -> Option<BackupMetadata> {
    let p = meta_sidecar_path(db_path);
    if !p.exists() { return None; }
    let bytes = fs::read(&p).ok()?;
    serde_json::from_slice(&bytes).ok()
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

/// Cria um backup do banco local. `kind` deve ser "manual", "auto" ou
/// "pre_restore". Gera o .db (VACUUM INTO) + sidecar `.meta.json` com
/// checksum e contexto da empresa.
pub fn create_backup(kind: &str) -> DbResult<BackupEntry> {
    ensure_schema()?;
    let dir = ensure_backups_dir()?;
    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let filename = format!("local-{kind}-{ts}.db");
    let dest = dir.join(&filename);

    if dest.exists() { let _ = fs::remove_file(&dest); }

    let res: DbResult<()> = db::with_raw_conn(|conn| {
        let path_str = dest.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{path_str}';"))?;
        Ok(())
    });

    let now = now_ms();
    match res {
        Ok(()) => {
            // sidecar metadata — best effort (não falha o backup se der erro).
            let meta_msg = match write_metadata_sidecar(&dest) {
                Ok(m) => Some(format!(
                    "sha256={} empresa={} schema={} app={} host={}",
                    &m.sha256.chars().take(12).collect::<String>(),
                    m.empresa_id.clone().unwrap_or_default(),
                    m.schema_version.clone().unwrap_or_default(),
                    m.app_version, m.hostname,
                )),
                Err(e) => {
                    eprintln!("[LOCAL_BACKUP] sidecar metadata falhou: {}", e.0);
                    None
                }
            };
            let id = log_entry(kind, &dest, "ok", meta_msg.as_deref())?;
            if kind == "auto" {
                db::with_raw_conn(|c| {
                    meta_set(c, "last_auto_backup_ms", &now.to_string())?;
                    meta_set(c, "last_backup_ms", &now.to_string())
                })?;
                if let Ok(report) = enforce_retention_smart() {
                    eprintln!(
                        "[LOCAL_BACKUP_RETENTION] auto={} mantidos_diarios={} mantidos_semanais={} removidos={}",
                        report.total_auto, report.kept_daily, report.kept_weekly, report.removed
                    );
                }
            } else {
                db::with_raw_conn(|c| meta_set(c, "last_backup_ms", &now.to_string()))?;
            }
            eprintln!(
                "[LOCAL_BACKUP] criado kind={} path={} size={}",
                kind,
                dest.to_string_lossy(),
                fs::metadata(&dest).map(|m| m.len()).unwrap_or(0),
            );
            Ok(read_log_entry(id)?.expect("entry just inserted"))
        }
        Err(e) => {
            eprintln!("[LOCAL_BACKUP] erro kind={} msg={}", kind, e.0);
            let _ = log_entry(kind, &dest, "error", Some(&e.0));
            Err(e)
        }
    }
}

/// Lista arquivos de backup (na pasta nova + na legacy, deduplicados por path).
pub fn list_backup_files() -> DbResult<Vec<BackupFile>> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();

    let mut scan = |dir: &Path| {
        let _ = fs::create_dir_all(dir);
        if let Ok(rd) = fs::read_dir(dir) {
            for entry in rd.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                if !name.ends_with(".db") { continue; }
                let key = path.to_string_lossy().to_string();
                if !seen.insert(key.clone()) { continue; }
                let metafs = match entry.metadata() { Ok(m) => m, Err(_) => continue };
                let modified_ms = metafs
                    .modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let kind = if name.contains("-auto-") { "auto" }
                    else if name.contains("-pre_restore-") { "pre_restore" }
                    else if name.contains("-manual-") { "manual" }
                    else { "outro" };
                let meta = read_metadata_sidecar(&path);
                out.push(BackupFile {
                    name,
                    path: key,
                    size_bytes: metafs.len() as i64,
                    modified_ms,
                    kind: kind.to_string(),
                    has_metadata: meta.is_some(),
                    empresa_id: meta.as_ref().and_then(|m| m.empresa_id.clone()),
                    schema_version: meta.as_ref().and_then(|m| m.schema_version.clone()),
                    app_version: meta.as_ref().map(|m| m.app_version.clone()),
                    hostname: meta.as_ref().map(|m| m.hostname.clone()),
                });
            }
        }
    };

    scan(&backups_dir());
    let legacy = legacy_backups_dir();
    if legacy != backups_dir() { scan(&legacy); }

    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

#[derive(Debug, Serialize, Clone)]
pub struct RetentionReport {
    pub total_auto: i64,
    pub kept_daily: i64,
    pub kept_weekly: i64,
    pub removed: i64,
}

/// Mantém últimos 7 diários + últimos 4 semanais (ISO week) entre backups
/// automáticos. Manuais e pre_restore NÃO são tocados.
pub fn enforce_retention_smart() -> DbResult<RetentionReport> {
    let files = list_backup_files()?;
    let mut autos: Vec<BackupFile> = files.into_iter().filter(|f| f.kind == "auto").collect();
    // mais recentes primeiro
    autos.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));

    use std::collections::HashSet;
    let mut keep_paths: HashSet<String> = HashSet::new();
    let mut kept_daily: i64 = 0;
    let mut seen_days: HashSet<String> = HashSet::new();
    for f in &autos {
        let dt = DateTime::<Utc>::from_timestamp_millis(f.modified_ms).unwrap_or_else(Utc::now);
        let day = dt.format("%Y-%m-%d").to_string();
        if seen_days.insert(day) {
            if (kept_daily as usize) < AUTO_DAILY_KEEP {
                keep_paths.insert(f.path.clone());
                kept_daily += 1;
            }
        }
        if (kept_daily as usize) >= AUTO_DAILY_KEEP { break; }
    }

    let mut kept_weekly: i64 = 0;
    let mut seen_weeks: HashSet<String> = HashSet::new();
    for f in &autos {
        let dt = DateTime::<Utc>::from_timestamp_millis(f.modified_ms).unwrap_or_else(Utc::now);
        let iso = dt.iso_week();
        let wk = format!("{}-W{:02}", iso.year(), iso.week());
        if seen_weeks.insert(wk) {
            if (kept_weekly as usize) < AUTO_WEEKLY_KEEP {
                keep_paths.insert(f.path.clone());
                kept_weekly += 1;
            }
        }
        if (kept_weekly as usize) >= AUTO_WEEKLY_KEEP { break; }
    }

    let mut removed = 0i64;
    for f in &autos {
        if keep_paths.contains(&f.path) { continue; }
        if fs::remove_file(&f.path).is_ok() {
            removed += 1;
            // sidecar
            let side = meta_sidecar_path(Path::new(&f.path));
            let _ = fs::remove_file(side);
            eprintln!("[LOCAL_BACKUP_RETENTION] removido path={}", f.path);
        }
    }

    Ok(RetentionReport {
        total_auto: autos.len() as i64,
        kept_daily,
        kept_weekly,
        removed,
    })
}

/// Exporta (copia) um backup existente para um caminho de destino arbitrário.
pub fn export_backup(source_path: &str, dest_path: &str) -> DbResult<BackupEntry> {
    ensure_schema()?;
    let src = Path::new(source_path);
    if !src.exists() {
        return Err(DbError(format!("arquivo de backup não encontrado: {source_path}")));
    }
    let dest = Path::new(dest_path);
    if let Some(parent) = dest.parent() { fs::create_dir_all(parent)?; }
    fs::copy(src, dest)?;
    // sidecar junto, se existir
    let src_side = meta_sidecar_path(src);
    if src_side.exists() {
        let dest_side = meta_sidecar_path(dest);
        let _ = fs::copy(&src_side, &dest_side);
    }
    let id = log_entry("export", dest, "ok", Some(&format!("from={source_path}")))?;
    eprintln!("[LOCAL_BACKUP] export from={} to={}", source_path, dest_path);
    Ok(read_log_entry(id)?.expect("entry just inserted"))
}

/// Validação completa de um arquivo de backup (sem aplicar).
pub fn validate_backup(source_path: &str) -> DbResult<BackupValidationReport> {
    let src = Path::new(source_path);
    let mut report = BackupValidationReport {
        valid: false,
        path: source_path.to_string(),
        size_bytes: 0,
        sha256: String::new(),
        sha256_match: None,
        schema_version: None,
        empresa_id: None,
        current_empresa_id: current_empresa_id(),
        tenant_match: None,
        app_version: None,
        hostname: None,
        has_metadata: false,
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    if !src.exists() {
        report.errors.push("arquivo não encontrado".into());
        eprintln!("[LOCAL_BACKUP_VALIDATE] missing path={}", source_path);
        return Ok(report);
    }

    report.size_bytes = fs::metadata(src).map(|m| m.len() as i64).unwrap_or(0);
    report.sha256 = sha256_of_file(src).unwrap_or_default();

    // tentar abrir read-only e ler schema_version + empresa_id
    match Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(conn) => {
            let schema: Option<String> = conn
                .query_row("SELECT value FROM meta WHERE key='schema_version'", [], |r| r.get(0))
                .optional().unwrap_or(None);
            if schema.is_none() {
                report.errors.push("meta.schema_version ausente".into());
            }
            report.schema_version = schema;

            let emp: Option<String> = conn
                .query_row("SELECT value FROM meta WHERE key='empresa_id'", [], |r| r.get(0))
                .optional().unwrap_or(None);
            report.empresa_id = emp;
        }
        Err(e) => {
            report.errors.push(format!("arquivo SQLite inválido: {e}"));
        }
    }

    if let Some(meta) = read_metadata_sidecar(src) {
        report.has_metadata = true;
        report.app_version = Some(meta.app_version.clone());
        report.hostname = Some(meta.hostname.clone());
        if !meta.sha256.is_empty() {
            let m = meta.sha256.eq_ignore_ascii_case(&report.sha256);
            report.sha256_match = Some(m);
            if !m {
                report.errors.push("checksum diverge do sidecar (.meta.json)".into());
            }
        }
        if report.empresa_id.is_none() && meta.empresa_id.is_some() {
            report.empresa_id = meta.empresa_id.clone();
        }
        if report.schema_version.is_none() && meta.schema_version.is_some() {
            report.schema_version = meta.schema_version.clone();
        }
    } else {
        report.warnings.push("sem sidecar .meta.json — checksum não pôde ser comparado".into());
    }

    if let (Some(cur), Some(b)) = (&report.current_empresa_id, &report.empresa_id) {
        let m = cur == b;
        report.tenant_match = Some(m);
        if !m {
            report.warnings.push(format!(
                "empresa_id do backup ({}) difere da atual ({}); restauração precisa de confirmação",
                b, cur
            ));
        }
    }

    report.valid = report.errors.is_empty();
    eprintln!(
        "[LOCAL_BACKUP_VALIDATE] valid={} schema={:?} empresa={:?} tenant_match={:?} sha_match={:?} errors={}",
        report.valid, report.schema_version, report.empresa_id,
        report.tenant_match, report.sha256_match, report.errors.len(),
    );
    Ok(report)
}

/// Exclui um arquivo de backup (apenas se estiver dentro de uma das pastas
/// gerenciadas: backups_dir() ou legacy).
pub fn delete_backup(path: &str) -> DbResult<bool> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(DbError("arquivo não encontrado".into()));
    }
    let canon = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let in_managed = [backups_dir(), legacy_backups_dir()]
        .iter()
        .any(|d| {
            fs::canonicalize(d)
                .map(|cd| canon.starts_with(&cd))
                .unwrap_or(false)
        });
    if !in_managed {
        return Err(DbError("recusado: caminho fora da pasta de backups".into()));
    }
    fs::remove_file(&canon)?;
    let _ = fs::remove_file(meta_sidecar_path(&canon));
    eprintln!("[LOCAL_BACKUP] delete path={}", canon.to_string_lossy());
    let _ = log_entry("delete", &canon, "ok", None);
    Ok(true)
}

/// Agenda restauração para o próximo boot. Antes:
///   - valida o arquivo;
///   - confere tenant (empresa_id) — bloqueia se divergir e `force_other_tenant=false`;
///   - gera pre-backup automático.
pub fn schedule_restore(source_path: &str, force_other_tenant: bool) -> DbResult<BackupEntry> {
    ensure_schema()?;
    let report = validate_backup(source_path)?;
    if !report.valid {
        let msg = report.errors.join("; ");
        eprintln!("[LOCAL_RESTORE] bloqueado: backup inválido ({msg})");
        return Err(DbError(format!("backup inválido: {msg}")));
    }
    if report.tenant_match == Some(false) && !force_other_tenant {
        eprintln!(
            "[LOCAL_RESTORE] bloqueado: tenant diferente backup={:?} atual={:?}",
            report.empresa_id, report.current_empresa_id
        );
        return Err(DbError(
            "backup pertence a outra empresa. Confirme explicitamente para prosseguir.".into(),
        ));
    }

    // pre-backup
    let pre = create_backup("pre_restore")?;

    // staging
    let main = db::db_file();
    let pending = with_suffix(&main, PENDING_SUFFIX);
    if pending.exists() { let _ = fs::remove_file(&pending); }
    fs::copy(source_path, &pending)?;

    db::with_raw_conn(|c| {
        meta_set(c, "restore_pending", "1")?;
        meta_set(c, "restore_pending_source", source_path)?;
        meta_set(c, "restore_pending_at_ms", &now_ms().to_string())
    })?;

    let id = log_entry(
        "restore",
        Path::new(source_path),
        "scheduled",
        Some(&format!("pending={}; pre_backup={}", pending.to_string_lossy(), pre.path)),
    )?;
    eprintln!(
        "[LOCAL_RESTORE] agendado source={} pre_backup={} force_other_tenant={}",
        source_path, pre.path, force_other_tenant
    );
    Ok(read_log_entry(id)?.expect("entry just inserted"))
}

/// Cancela uma restauração agendada (apaga staging e flag).
pub fn cancel_restore() -> DbResult<bool> {
    let main = db::db_file();
    let pending = with_suffix(&main, PENDING_SUFFIX);
    let had = pending.exists();
    if had { let _ = fs::remove_file(&pending); }
    db::with_raw_conn(|c| {
        meta_set(c, "restore_pending", "0")?;
        meta_set(c, "restore_pending_source", "")
    })?;
    if had {
        let _ = log_entry("restore", &pending, "cancelled", None);
        eprintln!("[LOCAL_RESTORE] cancelado");
    }
    Ok(had)
}

/// Aplicada no boot, ANTES da conexão ser aberta normalmente. Swap atômico.
pub fn apply_pending_restore_on_boot() -> Result<bool, String> {
    let main = db::db_file();
    let pending = with_suffix(&main, PENDING_SUFFIX);
    if !pending.exists() { return Ok(false); }

    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let dir = backups_dir();
    let _ = fs::create_dir_all(&dir);
    let archived = dir.join(format!("local-pre_restore-{ts}.db"));
    if main.exists() {
        if let Err(e) = fs::copy(&main, &archived) {
            return Err(format!("falha ao arquivar DB atual antes do restore: {e}"));
        }
        if let Err(e) = fs::remove_file(&main) {
            return Err(format!("falha ao remover DB atual: {e}"));
        }
    }
    let _ = fs::remove_file(with_suffix(&main, "-wal"));
    let _ = fs::remove_file(with_suffix(&main, "-shm"));

    if let Err(e) = fs::rename(&pending, &main) {
        if let Err(e2) = fs::copy(&pending, &main) {
            return Err(format!("falha ao aplicar restore: {e} / fallback: {e2}"));
        }
        let _ = fs::remove_file(&pending);
    }
    eprintln!("[LOCAL_RESTORE] aplicado no boot db={}", main.to_string_lossy());
    Ok(true)
}

/// Marca a restauração como concluída.
pub fn mark_restore_completed_after_boot() -> DbResult<()> {
    ensure_schema()?;
    let pending = db::with_raw_conn(|c| meta_get(c, "restore_pending")).unwrap_or(None);
    if pending.as_deref() != Some("1") { return Ok(()); }
    let now = now_ms();
    db::with_raw_conn(|c| {
        meta_set(c, "restore_pending", "0")?;
        meta_set(c, "last_restore_ms", &now.to_string())
    })?;
    let main = db::db_file();
    let _ = log_entry("restore", &main, "applied", Some("aplicado no boot"));
    Ok(())
}

pub fn status() -> DbResult<BackupStatus> {
    ensure_schema()?;
    let files = list_backup_files()?;
    let total_size: i64 = files.iter().map(|f| f.size_bytes).sum();
    let total = files.len() as i64;
    db::with_raw_conn(|c| {
        let last_backup_ms = meta_get(c, "last_backup_ms")?.and_then(|s| s.parse().ok());
        let last_auto = meta_get(c, "last_auto_backup_ms")?.and_then(|s| s.parse().ok());
        let last_restore = meta_get(c, "last_restore_ms")?.and_then(|s| s.parse().ok());
        let pending = meta_get(c, "restore_pending")?.as_deref() == Some("1");
        let empresa_id = meta_get(c, "empresa_id")?;
        let schema_v = meta_get(c, "schema_version")?;
        Ok(BackupStatus {
            backups_dir: backups_dir().to_string_lossy().to_string(),
            db_path: db::db_file().to_string_lossy().to_string(),
            last_backup_ms,
            last_auto_backup_ms: last_auto,
            last_restore_ms: last_restore,
            restore_pending: pending,
            auto_retention_daily: AUTO_DAILY_KEEP as i64,
            auto_retention_weekly: AUTO_WEEKLY_KEEP as i64,
            auto_interval_ms: AUTO_BACKUP_INTERVAL_MS,
            total_backups: total,
            total_size_bytes: total_size,
            current_empresa_id: empresa_id,
            current_schema_version: schema_v,
            app_version: APP_VERSION.to_string(),
            hostname: host(),
        })
    })
}

pub fn recent_log(limit: i64) -> DbResult<Vec<BackupEntry>> {
    ensure_schema()?;
    db::with_raw_conn(|conn| {
        let limit = limit.clamp(1, 500);
        let mut stmt = conn.prepare(
            "SELECT id, kind, path, status, size_bytes, message, created_at_ms
               FROM backup_log ORDER BY created_at_ms DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(BackupEntry {
                id: r.get(0)?,
                kind: r.get(1)?,
                path: r.get(2)?,
                status: r.get(3)?,
                size_bytes: r.get(4)?,
                message: r.get(5)?,
                created_at_ms: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    })
}

fn read_log_entry(id: i64) -> DbResult<Option<BackupEntry>> {
    db::with_raw_conn(|conn| {
        let r = conn.query_row(
            "SELECT id, kind, path, status, size_bytes, message, created_at_ms
               FROM backup_log WHERE id=?1",
            params![id],
            |r| {
                Ok(BackupEntry {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    path: r.get(2)?,
                    status: r.get(3)?,
                    size_bytes: r.get(4)?,
                    message: r.get(5)?,
                    created_at_ms: r.get(6)?,
                })
            },
        ).optional()?;
        Ok(r)
    })
}

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.to_string_lossy().to_string();
    s.push_str(suffix);
    PathBuf::from(s)
}

// ----------------------------------------------------------------------------
// Scheduler de backup automático (no máximo 1× por dia)
// ----------------------------------------------------------------------------

pub async fn run_backup_scheduler(mut shutdown: oneshot::Receiver<()>) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(SCHEDULER_TICK_MS));
    interval.tick().await; // imediato — backup-on-startup (se passou 24h)
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            _ = interval.tick() => {
                if let Err(e) = maybe_auto_backup() {
                    eprintln!("[LOCAL_BACKUP] auto backup falhou: {}", e.0);
                }
            }
        }
    }
}

/// Dispara backup automático se passou >= 24h do último. Usado pelo scheduler
/// E também por triggers de evento (ex.: fechar caixa) para não duplicar.
pub fn maybe_auto_backup() -> DbResult<()> {
    ensure_schema()?;
    let last = db::with_raw_conn(|c| meta_get(c, "last_auto_backup_ms"))?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let now = now_ms();
    if now - last < AUTO_BACKUP_INTERVAL_MS { return Ok(()); }
    let _ = create_backup("auto")?;
    Ok(())
}

/// Trigger de evento (caixa fechado, etc). Mesma debouncing que o scheduler.
pub fn trigger_event_backup(event: &str) {
    match maybe_auto_backup() {
        Ok(()) => eprintln!("[LOCAL_BACKUP] event-trigger ok event={}", event),
        Err(e) => eprintln!("[LOCAL_BACKUP] event-trigger erro event={} msg={}", event, e.0),
    }
}
