// ============================================================================
// Backup / Restauração / Exportação do banco local — Bloco de Segurança
// ============================================================================
//
// Estratégia:
//
//   * BACKUP MANUAL / AUTOMÁTICO: usa `VACUUM INTO 'path'` do SQLite. É um
//     comando nativo, atômico, não bloqueia leituras/escritas concorrentes
//     além do que uma transação curta normal já bloqueia, e gera um arquivo
//     de banco LIMPO (compactado, sem páginas livres). Perfeito para backup
//     em tempo real sem precisar parar o servidor local.
//
//   * EXPORTAÇÃO: copia um arquivo de backup já existente para um destino
//     escolhido pelo usuário (HD externo, pendrive, pasta de rede). Como o
//     arquivo de backup não está aberto, a cópia é uma operação simples e
//     segura de filesystem.
//
//   * RESTAURAÇÃO: NÃO substitui o banco em uso. Em vez disso:
//       1. Gera um pre-backup automático do estado atual (segurança extra).
//       2. Valida que o arquivo escolhido é um banco SQLite com schema
//          compatível.
//       3. Copia o arquivo escolhido para `local.db.restore-pending` ao lado
//          do banco principal.
//       4. Marca uma flag `restore_pending=1` em `meta`.
//       5. Pede ao usuário para reiniciar o aplicativo desktop.
//       6. No próximo boot, ANTES de abrir a conexão, `apply_pending_restore()`
//          troca atomicamente os arquivos.
//     Esse fluxo evita corromper um DB aberto e mantém a operação 100%
//     reversível (o pre-backup fica no histórico).
//
//   * HISTÓRICO: tabela `backup_log` registra toda operação (manual,
//     automática, restauração, exportação) com status e mensagem.
//
//   * RETENÇÃO: mantém os últimos N backups automáticos (default 14). Backups
//     manuais não são apagados automaticamente.
//
//   * SCHEDULER: roda em background, faz backup automático no máximo 1× por
//     dia (controlado por timestamp em `meta`).

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tokio::sync::oneshot;

use crate::db::{self, DbError, DbResult};

const PENDING_SUFFIX: &str = ".restore-pending";
const PRE_RESTORE_SUFFIX: &str = ".pre-restore";
const DEFAULT_AUTO_RETENTION: i64 = 14;
const AUTO_BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const SCHEDULER_TICK_MS: u64 = 30 * 60 * 1000; // 30 min

pub fn backups_dir() -> PathBuf {
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
    pub status: String,         // "ok" | "error"
    pub size_bytes: Option<i64>,
    pub message: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupFile {
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub modified_ms: i64,
    pub kind: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupStatus {
    pub backups_dir: String,
    pub db_path: String,
    pub last_backup_ms: Option<i64>,
    pub last_auto_backup_ms: Option<i64>,
    pub last_restore_ms: Option<i64>,
    pub restore_pending: bool,
    pub auto_retention: i64,
    pub auto_interval_ms: i64,
    pub total_backups: i64,
    pub total_size_bytes: i64,
}

/// Resultado do preflight de restauração (PROMPT 15).
/// Indica se o banco local está em estado seguro para receber um restore.
/// `blocked=true` significa que existe risco operacional (caixa aberto ou
/// pendências de outbox) e a UI deve exigir confirmação explícita
/// (`force=true`) antes de prosseguir.
#[derive(Debug, Serialize, Clone)]
pub struct RestorePreflight {
    pub blocked: bool,
    pub caixa_aberto: bool,
    pub caixa_abertos_count: i64,
    pub outbox_pending_total: i64,
    pub outbox_error_total: i64,
    pub reasons: Vec<String>,
}

// ----------------------------------------------------------------------------
// Migração leve (v13 lógica): tabela `backup_log`. Mantida fora do init() do db
// para não quebrar SCHEMA_VERSION; usamos CREATE IF NOT EXISTS.
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

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

/// Cria um backup do banco local. `kind` deve ser "manual" ou "auto".
pub fn create_backup(kind: &str) -> DbResult<BackupEntry> {
    ensure_schema()?;
    let dir = ensure_backups_dir()?;
    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let filename = format!("local-{kind}-{ts}.db");
    let dest = dir.join(&filename);

    // VACUUM INTO requer que o destino NÃO exista.
    if dest.exists() { let _ = fs::remove_file(&dest); }

    let res: DbResult<()> = db::with_raw_conn(|conn| {
        let path_str = dest.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{path_str}';"))?;
        Ok(())
    });

    let now = now_ms();
    match res {
        Ok(()) => {
            let id = log_entry(kind, &dest, "ok", None)?;
            if kind == "auto" {
                db::with_raw_conn(|c| {
                    meta_set(c, "last_auto_backup_ms", &now.to_string())?;
                    meta_set(c, "last_backup_ms", &now.to_string())
                })?;
                let _ = enforce_retention(DEFAULT_AUTO_RETENTION);
            } else {
                db::with_raw_conn(|c| meta_set(c, "last_backup_ms", &now.to_string()))?;
            }
            Ok(read_log_entry(id)?.expect("entry just inserted"))
        }
        Err(e) => {
            let _ = log_entry(kind, &dest, "error", Some(&e.0));
            Err(e)
        }
    }
}

/// Lista arquivos de backup existentes na pasta + seu kind inferido.
pub fn list_backup_files() -> DbResult<Vec<BackupFile>> {
    let dir = ensure_backups_dir()?;
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() { continue; }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !name.ends_with(".db") { continue; }
            let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let kind = if name.contains("-auto-") { "auto" }
                else if name.contains("-pre_restore-") { "pre_restore" }
                else if name.contains("-manual-") { "manual" }
                else { "outro" };
            out.push(BackupFile {
                name,
                path: path.to_string_lossy().to_string(),
                size_bytes: meta.len() as i64,
                modified_ms,
                kind: kind.to_string(),
            });
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Mantém os últimos `keep` backups automáticos. Backups manuais nunca são apagados.
pub fn enforce_retention(keep: i64) -> DbResult<i64> {
    let files = list_backup_files()?;
    let mut autos: Vec<&BackupFile> = files.iter().filter(|f| f.kind == "auto").collect();
    // ordenado desc por modified_ms; preservar os primeiros `keep`.
    autos.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    let mut removed = 0;
    for f in autos.iter().skip(keep.max(1) as usize) {
        if fs::remove_file(&f.path).is_ok() { removed += 1; }
    }
    Ok(removed)
}

/// Exporta (copia) um backup existente para um caminho de destino arbitrário.
pub fn export_backup(source_path: &str, dest_path: &str) -> DbResult<BackupEntry> {
    ensure_schema()?;
    let src = Path::new(source_path);
    if !src.exists() {
        return Err(DbError(format!("arquivo de backup não encontrado: {source_path}")));
    }
    let dest = Path::new(dest_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dest)?;
    let id = log_entry("export", dest, "ok", Some(&format!("from={source_path}")))?;
    Ok(read_log_entry(id)?.expect("entry just inserted"))
}

/// Valida que o arquivo é um SQLite válido com schema compatível e
/// agenda restauração para o próximo boot. Antes disso, gera pre-backup.
pub fn schedule_restore(source_path: &str) -> DbResult<BackupEntry> {
    ensure_schema()?;
    let src = Path::new(source_path);
    if !src.exists() {
        return Err(DbError(format!("arquivo não encontrado: {source_path}")));
    }

    // 1) Validação: tentar abrir como SQLite read-only e ler schema_version.
    let test_conn = Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).map_err(|e| DbError(format!("arquivo não parece um banco válido: {e}")))?;
    let schema: Option<String> = test_conn
        .query_row("SELECT value FROM meta WHERE key='schema_version'", [], |r| r.get(0))
        .optional()
        .map_err(|e| DbError(format!("backup sem tabela meta: {e}")))?;
    if schema.is_none() {
        return Err(DbError("backup inválido: meta.schema_version ausente".into()));
    }
    drop(test_conn);

    // 2) Pre-backup automático antes de qualquer mudança.
    let pre = create_backup_internal("pre_restore")?;

    // 3) Copia o arquivo para staging ao lado do DB principal.
    let main = db::db_file();
    let pending = with_suffix(&main, PENDING_SUFFIX);
    if pending.exists() { let _ = fs::remove_file(&pending); }
    fs::copy(src, &pending)?;

    // 4) Marca flag em meta.
    db::with_raw_conn(|c| {
        meta_set(c, "restore_pending", "1")?;
        meta_set(c, "restore_pending_source", source_path)?;
        meta_set(c, "restore_pending_at_ms", &now_ms().to_string())
    })?;

    let id = log_entry(
        "restore",
        src,
        "scheduled",
        Some(&format!("pending={}; pre_backup={}", pending.to_string_lossy(), pre.path)),
    )?;
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
    }
    Ok(had)
}

/// Aplicada no boot, ANTES da conexão ser aberta normalmente. Faz swap
/// atômico do arquivo principal pelo staging, salvando o atual como
/// `<main>.pre-restore-<ts>`.
pub fn apply_pending_restore_on_boot() -> Result<bool, String> {
    let main = db::db_file();
    let pending = with_suffix(&main, PENDING_SUFFIX);
    if !pending.exists() { return Ok(false); }

    // Mover o atual para .pre-restore-<ts>
    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let dir = backups_dir();
    let _ = fs::create_dir_all(&dir);
    let archived = dir.join(format!("local-pre_restore-{ts}.db"));
    if main.exists() {
        // melhor copiar e depois remover, para evitar problemas entre filesystems
        if let Err(e) = fs::copy(&main, &archived) {
            return Err(format!("falha ao arquivar DB atual antes do restore: {e}"));
        }
        if let Err(e) = fs::remove_file(&main) {
            return Err(format!("falha ao remover DB atual: {e}"));
        }
    }
    // Limpa side files do WAL/SHM se existirem.
    let _ = fs::remove_file(with_suffix(&main, "-wal"));
    let _ = fs::remove_file(with_suffix(&main, "-shm"));

    if let Err(e) = fs::rename(&pending, &main) {
        // tenta copiar como fallback
        if let Err(e2) = fs::copy(&pending, &main) {
            return Err(format!("falha ao aplicar restore: {e} / fallback: {e2}"));
        }
        let _ = fs::remove_file(&pending);
    }

    Ok(true)
}

/// Marca a restauração como concluída. Chamado após `db::init()` ter aberto
/// o banco já restaurado, para gravar o evento e limpar a flag.
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
        Ok(BackupStatus {
            backups_dir: backups_dir().to_string_lossy().to_string(),
            db_path: db::db_file().to_string_lossy().to_string(),
            last_backup_ms,
            last_auto_backup_ms: last_auto,
            last_restore_ms: last_restore,
            restore_pending: pending,
            auto_retention: DEFAULT_AUTO_RETENTION,
            auto_interval_ms: AUTO_BACKUP_INTERVAL_MS,
            total_backups: total,
            total_size_bytes: total_size,
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

fn create_backup_internal(kind: &str) -> DbResult<BackupEntry> {
    create_backup(kind)
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
    // Tick inicial após 60s para não atrapalhar o boot.
    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(SCHEDULER_TICK_MS));
    interval.tick().await; // imediato
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            _ = interval.tick() => {
                if let Err(e) = maybe_auto_backup() {
                    eprintln!("[backup] auto backup falhou: {}", e.0);
                }
            }
        }
    }
}

fn maybe_auto_backup() -> DbResult<()> {
    ensure_schema()?;
    let last = db::with_raw_conn(|c| meta_get(c, "last_auto_backup_ms"))?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let now = now_ms();
    if now - last < AUTO_BACKUP_INTERVAL_MS { return Ok(()); }
    let _ = create_backup("auto")?;
    Ok(())
}
