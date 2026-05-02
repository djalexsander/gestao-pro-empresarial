// ============================================================================
// Banco local SQLite — primeira camada real de persistência do Servidor Local
// ============================================================================
//
// Escopo desta etapa (intencionalmente pequeno e seguro):
//
//   1. `terminals`         → terminais conhecidos pelo servidor (deixa de
//                            ser estado em memória).
//   2. `terminal_events`   → trilha mínima de auditoria de conexão.
//   3. `cache_kv`          → cache read-through com TTL para os 3 domínios
//                            iniciais (produtos, estoque, clientes).
//   4. `meta`              → metadados (schema_version, created_at).
//
// Arquivo físico: <data_dir>/gestao-pro/local.db
//   - Linux:   ~/.local/share/gestao-pro/local.db
//   - macOS:   ~/Library/Application Support/gestao-pro/local.db
//   - Windows: %APPDATA%\gestao-pro\local.db
//
// Concorrência: usamos `Mutex<Connection>` simples. SQLite é serializado
// neste cenário (poucos terminais, baixa contenção). Se virar gargalo,
// trocamos por pool depois sem mudar a interface pública.

use once_cell::sync::OnceCell;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

const SCHEMA_VERSION: i64 = 3;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

#[derive(Debug)]
pub struct DbError(pub String);

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError(e.to_string())
    }
}

impl From<std::io::Error> for DbError {
    fn from(e: std::io::Error) -> Self {
        DbError(e.to_string())
    }
}

pub type DbResult<T> = Result<T, DbError>;

fn db_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("gestao-pro")
}

pub fn db_file() -> PathBuf {
    db_path().join("local.db")
}

pub fn init() -> DbResult<()> {
    let dir = db_path();
    std::fs::create_dir_all(&dir)?;
    let path = db_file();
    let conn = Connection::open(&path)?;

    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS terminals (
            terminal_id   TEXT PRIMARY KEY,
            machine_id    TEXT,
            server_id     TEXT,
            terminal_nome TEXT,
            role          TEXT,
            app_version   TEXT,
            host          TEXT,
            first_seen_ms INTEGER NOT NULL,
            last_seen_ms  INTEGER NOT NULL,
            status        TEXT NOT NULL DEFAULT 'online',
            heartbeats    INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_terminals_last_seen
            ON terminals(last_seen_ms DESC);

        CREATE TABLE IF NOT EXISTS terminal_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_id   TEXT NOT NULL,
            event_type    TEXT NOT NULL,
            ts_ms         INTEGER NOT NULL,
            server_match  INTEGER,
            expected_server_id TEXT,
            details       TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_terminal_ts
            ON terminal_events(terminal_id, ts_ms DESC);

        CREATE TABLE IF NOT EXISTS cache_kv (
            domain      TEXT NOT NULL,
            cache_key   TEXT NOT NULL,
            payload     TEXT NOT NULL,
            stored_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            PRIMARY KEY (domain, cache_key)
        );

        CREATE INDEX IF NOT EXISTS idx_cache_expires
            ON cache_kv(expires_at_ms);

        -- ====================================================================
        -- v2: Tabelas locais NORMALIZADAS para os primeiros domínios provados.
        -- Substituem o cache JSON cru. Mantemos `cache_kv` em paralelo para
        -- domínios ainda não migrados e como rede de segurança.
        --
        -- Convenções:
        --   * `id` é sempre o UUID/identificador da nuvem (fonte da verdade).
        --   * `payload` mantém o JSON original do upstream — útil enquanto o
        --     adapter ainda lê o objeto inteiro; nas próximas etapas podemos
        --     descartar quando todas as projeções estiverem mapeadas.
        --   * `updated_at_remote_ms` espelha o `updated_at` da nuvem (quando
        --     disponível) — base para sync incremental futuro.
        --   * `synced_at_ms` é quando este servidor local viu o registro.
        --   * `deleted_at_ms` reservado para tombstones futuros.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS produtos_local (
            id                   TEXT PRIMARY KEY,
            sku                  TEXT,
            nome                 TEXT,
            status               TEXT,
            categoria_id         TEXT,
            categoria_nome       TEXT,
            preco_venda          REAL,
            estoque_atual        REAL,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_status ON produtos_local(status);
        CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos_local(categoria_id);
        CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos_local(nome);
        CREATE INDEX IF NOT EXISTS idx_produtos_sku ON produtos_local(sku);

        CREATE TABLE IF NOT EXISTS clientes_local (
            id                   TEXT PRIMARY KEY,
            nome                 TEXT,
            nome_fantasia        TEXT,
            documento            TEXT,
            status               TEXT,
            payload              TEXT NOT NULL,
            updated_at_remote_ms INTEGER,
            synced_at_ms         INTEGER NOT NULL,
            deleted_at_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_clientes_status ON clientes_local(status);
        CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes_local(nome);
        CREATE INDEX IF NOT EXISTS idx_clientes_doc ON clientes_local(documento);

        -- Saldos: agregados por (produto_id, variacao_id). A chave única
        -- evita duplicatas quando o snapshot é re-ingerido.
        CREATE TABLE IF NOT EXISTS estoque_saldos_local (
            produto_id     TEXT NOT NULL,
            variacao_id    TEXT NOT NULL DEFAULT '',
            tipo           TEXT,
            quantidade     REAL NOT NULL DEFAULT 0,
            payload        TEXT NOT NULL,
            synced_at_ms   INTEGER NOT NULL,
            PRIMARY KEY (produto_id, variacao_id)
        );
        CREATE INDEX IF NOT EXISTS idx_saldos_produto ON estoque_saldos_local(produto_id);

        -- Metadados de sync por domínio (último refresh, contagem ingerida,
        -- origem). Base para o sync incremental futuro.
        CREATE TABLE IF NOT EXISTS domain_sync_meta (
            domain          TEXT PRIMARY KEY,
            last_synced_ms  INTEGER NOT NULL,
            row_count       INTEGER NOT NULL DEFAULT 0,
            last_source     TEXT,
            last_error      TEXT
        );
        "#,
    )?;

    // ------------------------------------------------------------------
    // v3 — Sync incremental: estende `domain_sync_meta` com cursor/estado.
    // Usa ADD COLUMN idempotente (ignora "duplicate column" do SQLite).
    // ------------------------------------------------------------------
    let alters = [
        "ALTER TABLE domain_sync_meta ADD COLUMN last_remote_cursor_ms INTEGER",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_strategy TEXT",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_delta_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_attempt_ms INTEGER",
        "ALTER TABLE domain_sync_meta ADD COLUMN last_synced_ok INTEGER NOT NULL DEFAULT 1",
    ];
    for sql in alters {
        // Erro só ocorre quando a coluna já existe — seguro ignorar.
        let _ = conn.execute(sql, []);
    }

    // schema_version
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SCHEMA_VERSION.to_string()],
    )?;
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('created_at_ms', ?1)
         ON CONFLICT(key) DO NOTHING",
        params![chrono::Utc::now().timestamp_millis().to_string()],
    )?;

    DB.set(Mutex::new(conn))
        .map_err(|_| DbError("DB já inicializado".into()))?;
    Ok(())
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
    let cell = DB
        .get()
        .ok_or_else(|| DbError("DB não inicializado".into()))?;
    let guard = cell
        .lock()
        .map_err(|e| DbError(format!("DB lock poisoned: {e}")))?;
    f(&guard)
}

// ---------- Terminals ----------

#[derive(Debug, Serialize, Clone)]
pub struct PersistedTerminal {
    pub terminal_id: String,
    pub machine_id: Option<String>,
    pub server_id: Option<String>,
    pub terminal_nome: Option<String>,
    pub role: Option<String>,
    pub app_version: Option<String>,
    pub host: Option<String>,
    pub first_seen_ms: i64,
    pub last_seen_ms: i64,
    pub status: String,
    pub heartbeats: i64,
}

pub struct UpsertHeartbeat<'a> {
    pub terminal_id: &'a str,
    pub machine_id: Option<&'a str>,
    pub server_id: Option<&'a str>,
    pub terminal_nome: Option<&'a str>,
    pub role: Option<&'a str>,
    pub app_version: Option<&'a str>,
    pub host: Option<&'a str>,
    pub now_ms: i64,
}

pub fn upsert_terminal(hb: UpsertHeartbeat<'_>) -> DbResult<PersistedTerminal> {
    with_conn(|conn| {
        conn.execute(
            r#"
            INSERT INTO terminals (
                terminal_id, machine_id, server_id, terminal_nome,
                role, app_version, host,
                first_seen_ms, last_seen_ms, status, heartbeats
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 'online', 1)
            ON CONFLICT(terminal_id) DO UPDATE SET
                machine_id    = COALESCE(excluded.machine_id, terminals.machine_id),
                server_id     = COALESCE(excluded.server_id,  terminals.server_id),
                terminal_nome = COALESCE(excluded.terminal_nome, terminals.terminal_nome),
                role          = COALESCE(excluded.role,       terminals.role),
                app_version   = COALESCE(excluded.app_version, terminals.app_version),
                host          = COALESCE(excluded.host,       terminals.host),
                last_seen_ms  = excluded.last_seen_ms,
                status        = 'online',
                heartbeats    = terminals.heartbeats + 1
            "#,
            params![
                hb.terminal_id,
                hb.machine_id,
                hb.server_id,
                hb.terminal_nome,
                hb.role,
                hb.app_version,
                hb.host,
                hb.now_ms,
            ],
        )?;
        get_terminal(conn, hb.terminal_id)?.ok_or_else(|| DbError("upsert sem retorno".into()))
    })
}

fn get_terminal(conn: &Connection, terminal_id: &str) -> DbResult<Option<PersistedTerminal>> {
    let mut stmt = conn.prepare(
        "SELECT terminal_id, machine_id, server_id, terminal_nome, role, app_version,
                host, first_seen_ms, last_seen_ms, status, heartbeats
         FROM terminals WHERE terminal_id = ?1",
    )?;
    let row = stmt
        .query_row(params![terminal_id], map_terminal_row)
        .optional()?;
    Ok(row)
}

fn map_terminal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistedTerminal> {
    Ok(PersistedTerminal {
        terminal_id: row.get(0)?,
        machine_id: row.get(1)?,
        server_id: row.get(2)?,
        terminal_nome: row.get(3)?,
        role: row.get(4)?,
        app_version: row.get(5)?,
        host: row.get(6)?,
        first_seen_ms: row.get(7)?,
        last_seen_ms: row.get(8)?,
        status: row.get(9)?,
        heartbeats: row.get(10)?,
    })
}

pub fn list_terminals(limit: i64) -> DbResult<Vec<PersistedTerminal>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT terminal_id, machine_id, server_id, terminal_nome, role, app_version,
                    host, first_seen_ms, last_seen_ms, status, heartbeats
             FROM terminals
             ORDER BY last_seen_ms DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], map_terminal_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn count_terminals() -> DbResult<(i64, i64)> {
    // Retorna (total, online_nos_ultimos_2min)
    with_conn(|conn| {
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))?;
        let cutoff = chrono::Utc::now().timestamp_millis() - 120_000;
        let online: i64 = conn.query_row(
            "SELECT COUNT(*) FROM terminals WHERE last_seen_ms >= ?1",
            params![cutoff],
            |r| r.get(0),
        )?;
        Ok((total, online))
    })
}

// ---------- Auditoria ----------

pub struct LogEvent<'a> {
    pub terminal_id: &'a str,
    pub event_type: &'a str,
    pub ts_ms: i64,
    pub server_match: Option<bool>,
    pub expected_server_id: Option<&'a str>,
    pub details: Option<&'a str>,
}

pub fn log_event(ev: LogEvent<'_>) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO terminal_events
                (terminal_id, event_type, ts_ms, server_match, expected_server_id, details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ev.terminal_id,
                ev.event_type,
                ev.ts_ms,
                ev.server_match.map(|b| if b { 1 } else { 0 }),
                ev.expected_server_id,
                ev.details,
            ],
        )?;
        Ok(())
    })
}

#[derive(Debug, Serialize)]
pub struct PersistedEvent {
    pub id: i64,
    pub terminal_id: String,
    pub event_type: String,
    pub ts_ms: i64,
    pub server_match: Option<bool>,
    pub expected_server_id: Option<String>,
    pub details: Option<String>,
}

pub fn list_events(limit: i64) -> DbResult<Vec<PersistedEvent>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, terminal_id, event_type, ts_ms, server_match,
                    expected_server_id, details
             FROM terminal_events
             ORDER BY ts_ms DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            let sm: Option<i64> = r.get(4)?;
            Ok(PersistedEvent {
                id: r.get(0)?,
                terminal_id: r.get(1)?,
                event_type: r.get(2)?,
                ts_ms: r.get(3)?,
                server_match: sm.map(|v| v != 0),
                expected_server_id: r.get(5)?,
                details: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

// ---------- Cache KV (read-through) ----------

pub fn cache_get(domain: &str, key: &str, now_ms: i64) -> DbResult<Option<String>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM cache_kv
             WHERE domain = ?1 AND cache_key = ?2 AND expires_at_ms > ?3",
        )?;
        let row = stmt
            .query_row(params![domain, key, now_ms], |r| r.get::<_, String>(0))
            .optional()?;
        Ok(row)
    })
}

pub fn cache_put(
    domain: &str,
    key: &str,
    payload: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO cache_kv(domain, cache_key, payload, stored_at_ms, expires_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(domain, cache_key) DO UPDATE SET
                payload = excluded.payload,
                stored_at_ms = excluded.stored_at_ms,
                expires_at_ms = excluded.expires_at_ms",
            params![domain, key, payload, now_ms, now_ms + ttl_ms],
        )?;
        Ok(())
    })
}

#[derive(Debug, Serialize)]
pub struct DbInfo {
    pub path: String,
    pub schema_version: i64,
    pub terminals_total: i64,
    pub terminals_online: i64,
    pub events_total: i64,
    pub cache_entries: i64,
    pub created_at_ms: Option<i64>,
}

pub fn db_info() -> DbResult<DbInfo> {
    let (total, online) = count_terminals()?;
    with_conn(|conn| {
        let events_total: i64 =
            conn.query_row("SELECT COUNT(*) FROM terminal_events", [], |r| r.get(0))?;
        let cache_entries: i64 =
            conn.query_row("SELECT COUNT(*) FROM cache_kv", [], |r| r.get(0))?;
        let created_at_ms: Option<i64> = conn
            .query_row(
                "SELECT value FROM meta WHERE key='created_at_ms'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .and_then(|s| s.parse().ok());
        Ok(DbInfo {
            path: db_file().to_string_lossy().to_string(),
            schema_version: SCHEMA_VERSION,
            terminals_total: total,
            terminals_online: online,
            events_total,
            cache_entries,
            created_at_ms,
        })
    })
}

// ============================================================================
// v2 — Tabelas tipadas para os primeiros domínios provados
// ============================================================================
//
// Estratégia: o servidor local continua buscando o JSON cru no upstream
// (Supabase REST) e, em paralelo ao cache_kv, INGERE em tabelas tipadas com
// índices. Próximas etapas farão writes locais e sync incremental real.
//
// `payload` mantém o JSON completo do registro para que o adapter possa
// devolver o objeto inteiro sem mapear todas as colunas ainda.

fn parse_iso_to_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn json_str<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn json_f64(v: &serde_json::Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

#[derive(Debug, Serialize)]
pub struct DomainStat {
    pub domain: String,
    pub row_count: i64,
    pub last_synced_ms: Option<i64>,
    pub last_source: Option<String>,
}

fn upsert_domain_meta(
    conn: &Connection,
    domain: &str,
    row_count: i64,
    now_ms: i64,
    source: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO domain_sync_meta(domain, last_synced_ms, row_count, last_source, last_error)
         VALUES (?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(domain) DO UPDATE SET
            last_synced_ms = excluded.last_synced_ms,
            row_count      = excluded.row_count,
            last_source    = excluded.last_source,
            last_error     = NULL",
        params![domain, now_ms, row_count, source],
    )?;
    Ok(())
}

// ---------- Produtos ----------

/// Ingere um snapshot do upstream (`[{...produto...}]`) na tabela tipada.
/// Faz upsert por id; não apaga produtos ausentes (tombstones virão com
/// sync incremental). Retorna a quantidade de registros aplicados.
pub fn ingest_produtos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_produtos: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok(0),
    };

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO produtos_local(
                    id, sku, nome, status, categoria_id, categoria_nome,
                    preco_venda, estoque_atual, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL)
                 ON CONFLICT(id) DO UPDATE SET
                    sku                  = excluded.sku,
                    nome                 = excluded.nome,
                    status               = excluded.status,
                    categoria_id         = excluded.categoria_id,
                    categoria_nome       = excluded.categoria_nome,
                    preco_venda          = excluded.preco_venda,
                    estoque_atual        = excluded.estoque_atual,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, produtos_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = NULL",
            )?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let categoria_nome = item
                    .get("categoria")
                    .and_then(|c| c.get("nome"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string());
                let updated_ms = json_str(item, "updated_at").and_then(parse_iso_to_ms);
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "sku"),
                    json_str(item, "nome"),
                    json_str(item, "status"),
                    json_str(item, "categoria_id"),
                    categoria_nome,
                    json_f64(item, "preco_venda"),
                    json_f64(item, "estoque_atual"),
                    payload,
                    updated_ms,
                    now_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM produtos_local WHERE deleted_at_ms IS NULL", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, "produtos", total, now_ms, "upstream")?;
        tx.commit()?;
        Ok(count)
    })
}

pub struct ProdutosFilter<'a> {
    pub status: Option<&'a str>,
    pub categoria_id: Option<&'a str>,
    pub busca: Option<&'a str>,
}

/// Lê produtos da tabela local. Retorna o JSON-array (string) compatível
/// com o que o upstream entregaria — assim o adapter atual nem percebe
/// que veio de tabela tipada.
pub fn read_produtos(filter: ProdutosFilter<'_>) -> DbResult<String> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT payload FROM produtos_local WHERE deleted_at_ms IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = filter.status {
            sql.push_str(" AND status = ?");
            args.push(Box::new(s.to_string()));
        }
        if let Some(c) = filter.categoria_id {
            sql.push_str(" AND categoria_id = ?");
            args.push(Box::new(c.to_string()));
        }
        if let Some(b) = filter.busca {
            let pat = format!("%{}%", b.to_lowercase());
            sql.push_str(" AND (LOWER(nome) LIKE ? OR LOWER(IFNULL(sku,'')) LIKE ?)");
            args.push(Box::new(pat.clone()));
            args.push(Box::new(pat));
        }
        sql.push_str(" ORDER BY nome ASC");

        let params_dyn: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| &**b).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |r| r.get::<_, String>(0))?;
        let mut out = String::from("[");
        let mut first = true;
        for r in rows {
            let payload = r?;
            if !first {
                out.push(',');
            }
            out.push_str(&payload);
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

// ---------- Clientes lite ----------

pub fn ingest_clientes_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_clientes: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok(0),
    };
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO clientes_local(
                    id, nome, nome_fantasia, documento, status, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)
                 ON CONFLICT(id) DO UPDATE SET
                    nome                 = excluded.nome,
                    nome_fantasia        = excluded.nome_fantasia,
                    documento            = excluded.documento,
                    status               = excluded.status,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, clientes_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = NULL",
            )?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let updated_ms = json_str(item, "updated_at").and_then(parse_iso_to_ms);
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "nome"),
                    json_str(item, "nome_fantasia"),
                    json_str(item, "documento"),
                    json_str(item, "status"),
                    payload,
                    updated_ms,
                    now_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM clientes_local WHERE deleted_at_ms IS NULL", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, "clientes_lite", total, now_ms, "upstream")?;
        tx.commit()?;
        Ok(count)
    })
}

pub fn read_clientes(status: Option<&str>) -> DbResult<String> {
    with_conn(|conn| {
        let mut sql = String::from(
            "SELECT payload FROM clientes_local WHERE deleted_at_ms IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            args.push(Box::new(s.to_string()));
        }
        sql.push_str(" ORDER BY nome ASC");
        let params_dyn: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| &**b).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_dyn.as_slice(), |r| r.get::<_, String>(0))?;
        let mut out = String::from("[");
        let mut first = true;
        for r in rows {
            let payload = r?;
            if !first {
                out.push(',');
            }
            out.push_str(&payload);
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

// ---------- Estoque saldos ----------

pub fn ingest_saldos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_saldos: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok(0),
    };
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        // Snapshot completo: limpa antes para refletir o estado upstream.
        tx.execute("DELETE FROM estoque_saldos_local", [])?;
        let mut count = 0usize;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO estoque_saldos_local(
                    produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(produto_id, variacao_id) DO UPDATE SET
                    tipo         = excluded.tipo,
                    quantidade   = excluded.quantidade,
                    payload      = excluded.payload,
                    synced_at_ms = excluded.synced_at_ms",
            )?;
            for item in items {
                let produto_id = match json_str(item, "produto_id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let variacao_id = json_str(item, "variacao_id").unwrap_or("").to_string();
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    produto_id,
                    variacao_id,
                    json_str(item, "tipo"),
                    json_f64(item, "quantidade").unwrap_or(0.0),
                    payload,
                    now_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM estoque_saldos_local", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, "estoque_saldos", total, now_ms, "upstream")?;
        tx.commit()?;
        Ok(count)
    })
}

pub fn read_saldos() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload FROM estoque_saldos_local ORDER BY produto_id ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = String::from("[");
        let mut first = true;
        for r in rows {
            let payload = r?;
            if !first {
                out.push(',');
            }
            out.push_str(&payload);
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

// ---------- Stats por domínio ----------

pub fn list_domain_stats() -> DbResult<Vec<DomainStat>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT domain, row_count, last_synced_ms, last_source
             FROM domain_sync_meta
             ORDER BY domain ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(DomainStat {
                domain: r.get(0)?,
                row_count: r.get(1)?,
                last_synced_ms: r.get::<_, Option<i64>>(2)?,
                last_source: r.get::<_, Option<String>>(3)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// True quando temos pelo menos uma linha tipada para o domínio (utilizado
/// para servir `local-table` mesmo após o cache_kv expirar).
pub fn domain_has_rows(domain: &str) -> DbResult<bool> {
    with_conn(|conn| {
        let table = match domain {
            "produtos" => "produtos_local",
            "clientes_lite" => "clientes_local",
            "estoque_saldos" => "estoque_saldos_local",
            _ => return Ok(false),
        };
        let sql = format!("SELECT COUNT(*) FROM {table}");
        let n: i64 = conn.query_row(&sql, [], |r| r.get(0))?;
        Ok(n > 0)
    })
}
