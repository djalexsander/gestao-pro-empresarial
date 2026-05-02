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

const SCHEMA_VERSION: i64 = 5;

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

        -- ====================================================================
        -- v4: Estoque normalizado real
        --
        -- `estoque_movimentacoes_local` é APPEND-ONLY: o cursor avança por
        -- `data_movimentacao` (timestamp da movimentação na nuvem). Saldo
        -- local passa a ser DERIVADO incrementalmente a partir do delta —
        -- nunca mais um snapshot bruto de quantidades.
        --
        -- `estoque_saldos_local` é mantida (mesmo PK) mas agora é uma
        -- tabela MATERIALIZADA: cada ingestão de movimentações soma/subtrai
        -- a quantidade na linha (produto_id, variacao_id) correspondente.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS estoque_movimentacoes_local (
            id                   TEXT PRIMARY KEY,
            produto_id           TEXT NOT NULL,
            variacao_id          TEXT,
            tipo                 TEXT NOT NULL,
            quantidade           REAL NOT NULL,
            saldo_anterior       REAL,
            saldo_posterior      REAL,
            custo_unitario       REAL,
            origem               TEXT,
            observacoes          TEXT,
            data_movimentacao_ms INTEGER NOT NULL,
            payload              TEXT NOT NULL,
            synced_at_ms         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_movs_produto
            ON estoque_movimentacoes_local(produto_id);
        CREATE INDEX IF NOT EXISTS idx_movs_data
            ON estoque_movimentacoes_local(data_movimentacao_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_movs_produto_data
            ON estoque_movimentacoes_local(produto_id, data_movimentacao_ms DESC);

        -- ====================================================================
        -- v5: WRITES LOCAIS de movimentação de estoque + fila offline.
        --
        -- `outbox_estoque_movs` é a FILA OFFLINE idempotente:
        --   * `local_uuid`     → identidade local estável (idempotency key real
        --                        usada no upstream); gerado pelo servidor.
        --   * `client_uuid`    → idempotency key vinda do terminal (modal /
        --                        botão); usada para deduplicar reenvios do
        --                        próprio terminal antes de enfileirar.
        --   * `status`         → 'pending' | 'sending' | 'sent' | 'error'
        --   * `attempts`       → contador de tentativas
        --   * `payload`        → JSON do RegistrarMovimentoEstoqueInput
        --   * `last_error`     → mensagem da última falha
        --   * `remote_id`      → id do movimento na nuvem após push OK
        --
        -- O write local funciona em DOIS PASSOS atômicos:
        --   1. INSERT em `estoque_movimentacoes_local` com id = local_uuid
        --      (já materializa saldo via apply_mov_to_saldo).
        --   2. INSERT em `outbox_estoque_movs` com status='pending'.
        -- Tudo na MESMA transação → ou aparece nos dois lados ou em nenhum.
        -- ====================================================================

        CREATE TABLE IF NOT EXISTS outbox_estoque_movs (
            local_uuid    TEXT PRIMARY KEY,
            client_uuid   TEXT,
            payload       TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending',
            attempts      INTEGER NOT NULL DEFAULT 0,
            last_error    TEXT,
            remote_id     TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            sent_at_ms    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status
            ON outbox_estoque_movs(status, created_at_ms);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_client_uuid
            ON outbox_estoque_movs(client_uuid)
            WHERE client_uuid IS NOT NULL;
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
    pub last_strategy: Option<String>,
    pub last_delta_count: i64,
    pub last_remote_cursor_ms: Option<i64>,
    pub last_attempt_ms: Option<i64>,
    pub last_synced_ok: bool,
    pub last_error: Option<String>,
}

/// Estado de sync por domínio (lido pela camada de proxy).
#[derive(Debug, Clone)]
pub struct DomainSyncState {
    pub last_remote_cursor_ms: Option<i64>,
    pub last_strategy: Option<String>,
}

pub fn get_domain_sync_state(domain: &str) -> DbResult<DomainSyncState> {
    with_conn(|conn| {
        let row = conn
            .query_row(
                "SELECT last_remote_cursor_ms, last_strategy
                 FROM domain_sync_meta WHERE domain = ?1",
                params![domain],
                |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        Ok(match row {
            Some((c, s)) => DomainSyncState { last_remote_cursor_ms: c, last_strategy: s },
            None => DomainSyncState { last_remote_cursor_ms: None, last_strategy: None },
        })
    })
}

pub fn record_sync_error(domain: &str, now_ms: i64, err: &str) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO domain_sync_meta(domain, last_synced_ms, row_count, last_source,
                last_error, last_strategy, last_delta_count, last_attempt_ms, last_synced_ok)
             VALUES (?1, 0, 0, NULL, ?2, NULL, 0, ?3, 0)
             ON CONFLICT(domain) DO UPDATE SET
                last_error      = excluded.last_error,
                last_attempt_ms = excluded.last_attempt_ms,
                last_synced_ok  = 0",
            params![domain, err, now_ms],
        )?;
        Ok(())
    })
}

/// Argumentos consolidados para gravar metadata após uma ingestão bem-sucedida.
pub struct DomainMetaUpdate<'a> {
    pub domain: &'a str,
    pub row_count: i64,
    pub now_ms: i64,
    pub source: &'a str,        // "upstream" | "manual"
    pub strategy: &'a str,      // "snapshot" | "incremental" | "append"
    pub delta_count: i64,
    pub max_remote_updated_ms: Option<i64>,
}

fn upsert_domain_meta(
    conn: &Connection,
    upd: DomainMetaUpdate<'_>,
) -> rusqlite::Result<()> {
    // Avança o cursor monotonicamente — nunca retrocede.
    conn.execute(
        "INSERT INTO domain_sync_meta(domain, last_synced_ms, row_count, last_source,
            last_error, last_strategy, last_delta_count, last_attempt_ms, last_synced_ok,
            last_remote_cursor_ms)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?2, 1, ?7)
         ON CONFLICT(domain) DO UPDATE SET
            last_synced_ms        = excluded.last_synced_ms,
            row_count             = excluded.row_count,
            last_source           = excluded.last_source,
            last_error            = NULL,
            last_strategy         = excluded.last_strategy,
            last_delta_count      = excluded.last_delta_count,
            last_attempt_ms       = excluded.last_attempt_ms,
            last_synced_ok        = 1,
            last_remote_cursor_ms = MAX(
                COALESCE(domain_sync_meta.last_remote_cursor_ms, 0),
                COALESCE(excluded.last_remote_cursor_ms, 0)
            )",
        params![
            upd.domain,
            upd.now_ms,
            upd.row_count,
            upd.source,
            upd.strategy,
            upd.delta_count,
            upd.max_remote_updated_ms,
        ],
    )?;
    Ok(())
}

// ---------- Produtos ----------

/// Estratégia da ingestão (afeta como o servidor trata "ausentes").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestStrategy {
    /// Snapshot completo do upstream — base inicial; não sabemos se algo foi
    /// removido fora deste lote, então NÃO marcamos tombstones por ausência.
    Snapshot,
    /// Lote incremental por `updated_at` — só vieram registros alterados.
    /// Tombstone "soft" é aplicado para qualquer linha cujo `status` no
    /// upstream tenha mudado para algo diferente de "ativo".
    Incremental,
    /// Append-only por `data_movimentacao` (ou cursor equivalente). Usado
    /// para domínios imutáveis como `estoque_movimentacoes`: registros
    /// nunca são apagados, só inseridos. Não há tombstone — o cursor
    /// avança e cada nova linha simplesmente é INSERT OR IGNORE.
    Append,
}

impl IngestStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            IngestStrategy::Snapshot => "snapshot",
            IngestStrategy::Incremental => "incremental",
            IngestStrategy::Append => "append",
        }
    }
}

/// Considera o status remoto como soft-delete (tombstone local).
/// Cloud usa `status` para arquivar/inativar — esta etapa cobre o caso
/// realista. Hard-delete real exigirá endpoint de tombstones (próxima etapa).
fn is_tombstoned_status(status: Option<&str>) -> bool {
    match status {
        None => false,
        Some(s) => {
            let s = s.to_ascii_lowercase();
            s == "inativo" || s == "arquivado" || s == "deleted" || s == "removido"
        }
    }
}

/// Ingere uma resposta do upstream (snapshot OU delta) na tabela tipada.
/// Retorna `(linhas_aplicadas, max_updated_at_ms_no_lote)`.
pub fn ingest_produtos(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_produtos: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        let mut max_remote_ms: Option<i64> = None;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO produtos_local(
                    id, sku, nome, status, categoria_id, categoria_nome,
                    preco_venda, estoque_atual, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
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
                    deleted_at_ms        = excluded.deleted_at_ms",
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
                if let Some(ms) = updated_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let status = json_str(item, "status");
                // Tombstone aplicado APENAS em modo incremental — em snapshot
                // não temos como diferenciar "não retornou" de "removido", e
                // status pode aparecer como "inativo" sem ser deleção.
                let deleted_at_ms = if strategy == IngestStrategy::Incremental
                    && is_tombstoned_status(status)
                {
                    Some(now_ms)
                } else {
                    None::<i64>
                };
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "sku"),
                    json_str(item, "nome"),
                    status,
                    json_str(item, "categoria_id"),
                    categoria_nome,
                    json_f64(item, "preco_venda"),
                    json_f64(item, "estoque_atual"),
                    payload,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM produtos_local WHERE deleted_at_ms IS NULL", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "produtos",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

/// Compat: chamada antiga (snapshot).
pub fn ingest_produtos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_produtos(json_text, now_ms, IngestStrategy::Snapshot).map(|(n, _)| n)
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

pub fn ingest_clientes(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_clientes: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };
    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        let mut max_remote_ms: Option<i64> = None;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO clientes_local(
                    id, nome, nome_fantasia, documento, status, payload,
                    updated_at_remote_ms, synced_at_ms, deleted_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(id) DO UPDATE SET
                    nome                 = excluded.nome,
                    nome_fantasia        = excluded.nome_fantasia,
                    documento            = excluded.documento,
                    status               = excluded.status,
                    payload              = excluded.payload,
                    updated_at_remote_ms = COALESCE(excluded.updated_at_remote_ms, clientes_local.updated_at_remote_ms),
                    synced_at_ms         = excluded.synced_at_ms,
                    deleted_at_ms        = excluded.deleted_at_ms",
            )?;
            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let updated_ms = json_str(item, "updated_at").and_then(parse_iso_to_ms);
                if let Some(ms) = updated_ms {
                    max_remote_ms = Some(max_remote_ms.map_or(ms, |c| c.max(ms)));
                }
                let status = json_str(item, "status");
                let deleted_at_ms = if strategy == IngestStrategy::Incremental
                    && is_tombstoned_status(status)
                {
                    Some(now_ms)
                } else {
                    None::<i64>
                };
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());
                stmt.execute(params![
                    id,
                    json_str(item, "nome"),
                    json_str(item, "nome_fantasia"),
                    json_str(item, "documento"),
                    status,
                    payload,
                    updated_ms,
                    now_ms,
                    deleted_at_ms,
                ])?;
                count += 1;
            }
        }
        let total: i64 =
            tx.query_row("SELECT COUNT(*) FROM clientes_local WHERE deleted_at_ms IS NULL", [], |r| r.get(0))?;
        upsert_domain_meta(&tx, DomainMetaUpdate {
            domain: "clientes_lite",
            row_count: total,
            now_ms,
            source: "upstream",
            strategy: strategy.as_str(),
            delta_count: count as i64,
            max_remote_updated_ms: max_remote_ms,
        })?;
        tx.commit()?;
        Ok((count, max_remote_ms))
    })
}

pub fn ingest_clientes_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_clientes(json_text, now_ms, IngestStrategy::Snapshot).map(|(n, _)| n)
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

// ---------- Estoque: movimentações + saldos derivados ----------
//
// Modelo desta etapa:
//
//   * `estoque_movimentacoes_local` é APPEND-ONLY. Cursor de sync é
//     `data_movimentacao` (timestamp definitivo na nuvem; mais estável
//     que `updated_at`, que poderia mudar com edição de observação).
//     Lote = INSERT OR IGNORE pelo `id` → retries idempotentes.
//
//   * `estoque_saldos_local` deixa de ser snapshot bruto e passa a ser
//     uma MATERIALIZAÇÃO incremental: para cada movimentação NOVA do
//     lote, ajustamos a quantidade da linha (produto_id, variacao_id)
//     com o sinal:
//          entrada / devolucao    → +qtd
//          saida   / transferencia → -qtd
//          ajuste                 → +qtd  (ajuste pode vir negativo na nuvem)
//
//   * Snapshot inicial (sem cursor): zera os saldos antes do delta —
//     reconstrução do zero a partir do histórico que está vindo agora.

fn parse_data_mov_ms(item: &serde_json::Value) -> Option<i64> {
    json_str(item, "data_movimentacao")
        .and_then(parse_iso_to_ms)
        .or_else(|| json_str(item, "created_at").and_then(parse_iso_to_ms))
}

fn signal_for_tipo(tipo: Option<&str>) -> f64 {
    match tipo.unwrap_or("") {
        "entrada" | "devolucao" => 1.0,
        "saida" | "transferencia" => -1.0,
        _ => 1.0,
    }
}

fn apply_mov_to_saldo(
    tx: &rusqlite::Transaction<'_>,
    produto_id: &str,
    variacao_id: &str,
    tipo: Option<&str>,
    quantidade: f64,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let delta = signal_for_tipo(tipo) * quantidade;
    tx.execute(
        "INSERT INTO estoque_saldos_local(
            produto_id, variacao_id, tipo, quantidade, payload, synced_at_ms
         ) VALUES (?1, ?2, NULL, 0, '{}', ?3)
         ON CONFLICT(produto_id, variacao_id) DO NOTHING",
        params![produto_id, variacao_id, now_ms],
    )?;
    tx.execute(
        "UPDATE estoque_saldos_local
            SET quantidade   = quantidade + ?3,
                synced_at_ms = ?4
          WHERE produto_id = ?1 AND variacao_id = ?2",
        params![produto_id, variacao_id, delta, now_ms],
    )?;
    Ok(())
}

pub fn ingest_movimentacoes(
    json_text: &str,
    now_ms: i64,
    strategy: IngestStrategy,
) -> DbResult<(usize, Option<i64>)> {
    let arr: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| DbError(format!("ingest_movimentacoes: json inválido: {e}")))?;
    let items = match arr.as_array() {
        Some(a) => a,
        None => return Ok((0, None)),
    };

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        if strategy == IngestStrategy::Snapshot {
            tx.execute("DELETE FROM estoque_saldos_local", [])?;
        }

        let mut inserted = 0usize;
        let mut max_ms: Option<i64> = None;

        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                    id, produto_id, variacao_id, tipo, quantidade,
                    saldo_anterior, saldo_posterior, custo_unitario,
                    origem, observacoes, data_movimentacao_ms,
                    payload, synced_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            )?;

            for item in items {
                let id = match json_str(item, "id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let produto_id = match json_str(item, "produto_id") {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let variacao_id = json_str(item, "variacao_id").unwrap_or("").to_string();
                let tipo = json_str(item, "tipo").unwrap_or("").to_string();
                let quantidade = json_f64(item, "quantidade").unwrap_or(0.0);
                let data_ms = match parse_data_mov_ms(item) {
                    Some(ms) => ms,
                    None => continue,
                };
                max_ms = Some(max_ms.map_or(data_ms, |c| c.max(data_ms)));
                let payload = serde_json::to_string(item).unwrap_or_else(|_| "{}".into());

                let n = stmt.execute(params![
                    id,
                    produto_id,
                    variacao_id,
                    tipo,
                    quantidade,
                    json_f64(item, "saldo_anterior"),
                    json_f64(item, "saldo_posterior"),
                    json_f64(item, "custo_unitario"),
                    json_str(item, "origem"),
                    json_str(item, "observacoes"),
                    data_ms,
                    payload,
                    now_ms,
                ])?;

                if n > 0 {
                    apply_mov_to_saldo(
                        &tx,
                        &produto_id,
                        &variacao_id,
                        Some(tipo.as_str()),
                        quantidade,
                        now_ms,
                    )?;
                    inserted += 1;
                }
            }
        }

        let total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM estoque_movimentacoes_local",
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(
            &tx,
            DomainMetaUpdate {
                domain: "estoque_movimentacoes",
                row_count: total,
                now_ms,
                source: "upstream",
                strategy: strategy.as_str(),
                delta_count: inserted as i64,
                max_remote_updated_ms: max_ms,
            },
        )?;

        let saldos_total: i64 = tx.query_row(
            "SELECT COUNT(*) FROM estoque_saldos_local",
            [],
            |r| r.get(0),
        )?;
        upsert_domain_meta(
            &tx,
            DomainMetaUpdate {
                domain: "estoque_saldos",
                row_count: saldos_total,
                now_ms,
                source: "derived",
                strategy: "derived",
                delta_count: inserted as i64,
                max_remote_updated_ms: max_ms,
            },
        )?;

        tx.commit()?;
        Ok((inserted, max_ms))
    })
}

/// Compat com o caminho legacy de saldos (proxy_with_cache).
pub fn ingest_saldos_snapshot(json_text: &str, now_ms: i64) -> DbResult<usize> {
    ingest_movimentacoes(json_text, now_ms, IngestStrategy::Snapshot).map(|(n, _)| n)
}

pub fn read_saldos() -> DbResult<String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT produto_id, variacao_id, quantidade
               FROM estoque_saldos_local
              ORDER BY produto_id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
            ))
        })?;
        let mut out = String::from("[");
        let mut first = true;
        for row in rows {
            let (produto_id, variacao_id, qtd) = row?;
            if !first {
                out.push(',');
            }
            let var_field = if variacao_id.is_empty() {
                "null".to_string()
            } else {
                format!(""{variacao_id}"")
            };
            out.push_str(&format!(
                "{{"produto_id":"{produto_id}","variacao_id":{var_field},"tipo":"entrada","quantidade":{qtd}}}"
            ));
            first = false;
        }
        out.push(']');
        Ok(out)
    })
}

pub fn read_movimentacoes(produto_id: Option<&str>, limit: i64) -> DbResult<String> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 5000);
        let mut out = String::from("[");
        let mut first = true;

        if let Some(pid) = produto_id {
            let mut stmt = conn.prepare(
                "SELECT payload FROM estoque_movimentacoes_local
                  WHERE produto_id = ?1
                  ORDER BY data_movimentacao_ms DESC
                  LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pid, limit], |r| r.get::<_, String>(0))?;
            for r in rows {
                let p = r?;
                if !first { out.push(','); }
                out.push_str(&p);
                first = false;
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT payload FROM estoque_movimentacoes_local
                  ORDER BY data_movimentacao_ms DESC
                  LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], |r| r.get::<_, String>(0))?;
            for r in rows {
                let p = r?;
                if !first { out.push(','); }
                out.push_str(&p);
                first = false;
            }
        }

        out.push(']');
        Ok(out)
    })
}


// ---------- Stats por domínio ----------

pub fn list_domain_stats() -> DbResult<Vec<DomainStat>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT domain, row_count, last_synced_ms, last_source,
                    last_strategy, last_delta_count, last_remote_cursor_ms,
                    last_attempt_ms, last_synced_ok, last_error
             FROM domain_sync_meta
             ORDER BY domain ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let ok: i64 = r.get(8)?;
            Ok(DomainStat {
                domain: r.get(0)?,
                row_count: r.get(1)?,
                last_synced_ms: r.get::<_, Option<i64>>(2)?,
                last_source: r.get::<_, Option<String>>(3)?,
                last_strategy: r.get::<_, Option<String>>(4)?,
                last_delta_count: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                last_remote_cursor_ms: r.get::<_, Option<i64>>(6)?,
                last_attempt_ms: r.get::<_, Option<i64>>(7)?,
                last_synced_ok: ok != 0,
                last_error: r.get::<_, Option<String>>(9)?,
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
            "estoque_movimentacoes" => "estoque_movimentacoes_local",
            _ => return Ok(false),
        };
        let sql = format!("SELECT COUNT(*) FROM {table}");
        let n: i64 = conn.query_row(&sql, [], |r| r.get(0))?;
        Ok(n > 0)
    })
}

// ============================================================================
// v5 — Writes locais de movimentação de estoque + fila offline (outbox)
// ============================================================================
//
// Modelo:
//   * `local_uuid` é GERADO pelo servidor (UUID v4). É a identidade real
//     dessa movimentação enquanto ela vive offline e é a chave de
//     idempotência usada no upstream — assim retries pelo sync nunca
//     duplicam.
//   * `client_uuid` é a chave que o terminal já mandava (1 por modal). Se
//     vier repetida (duplo clique, retry de rede entre terminal e servidor),
//     o servidor reconhece e devolve a movimentação já enfileirada — sem
//     gravar de novo, sem duplicar saldo.

#[derive(Debug, Clone, Serialize)]
pub struct LocalMovimentacaoInput {
    pub produto_id: String,
    pub variacao_id: Option<String>,
    pub tipo: String,
    pub quantidade: f64,
    pub custo_unitario: Option<f64>,
    pub observacoes: Option<String>,
    pub origem: Option<String>,
    pub client_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalMovimentacaoResult {
    pub local_uuid: String,
    pub idempotente: bool,
    pub saldo_anterior: f64,
    pub saldo_posterior: f64,
}

fn random_uuid_v4() -> String {
    // UUID v4 simples — evita dependência extra. Usa o RNG do SQLite.
    let bytes: [u8; 16] = with_conn(|conn| {
        let blob: Vec<u8> = conn.query_row("SELECT randomblob(16)", [], |r| r.get(0))?;
        let mut a = [0u8; 16];
        for (i, b) in blob.iter().take(16).enumerate() {
            a[i] = *b;
        }
        Ok(a)
    })
    .unwrap_or([0u8; 16]);
    let mut b = bytes;
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]
    )
}

/// Lê saldo atual (produto, variacao) — 0 se não existe linha.
fn read_saldo_atual(
    tx: &rusqlite::Transaction<'_>,
    produto_id: &str,
    variacao_id: &str,
) -> rusqlite::Result<f64> {
    let v: Option<f64> = tx
        .query_row(
            "SELECT quantidade FROM estoque_saldos_local
              WHERE produto_id = ?1 AND variacao_id = ?2",
            params![produto_id, variacao_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.unwrap_or(0.0))
}

/// Escreve uma movimentação LOCALMENTE:
///   1. Idempotência por `client_uuid`: se já existe na outbox, devolve a
///      movimentação anterior (sem efeito colateral).
///   2. Calcula saldo_anterior, valida saldo negativo.
///   3. Insere em `estoque_movimentacoes_local` (com id = local_uuid),
///      aplica delta no saldo materializado, enfileira na outbox —
///      tudo em UMA transação.
pub fn registrar_movimento_local(
    input: LocalMovimentacaoInput,
    now_ms: i64,
) -> DbResult<LocalMovimentacaoResult> {
    // Validação básica antes de transação.
    if input.quantidade <= 0.0 {
        return Err(DbError("quantidade deve ser > 0".into()));
    }
    let tipo_norm = input.tipo.trim().to_ascii_lowercase();
    if !matches!(
        tipo_norm.as_str(),
        "entrada" | "saida" | "ajuste" | "devolucao" | "transferencia"
    ) {
        return Err(DbError(format!("tipo inválido: {}", input.tipo)));
    }

    // Idempotência por client_uuid — antes de abrir transação grande.
    if let Some(cu) = input.client_uuid.as_deref() {
        if !cu.is_empty() {
            if let Some(existing) = with_conn(|conn| {
                let row = conn
                    .query_row(
                        "SELECT local_uuid, payload FROM outbox_estoque_movs
                          WHERE client_uuid = ?1",
                        params![cu],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                    )
                    .optional()?;
                Ok(row)
            })? {
                let (local_uuid, _payload) = existing;
                // Lê saldo atual como saldo_posterior; saldo_anterior é
                // recomposto a partir do tipo+quantidade já gravados.
                let posterior = with_conn(|conn| {
                    let v: Option<f64> = conn
                        .query_row(
                            "SELECT quantidade FROM estoque_saldos_local
                              WHERE produto_id = ?1 AND variacao_id = ?2",
                            params![input.produto_id, input.variacao_id.clone().unwrap_or_default()],
                            |r| r.get(0),
                        )
                        .optional()?;
                    Ok(v.unwrap_or(0.0))
                })?;
                let delta = signal_for_tipo(Some(&tipo_norm)) * input.quantidade;
                return Ok(LocalMovimentacaoResult {
                    local_uuid,
                    idempotente: true,
                    saldo_anterior: posterior - delta,
                    saldo_posterior: posterior,
                });
            }
        }
    }

    let local_uuid = random_uuid_v4();
    let variacao_id = input.variacao_id.clone().unwrap_or_default();

    let payload_json = serde_json::json!({
        "local_uuid": local_uuid,
        "produto_id": input.produto_id,
        "variacao_id": input.variacao_id,
        "tipo": tipo_norm,
        "quantidade": input.quantidade,
        "custo_unitario": input.custo_unitario,
        "observacoes": input.observacoes,
        "origem": input.origem,
        "client_uuid": input.client_uuid,
    })
    .to_string();

    with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;

        let saldo_anterior = read_saldo_atual(&tx, &input.produto_id, &variacao_id)?;
        let delta = signal_for_tipo(Some(&tipo_norm)) * input.quantidade;
        let saldo_posterior = saldo_anterior + delta;

        // Bloqueia saldo negativo (paridade com a RPC do upstream).
        if saldo_posterior < 0.0 && (tipo_norm == "saida" || tipo_norm == "transferencia") {
            return Err(DbError(format!(
                "saldo insuficiente: atual={saldo_anterior}, tentativa={}",
                input.quantidade
            )));
        }

        // 1) Insere no histórico local com id = local_uuid (estável).
        let item_payload = serde_json::json!({
            "id": local_uuid,
            "produto_id": input.produto_id,
            "variacao_id": input.variacao_id,
            "tipo": tipo_norm,
            "quantidade": input.quantidade,
            "saldo_anterior": saldo_anterior,
            "saldo_posterior": saldo_posterior,
            "custo_unitario": input.custo_unitario,
            "origem": input.origem,
            "observacoes": input.observacoes,
            "data_movimentacao": iso_from_ms_z_pub(now_ms),
            "_pending": true,
        })
        .to_string();

        tx.execute(
            "INSERT OR IGNORE INTO estoque_movimentacoes_local(
                id, produto_id, variacao_id, tipo, quantidade,
                saldo_anterior, saldo_posterior, custo_unitario,
                origem, observacoes, data_movimentacao_ms,
                payload, synced_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                local_uuid,
                input.produto_id,
                variacao_id,
                tipo_norm,
                input.quantidade,
                saldo_anterior,
                saldo_posterior,
                input.custo_unitario,
                input.origem,
                input.observacoes,
                now_ms,
                item_payload,
                now_ms,
            ],
        )?;

        // 2) Materializa saldo (mesmo padrão do ingest do upstream).
        apply_mov_to_saldo(
            &tx,
            &input.produto_id,
            &variacao_id,
            Some(tipo_norm.as_str()),
            input.quantidade,
            now_ms,
        )?;

        // 3) Enfileira na outbox.
        tx.execute(
            "INSERT INTO outbox_estoque_movs(
                local_uuid, client_uuid, payload, status,
                attempts, last_error, remote_id,
                created_at_ms, updated_at_ms, sent_at_ms
             ) VALUES (?1, ?2, ?3, 'pending', 0, NULL, NULL, ?4, ?4, NULL)",
            params![local_uuid, input.client_uuid, payload_json, now_ms],
        )?;

        tx.commit()?;
        Ok(LocalMovimentacaoResult {
            local_uuid,
            idempotente: false,
            saldo_anterior,
            saldo_posterior,
        })
    })
}

fn iso_from_ms_z_pub(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

// ---------- Outbox: leitura, stats e atualização de status ----------

#[derive(Debug, Serialize)]
pub struct OutboxItem {
    pub local_uuid: String,
    pub client_uuid: Option<String>,
    pub payload: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub remote_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub sent_at_ms: Option<i64>,
}

#[derive(Debug, Serialize, Default)]
pub struct OutboxStats {
    pub pending: i64,
    pub sending: i64,
    pub sent: i64,
    pub error: i64,
    pub last_sent_at_ms: Option<i64>,
    pub last_error: Option<String>,
}

pub fn outbox_stats() -> DbResult<OutboxStats> {
    with_conn(|conn| {
        let mut s = OutboxStats::default();
        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM outbox_estoque_movs GROUP BY status",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for r in rows {
            let (st, n) = r?;
            match st.as_str() {
                "pending" => s.pending = n,
                "sending" => s.sending = n,
                "sent" => s.sent = n,
                "error" => s.error = n,
                _ => {}
            }
        }
        s.last_sent_at_ms = conn
            .query_row(
                "SELECT MAX(sent_at_ms) FROM outbox_estoque_movs WHERE status='sent'",
                [],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        s.last_error = conn
            .query_row(
                "SELECT last_error FROM outbox_estoque_movs
                  WHERE status='error' ORDER BY updated_at_ms DESC LIMIT 1",
                [],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        Ok(s)
    })
}

pub fn outbox_list(limit: i64, only_status: Option<&str>) -> DbResult<Vec<OutboxItem>> {
    with_conn(|conn| {
        let limit = limit.clamp(1, 1000);
        let (sql, has_filter) = match only_status {
            Some(_) => (
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_estoque_movs
                  WHERE status = ?1
                  ORDER BY created_at_ms DESC
                  LIMIT ?2"
                    .to_string(),
                true,
            ),
            None => (
                "SELECT local_uuid, client_uuid, payload, status, attempts, last_error,
                        remote_id, created_at_ms, updated_at_ms, sent_at_ms
                   FROM outbox_estoque_movs
                  ORDER BY created_at_ms DESC
                  LIMIT ?1"
                    .to_string(),
                false,
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        let map_row = |r: &rusqlite::Row<'_>| -> rusqlite::Result<OutboxItem> {
            Ok(OutboxItem {
                local_uuid: r.get(0)?,
                client_uuid: r.get(1)?,
                payload: r.get(2)?,
                status: r.get(3)?,
                attempts: r.get(4)?,
                last_error: r.get(5)?,
                remote_id: r.get(6)?,
                created_at_ms: r.get(7)?,
                updated_at_ms: r.get(8)?,
                sent_at_ms: r.get(9)?,
            })
        };
        let mut out = Vec::new();
        if has_filter {
            let s = only_status.unwrap();
            let rows = stmt.query_map(params![s, limit], map_row)?;
            for r in rows { out.push(r?); }
        } else {
            let rows = stmt.query_map(params![limit], map_row)?;
            for r in rows { out.push(r?); }
        }
        Ok(out)
    })
}

pub fn outbox_pending_batch(limit: i64) -> DbResult<Vec<OutboxItem>> {
    outbox_list(limit, Some("pending"))
}

pub fn outbox_mark_sending(local_uuid: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='sending', updated_at_ms=?2, attempts=attempts+1
              WHERE local_uuid=?1",
            params![local_uuid, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_mark_sent(local_uuid: &str, remote_id: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='sent', sent_at_ms=?2, updated_at_ms=?2,
                    remote_id=?3, last_error=NULL
              WHERE local_uuid=?1",
            params![local_uuid, now_ms, remote_id],
        )?;
        Ok(())
    })
}

pub fn outbox_mark_error(local_uuid: &str, err: &str, now_ms: i64) -> DbResult<()> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='error', last_error=?2, updated_at_ms=?3
              WHERE local_uuid=?1",
            params![local_uuid, err, now_ms],
        )?;
        Ok(())
    })
}

pub fn outbox_reset_errors(now_ms: i64) -> DbResult<i64> {
    with_conn(|conn| {
        let n = conn.execute(
            "UPDATE outbox_estoque_movs
                SET status='pending', updated_at_ms=?1
              WHERE status='error'",
            params![now_ms],
        )?;
        Ok(n as i64)
    })
}
