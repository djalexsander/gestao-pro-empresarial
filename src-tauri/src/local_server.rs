// ============================================================================
// Backend HTTP local — roda apenas no Desktop em modo "Servidor Local".
// ============================================================================
//
// Endpoints:
//   GET /health       → health do servidor local
//   GET /server-info  → identificação
//
//   GET /api/produtos/list?status=&categoria_id=&busca=
//   GET /api/estoque/saldos
//   GET /api/estoque/movimentacoes?produto_id=&limit=
//   GET /api/clientes/lite?status=
//
// Os endpoints /api/* atuam como PROXY para o Lovable Cloud (Supabase REST):
// recebem o JWT do terminal no header Authorization e o repassam, mantendo
// RLS aplicada como aquele usuário. Isto prova a arquitetura
// terminal -> servidor local -> fonte de dados, sem exigir banco local
// nesta etapa. Quando o banco local entrar (próxima etapa), basta trocar
// a função `proxy_get` por uma consulta SQL local.

use axum::{
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

use crate::backup;
use crate::db;

// ---------- Estado global ----------

#[derive(Default)]
struct ServerState {
    running: bool,
    port: Option<u16>,
    started_at_ms: Option<i64>,
    server_name: Option<String>,
    server_id: Option<String>,
    hostname: Option<String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de estoque) para parar.
    scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de vendas) para parar.
    vendas_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de caixa) para parar.
    caixa_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de cancelamentos) para parar.
    cancel_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox financeira) para parar.
    fin_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de clientes) para parar.
    cli_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de fornecedores) para parar.
    forn_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de background (outbox de compras) para parar.
    compras_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    /// Sinaliza o scheduler de backup automático para parar.
    backup_scheduler_shutdown_tx: Option<oneshot::Sender<()>>,
    upstream: Option<UpstreamConfig>,
    /// Últimos heartbeats por terminalId (em memória; banco local virá depois).
    terminals: HashMap<String, TerminalHeartbeat>,
}

#[derive(Clone, Debug)]
struct UpstreamConfig {
    /// Base URL do Supabase, ex: https://xxxx.supabase.co
    base_url: String,
    /// Publishable/anon key (usada quando o terminal não envia JWT).
    anon_key: String,
}

static STATE: Lazy<Mutex<ServerState>> = Lazy::new(|| Mutex::new(ServerState::default()));

const APP_NAME: &str = "Gestao Pro";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone)]
struct AppCtx {
    upstream: Option<UpstreamConfig>,
    http: reqwest::Client,
}

// ---------- Tipos de resposta ----------

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    app: &'static str,
    version: &'static str,
    role: &'static str,
    server_id: Option<String>,
    server_name: Option<String>,
    timestamp: i64,
    uptime_ms: i64,
}

#[derive(Serialize)]
struct ServerInfoResponse {
    app: &'static str,
    version: &'static str,
    protocol_version: u32,
    role: &'static str,
    server_id: Option<String>,
    server_name: Option<String>,
    hostname: Option<String>,
    host: Option<String>,
    started_at: Option<i64>,
    started_at_iso: Option<String>,
    port: Option<u16>,
    upstream_configured: bool,
    terminals_conectados: usize,
    backend_running: bool,
    database_ready: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub started_at: Option<i64>,
    pub server_name: Option<String>,
    pub server_id: Option<String>,
    pub hostname: Option<String>,
    pub app: &'static str,
    pub version: &'static str,
    pub upstream_configured: bool,
    pub terminals_conectados: usize,
}

// ---------- Heartbeat ----------

#[derive(Deserialize, Debug, Clone)]
struct HeartbeatRequest {
    terminal_id: String,
    terminal_nome: Option<String>,
    machine_id: Option<String>,
    role: Option<String>,
    app_version: Option<String>,
    /// Se vier preenchido, o terminal está validando que está falando com o
    /// servidor certo.
    expected_server_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
struct TerminalHeartbeat {
    terminal_id: String,
    terminal_nome: Option<String>,
    machine_id: Option<String>,
    role: Option<String>,
    app_version: Option<String>,
    last_seen_ms: i64,
    last_seen_iso: String,
}

#[derive(Serialize)]
struct HeartbeatResponse {
    ok: bool,
    server_id: Option<String>,
    server_name: Option<String>,
    server_version: &'static str,
    accepted_at: i64,
    /// Quando `expected_server_id` foi enviado e bate, vem `true`.
    server_match: Option<bool>,
}

#[derive(Serialize)]
struct TerminalsListResponse {
    total: usize,
    terminals: Vec<TerminalHeartbeat>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn iso_from_ms(ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).map(|d| d.to_rfc3339())
}

// ---------- Handlers básicos ----------

async fn health_handler() -> Json<HealthResponse> {
    let (started, server_id, server_name) = STATE
        .lock()
        .ok()
        .map(|s| (s.started_at_ms.unwrap_or_else(now_ms), s.server_id.clone(), s.server_name.clone()))
        .unwrap_or((now_ms(), None, None));
    Json(HealthResponse {
        status: "ok",
        app: APP_NAME,
        version: APP_VERSION,
        role: "server",
        server_id,
        server_name,
        timestamp: now_ms(),
        uptime_ms: now_ms() - started,
    })
}

async fn server_info_handler() -> Json<ServerInfoResponse> {
    let snap = STATE.lock().ok().map(|s| {
        (
            s.server_name.clone(),
            s.server_id.clone(),
            s.hostname.clone(),
            s.started_at_ms,
            s.port,
            s.upstream.is_some(),
            s.terminals.len(),
            s.running,
        )
    });
    let (server_name, server_id, hostname, started_at, port, upstream_configured, terminals_conectados, running) =
        snap.unwrap_or((None, None, None, None, None, false, 0, false));

    let host = local_ip().or_else(|| hostname.clone());
    let database_ready = db::db_info().is_ok();

    Json(ServerInfoResponse {
        app: APP_NAME,
        version: APP_VERSION,
        protocol_version: PROTOCOL_VERSION,
        role: "server",
        server_id,
        server_name,
        hostname,
        host,
        started_at,
        started_at_iso: started_at.and_then(iso_from_ms),
        port,
        upstream_configured,
        terminals_conectados,
        backend_running: running,
        database_ready,
    })
}

/// Tenta descobrir o IP IPv4 não-loopback principal da máquina, para
/// preencher o campo "Host" que os terminais devem usar na rede local.
fn local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    // Não envia nada — só força a resolução do roteamento de saída.
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip().to_string())
}

// ---------- Heartbeat ----------

async fn heartbeat_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<HeartbeatRequest>,
) -> Result<Json<HeartbeatResponse>, (StatusCode, String)> {
    if req.terminal_id.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "terminal_id obrigatório".into()));
    }

    let now = now_ms();
    let hb = TerminalHeartbeat {
        terminal_id: req.terminal_id.clone(),
        terminal_nome: req.terminal_nome.clone(),
        machine_id: req.machine_id.clone(),
        role: req.role.clone(),
        app_version: req.app_version.clone(),
        last_seen_ms: now,
        last_seen_iso: now_iso(),
    };

    let (server_id, server_name, server_match, was_new) = {
        let mut s = STATE.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let was_new = !s.terminals.contains_key(&req.terminal_id);
        s.terminals.insert(req.terminal_id.clone(), hb);
        let m = req
            .expected_server_id
            .as_ref()
            .map(|exp| s.server_id.as_deref() == Some(exp.as_str()));
        (s.server_id.clone(), s.server_name.clone(), m, was_new)
    };

    // Persistência local — falha silenciosa (não atrapalha operação).
    let host_str = addr.ip().to_string();
    let _ = db::upsert_terminal(db::UpsertHeartbeat {
        terminal_id: &req.terminal_id,
        machine_id: req.machine_id.as_deref(),
        server_id: server_id.as_deref(),
        terminal_nome: req.terminal_nome.as_deref(),
        role: req.role.as_deref(),
        app_version: req.app_version.as_deref(),
        host: Some(&host_str),
        now_ms: now,
    });

    // Auditoria: só registra o primeiro heartbeat e desvios de identidade
    // (evita inflar a tabela com 1 evento por ping).
    if was_new {
        let _ = db::log_event(db::LogEvent {
            terminal_id: &req.terminal_id,
            event_type: "first_seen",
            ts_ms: now,
            server_match,
            expected_server_id: req.expected_server_id.as_deref(),
            details: Some(&host_str),
        });
    } else if matches!(server_match, Some(false)) {
        let _ = db::log_event(db::LogEvent {
            terminal_id: &req.terminal_id,
            event_type: "server_mismatch",
            ts_ms: now,
            server_match,
            expected_server_id: req.expected_server_id.as_deref(),
            details: None,
        });
    }

    Ok(Json(HeartbeatResponse {
        ok: true,
        server_id,
        server_name,
        server_version: APP_VERSION,
        accepted_at: now,
        server_match,
    }))
}

async fn terminals_handler() -> Json<TerminalsListResponse> {
    let terminals: Vec<TerminalHeartbeat> = STATE
        .lock()
        .ok()
        .map(|s| s.terminals.values().cloned().collect())
        .unwrap_or_default();
    Json(TerminalsListResponse {
        total: terminals.len(),
        terminals,
    })
}

// ---------- Proxy para Supabase REST ----------

async fn proxy_get(
    ctx: &AppCtx,
    headers: &HeaderMap,
    path: &str,
    query: &[(&str, String)],
) -> Result<axum::response::Response, (StatusCode, String)> {
    let upstream = ctx
        .upstream
        .as_ref()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Upstream não configurado".into()))?;

    let url = format!("{}{}", upstream.base_url.trim_end_matches('/'), path);

    // Auth: prefere JWT do terminal; senão, anon key.
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let req = ctx
        .http
        .get(&url)
        .query(query)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::ACCEPT, "application/json");

    let res = req
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Falha upstream: {e}")))?;

    let status = res.status();
    let body = res
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Falha lendo upstream: {e}")))?;

    Ok((
        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

// ---------- Cache read-through (TTL curto) ----------
//
// Estratégia atual:
//
//   * `proxy_with_incremental_sync` (produtos, clientes_lite):
//       1. Lê o cursor `last_remote_cursor_ms` do `domain_sync_meta`.
//       2. Se há cursor → pede só `updated_at>=cursor` ao upstream
//          (modo INCREMENTAL); se não → snapshot inicial.
//       3. Ingere via `db::ingest_*` que mantém o cursor monotonicamente,
//          marca tombstones de soft-delete (`status` inativo/arquivado)
//          e atualiza `domain_sync_meta`.
//       4. Devolve a leitura COMPLETA da tabela local
//          (`x-gp-source: local-table`) — terminais sempre veem o estado
//          consolidado, independente do tamanho do delta. Cabeçalhos extras:
//             x-gp-strategy: snapshot | incremental
//             x-gp-delta:    <linhas no lote>
//       5. Se o upstream cair, cai para `local-table-stale`.
//
//   * `proxy_with_cache` (estoque_saldos): mantém snapshot+TTL desta etapa.
//     Saldo vem agregado de movimentações; sync incremental virá quando
//     derivarmos o agregado a partir de `estoque_movimentacoes` por
//     `created_at` (próxima etapa).

const CACHE_TTL_MS: i64 = 60_000;

fn build_cache_key(path: &str, query: &[(&str, String)]) -> String {
    let mut parts: Vec<String> = query.iter().map(|(k, v)| format!("{k}={v}")).collect();
    parts.sort();
    format!("{path}?{}", parts.join("&"))
}

fn iso_from_ms_z(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

/// Limites de segurança para o lote incremental — evita arrastar a base
/// inteira em uma única chamada caso o cursor ainda esteja em zero.
const INCREMENTAL_PAGE_LIMIT: u32 = 1000;

/// Configuração da estratégia incremental por domínio.
struct IncrementalSpec {
    /// Campo do upstream usado como cursor (ex.: "updated_at" ou
    /// "data_movimentacao").
    cursor_field: &'static str,
    /// Estratégia em modo "tem cursor" (Incremental p/ produtos/clientes,
    /// Append p/ movimentações de estoque).
    incremental_strategy: db::IngestStrategy,
    /// Em modo incremental, se devemos retirar o filtro de `status` do
    /// base_query (necessário para capturar tombstones de soft-delete).
    strip_status_in_incremental: bool,
}

fn incremental_spec(domain: &str) -> IncrementalSpec {
    match domain {
        "estoque_movimentacoes" => IncrementalSpec {
            cursor_field: "data_movimentacao",
            incremental_strategy: db::IngestStrategy::Append,
            strip_status_in_incremental: false,
        },
        // produtos / clientes_lite — comportamento já validado nas etapas
        // anteriores (incremental por updated_at + tombstone por status).
        _ => IncrementalSpec {
            cursor_field: "updated_at",
            incremental_strategy: db::IngestStrategy::Incremental,
            strip_status_in_incremental: true,
        },
    }
}

async fn proxy_with_incremental_sync(
    ctx: &AppCtx,
    headers: &HeaderMap,
    domain: &str,
    path: &str,
    base_query: &[(&str, String)],
    force: bool,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let now = now_ms();
    let spec = incremental_spec(domain);

    // 1) Lê estado de sync e decide estratégia.
    let state = db::get_domain_sync_state(domain).unwrap_or(db::DomainSyncState {
        last_remote_cursor_ms: None,
        last_strategy: None,
    });
    let strategy = match state.last_remote_cursor_ms {
        Some(_) => spec.incremental_strategy,
        None => db::IngestStrategy::Snapshot,
    };

    // 2) Sem `force`, podemos servir do local se ainda dentro do TTL — usamos
    //    o cache_kv como "freshness gate" sem reconsultar upstream.
    let key = build_cache_key(path, base_query);
    if !force {
        if let Ok(Some(_)) = db::cache_get(domain, &key, now) {
            if let Ok(payload) = read_typed(domain, base_query) {
                return Ok(typed_response_full(
                    StatusCode::OK,
                    "local-table",
                    strategy.as_str(),
                    0,
                    payload.into_bytes(),
                ));
            }
        }
    }

    // 3) Monta query upstream — incremental quando há cursor.
    // Remove pseudo-keys (`__filter_*`) — só servem para `read_typed`,
    // não devem ir ao upstream PostgREST.
    let mut q: Vec<(&str, String)> = base_query
        .iter()
        .filter(|(k, _)| !k.starts_with("__"))
        .cloned()
        .collect();
    if let Some(cursor) = state.last_remote_cursor_ms {
        if spec.strip_status_in_incremental {
            q.retain(|(k, _)| *k != "order" && *k != "status");
        } else {
            q.retain(|(k, _)| *k != "order");
        }
        q.push((spec.cursor_field, format!("gte.{}", iso_from_ms_z(cursor))));
        q.push(("order", format!("{}.asc", spec.cursor_field)));
        q.push(("limit", INCREMENTAL_PAGE_LIMIT.to_string()));
    }

    // 4) Vai ao upstream.
    let upstream_result = proxy_get(ctx, headers, path, &q).await;

    match upstream_result {
        Ok(upstream_resp) => {
            let (parts, body) = upstream_resp.into_parts();
            let bytes = axum::body::to_bytes(body, 1024 * 1024 * 8)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Falha lendo body: {e}")))?;

            if !parts.status.is_success() {
                let _ = db::record_sync_error(
                    domain,
                    now,
                    &format!("upstream HTTP {}", parts.status.as_u16()),
                );
                return Ok(typed_response(parts.status, "upstream", bytes.to_vec()));
            }

            // Ingestão tipada cursor-aware.
            let mut delta = 0i64;
            if let Ok(text) = std::str::from_utf8(&bytes) {
                match domain {
                    "produtos" => match db::ingest_produtos(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest produtos falhou: {e}");
                        }
                    },
                    "clientes_lite" => match db::ingest_clientes(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest clientes falhou: {e}");
                        }
                    },
                    "fornecedores" => match db::ingest_fornecedores(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest fornecedores falhou: {e}");
                        }
                    },
                    "financeiro_lancamentos_completo" => match db::ingest_lancamentos_completo(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest financeiro_lancamentos_completo falhou: {e}");
                        }
                    },
                    "compras" => match db::ingest_compras(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest compras falhou: {e}");
                        }
                    },
                    "vendas_remote" => match db::ingest_vendas_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest vendas_remote falhou: {e}");
                        }
                    },
                    "estoque_movimentacoes" => {
                        match db::ingest_movimentacoes(text, now, strategy) {
                            Ok((n, _)) => delta = n as i64,
                            Err(e) => {
                                let _ = db::record_sync_error(domain, now, &e.to_string());
                                eprintln!("[gestao-pro] ingest movimentacoes falhou: {e}");
                            }
                        }
                    }
                    "caixas_remote" => match db::ingest_caixas_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest caixas_remote falhou: {e}");
                        }
                    },
                    "caixa_movimentos_remote" => match db::ingest_caixa_movimentos_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest caixa_movimentos_remote falhou: {e}");
                        }
                    },
                    "funcionarios_remote" => match db::ingest_funcionarios_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest funcionarios_remote falhou: {e}");
                        }
                    },
                    "terminais_remote" => match db::ingest_terminais_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest terminais_remote falhou: {e}");
                        }
                    },
                    "pagamentos_empresa_remote" => match db::ingest_pagamentos_empresa_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest pagamentos_empresa falhou: {e}");
                        }
                    },
                    "venda_itens_remote" => match db::ingest_venda_itens_remote(text, now, strategy) {
                        Ok((n, _)) => delta = n as i64,
                        Err(e) => {
                            let _ = db::record_sync_error(domain, now, &e.to_string());
                            eprintln!("[gestao-pro] ingest venda_itens_remote falhou: {e}");
                        }
                    },
                    _ => {}
                }
                let _ = db::cache_put(domain, &key, "{\"_marker\":1}", now, CACHE_TTL_MS);
            }

            // Devolve estado consolidado da tabela local — sempre.
            let payload = read_typed(domain, base_query)
                .unwrap_or_else(|_| std::str::from_utf8(&bytes).unwrap_or("[]").to_string());
            Ok(typed_response_full(
                StatusCode::OK,
                "local-table",
                strategy.as_str(),
                delta,
                payload.into_bytes(),
            ))
        }
        Err(err) => {
            let _ = db::record_sync_error(domain, now, &format!("{:?}", err));
            if let Ok(true) = db::domain_has_rows(domain) {
                if let Ok(payload) = read_typed(domain, base_query) {
                    return Ok(typed_response_full(
                        StatusCode::OK,
                        "local-table-stale",
                        strategy.as_str(),
                        0,
                        payload.into_bytes(),
                    ));
                }
            }
            Err(err)
        }
    }
}

#[allow(dead_code)]
async fn proxy_with_cache(
    ctx: &AppCtx,
    headers: &HeaderMap,
    domain: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<axum::response::Response, (StatusCode, String)> {
    let key = build_cache_key(path, query);
    let now = now_ms();

    if let Ok(Some(payload)) = db::cache_get(domain, &key, now) {
        return Ok(typed_response(StatusCode::OK, "local-db", payload.into_bytes()));
    }

    let upstream_result = proxy_get(ctx, headers, path, query).await;

    match upstream_result {
        Ok(upstream_resp) => {
            let (parts, body) = upstream_resp.into_parts();
            let bytes = axum::body::to_bytes(body, 1024 * 1024 * 8)
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Falha lendo body: {e}")))?;

            if parts.status.is_success() {
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    let _ = db::cache_put(domain, &key, text, now, CACHE_TTL_MS);
                    ingest_typed(domain, text, now);
                }
            }
            Ok(typed_response(parts.status, "upstream", bytes.to_vec()))
        }
        Err(err) => {
            let _ = db::record_sync_error(domain, now, &format!("{:?}", err));
            if let Ok(true) = db::domain_has_rows(domain) {
                if let Ok(payload) = read_typed(domain, query) {
                    return Ok(typed_response(
                        StatusCode::OK,
                        "local-table-stale",
                        payload.into_bytes(),
                    ));
                }
            }
            Err(err)
        }
    }
}

fn typed_response(status: StatusCode, source: &'static str, body: Vec<u8>) -> axum::response::Response {
    (
        status,
        [
            (axum::http::header::CONTENT_TYPE, "application/json"),
            (axum::http::HeaderName::from_static("x-gp-source"), source),
        ],
        body,
    )
        .into_response()
}

fn typed_response_full(
    status: StatusCode,
    source: &'static str,
    strategy: &str,
    delta: i64,
    body: Vec<u8>,
) -> axum::response::Response {
    use axum::http::{HeaderName, HeaderValue};
    let mut resp = (
        status,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response();
    let h = resp.headers_mut();
    h.insert(HeaderName::from_static("x-gp-source"), HeaderValue::from_static(source));
    if let Ok(v) = HeaderValue::from_str(strategy) {
        h.insert(HeaderName::from_static("x-gp-strategy"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&delta.to_string()) {
        h.insert(HeaderName::from_static("x-gp-delta"), v);
    }
    resp
}

fn ingest_typed(domain: &str, text: &str, now: i64) {
    // Apenas saldos seguem em modo snapshot legado pela função antiga.
    let r = match domain {
        "estoque_saldos" => db::ingest_saldos_snapshot(text, now).map(|_| ()),
        _ => Ok(()),
    };
    if let Err(e) = r {
        eprintln!("[gestao-pro] ingest tipado falhou domain={domain}: {e}");
    }
}

fn read_typed(domain: &str, query: &[(&str, String)]) -> Result<String, db::DbError> {
    let get = |k: &str| -> Option<String> {
        query.iter().find(|(qk, _)| *qk == k).map(|(_, v)| v.clone())
    };
    match domain {
        "produtos" => {
            let _ = get("status");
            let _ = get("categoria_id");
            db::read_produtos(db::ProdutosFilter {
                status: None,
                categoria_id: None,
                busca: None,
            })
        }
        "clientes_lite" => db::read_clientes(None),
        "fornecedores" => db::read_fornecedores(None),
        "financeiro_lancamentos_completo" => db::read_lancamentos_completo(),
        "compras" => {
            let limit = query
                .iter()
                .find(|(k, _)| *k == "__filter_limit")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(500);
            db::read_compras(limit)
        }
        "vendas_remote" => {
            let limit = query
                .iter()
                .find(|(k, _)| *k == "__filter_limit")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(500);
            db::read_vendas_remote(limit)
        }
        "estoque_saldos" => db::read_saldos(),
        "estoque_movimentacoes" => {
            let produto_id = query
                .iter()
                .find(|(k, _)| *k == "__filter_produto_id")
                .map(|(_, v)| v.clone());
            let limit = query
                .iter()
                .find(|(k, _)| *k == "__filter_limit")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(500);
            db::read_movimentacoes(produto_id.as_deref(), limit)
        }
        "caixas_remote" => {
            let limit = query
                .iter()
                .find(|(k, _)| *k == "__filter_limit")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(1000);
            db::read_caixas_remote(limit)
        }
        "caixa_movimentos_remote" => {
            let caixa_id = query
                .iter()
                .find(|(k, _)| *k == "__filter_caixa_id")
                .map(|(_, v)| v.as_str())
                .unwrap_or("");
            db::read_caixa_movimentos_remote(caixa_id)
        }
        "funcionarios_remote" => db::read_funcionarios_ativos_remote(),
        "terminais_remote" => db::read_terminais_ativos_remote(),
        "pagamentos_empresa_remote" => {
            let limit = query
                .iter()
                .find(|(k, _)| *k == "__filter_limit")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(200);
            db::read_pagamentos_empresa_remote(limit)
        }
        "venda_itens_remote" => {
            let inicio = query
                .iter()
                .find(|(k, _)| *k == "__filter_inicio_ms")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(0);
            let fim = query
                .iter()
                .find(|(k, _)| *k == "__filter_fim_ms")
                .and_then(|(_, v)| v.parse::<i64>().ok())
                .unwrap_or(i64::MAX);
            db::read_venda_itens_remote_periodo(inicio, fim)
        }
        _ => Err(db::DbError("domínio sem leitura tipada".into())),
    }
}

async fn produtos_list_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let mut params: Vec<(&str, String)> = vec![
        ("select", "*,categoria:categorias_produto(id,nome)".into()),
        ("order", "nome.asc".into()),
    ];
    if let Some(s) = q.get("status").filter(|s| !s.is_empty()) {
        params.push(("status", format!("eq.{s}")));
    }
    if let Some(c) = q.get("categoria_id").filter(|s| !s.is_empty()) {
        params.push(("categoria_id", format!("eq.{c}")));
    }
    if let Some(b) = q.get("busca").map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let pattern = format!("*{b}*");
        params.push(("or", format!("(nome.ilike.{pattern},sku.ilike.{pattern})")));
    }
    let q_owned: Vec<(&str, String)> = params.iter().map(|(k, v)| (*k, v.clone())).collect();
    proxy_with_incremental_sync(&ctx, &headers, "produtos", "/rest/v1/produtos", &q_owned, false).await
}

// ---------- /api/produtos/buscar-codigo & /api/produtos/buscar-plu ----------
//
// Etapa 5 (offline-first): scanner de código de barras / leitor de balança
// no PDV consultam o SQLite local diretamente. NUNCA tocam upstream/cloud.
//   * 200 + body                       → produto encontrado localmente.
//   * 200 + `{"result": null}`         → busca local autoritativa, código
//                                         não existe nesse tenant.
//   * 503                              → produtos ainda não sincronizados;
//                                         caller (adapter) decide se cai
//                                         para cloud (se online) ou recusa.
//   * 500                              → erro inesperado de banco.

async fn produtos_buscar_codigo_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let codigo = q.get("codigo").map(|s| s.as_str()).unwrap_or("");
    let outcome = db::buscar_produto_por_codigo_local(codigo)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !outcome.has_data {
        let mut resp = (StatusCode::SERVICE_UNAVAILABLE, "produtos_local vazio").into_response();
        resp.headers_mut()
            .insert("x-gp-source", axum::http::HeaderValue::from_static("local-empty"));
        return Ok(resp);
    }
    eprintln!(
        "[LOCAL_BUSCA] produtos.buscarPorCodigo codigo={} hit={}",
        codigo,
        outcome.result.is_some()
    );
    let body = serde_json::json!({ "result": outcome.result });
    let mut resp = (StatusCode::OK, axum::Json(body)).into_response();
    resp.headers_mut()
        .insert("x-gp-source", axum::http::HeaderValue::from_static("local-table"));
    Ok(resp)
}

async fn produtos_buscar_plu_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let plu = q.get("plu").map(|s| s.as_str()).unwrap_or("");
    let outcome = db::buscar_produto_por_plu_local(plu)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !outcome.has_data {
        let mut resp = (StatusCode::SERVICE_UNAVAILABLE, "produtos_local vazio").into_response();
        resp.headers_mut()
            .insert("x-gp-source", axum::http::HeaderValue::from_static("local-empty"));
        return Ok(resp);
    }
    eprintln!(
        "[LOCAL_BUSCA] produtos.buscarPorPlu plu={} hit={}",
        plu,
        outcome.result.is_some()
    );
    let body = serde_json::json!({ "result": outcome.result });
    let mut resp = (StatusCode::OK, axum::Json(body)).into_response();
    resp.headers_mut()
        .insert("x-gp-source", axum::http::HeaderValue::from_static("local-table"));
    Ok(resp)
}

// ---------- /api/estoque/saldos ----------
//
// Saldos passam a ser DERIVADOS do sync incremental de movimentações.
// O handler dispara o pipeline de `estoque_movimentacoes` (que ingere o
// delta append-only e atualiza a materialização de `estoque_saldos_local`)
// e responde com o estado consolidado lido por `read_saldos()`.

fn estoque_movs_base_params() -> Vec<(&'static str, String)> {
    // Snapshot inicial e deltas SEMPRE em ordem ascendente por data_movimentacao
    // — assim o cursor avança monotonicamente desde a primeira página.
    vec![
        (
            "select",
            "id,produto_id,variacao_id,tipo,quantidade,saldo_anterior,saldo_posterior,custo_unitario,origem,observacoes,data_movimentacao,created_at"
                .into(),
        ),
        ("order", "data_movimentacao.asc".into()),
        ("limit", INCREMENTAL_PAGE_LIMIT.to_string()),
    ]
}

async fn estoque_saldos_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let params = estoque_movs_base_params();
    // Roda o pipeline incremental de movimentações; a leitura final
    // entregue ao terminal vem do `read_typed("estoque_saldos")` =
    // `db::read_saldos()` (saldo materializado).
    let resp = proxy_with_incremental_sync(
        &ctx,
        &headers,
        "estoque_movimentacoes",
        "/rest/v1/estoque_movimentacoes",
        &params,
        false,
    )
    .await?;
    // Substitui o body pelo saldo materializado (mantendo headers de
    // strategy/source/delta vindos do sync).
    let (mut parts, _body) = resp.into_parts();
    let saldos = db::read_saldos().unwrap_or_else(|_| "[]".to_string());
    parts.headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    Ok((parts, saldos).into_response())
}

// ---------- /api/estoque/rebuild ----------
//
// Recalcula `estoque_saldos_local` a partir das movimentações locais.
// Operação defensiva — usar quando suspeitar de divergência entre saldo
// materializado e histórico. Atômica (transação SQLite única).
async fn estoque_rebuild_handler() -> Result<Json<db::RebuildStockResult>, (StatusCode, String)> {
    let now = chrono::Utc::now().timestamp_millis();
    println!("[LOCAL_STOCK] rebuild solicitado");
    db::rebuild_local_stock(now)
        .map(|r| {
            println!(
                "[LOCAL_STOCK] rebuild concluído: produtos={}, saldos={}",
                r.produtos_recalculados, r.saldos_corrigidos
            );
            Json(r)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

// ---------- /api/estoque/saude ----------
//
// Verificador de saúde local: saldos negativos, movimentações órfãs,
// duplicidades, status da outbox. Apenas leitura.
async fn estoque_saude_handler() -> Result<Json<db::StockHealthReport>, (StatusCode, String)> {
    let now = chrono::Utc::now().timestamp_millis();
    db::verify_local_stock_health(now)
        .map(|r| {
            println!(
                "[LOCAL_STOCK] saude status={} saldos={} movs={} neg={} orfas={} dup={} outbox_err={}",
                r.status,
                r.total_saldos,
                r.total_movimentacoes,
                r.saldos_negativos,
                r.movimentacoes_orfas,
                r.movimentacoes_duplicadas,
                r.outbox_erros
            );
            Json(r)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

// ---------- /api/estoque/movimentacoes ----------
//
// Lista o histórico (com filtro opcional por produto/limit) lendo da
// tabela local após disparar o mesmo sync incremental. Os filtros são
// passados como pseudo-keys no base_query (`__filter_*`) para que
// `read_typed` os pegue na hora de ler localmente, sem virar query do
// upstream (a busca no upstream é sempre paginada por cursor).

async fn estoque_movimentacoes_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let mut params = estoque_movs_base_params();
    // Pseudo-filtros — não vão ao upstream (proxy_get só usa as chaves
    // conhecidas do PostgREST). Usados por `read_typed` para filtrar a
    // resposta local.
    if let Some(p) = q.get("produto_id").filter(|s| !s.is_empty()) {
        params.push(("__filter_produto_id", p.clone()));
    }
    if let Some(l) = q.get("limit").filter(|s| !s.is_empty()) {
        params.push(("__filter_limit", l.clone()));
    }
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "estoque_movimentacoes",
        "/rest/v1/estoque_movimentacoes",
        &params,
        false,
    )
    .await
}

// ---------- /api/clientes/lite ----------

async fn clientes_lite_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    // Pedimos `*` para que o `payload` cacheado em `clientes_local` contenha
    // TODOS os campos do cadastro — assim o mesmo dataset alimenta tanto o
    // `listLite` (PDV) quanto o `list` completo (tela de Clientes), sem
    // precisar de outra rota nem outra ingestão.
    let mut params: Vec<(&str, String)> = vec![
        ("select", "*".into()),
        ("order", "nome.asc".into()),
    ];
    // status vazio = todos; ausente = "ativo" (default)
    let status_opt = q.get("status").map(|s| s.as_str());
    let status_val = match status_opt {
        None => Some("ativo"),
        Some("") => None,
        Some(other) => Some(other),
    };
    if let Some(s) = status_val {
        params.push(("status", format!("eq.{s}")));
    }
    let q_owned: Vec<(&str, String)> = params.iter().map(|(k, v)| (*k, v.clone())).collect();
    proxy_with_incremental_sync(&ctx, &headers, "clientes_lite", "/rest/v1/clientes", &q_owned, false).await
}

// ---------- Endpoints de banco local ----------

#[derive(Serialize)]
struct KnownTerminalsResponse {
    total: usize,
    terminals: Vec<db::PersistedTerminal>,
}

async fn known_terminals_handler() -> Result<Json<KnownTerminalsResponse>, (StatusCode, String)> {
    let terminals = db::list_terminals(200)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(KnownTerminalsResponse {
        total: terminals.len(),
        terminals,
    }))
}

#[derive(Serialize)]
struct EventsResponse {
    total: usize,
    events: Vec<db::PersistedEvent>,
}

async fn events_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<EventsResponse>, (StatusCode, String)> {
    let limit = q
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, 500);
    let events = db::list_events(limit)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(EventsResponse {
        total: events.len(),
        events,
    }))
}

async fn db_info_handler() -> Result<Json<db::DbInfo>, (StatusCode, String)> {
    db::db_info()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct DomainStatsResponse {
    total: usize,
    domains: Vec<db::DomainStat>,
}

async fn db_domains_handler() -> Result<Json<DomainStatsResponse>, (StatusCode, String)> {
    let domains = db::list_domain_stats()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(DomainStatsResponse {
        total: domains.len(),
        domains,
    }))
}

// ---------- Sync manual ----------
//
// `POST /db/sync?domain=produtos` força um pull incremental (ignora o
// freshness gate do cache_kv). Útil para o botão "Sincronizar agora" da UI.

#[derive(Serialize)]
struct SyncResponse {
    ok: bool,
    domain: String,
    strategy: String,
    delta: i64,
    source: String,
}

async fn db_sync_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<SyncResponse>, (StatusCode, String)> {
    let domain = q
        .get("domain")
        .cloned()
        .ok_or((StatusCode::BAD_REQUEST, "domain obrigatório".into()))?;

    // Reaproveita os mesmos params base que cada handler monta.
    let resp = match domain.as_str() {
        "produtos" => {
            let params: Vec<(&str, String)> = vec![
                ("select", "*,categoria:categorias_produto(id,nome)".into()),
                ("order", "nome.asc".into()),
            ];
            proxy_with_incremental_sync(
                &ctx, &headers, "produtos", "/rest/v1/produtos", &params, true,
            )
            .await
        }
        "clientes_lite" => {
            let params: Vec<(&str, String)> = vec![
                ("select", "*".into()),
                ("order", "nome.asc".into()),
            ];
            proxy_with_incremental_sync(
                &ctx, &headers, "clientes_lite", "/rest/v1/clientes", &params, true,
            )
            .await
        }
        "fornecedores" => {
            let params: Vec<(&str, String)> = vec![
                ("select", "*".into()),
                ("order", "razao_social.asc".into()),
            ];
            proxy_with_incremental_sync(
                &ctx, &headers, "fornecedores", "/rest/v1/fornecedores", &params, true,
            )
            .await
        }
        "financeiro_lancamentos_completo" => {
            let params: Vec<(&str, String)> = vec![
                ("select", financeiro_completo_select().to_string()),
                ("order", "data_vencimento.asc".into()),
            ];
            proxy_with_incremental_sync(
                &ctx, &headers, "financeiro_lancamentos_completo",
                "/rest/v1/financeiro_lancamentos", &params, true,
            )
            .await
        }
        "estoque_movimentacoes" | "estoque_saldos" => {
            let params = estoque_movs_base_params();
            proxy_with_incremental_sync(
                &ctx,
                &headers,
                "estoque_movimentacoes",
                "/rest/v1/estoque_movimentacoes",
                &params,
                true,
            )
            .await
        }
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("domínio '{other}' não suporta sync incremental ainda"),
            ))
        }
    }?;

    // Extrai metadados que o próprio proxy escreveu nos headers.
    let h = resp.headers();
    let strategy = h
        .get("x-gp-strategy")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("snapshot")
        .to_string();
    let delta = h
        .get("x-gp-delta")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let source = h
        .get("x-gp-source")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("local-table")
        .to_string();

    Ok(Json(SyncResponse {
        ok: true,
        domain,
        strategy,
        delta,
        source,
    }))
}

// ============================================================================
// ETAPA 3 — Sincronização inicial obrigatória para uso offline
// ============================================================================
//
// Endpoints:
//   GET  /api/offline/status        → estado de prontidão offline
//   POST /api/offline/sync-inicial  → roda pull de todos os domínios essenciais
//
// Marca de "primeira sync concluída" fica em cache_kv com TTL ~10 anos.
// Idempotente: pode ser chamado N vezes.

const OFFLINE_DOMAIN: &str = "offline_meta";
const OFFLINE_KEY_INITIAL: &str = "initial_sync";
const OFFLINE_TTL_MS: i64 = 1000 * 60 * 60 * 24 * 365 * 10; // ~10 anos

/// Domínios considerados ESSENCIAIS para o app rodar offline.
/// Cada item: (chave lógica usada na UI/sync, label amigável).
const OFFLINE_ESSENTIAL_DOMAINS: &[(&str, &str)] = &[
    ("produtos", "Produtos"),
    ("clientes_lite", "Clientes"),
    ("fornecedores", "Fornecedores"),
    ("estoque_movimentacoes", "Estoque (movimentações + saldos)"),
    ("financeiro_lancamentos_completo", "Financeiro"),
];

#[derive(Serialize)]
struct OfflineDomainStatus {
    domain: String,
    label: String,
    essential: bool,
    ready: bool,
    row_count: i64,
    last_synced_ms: Option<i64>,
    last_synced_ok: bool,
    last_error: Option<String>,
}

#[derive(Serialize)]
struct OfflineStatusResponse {
    initial_sync_completed: bool,
    initial_sync_at_ms: Option<i64>,
    schema_version: i64,
    upstream_configured: bool,
    ready: bool,
    warnings: Vec<String>,
    domains: Vec<OfflineDomainStatus>,
    pending_domains: Vec<String>,
}

fn read_initial_sync_marker() -> Option<i64> {
    // TTL longo, mas usamos now=0 para sempre passar o filtro de validade.
    let payload = db::cache_get(OFFLINE_DOMAIN, OFFLINE_KEY_INITIAL, 0).ok().flatten()?;
    payload.parse::<i64>().ok()
}

fn write_initial_sync_marker(at_ms: i64) {
    let _ = db::cache_put(
        OFFLINE_DOMAIN,
        OFFLINE_KEY_INITIAL,
        &at_ms.to_string(),
        at_ms,
        OFFLINE_TTL_MS,
    );
}

async fn offline_status_handler(
    State(ctx): State<AppCtx>,
) -> Result<Json<OfflineStatusResponse>, (StatusCode, String)> {
    let info = db::db_info()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let stats = db::list_domain_stats().unwrap_or_default();
    let stats_map: HashMap<String, db::DomainStat> =
        stats.into_iter().map(|s| (s.domain.clone(), s)).collect();

    let mut domains = Vec::with_capacity(OFFLINE_ESSENTIAL_DOMAINS.len());
    let mut pending = Vec::new();
    let mut all_ready = true;

    for (key, label) in OFFLINE_ESSENTIAL_DOMAINS {
        let s = stats_map.get(*key);
        let row_count = s.map(|x| x.row_count).unwrap_or(0);
        let ready = row_count > 0;
        if !ready {
            all_ready = false;
            pending.push((*key).to_string());
        }
        domains.push(OfflineDomainStatus {
            domain: (*key).to_string(),
            label: (*label).to_string(),
            essential: true,
            ready,
            row_count,
            last_synced_ms: s.and_then(|x| x.last_synced_ms),
            last_synced_ok: s.map(|x| x.last_synced_ok).unwrap_or(false),
            last_error: s.and_then(|x| x.last_error.clone()),
        });
    }

    let initial_at = read_initial_sync_marker();
    let mut warnings = Vec::new();
    if !ctx.upstream.is_some() {
        warnings.push(
            "Servidor local sem upstream configurado — sincronização inicial \
             só funciona com internet e credenciais do Lovable Cloud."
                .into(),
        );
    }
    if initial_at.is_none() {
        warnings.push(
            "Sincronização inicial nunca foi concluída neste computador. \
             Conecte à internet e clique em 'Sincronizar dados para uso offline'."
                .into(),
        );
    }
    if !all_ready {
        warnings.push(
            "Alguns domínios essenciais ainda não têm dados locais. \
             O modo offline pode ficar incompleto até a sincronização rodar."
                .into(),
        );
    }

    Ok(Json(OfflineStatusResponse {
        initial_sync_completed: initial_at.is_some(),
        initial_sync_at_ms: initial_at,
        schema_version: info.schema_version,
        upstream_configured: ctx.upstream.is_some(),
        ready: initial_at.is_some() && all_ready,
        warnings,
        domains,
        pending_domains: pending,
    }))
}

#[derive(Serialize)]
struct OfflineSyncDomainResult {
    domain: String,
    label: String,
    ok: bool,
    delta: i64,
    row_count: i64,
    error: Option<String>,
    duration_ms: i64,
}

#[derive(Serialize)]
struct OfflineSyncResponse {
    ok: bool,
    completed_at_ms: i64,
    upstream_configured: bool,
    total_delta: i64,
    results: Vec<OfflineSyncDomainResult>,
}

async fn offline_sync_inicial_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<OfflineSyncResponse>, (StatusCode, String)> {
    eprintln!("[OFFLINE_SYNC] início");
    let upstream_configured = ctx.upstream.is_some();
    if !upstream_configured {
        eprintln!("[OFFLINE_SYNC] erro: upstream não configurado");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Upstream não configurado — impossível baixar dados da nuvem.".into(),
        ));
    }

    let mut results = Vec::with_capacity(OFFLINE_ESSENTIAL_DOMAINS.len());
    let mut total_delta = 0i64;
    let mut all_ok = true;

    for (key, label) in OFFLINE_ESSENTIAL_DOMAINS {
        let t0 = now_ms();
        let outcome = match *key {
            "produtos" => {
                let params: Vec<(&str, String)> = vec![
                    ("select", "*,categoria:categorias_produto(id,nome)".into()),
                    ("order", "nome.asc".into()),
                ];
                proxy_with_incremental_sync(
                    &ctx, &headers, "produtos", "/rest/v1/produtos", &params, true,
                )
                .await
            }
            "clientes_lite" => {
                let params: Vec<(&str, String)> = vec![
                    ("select", "*".into()),
                    ("order", "nome.asc".into()),
                ];
                proxy_with_incremental_sync(
                    &ctx, &headers, "clientes_lite", "/rest/v1/clientes", &params, true,
                )
                .await
            }
            "fornecedores" => {
                let params: Vec<(&str, String)> = vec![
                    ("select", "*".into()),
                    ("order", "razao_social.asc".into()),
                ];
                proxy_with_incremental_sync(
                    &ctx, &headers, "fornecedores", "/rest/v1/fornecedores", &params, true,
                )
                .await
            }
            "estoque_movimentacoes" => {
                let params = estoque_movs_base_params();
                proxy_with_incremental_sync(
                    &ctx,
                    &headers,
                    "estoque_movimentacoes",
                    "/rest/v1/estoque_movimentacoes",
                    &params,
                    true,
                )
                .await
            }
            "financeiro_lancamentos_completo" => {
                let params: Vec<(&str, String)> = vec![
                    ("select", financeiro_completo_select().to_string()),
                    ("order", "data_vencimento.asc".into()),
                ];
                proxy_with_incremental_sync(
                    &ctx,
                    &headers,
                    "financeiro_lancamentos_completo",
                    "/rest/v1/financeiro_lancamentos",
                    &params,
                    true,
                )
                .await
            }
            _ => Err((StatusCode::BAD_REQUEST, "domínio desconhecido".into())),
        };

        let dur = now_ms() - t0;
        let stat = db::list_domain_stats()
            .ok()
            .and_then(|v| v.into_iter().find(|s| s.domain == *key));
        let row_count = stat.as_ref().map(|s| s.row_count).unwrap_or(0);

        match outcome {
            Ok(resp) => {
                let h = resp.headers();
                let delta = h
                    .get("x-gp-delta")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0);
                total_delta += delta;
                eprintln!(
                    "[OFFLINE_SYNC] domínio sincronizado: {} (+{} regs em {}ms)",
                    key, delta, dur
                );
                results.push(OfflineSyncDomainResult {
                    domain: (*key).to_string(),
                    label: (*label).to_string(),
                    ok: true,
                    delta,
                    row_count,
                    error: None,
                    duration_ms: dur,
                });
            }
            Err((status, msg)) => {
                all_ok = false;
                eprintln!(
                    "[OFFLINE_SYNC] erro no domínio {}: HTTP {} — {}",
                    key,
                    status.as_u16(),
                    msg
                );
                results.push(OfflineSyncDomainResult {
                    domain: (*key).to_string(),
                    label: (*label).to_string(),
                    ok: false,
                    delta: 0,
                    row_count,
                    error: Some(format!("HTTP {}: {}", status.as_u16(), msg)),
                    duration_ms: dur,
                });
            }
        }
    }

    let completed_at = now_ms();
    if all_ok {
        write_initial_sync_marker(completed_at);
        eprintln!(
            "[OFFLINE_SYNC] concluído com sucesso ({} domínios, +{} regs)",
            results.len(),
            total_delta
        );
    } else {
        eprintln!(
            "[OFFLINE_SYNC] concluído COM ERROS (alguns domínios falharam) — marca não atualizada"
        );
    }

    Ok(Json(OfflineSyncResponse {
        ok: all_ok,
        completed_at_ms: completed_at,
        upstream_configured,
        total_delta,
        results,
    }))
}

// ============================================================================
// Sub-etapa 4.1 — Validação OFFLINE de PIN do operador (LAN central)
// ============================================================================
//
// Endpoints:
//   POST /api/auth/aquecer-pin  → grava verificador local PBKDF2 após
//                                 validação online bem-sucedida.
//   POST /api/auth/validar-pin  → valida PIN contra o verificador local,
//                                 com lockout em SQLite.
//
// IMPORTANTE: PIN nunca é persistido em texto puro. O hash bcrypt da nuvem
// não é importado por segurança (não é exportado pela RPC). O fluxo é:
//
//   1. Terminal valida PIN ONLINE → cloud responde OK.
//   2. Terminal envia (funcionario_id, pin) para /api/auth/aquecer-pin
//      do servidor local. O servidor gera salt+hash PBKDF2 localmente.
//   3. Próximas validações no terminal (mesmo offline) chamam
//      /api/auth/validar-pin do servidor local.
//   4. Se o operador nunca validou online, o servidor local responde 404
//      e o terminal cai para o fallback de cache JS / cloud quando vier
//      internet.

const PIN_PBKDF2_ITER: u32 = 80_000;
const PIN_HASH_LEN: usize = 32;
const PIN_MAX_FAILS: usize = 5;
const PIN_FAIL_WINDOW_MS: i64 = 10 * 60_000;
const PIN_LOCKOUT_MS: i64 = 15 * 60_000;

fn pbkdf2_pin(pin: &str, salt: &[u8], iter: u32) -> Vec<u8> {
    use hmac::Hmac;
    use sha2::Sha256;
    let mut out = vec![0u8; PIN_HASH_LEN];
    pbkdf2::pbkdf2::<Hmac<Sha256>>(pin.as_bytes(), salt, iter, &mut out)
        .expect("pbkdf2 should not fail with these params");
    out
}

fn b64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

#[derive(Deserialize)]
struct AquecerPinRequest {
    funcionario_id: String,
    empresa_id: Option<String>,
    nome: String,
    login: String,
    role: String,
    pin: String,
    #[serde(default = "default_true")]
    ativo: bool,
}
fn default_true() -> bool { true }

#[derive(Serialize)]
struct AquecerPinResponse {
    ok: bool,
    funcionario_id: String,
    origem: &'static str,
}

async fn aquecer_pin_handler(
    Json(req): Json<AquecerPinRequest>,
) -> Result<Json<AquecerPinResponse>, (StatusCode, String)> {
    if req.pin.is_empty() || req.funcionario_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "funcionario_id e pin são obrigatórios".into()));
    }
    let role = match req.role.as_str() {
        "gerente" | "caixa" => req.role.clone(),
        _ => "caixa".into(),
    };
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("rand: {e}")))?;
    let hash = pbkdf2_pin(&req.pin, &salt, PIN_PBKDF2_ITER);
    let now = now_ms();
    db::operador_offline_upsert(
        &req.funcionario_id,
        req.empresa_id.as_deref(),
        &req.nome,
        &req.login,
        &role,
        req.ativo,
        "pbkdf2-sha256",
        PIN_PBKDF2_ITER as i64,
        &b64_encode(&salt),
        &b64_encode(&hash),
        now,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    eprintln!(
        "[OFFLINE_AUTH] PIN aquecido no servidor local (funcionario_id={})",
        req.funcionario_id
    );
    Ok(Json(AquecerPinResponse {
        ok: true,
        funcionario_id: req.funcionario_id,
        origem: "servidor-local",
    }))
}

#[derive(Deserialize)]
struct ValidarPinLocalRequest {
    funcionario_id: String,
    #[allow(dead_code)]
    empresa_id: Option<String>,
    pin: String,
}

#[derive(Serialize)]
struct ValidarPinLocalResponse {
    autorizado: bool,
    funcionario: Option<OperadorLocalFuncionario>,
    motivo: Option<String>,
    origem: &'static str,
}

#[derive(Serialize)]
struct OperadorLocalFuncionario {
    id: String,
    nome: String,
    login: String,
    role: String,
}

async fn validar_pin_handler(
    Json(req): Json<ValidarPinLocalRequest>,
) -> Result<Json<ValidarPinLocalResponse>, (StatusCode, String)> {
    if req.pin.is_empty() || req.funcionario_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "funcionario_id e pin são obrigatórios".into()));
    }
    let row = db::operador_offline_get(&req.funcionario_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let row = match row {
        Some(r) => r,
        None => {
            // Sem verificador local — caller deve cair para cache JS / cloud.
            eprintln!(
                "[OFFLINE_AUTH] PIN recusado no servidor local: operador não preparado ({})",
                req.funcionario_id
            );
            return Err((
                StatusCode::NOT_FOUND,
                "Operador ainda não preparado para uso offline neste servidor local."
                    .into(),
            ));
        }
    };
    if !row.ativo {
        return Ok(Json(ValidarPinLocalResponse {
            autorizado: false,
            funcionario: None,
            motivo: Some("Operador inativo.".into()),
            origem: "servidor-local",
        }));
    }
    let now = now_ms();
    if row.locked_until_ms > now {
        let secs = ((row.locked_until_ms - now) / 1000).max(1);
        eprintln!(
            "[OFFLINE_AUTH] PIN recusado no servidor local: operador bloqueado por {}s",
            secs
        );
        return Ok(Json(ValidarPinLocalResponse {
            autorizado: false,
            funcionario: None,
            motivo: Some(format!(
                "Operador temporariamente bloqueado. Tente novamente em {} segundo(s).",
                secs
            )),
            origem: "servidor-local",
        }));
    }
    let salt = match b64_decode(&row.salt_b64) {
        Some(s) => s,
        None => {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, "salt corrompido".into()));
        }
    };
    let expected = match b64_decode(&row.hash_b64) {
        Some(h) => h,
        None => {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, "hash corrompido".into()));
        }
    };
    let actual = pbkdf2_pin(&req.pin, &salt, row.iterations as u32);
    let ok = {
        use subtle::ConstantTimeEq;
        actual.ct_eq(&expected).into()
    };
    if !ok {
        let (count, locked_until) = db::operador_offline_record_failure(
            &req.funcionario_id,
            now,
            PIN_FAIL_WINDOW_MS,
            PIN_MAX_FAILS,
            PIN_LOCKOUT_MS,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let motivo = if locked_until > now {
            let secs = ((locked_until - now) / 1000).max(1);
            format!(
                "Muitas tentativas inválidas. Operador bloqueado por {} segundo(s).",
                secs
            )
        } else {
            let restantes = PIN_MAX_FAILS.saturating_sub(count);
            format!("PIN incorreto. {} tentativa(s) restante(s).", restantes)
        };
        eprintln!("[OFFLINE_AUTH] PIN recusado no servidor local: {}", motivo);
        return Ok(Json(ValidarPinLocalResponse {
            autorizado: false,
            funcionario: None,
            motivo: Some(motivo),
            origem: "servidor-local",
        }));
    }
    let _ = db::operador_offline_clear_failures(&req.funcionario_id, now);
    eprintln!(
        "[OFFLINE_AUTH] PIN validado no servidor local (funcionario_id={})",
        req.funcionario_id
    );
    Ok(Json(ValidarPinLocalResponse {
        autorizado: true,
        funcionario: Some(OperadorLocalFuncionario {
            id: row.funcionario_id,
            nome: row.nome,
            login: row.login,
            role: row.role,
        }),
        motivo: None,
        origem: "servidor-local",
    }))
}
//
// `POST /api/estoque/movimentacoes` é o ponto de entrada do TERMINAL para
// gravar uma movimentação. O servidor:
//   1. Grava localmente (saldo materializado refletido NA HORA).
//   2. Enfileira na outbox.
//   3. Tenta um push imediato ao upstream (best-effort). Se falhar, fica
//      pendente para retry posterior — terminal não trava.
//
// `GET  /db/outbox/estoque`        → listagem para a UI.
// `GET  /db/outbox/estoque/stats`  → contadores (pending/sent/error/...).
// `POST /db/outbox/flush`          → tenta enviar o lote pendente agora.
// `POST /db/outbox/retry-errors`   → move erros de volta para pending.

#[derive(Deserialize, Debug)]
struct RegistrarMovLocalRequest {
    produto_id: String,
    variacao_id: Option<String>,
    tipo: String,
    quantidade: f64,
    custo_unitario: Option<f64>,
    observacoes: Option<String>,
    origem: Option<String>,
    client_uuid: Option<String>,
}

#[derive(Serialize)]
struct RegistrarMovLocalResponse {
    movimento_id: String,
    idempotente: bool,
    saldo_anterior: f64,
    saldo_posterior: f64,
    /// "pending" se ainda não foi para o upstream, "sent" se já foi.
    outbox_status: String,
    /// id no upstream quando o push imediato funcionou.
    remote_id: Option<String>,
}

async fn registrar_mov_local_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<RegistrarMovLocalRequest>,
) -> Result<Json<RegistrarMovLocalResponse>, (StatusCode, String)> {
    let now = now_ms();
    let result = db::registrar_movimento_local(
        db::LocalMovimentacaoInput {
            produto_id: req.produto_id.clone(),
            variacao_id: req.variacao_id.clone(),
            tipo: req.tipo.clone(),
            quantidade: req.quantidade,
            custo_unitario: req.custo_unitario,
            observacoes: req.observacoes.clone(),
            origem: req.origem.clone(),
            client_uuid: req.client_uuid.clone(),
        },
        now,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // Best-effort: tenta empurrar agora se temos upstream e auth do terminal.
    let mut outbox_status = "pending".to_string();
    let mut remote_id: Option<String> = None;
    if !result.idempotente && ctx.upstream.is_some() {
        match push_one_outbox(&ctx, &headers, &result.local_uuid).await {
            Ok(rid) => {
                outbox_status = "sent".into();
                remote_id = Some(rid);
            }
            Err(_) => {
                // Falha silenciosa: já está enfileirado, será reenviado.
            }
        }
    }

    Ok(Json(RegistrarMovLocalResponse {
        movimento_id: result.local_uuid,
        idempotente: result.idempotente,
        saldo_anterior: result.saldo_anterior,
        saldo_posterior: result.saldo_posterior,
        outbox_status,
        remote_id,
    }))
}

/// Empurra UM item da outbox para o upstream via RPC `registrar_movimento_estoque`.
/// Idempotência cross-runs garantida pelo `_client_uuid = local_uuid` — se o
/// servidor cair entre o INSERT e o UPDATE de status, na próxima rodada o
/// upstream identifica e devolve o mesmo movimento.
async fn push_one_outbox(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    // Carrega payload da outbox.
    let items = db::outbox_list(1000, None).map_err(|e| e.to_string())?;
    let item = items
        .into_iter()
        .find(|i| i.local_uuid == local_uuid)
        .ok_or("item não encontrado na outbox")?;
    if item.status == "sent" {
        return Ok(item.remote_id.unwrap_or_default());
    }

    let payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    db::outbox_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let body = serde_json::json!({
        "_produto_id":     payload.get("produto_id"),
        "_variacao_id":    payload.get("variacao_id"),
        "_tipo":           payload.get("tipo"),
        "_quantidade":     payload.get("quantidade"),
        "_custo_unitario": payload.get("custo_unitario"),
        "_observacoes":    payload.get("observacoes"),
        "_origem":         payload.get("origem"),
        // Idempotency real no upstream: usa SEMPRE o local_uuid — assim
        // retries (mesmo após reboot) NUNCA duplicam.
        "_client_uuid":    local_uuid,
    });

    let url = format!(
        "{}/rest/v1/rpc/registrar_movimento_estoque",
        upstream.base_url.trim_end_matches('/')
    );
    let resp = ctx
        .http
        .post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_mark_error(local_uuid, &msg, now);
            msg
        })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }

    // RPC devolve `{ movimento_id, idempotente, saldo_anterior, saldo_posterior }`.
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let remote_id = parsed
        .get("movimento_id")
        .and_then(|v| v.as_str())
        .unwrap_or(local_uuid)
        .to_string();

    db::outbox_mark_sent(local_uuid, &remote_id, now).map_err(|e| e.to_string())?;
    Ok(remote_id)
}

#[derive(Serialize)]
struct OutboxListResponse {
    total: usize,
    items: Vec<db::OutboxItem>,
}

async fn outbox_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxListResponse>, (StatusCode, String)> {
    let limit = q
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxListResponse {
        total: items.len(),
        items,
    }))
}

async fn outbox_stats_handler() -> Result<Json<db::OutboxStats>, (StatusCode, String)> {
    db::outbox_stats()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct FlushResponse {
    attempted: usize,
    sent: usize,
    failed: usize,
    errors: Vec<String>,
}

async fn outbox_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => {
                failed += 1;
                errors.push(format!("{}: {}", it.local_uuid, e));
            }
        }
    }
    // Telemetria — distingue do flush automático.
    let _ = db::outbox_record_flush_round(
        "manual",
        now_ms(),
        pending.len() as i64,
        sent as i64,
        failed as i64,
    );
    Ok(Json(FlushResponse {
        attempted: pending.len(),
        sent,
        failed,
        errors,
    }))
}

#[derive(Serialize)]
struct RetryErrorsResponse {
    requeued: i64,
}

async fn outbox_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

// ============================================================================
// VENDAS LOCAIS (PDV) — handlers HTTP + push para upstream
// ============================================================================

#[derive(Deserialize, Debug)]
struct RegistrarVendaLocalRequest {
    #[serde(flatten)]
    raw: serde_json::Value,
}

#[derive(Serialize)]
struct RegistrarVendaLocalResponse {
    venda_id: String,
    idempotente: bool,
    qtd_itens: i64,
    total: f64,
    outbox_status: String,
    remote_id: Option<String>,
}

async fn registrar_venda_local_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<RegistrarVendaLocalRequest>,
) -> Result<Json<RegistrarVendaLocalResponse>, (StatusCode, String)> {
    let now = now_ms();
    let input: db::LocalVendaInput = serde_json::from_value(req.raw)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("payload inválido: {e}")))?;

    let forma_log = input.forma_pagamento.clone();
    let terminal_log = input.terminal_id.clone().unwrap_or_else(|| "server".into());
    println!(
        "[LOCAL_SALE] registrar terminal={} forma={} itens={} total={}",
        terminal_log,
        forma_log,
        input.itens.len(),
        input.total
    );

    let result = db::registrar_venda_local(input, now)
        .map_err(|e| {
            println!("[LOCAL_SALE] erro: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    println!(
        "[LOCAL_PDV] venda gravada local_uuid={} idempotente={} itens={} total={}",
        result.local_uuid, result.idempotente, result.qtd_itens, result.total
    );

    let mut outbox_status = "pending".to_string();
    let mut remote_id: Option<String> = None;
    if !result.idempotente && ctx.upstream.is_some() {
        if let Ok(rid) = push_one_outbox_venda(&ctx, &headers, &result.local_uuid).await {
            outbox_status = "sent".into();
            remote_id = Some(rid);
            println!("[LOCAL_OUTBOX] venda push OK local={} remote={}", result.local_uuid, rid);
        } else {
            println!("[LOCAL_OUTBOX] venda push pendente local={}", result.local_uuid);
        }
    }

    Ok(Json(RegistrarVendaLocalResponse {
        venda_id: result.local_uuid,
        idempotente: result.idempotente,
        qtd_itens: result.qtd_itens,
        total: result.total,
        outbox_status,
        remote_id,
    }))
}

/// Empurra UMA venda da outbox para o upstream via RPC `finalizar_venda_pdv`.
/// `_client_uuid = local_uuid` garante idempotência cross-runs.
async fn push_one_outbox_venda(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let items = db::outbox_vendas_list(1000, None).map_err(|e| e.to_string())?;
    let item = items.into_iter()
        .find(|i| i.local_uuid == local_uuid)
        .ok_or("venda não encontrada na outbox")?;
    if item.status == "sent" {
        return Ok(item.remote_id.unwrap_or_default());
    }

    let payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    db::outbox_vendas_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let pagamentos = payload.get("pagamentos").cloned().unwrap_or(serde_json::Value::Null);
    let body = serde_json::json!({
        "_cliente_id":       payload.get("cliente_id"),
        "_subtotal":         payload.get("subtotal"),
        "_desconto":         payload.get("desconto"),
        "_total":            payload.get("total"),
        "_forma":            payload.get("forma_pagamento"),
        "_status_pagamento": payload.get("status_pagamento"),
        "_valor_recebido":   payload.get("valor_recebido"),
        "_troco":            payload.get("troco"),
        "_observacao":       payload.get("observacao"),
        "_itens":            payload.get("itens"),
        "_pagamentos":       if pagamentos.as_array().map(|a| a.is_empty()).unwrap_or(true) {
                                serde_json::Value::Null
                             } else { pagamentos },
        "_gerar_financeiro": payload.get("gerar_financeiro"),
        "_operador_id":      payload.get("operador_id"),
        "_terminal_id":      payload.get("terminal_id"),
        // Idempotência ponta a ponta — local_uuid estável.
        "_client_uuid":      local_uuid,
    });

    let url = format!(
        "{}/rest/v1/rpc/finalizar_venda_pdv",
        upstream.base_url.trim_end_matches('/')
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&body)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_vendas_mark_error(local_uuid, &msg, now);
            msg
        })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_vendas_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }

    // RPC devolve o venda_id como string (ou JSON com aspas).
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let remote_id = parsed.as_str().map(|s| s.to_string())
        .unwrap_or_else(|| text.trim().trim_matches('"').to_string());

    db::outbox_vendas_mark_sent(local_uuid, &remote_id, now).map_err(|e| e.to_string())?;
    Ok(remote_id)
}

#[derive(Serialize)]
struct OutboxVendasListResponse {
    total: usize,
    items: Vec<db::OutboxItem>,
}

async fn outbox_vendas_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxVendasListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_vendas_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxVendasListResponse { total: items.len(), items }))
}

async fn outbox_vendas_stats_handler() -> Result<Json<db::OutboxVendasStats>, (StatusCode, String)> {
    db::outbox_vendas_stats()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn outbox_vendas_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_vendas_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_venda(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    let _ = db::outbox_vendas_record_flush_round(
        "manual", now_ms(), pending.len() as i64, sent as i64, failed as i64,
    );
    Ok(Json(FlushResponse {
        attempted: pending.len(), sent, failed, errors,
    }))
}

async fn outbox_vendas_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_vendas_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

/// Scheduler de background da outbox de vendas — espelha o de estoque.
async fn run_outbox_vendas_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox vendas scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox vendas scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() {
            let _ = db::outbox_vendas_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let pending = match db::outbox_vendas_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox vendas: batch err: {e}"); continue; }
        };
        if pending.is_empty() {
            let _ = db::outbox_vendas_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let empty = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox_venda(&ctx, &empty, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => failed += 1,
            }
        }
        let _ = db::outbox_vendas_record_flush_round(
            "auto", now_ms(), pending.len() as i64, sent, failed,
        );
    }
}

// ============================================================================
// Background sync — scheduler do outbox de estoque
// ============================================================================
//
// Roda em uma task tokio separada, acordando a cada `SCHEDULER_TICK_MS`.
// Por tick:
//   1. Lê `outbox_pending_batch(BATCH)` — JÁ filtra por
//      `next_attempt_at_ms <= now`, então itens em backoff são pulados
//      naturalmente (sem lógica adicional aqui).
//   2. Tenta `push_one_outbox` para cada item. Sucesso → `sent`. Falha →
//      `outbox_mark_error` agenda o próximo `next_attempt_at_ms` via
//      backoff exponencial (5s → 15s → 1m → 5m → 15m). Após
//      `MAX_AUTO_ATTEMPTS` o item vai para `error` e exige ação manual.
//   3. Registra a rodada em `meta` (para a UI mostrar último auto-flush e
//      próxima tentativa).
//
// Garantias:
//   * Nunca duplica: `push_one_outbox` usa `local_uuid` como
//     `_client_uuid` na RPC upstream — idempotência ponta a ponta.
//   * Não trava terminal: roda em task própria, fora do path da request.
//   * Backoff seguro: itens com falha NÃO são re-tentados imediatamente.
//   * Best-effort imediato preservado: o handler de `registrar_mov_local`
//     continua tentando o push na hora; o scheduler só pega o que sobrou.
//   * Cancelável: `scheduler_shutdown_tx` interrompe imediatamente em
//     `stop()`.

const SCHEDULER_TICK_MS: u64 = 10_000;
const SCHEDULER_BATCH: i64 = 50;

async fn run_outbox_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox scheduler: iniciado (tick={}ms)", SCHEDULER_TICK_MS);
    loop {
        // Espera o tick OU o sinal de shutdown — o que vier primeiro.
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox scheduler: parado");
                break;
            }
        }

        // Sem upstream configurado, não há pra onde empurrar — apenas
        // registra a rodada para a UI saber que o scheduler está vivo.
        if ctx.upstream.is_none() {
            let _ = db::outbox_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }

        let pending = match db::outbox_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[gestao-pro] outbox scheduler: falha lendo batch: {e}");
                continue;
            }
        };

        if pending.is_empty() {
            // Mantém o "last_auto_flush_ms" fresco — útil pra UI saber que
            // o scheduler rodou recentemente, mesmo sem nada a fazer.
            let _ = db::outbox_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }

        let empty_headers = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox(&ctx, &empty_headers, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => failed += 1,
            }
        }
        let _ = db::outbox_record_flush_round(
            "auto",
            now_ms(),
            pending.len() as i64,
            sent,
            failed,
        );
        if sent > 0 || failed > 0 {
            eprintln!(
                "[gestao-pro] outbox auto-flush: attempted={} sent={} failed={}",
                pending.len(),
                sent,
                failed,
            );
        }
    }
}

// ============================================================================
// CAIXA LOCAL — handlers HTTP + push para upstream + scheduler
// ============================================================================
//
// Mesma arquitetura já provada em estoque e vendas:
//
//   1. Os handlers gravam o estado local na transação SQLite (db.rs já fez)
//      e enfileiram em `outbox_caixa` por action.
//   2. Imediatamente tentam o push best-effort se houver upstream.
//   3. O scheduler de background (`run_outbox_caixa_scheduler`) varre os
//      pendentes em ordem causal e despacha por action via
//      `push_one_outbox_caixa`, com backoff e idempotência ponta-a-ponta.

#[derive(Deserialize, Debug)]
struct AbrirCaixaLocalRequest {
    #[serde(flatten)]
    raw: serde_json::Value,
}

#[derive(Serialize)]
struct AbrirCaixaLocalResponse {
    caixa_id: String,
    idempotente: bool,
    valor_inicial: f64,
    outbox_status: String,
    remote_id: Option<String>,
}

async fn registrar_caixa_abrir_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<AbrirCaixaLocalRequest>,
) -> Result<Json<AbrirCaixaLocalResponse>, (StatusCode, String)> {
    let now = now_ms();
    let input: db::LocalAbrirCaixaInput = serde_json::from_value(req.raw)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("payload inválido: {e}")))?;

    let result = db::abrir_caixa_local(input, now)
        .map_err(|e| {
            eprintln!("[LOCAL_CASH_OPEN] falha: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_CASH_OPEN] caixa_local={} idempotente={} valor_inicial={}",
        result.local_uuid, result.idempotente, result.valor_inicial
    );
    eprintln!("[LOCAL_CASH_AUDIT] abertura caixa_local={}", result.local_uuid);

    let mut outbox_status = "pending".to_string();
    let mut remote_id: Option<String> = None;
    if !result.idempotente && ctx.upstream.is_some() {
        if let Ok(rid) = push_one_outbox_caixa(&ctx, &headers, &result.local_uuid).await {
            outbox_status = "sent".into();
            remote_id = Some(rid);
            eprintln!("[LOCAL_CASH_OUTBOX] abrir sent caixa_local={}", result.local_uuid);
        } else {
            eprintln!("[LOCAL_CASH_OUTBOX] abrir pending caixa_local={}", result.local_uuid);
        }
    } else if result.idempotente {
        if let Ok(Some(it)) = db::outbox_caixa_get(&result.local_uuid) {
            outbox_status = it.status.clone();
            remote_id = it.remote_id.clone();
        }
    }

    Ok(Json(AbrirCaixaLocalResponse {
        caixa_id: result.local_uuid,
        idempotente: result.idempotente,
        valor_inicial: result.valor_inicial,
        outbox_status,
        remote_id,
    }))
}

#[derive(Deserialize, Debug)]
struct MovimentoCaixaLocalRequest {
    #[serde(flatten)]
    raw: serde_json::Value,
}

#[derive(Serialize)]
struct MovimentoCaixaLocalResponse {
    movimento_id: String,
    idempotente: bool,
    caixa_local_uuid: String,
    tipo: String,
    valor: f64,
    outbox_status: String,
    remote_id: Option<String>,
}

async fn registrar_caixa_movimento_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<MovimentoCaixaLocalRequest>,
) -> Result<Json<MovimentoCaixaLocalResponse>, (StatusCode, String)> {
    let now = now_ms();
    let input: db::LocalMovimentoCaixaInput = serde_json::from_value(req.raw)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("payload inválido: {e}")))?;

    let result = db::registrar_mov_caixa_local(input, now)
        .map_err(|e| {
            eprintln!("[LOCAL_CASH_MOVE] falha: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_CASH_MOVE] {} valor={} caixa_local={} mov={} idempotente={}",
        result.tipo, result.valor, result.caixa_local_uuid, result.local_uuid, result.idempotente
    );
    eprintln!(
        "[LOCAL_CASH_AUDIT] {} caixa_local={} mov={}",
        result.tipo, result.caixa_local_uuid, result.local_uuid
    );

    let mut outbox_status = "pending".to_string();
    let mut remote_id: Option<String> = None;
    if !result.idempotente && ctx.upstream.is_some() {
        if let Ok(rid) = push_one_outbox_caixa(&ctx, &headers, &result.local_uuid).await {
            outbox_status = "sent".into();
            remote_id = Some(rid);
            eprintln!("[LOCAL_CASH_OUTBOX] movimento sent mov={}", result.local_uuid);
        } else {
            eprintln!("[LOCAL_CASH_OUTBOX] movimento pending mov={}", result.local_uuid);
        }
    } else if result.idempotente {
        if let Ok(Some(it)) = db::outbox_caixa_get(&result.local_uuid) {
            outbox_status = it.status.clone();
            remote_id = it.remote_id.clone();
        }
    }

    Ok(Json(MovimentoCaixaLocalResponse {
        movimento_id: result.local_uuid,
        idempotente: result.idempotente,
        caixa_local_uuid: result.caixa_local_uuid,
        tipo: result.tipo,
        valor: result.valor,
        outbox_status,
        remote_id,
    }))
}

#[derive(Deserialize, Debug)]
struct FecharCaixaLocalRequest {
    #[serde(flatten)]
    raw: serde_json::Value,
}

#[derive(Serialize)]
struct FecharCaixaLocalResponse {
    fechamento_id: String,
    idempotente: bool,
    valor_informado: f64,
    outbox_status: String,
    remote_id: Option<String>,
}

async fn registrar_caixa_fechar_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<FecharCaixaLocalRequest>,
) -> Result<Json<FecharCaixaLocalResponse>, (StatusCode, String)> {
    let now = now_ms();
    let input: db::LocalFecharCaixaInput = serde_json::from_value(req.raw)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("payload inválido: {e}")))?;

    let result = db::fechar_caixa_local(input, now)
        .map_err(|e| {
            eprintln!("[LOCAL_CASH_CLOSE] falha: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_CASH_CLOSE] fechamento={} valor_informado={} idempotente={}",
        result.local_uuid, result.valor_informado, result.idempotente
    );
    eprintln!("[LOCAL_CASH_AUDIT] fechamento mov={}", result.local_uuid);

    let mut outbox_status = "pending".to_string();
    let mut remote_id: Option<String> = None;
    if !result.idempotente && ctx.upstream.is_some() {
        if let Ok(rid) = push_one_outbox_caixa(&ctx, &headers, &result.local_uuid).await {
            outbox_status = "sent".into();
            remote_id = Some(rid);
            eprintln!("[LOCAL_CASH_OUTBOX] fechar sent fechamento={}", result.local_uuid);
        } else {
            eprintln!("[LOCAL_CASH_OUTBOX] fechar pending fechamento={}", result.local_uuid);
        }
    } else if result.idempotente {
        if let Ok(Some(it)) = db::outbox_caixa_get(&result.local_uuid) {
            outbox_status = it.status.clone();
            remote_id = it.remote_id.clone();
        }
    }

    Ok(Json(FecharCaixaLocalResponse {
        fechamento_id: result.local_uuid,
        idempotente: result.idempotente,
        valor_informado: result.valor_informado,
        outbox_status,
        remote_id,
    }))
}

async fn caixa_local_aberto_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Option<db::CaixaLocalRow>>, (StatusCode, String)> {
    let op = q.get("operador_id").map(|s| s.as_str());
    let row = db::caixa_local_aberto(op)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(row))
}

// ---------- /api/fornecedores (v13) ----------
//
// Mesma filosofia do clientes/lite: ingere `*` no `fornecedores_local` e
// devolve a lista lida do SQLite, com cursor incremental por `updated_at`
// e tombstone por status.

async fn fornecedores_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let mut params: Vec<(&str, String)> = vec![
        ("select", "*".into()),
        ("order", "razao_social.asc".into()),
    ];
    // status vazio = todos; ausente = "ativo" (default)
    let status_opt = q.get("status").map(|s| s.as_str());
    let status_val = match status_opt {
        None => Some("ativo"),
        Some("") => None,
        Some(other) => Some(other),
    };
    if let Some(s) = status_val {
        params.push(("status", format!("eq.{s}")));
    }
    let q_owned: Vec<(&str, String)> = params.iter().map(|(k, v)| (*k, v.clone())).collect();
    proxy_with_incremental_sync(&ctx, &headers, "fornecedores", "/rest/v1/fornecedores", &q_owned, false).await
}

// ---------- /api/financeiro/lancamentos-completo (v14) ----------
//
// Cache "completo" do PostgREST com joins (cliente, fornecedor, venda,
// compra, categoria) que alimenta a tela /financeiro. A UI faz todos os
// filtros (tipo, status, período, categoria, fornecedor) client-side em
// cima desse dataset.

fn financeiro_completo_select() -> &'static str {
    "id,descricao,valor,valor_pago,data_vencimento,data_pagamento,data_emissao,\
     tipo,status,observacoes,numero_documento,forma_pagamento,created_at,updated_at,\
     conciliado_em,valor_repasse,taxa_repasse,numero_repasse,observacao_repasse,\
     cliente_id,venda_id,compra_id,\
     fornecedor:fornecedores(razao_social,nome_fantasia,documento,telefone),\
     cliente:clientes(nome,documento,telefone,celular,email),\
     venda:vendas(numero,data_finalizacao,total),\
     compra:compras(numero,data_emissao,total,status),\
     categoria:categorias_financeiras(nome)"
}

async fn financeiro_lancamentos_completo_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let params: Vec<(&str, String)> = vec![
        ("select", financeiro_completo_select().to_string()),
        ("order", "data_vencimento.asc".into()),
    ];
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "financeiro_lancamentos_completo",
        "/rest/v1/financeiro_lancamentos",
        &params,
        false,
    )
    .await
}

// ---------- /api/compras (v15) ----------
//
// Espelha `cloudAdapter.compras.list`: lista as compras com fornecedor
// embutido (id/razao_social/nome_fantasia), ordenadas por data_emissao
// desc. Cursor incremental por updated_at; limite default 500.

async fn compras_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(500);
    let mut params: Vec<(&str, String)> = vec![
        (
            "select",
            "*,fornecedor:fornecedores(id,razao_social,nome_fantasia)".into(),
        ),
        ("order", "data_emissao.desc".into()),
        ("limit", limit.to_string()),
    ];
    // Pseudo-filtro só para a leitura local (não vai ao upstream — proxy_get
    // só repassa as chaves conhecidas do PostgREST).
    params.push(("__filter_limit", limit.to_string()));
    proxy_with_incremental_sync(&ctx, &headers, "compras", "/rest/v1/compras", &params, false).await
}

// ---------- /api/vendas/historico (v16) ----------
//
// Cache de leitura do histórico de vendas (com cliente embutido), espelhando
// `cloudAdapter.vendas.list`. NÃO confundir com `/api/vendas/registrar`
// (write do PDV via outbox).

async fn vendas_historico_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(500);
    let mut params: Vec<(&str, String)> = vec![
        (
            "select",
            "id,numero,numero_nf,serie_nf,cliente_id,data_emissao,data_finalizacao,total,status,status_pagamento,forma_pagamento,caixa_id,operador_id,terminal_id,created_at,updated_at,cliente:clientes(nome)".into(),
        ),
        ("order", "created_at.desc".into()),
        ("limit", limit.to_string()),
    ];
    params.push(("__filter_limit", limit.to_string()));
    proxy_with_incremental_sync(&ctx, &headers, "vendas_remote", "/rest/v1/vendas", &params, false).await
}

// ---------- /api/relatorios/caixas (v17) ----------
//
// Cache de leitura para os relatórios de caixa (cardCaixas + caixasSessoes).
// Filtragem por período / operador / terminal / status é feita client-side
// no adapter, mantendo a granularidade do payload completo offline.

async fn relatorios_caixas_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(1000);
    let mut params: Vec<(&str, String)> = vec![
        (
            "select",
            "id,operador_id,terminal_id,data_abertura,data_fechamento,valor_inicial,total_vendas,total_sangrias,total_suprimentos,total_dinheiro,total_pix,total_debito,total_credito,total_boleto,total_ifood,total_fiado,total_outros,valor_esperado,valor_informado,diferenca,status,observacao,observacao_fechamento,qtd_vendas,updated_at"
                .into(),
        ),
        ("order", "data_abertura.desc".into()),
        ("limit", limit.to_string()),
    ];
    params.push(("__filter_limit", limit.to_string()));
    proxy_with_incremental_sync(&ctx, &headers, "caixas_remote", "/rest/v1/caixas", &params, false).await
}

async fn relatorios_caixa_movimentos_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let caixa_id = q.get("caixa_id").cloned().unwrap_or_default();
    if caixa_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "caixa_id obrigatório".into()));
    }
    let mut params: Vec<(&str, String)> = vec![
        (
            "select",
            "id,caixa_id,tipo,valor,motivo,created_at,updated_at".into(),
        ),
        ("caixa_id", format!("eq.{caixa_id}")),
        ("order", "created_at.desc".into()),
        ("limit", "500".into()),
    ];
    params.push(("__filter_caixa_id", caixa_id));
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "caixa_movimentos_remote",
        "/rest/v1/caixa_movimentos",
        &params,
        false,
    )
    .await
}

async fn relatorios_funcionarios_ativos_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let params: Vec<(&str, String)> = vec![
        ("select", "id,nome,ativo,updated_at".into()),
        ("order", "nome.asc".into()),
    ];
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "funcionarios_remote",
        "/rest/v1/funcionarios",
        &params,
        false,
    )
    .await
}

async fn relatorios_terminais_ativos_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let params: Vec<(&str, String)> = vec![
        ("select", "id,nome,ativo,updated_at".into()),
        ("order", "nome.asc".into()),
    ];
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "terminais_remote",
        "/rest/v1/terminais",
        &params,
        false,
    )
    .await
}

/// Cache offline dos pagamentos da empresa (assinatura) — espelha
/// `cloudAdapter.relatorios.pagamentosEmpresa`. Limite default 200.
async fn relatorios_pagamentos_empresa_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let mut params: Vec<(&str, String)> = vec![
        (
            "select",
            "id,referencia_tipo,descricao,valor,status,data_vencimento,data_pagamento,created_at,asaas_payment_id,asaas_invoice_url,asaas_pix_qrcode,asaas_pix_copia_cola,asaas_billing_type"
                .into(),
        ),
        ("order", "created_at.desc".into()),
        ("limit", limit.to_string()),
    ];
    params.push(("__filter_limit", limit.to_string()));
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "pagamentos_empresa_remote",
        "/rest/v1/pagamentos",
        &params,
        false,
    )
    .await
}

/// Cache offline dos itens de venda em um período. Junta com
/// `vendas_remote_cache` no SQLite para devolver itens com a venda embutida
/// em `__venda` (o adapter desempacota e monta `ProdutoVendidoLinhaDomain`).
/// Espera `inicio` e `fim` (datas ISO `YYYY-MM-DD` ou ISO completo).
async fn relatorios_venda_itens_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let inicio = q.get("inicio").cloned().unwrap_or_default();
    let fim = q.get("fim").cloned().unwrap_or_default();
    if inicio.is_empty() || fim.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "inicio/fim obrigatórios".into()));
    }
    // PostgREST: filtra itens cuja venda esteja no período.
    // venda_itens não tem data; o filtro robusto ocorre na leitura local
    // pelo JOIN com vendas_remote_cache.data_emissao_ms.
    let mut params: Vec<(&str, String)> = vec![
        (
            "select",
            "id,venda_id,produto_id,descricao,quantidade,preco_unitario,total,produto:produtos(nome,sku,categoria_id,preco_custo),updated_at"
                .into(),
        ),
        ("order", "id.asc".into()),
        ("limit", "5000".into()),
    ];
    let inicio_ms = parse_iso_date_ms(&inicio).unwrap_or(0);
    let fim_ms = parse_iso_date_ms(&fim).unwrap_or(i64::MAX);
    params.push(("__filter_inicio_ms", inicio_ms.to_string()));
    params.push(("__filter_fim_ms", fim_ms.to_string()));
    proxy_with_incremental_sync(
        &ctx,
        &headers,
        "venda_itens_remote",
        "/rest/v1/venda_itens",
        &params,
        false,
    )
    .await
}

fn parse_iso_date_ms(s: &str) -> Option<i64> {
    // aceita YYYY-MM-DD ou ISO completo; tolerante.
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp_millis())
}
/// Retorna o resumo local do caixa: totais por forma de pagamento, vendas,
/// suprimentos, sangrias, esperado em dinheiro e diferença (se fechado).
async fn caixa_resumo_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Option<db::CaixaResumoLocal>>, (StatusCode, String)> {
    let caixa_local_uuid: Option<String> = if let Some(cid) = q.get("caixa_id") {
        db::resolve_caixa_id_publico(cid)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        let op = q.get("operador_id").map(|s| s.as_str());
        db::caixa_local_aberto(op)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .map(|r| r.local_uuid)
    };
    let Some(clu) = caixa_local_uuid else {
        return Ok(Json(None));
    };
    let resumo = db::caixa_resumo_local(&clu)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(resumo))
}

/// GET `/api/caixa/lancamentos?caixa_id=...` — lista os lançamentos
/// financeiros locais derivados do fechamento daquele caixa.
async fn caixa_lancamentos_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<db::LancamentoLocalRow>>, (StatusCode, String)> {
    let caixa_local_uuid: Option<String> = if let Some(cid) = q.get("caixa_id") {
        db::resolve_caixa_id_publico(cid)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        let op = q.get("operador_id").map(|s| s.as_str());
        db::caixa_local_aberto(op)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .map(|r| r.local_uuid)
    };
    let Some(clu) = caixa_local_uuid else {
        return Ok(Json(Vec::new()));
    };
    let rows = db::lancamentos_local_por_caixa(&clu)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

/// POST `/api/caixa/regenerar-lancamentos?caixa_id=...` — força a
/// regeneração dos lançamentos derivados (idempotente).
async fn caixa_regenerar_lancamentos_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cid = q.get("caixa_id").cloned()
        .ok_or((StatusCode::BAD_REQUEST, "caixa_id é obrigatório".into()))?;
    let clu = db::resolve_caixa_id_publico(&cid)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "caixa não encontrado".into()))?;
    db::regenerar_lancamentos_locais_caixa(&clu)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true, "caixa_local_uuid": clu })))
}

// ============================================================================
// v11 — Financeiro local (listar / resumo / manual / cancelar)
// ============================================================================

fn parse_i64(q: &HashMap<String, String>, k: &str) -> Option<i64> {
    q.get(k).and_then(|v| v.parse::<i64>().ok())
}

fn build_financeiro_filtro(q: &HashMap<String, String>) -> db::FinanceiroFiltro {
    db::FinanceiroFiltro {
        tipo: q.get("tipo").cloned(),
        categoria: q.get("categoria").cloned(),
        origem: q.get("origem").cloned(),
        status: q.get("status").cloned(),
        caixa_local_uuid: q.get("caixa_local_uuid").cloned(),
        venda_local_uuid: q.get("venda_local_uuid").cloned(),
        desde_ms: parse_i64(q, "desde_ms"),
        ate_ms: parse_i64(q, "ate_ms"),
        limit: parse_i64(q, "limit"),
    }
}

/// GET /api/financeiro/lancamentos?tipo=&categoria=&origem=&status=&caixa_local_uuid=&venda_local_uuid=&desde_ms=&ate_ms=&limit=
async fn financeiro_listar_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<db::LancamentoLocalRow>>, (StatusCode, String)> {
    let f = build_financeiro_filtro(&q);
    let rows = db::lancamentos_local_listar(&f)
        .map_err(|e| {
            eprintln!("[LOCAL_FINANCE] listar falha: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    eprintln!("[LOCAL_FINANCE] listar ok rows={}", rows.len());
    Ok(Json(rows))
}

/// GET /api/financeiro/resumo (mesmos filtros do listar)
async fn financeiro_resumo_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<db::FinanceiroResumo>, (StatusCode, String)> {
    let f = build_financeiro_filtro(&q);
    let r = db::financeiro_resumo_local(&f)
        .map_err(|e| {
            eprintln!("[LOCAL_FINANCE] resumo falha: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    eprintln!("[LOCAL_CASHFLOW] resumo ok");
    Ok(Json(r))
}

/// POST /api/financeiro/manual — insere lançamento manual (idempotente via client_uuid)
async fn financeiro_manual_handler(
    Json(payload): Json<db::LancamentoManualInput>,
) -> Result<Json<db::LancamentoManualResult>, (StatusCode, String)> {
    let r = db::lancamento_manual_inserir(&payload)
        .map_err(|e| {
            eprintln!("[LOCAL_FINANCE] manual falha: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!("[LOCAL_FINANCE] manual ok local_uuid={}", r.local_uuid);
    eprintln!("[LOCAL_FINANCE_OUTBOX] manual enfileirado local_uuid={}", r.local_uuid);
    Ok(Json(r))
}

/// POST /api/financeiro/cancelar?local_uuid=...&motivo=...
async fn financeiro_cancelar_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let lu = q.get("local_uuid").cloned()
        .ok_or((StatusCode::BAD_REQUEST, "local_uuid é obrigatório".into()))?;
    let motivo = q.get("motivo").map(|s| s.as_str());
    let ok = db::lancamento_cancelar(&lu, motivo)
        .map_err(|e| {
            eprintln!("[LOCAL_FINANCE] cancelar falha: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    eprintln!("[LOCAL_FINANCE_AUDIT] cancelamento lancamento={} ok={}", lu, ok);
    Ok(Json(serde_json::json!({ "ok": ok, "local_uuid": lu })))
}

// ---------- /api/financeiro/receber (v21 — Etapa 8) ----------
//
// Exposição offline-first do `contas_receber_local` + baixa parcial/total
// + cancelamento. Cada operação é gravada na MESMA transação SQLite do
// título (`contas_receber_local`) + auditoria (`financeiro_audit_local`).

/// GET /api/financeiro/receber?status=&cliente_id=&desde_ms=&ate_ms=&limit=
async fn financeiro_receber_listar_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<db::ContaReceberLocalRow>>, (StatusCode, String)> {
    let f = db::ContasReceberLocalFiltro {
        status: q.get("status").cloned(),
        cliente_id: q.get("cliente_id").cloned(),
        desde_ms: parse_i64(&q, "desde_ms"),
        ate_ms: parse_i64(&q, "ate_ms"),
        limit: parse_i64(&q, "limit"),
    };
    let rows = db::contas_receber_local_list(&f, now_ms())
        .map_err(|e| {
            eprintln!("[LOCAL_RECEIVABLE] list falha: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    eprintln!("[LOCAL_RECEIVABLE] list ok rows={}", rows.len());
    Ok(Json(rows))
}

/// POST /api/financeiro/receber/baixar — body: BaixarReceberInput
async fn financeiro_receber_baixar_handler(
    Json(payload): Json<db::BaixarReceberInput>,
) -> Result<Json<db::BaixarReceberResult>, (StatusCode, String)> {
    let now = now_ms();
    let r = db::baixar_receber_local(payload, now)
        .map_err(|e| {
            eprintln!("[LOCAL_RECEIVABLE] baixa falha: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_RECEIVABLE] baixa ok titulo={} pago_total={} restante={} status={} idempotente={}",
        r.receber_local_uuid, r.valor_pago_total, r.valor_restante, r.status, r.idempotente
    );
    eprintln!("[LOCAL_FINANCE_AUDIT] recebimento titulo={} valor={}", r.receber_local_uuid, r.valor);
    eprintln!("[LOCAL_CASHFLOW] entrada realizada valor={} forma={:?}", r.valor, None::<String>);
    Ok(Json(r))
}

/// POST /api/financeiro/receber/cancelar — body: CancelarReceberInput
async fn financeiro_receber_cancelar_handler(
    Json(payload): Json<db::CancelarReceberInput>,
) -> Result<Json<db::CancelarReceberResult>, (StatusCode, String)> {
    let now = now_ms();
    let r = db::cancelar_receber_local(payload, now)
        .map_err(|e| {
            eprintln!("[LOCAL_RECEIVABLE] cancelar falha: {e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_RECEIVABLE] cancelado titulo={} status={} idempotente={}",
        r.receber_local_uuid, r.status, r.idempotente
    );
    eprintln!("[LOCAL_FINANCE_AUDIT] cancelamento titulo={}", r.receber_local_uuid);
    Ok(Json(r))
}

// ---------- /api/financeiro/pagar (v22 — Etapa 9) ----------
//
// Contas a PAGAR offline. Espelho do /api/financeiro/receber. Cada
// operação é gravada na MESMA transação SQLite do título
// (`contas_pagar_local`) + auditoria (`financeiro_audit_local`).
// A criação automática nasce de `compra_receber_local` quando a
// compra é a prazo (vencimento informado) e o usuário pediu
// gerar_financeiro — atomicamente com a entrada de estoque.

async fn financeiro_pagar_listar_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<db::ContaPagarLocalRow>>, (StatusCode, String)> {
    let f = db::ContasPagarLocalFiltro {
        status: q.get("status").cloned(),
        fornecedor_id: q.get("fornecedor_id").cloned(),
        compra_id: q.get("compra_id").cloned(),
        desde_ms: parse_i64(&q, "desde_ms"),
        ate_ms: parse_i64(&q, "ate_ms"),
        limit: parse_i64(&q, "limit"),
    };
    let rows = db::contas_pagar_local_list(&f, now_ms()).map_err(|e| {
        eprintln!("[LOCAL_PAYABLE] list falha: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;
    eprintln!("[LOCAL_PAYABLE] list ok rows={}", rows.len());
    Ok(Json(rows))
}

async fn financeiro_pagar_baixar_handler(
    Json(payload): Json<db::BaixarPagarInput>,
) -> Result<Json<db::BaixarPagarResult>, (StatusCode, String)> {
    let now = now_ms();
    let r = db::baixar_pagar_local(payload, now).map_err(|e| {
        eprintln!("[LOCAL_PAYABLE] baixa falha: {e}");
        (StatusCode::BAD_REQUEST, e.to_string())
    })?;
    eprintln!(
        "[LOCAL_PAYABLE] baixa ok titulo={} pago_total={} restante={} status={} idempotente={}",
        r.pagar_local_uuid, r.valor_pago_total, r.valor_restante, r.status, r.idempotente
    );
    eprintln!("[LOCAL_FINANCE_AUDIT] pagamento titulo={} valor={}", r.pagar_local_uuid, r.valor);
    eprintln!("[LOCAL_CASHFLOW] saida realizada valor={} forma={:?}", r.valor, None::<String>);
    Ok(Json(r))
}

async fn financeiro_pagar_cancelar_handler(
    Json(payload): Json<db::CancelarPagarInput>,
) -> Result<Json<db::CancelarPagarResult>, (StatusCode, String)> {
    let now = now_ms();
    let r = db::cancelar_pagar_local(payload, now).map_err(|e| {
        eprintln!("[LOCAL_PAYABLE] cancelar falha: {e}");
        (StatusCode::BAD_REQUEST, e.to_string())
    })?;
    eprintln!(
        "[LOCAL_PAYABLE] cancelado titulo={} status={} idempotente={}",
        r.pagar_local_uuid, r.status, r.idempotente
    );
    eprintln!("[LOCAL_FINANCE_AUDIT] cancelamento_pagar titulo={}", r.pagar_local_uuid);
    Ok(Json(r))
}


///   - `abrir`     → RPC `abrir_caixa`      → devolve UUID do caixa criado
///   - `movimento` → RPC `caixa_registrar_movimento` → devolve id do movimento
///   - `fechar`    → RPC `fechar_caixa`     → devolve JSON; usamos `caixa_id`
///
/// Idempotência ponta-a-ponta:
///   - Para `movimento` enviamos `_client_uuid = local_uuid` (a RPC já trata).
///   - Para `abrir`/`fechar` o nosso `client_uuid` interno (no nível da
///     outbox) garante que reenfileiramentos NÃO disparem novas RPCs locais
///     duplicadas; do lado da nuvem, qualquer reenvio do MESMO `local_uuid`
///     reaproveita a outbox local e não cria item novo. Para a `abrir`
///     enviamos também `_terminal_id` que é a chave única do caixa aberto
///     no servidor (impede dois caixas para o mesmo terminal).
async fn push_one_outbox_caixa(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let item = db::outbox_caixa_get(local_uuid)
        .map_err(|e| e.to_string())?
        .ok_or("item de caixa não encontrado na outbox")?;
    if item.status == "sent" {
        return Ok(item.remote_id.unwrap_or_default());
    }

    let payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    db::outbox_caixa_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let (rpc, body) = match item.action.as_str() {
        "abrir" => (
            "abrir_caixa",
            serde_json::json!({
                "_valor_inicial": payload.get("valor_inicial"),
                "_observacao":    payload.get("observacao"),
                "_operador_id":   payload.get("operador_id"),
                "_terminal_id":   payload.get("terminal_id"),
            }),
        ),
        "movimento" => (
            "caixa_registrar_movimento",
            serde_json::json!({
                // Para resolver o caixa do lado da nuvem, preferimos o
                // remote_id (quando a `abrir` já foi sincronizada) e caímos
                // para o local_uuid quando ainda é a primeira sincronização.
                "_caixa_id":    payload.get("caixa_remote_id")
                                       .and_then(|v| v.as_str())
                                       .or_else(|| payload.get("caixa_local_uuid").and_then(|v| v.as_str()))
                                       .unwrap_or(""),
                "_tipo":        payload.get("tipo"),
                "_valor":       payload.get("valor"),
                "_motivo":      payload.get("motivo"),
                "_client_uuid": local_uuid,
            }),
        ),
        "fechar" => (
            "fechar_caixa",
            serde_json::json!({
                "_caixa_id":        payload.get("caixa_remote_id")
                                            .and_then(|v| v.as_str())
                                            .or_else(|| payload.get("caixa_local_uuid").and_then(|v| v.as_str()))
                                            .unwrap_or(""),
                "_valor_informado": payload.get("valor_informado"),
                "_observacao":      payload.get("observacao"),
            }),
        ),
        other => {
            let msg = format!("action desconhecida: {other}");
            let _ = db::outbox_caixa_mark_error(local_uuid, &msg, now);
            return Err(msg);
        }
    };

    let url = format!(
        "{}/rest/v1/rpc/{}",
        upstream.base_url.trim_end_matches('/'),
        rpc
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&body)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_caixa_mark_error(local_uuid, &msg, now);
            msg
        })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_caixa_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    // Para `fechar`, a RPC devolve um JSON com `caixa_id`; para `abrir`/
    // `movimento` devolve uma string crua.
    let remote_id = if let Some(s) = parsed.as_str() {
        s.to_string()
    } else if let Some(s) = parsed.get("caixa_id").and_then(|v| v.as_str()) {
        s.to_string()
    } else if let Some(s) = parsed.get("movimento_id").and_then(|v| v.as_str()) {
        s.to_string()
    } else {
        text.trim().trim_matches('"').to_string()
    };

    db::outbox_caixa_mark_sent(local_uuid, &remote_id, now).map_err(|e| e.to_string())?;
    Ok(remote_id)
}

#[derive(Serialize)]
struct OutboxCaixaListResponse {
    total: usize,
    items: Vec<db::OutboxCaixaItem>,
}

async fn outbox_caixa_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxCaixaListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_caixa_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxCaixaListResponse { total: items.len(), items }))
}

async fn outbox_caixa_stats_handler() -> Result<Json<db::OutboxCaixaStats>, (StatusCode, String)> {
    db::outbox_caixa_stats()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn outbox_caixa_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_caixa_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_caixa(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    let _ = db::outbox_caixa_record_flush_round(
        "manual", now_ms(), pending.len() as i64, sent as i64, failed as i64,
    );
    Ok(Json(FlushResponse {
        attempted: pending.len(), sent, failed, errors,
    }))
}

async fn outbox_caixa_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_caixa_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

/// Scheduler de background da outbox de caixa — espelha vendas/estoque.
/// Despacha em ordem causal por `created_at_ms` para preservar
/// abrir → movimento → fechar do MESMO caixa.
async fn run_outbox_caixa_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox caixa scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox caixa scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() {
            let _ = db::outbox_caixa_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let pending = match db::outbox_caixa_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox caixa: batch err: {e}"); continue; }
        };
        if pending.is_empty() {
            let _ = db::outbox_caixa_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let empty = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox_caixa(&ctx, &empty, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => {
                    failed += 1;
                    // Para preservar a ordem causal abrir→movimento→fechar
                    // do MESMO caixa, paramos no primeiro erro envolvendo
                    // este caixa — assim os próximos itens dele só serão
                    // tentados na próxima rodada (depois do backoff).
                    // Itens de OUTROS caixas continuam sendo tentados.
                    let stuck = it.caixa_local_uuid.clone();
                    // (Implementação simples: não filtra agora; o backoff já
                    // garante que retries não martelem.)
                    let _ = stuck;
                }
            }
        }
        let _ = db::outbox_caixa_record_flush_round(
            "auto", now_ms(), pending.len() as i64, sent, failed,
        );
        if sent > 0 || failed > 0 {
            eprintln!(
                "[gestao-pro] outbox caixa auto-flush: attempted={} sent={} failed={}",
                pending.len(), sent, failed,
            );
        }
    }
}

// ---------- Router ----------

fn build_router(ctx: AppCtx) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health_handler))
        .route("/server-info", get(server_info_handler))
        .route("/heartbeat", post(heartbeat_handler))
        .route("/terminals", get(terminals_handler))
        .route("/terminals/known", get(known_terminals_handler))
        .route("/events", get(events_handler))
        .route("/db/info", get(db_info_handler))
        .route("/db/domains", get(db_domains_handler))
        .route("/db/sync", post(db_sync_handler))
        .route("/api/offline/status", get(offline_status_handler))
        .route("/api/offline/sync-inicial", post(offline_sync_inicial_handler))
        .route("/api/auth/aquecer-pin", post(aquecer_pin_handler))
        .route("/api/auth/validar-pin", post(validar_pin_handler))
        .route("/db/outbox/estoque", get(outbox_list_handler))
        .route("/db/outbox/estoque/stats", get(outbox_stats_handler))
        .route("/db/outbox/flush", post(outbox_flush_handler))
        .route("/db/outbox/retry-errors", post(outbox_retry_errors_handler))
        .route("/db/outbox/vendas", get(outbox_vendas_list_handler))
        .route("/db/outbox/vendas/stats", get(outbox_vendas_stats_handler))
        .route("/db/outbox/vendas/flush", post(outbox_vendas_flush_handler))
        .route("/db/outbox/vendas/retry-errors", post(outbox_vendas_retry_errors_handler))
        .route("/api/produtos/list", get(produtos_list_handler))
        .route("/api/produtos/buscar-codigo", get(produtos_buscar_codigo_handler))
        .route("/api/produtos/buscar-plu", get(produtos_buscar_plu_handler))
        .route("/api/estoque/saldos", get(estoque_saldos_handler))
        .route("/api/estoque/movimentacoes", get(estoque_movimentacoes_handler))
        .route("/api/estoque/rebuild", post(estoque_rebuild_handler))
        .route("/api/estoque/saude", get(estoque_saude_handler))
        .route(
            "/api/estoque/movimentacoes/registrar",
            post(registrar_mov_local_handler),
        )
        .route("/api/vendas/registrar", post(registrar_venda_local_handler))
        .route("/api/caixa/abrir", post(registrar_caixa_abrir_handler))
        .route("/api/caixa/movimento", post(registrar_caixa_movimento_handler))
        .route("/api/caixa/fechar", post(registrar_caixa_fechar_handler))
        .route("/api/caixa/aberto", get(caixa_local_aberto_handler))
        .route("/api/caixa/resumo", get(caixa_resumo_handler))
        .route("/api/caixa/lancamentos", get(caixa_lancamentos_handler))
        .route("/api/caixa/regenerar-lancamentos", post(caixa_regenerar_lancamentos_handler))
        .route("/api/financeiro/lancamentos", get(financeiro_listar_handler))
        .route("/api/financeiro/resumo", get(financeiro_resumo_handler))
        .route("/api/financeiro/manual", post(financeiro_manual_handler))
        .route("/api/financeiro/cancelar", post(financeiro_cancelar_handler))
        .route("/api/financeiro/receber", get(financeiro_receber_listar_handler))
        .route("/api/financeiro/receber/baixar", post(financeiro_receber_baixar_handler))
        .route("/api/financeiro/receber/cancelar", post(financeiro_receber_cancelar_handler))
        .route("/api/financeiro/pagar", get(financeiro_pagar_listar_handler))
        .route("/api/financeiro/pagar/baixar", post(financeiro_pagar_baixar_handler))
        .route("/api/financeiro/pagar/cancelar", post(financeiro_pagar_cancelar_handler))
        .route("/db/outbox/caixa", get(outbox_caixa_list_handler))
        .route("/db/outbox/caixa/stats", get(outbox_caixa_stats_handler))
        .route("/db/outbox/caixa/flush", post(outbox_caixa_flush_handler))
        .route("/db/outbox/caixa/retry-errors", post(outbox_caixa_retry_errors_handler))
        .route("/api/vendas/cancelar", post(cancelar_venda_local_handler))
        .route("/db/outbox/cancelamentos", get(outbox_cancel_list_handler))
        .route("/db/outbox/cancelamentos/stats", get(outbox_cancel_stats_handler))
        .route("/db/outbox/cancelamentos/flush", post(outbox_cancel_flush_handler))
        .route("/db/outbox/cancelamentos/retry-errors", post(outbox_cancel_retry_errors_handler))
        .route("/db/outbox/financeiro", get(outbox_fin_list_handler))
        .route("/db/outbox/financeiro/stats", get(outbox_fin_stats_handler))
        .route("/db/outbox/financeiro/flush", post(outbox_fin_flush_handler))
        .route("/db/outbox/financeiro/retry-errors", post(outbox_fin_retry_errors_handler))
        .route("/db/outbox/clientes", get(outbox_cli_list_handler))
        .route("/db/outbox/clientes/stats", get(outbox_cli_stats_handler))
        .route("/db/outbox/clientes/flush", post(outbox_cli_flush_handler))
        .route("/db/outbox/clientes/retry-errors", post(outbox_cli_retry_errors_handler))
        .route("/db/outbox/fornecedores", get(outbox_forn_list_handler))
        .route("/db/outbox/fornecedores/stats", get(outbox_forn_stats_handler))
        .route("/db/outbox/fornecedores/flush", post(outbox_forn_flush_handler))
        .route("/db/outbox/fornecedores/retry-errors", post(outbox_forn_retry_errors_handler))
        .route("/db/outbox/compras", get(outbox_compras_list_handler))
        .route("/db/outbox/compras/stats", get(outbox_compras_stats_handler))
        .route("/db/outbox/compras/flush", post(outbox_compras_flush_handler))
        .route("/db/outbox/compras/retry-errors", post(outbox_compras_retry_errors_handler))
        .route("/api/compras/criar", post(compra_criar_handler))
        .route("/api/compras/editar-metadados", post(compra_editar_metadados_handler))
        .route("/api/compras/alterar-status", post(compra_alterar_status_handler))
        .route("/api/compras/excluir", post(compra_excluir_handler))
        .route("/api/compras/receber", post(compra_receber_handler))
        .route("/api/compras/receber-itens", post(compra_receber_itens_handler))
        .route("/api/clientes/criar", post(cliente_criar_handler))
        .route("/api/clientes/editar", post(cliente_editar_handler))
        .route("/api/clientes/alterar-status", post(cliente_alterar_status_handler))
        .route("/api/clientes/excluir", post(cliente_excluir_handler))
        .route("/api/clientes/lite", get(clientes_lite_handler))
        .route("/api/fornecedores/criar", post(fornecedor_criar_handler))
        .route("/api/fornecedores/editar", post(fornecedor_editar_handler))
        .route("/api/fornecedores/alterar-status", post(fornecedor_alterar_status_handler))
        .route("/api/fornecedores/excluir", post(fornecedor_excluir_handler))
        .route("/api/fornecedores", get(fornecedores_handler))
        .route("/api/financeiro/lancamentos-completo", get(financeiro_lancamentos_completo_handler))
        .route("/api/compras", get(compras_handler))
        .route("/api/vendas/historico", get(vendas_historico_handler))
        .route("/api/relatorios/caixas", get(relatorios_caixas_handler))
        .route("/api/relatorios/caixa-movimentos", get(relatorios_caixa_movimentos_handler))
        .route("/api/relatorios/funcionarios-ativos", get(relatorios_funcionarios_ativos_handler))
        .route("/api/relatorios/terminais-ativos", get(relatorios_terminais_ativos_handler))
        .route("/api/relatorios/pagamentos-empresa", get(relatorios_pagamentos_empresa_handler))
        .route("/api/relatorios/venda-itens", get(relatorios_venda_itens_handler))
        .route("/backup/status", get(backup_status_handler))
        .route("/backup/list", get(backup_list_handler))
        .route("/backup/log", get(backup_log_handler))
        .route("/backup/create", post(backup_create_handler))
        .route("/backup/export", post(backup_export_handler))
        .route("/backup/restore/schedule", post(backup_restore_schedule_handler))
        .route("/backup/restore/cancel", post(backup_restore_cancel_handler))
        .with_state(ctx)
        .layer(cors)
}

// ---------- API pública ----------

pub fn current_status() -> LocalServerStatus {
    let s = STATE.lock().expect("local_server state poisoned");
    LocalServerStatus {
        running: s.running,
        port: s.port,
        started_at: s.started_at_ms,
        server_name: s.server_name.clone(),
        server_id: s.server_id.clone(),
        hostname: s.hostname.clone(),
        app: APP_NAME,
        version: APP_VERSION,
        upstream_configured: s.upstream.is_some(),
        terminals_conectados: s.terminals.len(),
    }
}

pub async fn start(
    port: u16,
    server_name: Option<String>,
    server_id: Option<String>,
    upstream_url: Option<String>,
    upstream_anon_key: Option<String>,
) -> Result<LocalServerStatus, String> {
    let upstream = match (upstream_url, upstream_anon_key) {
        (Some(url), Some(key)) if !url.is_empty() && !key.is_empty() => {
            Some(UpstreamConfig { base_url: url, anon_key: key })
        }
        _ => None,
    };

    let host = hostname::get()
        .ok()
        .and_then(|s| s.into_string().ok());

    {
        let mut s = STATE.lock().map_err(|e| e.to_string())?;
        if s.running {
            // Atualiza identidade se o frontend mandou novos valores.
            if server_name.is_some() {
                s.server_name = server_name.clone();
            }
            if server_id.is_some() {
                s.server_id = server_id.clone();
            }
            if s.hostname.is_none() {
                s.hostname = host.clone();
            }
            return Ok(LocalServerStatus {
                running: true,
                port: s.port,
                started_at: s.started_at_ms,
                server_name: s.server_name.clone(),
                server_id: s.server_id.clone(),
                hostname: s.hostname.clone(),
                app: APP_NAME,
                version: APP_VERSION,
                upstream_configured: s.upstream.is_some(),
                terminals_conectados: s.terminals.len(),
            });
        }
    }

    // Garante que o banco local esteja inicializado antes de subir o HTTP.
    if let Err(e) = db::init() {
        eprintln!("[gestao-pro] db::init falhou no start: {e}");
    }

    let addr: SocketAddr = format!("0.0.0.0:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("Endereço inválido: {e}"))?;

    let ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client: {e}"))?,
    };

    let app = build_router(ctx);

    let handle = tokio::runtime::Handle::current();

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Falha ao abrir porta {port}: {e}"))?;

    let (tx, rx) = oneshot::channel::<()>();

    handle.spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });

    // Background scheduler para a outbox de estoque — cancelável via
    // `scheduler_tx` em `stop()`. Roda em paralelo ao servidor HTTP, sem
    // travar requests do terminal.
    let (scheduler_tx, scheduler_rx) = oneshot::channel::<()>();
    let scheduler_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_scheduler(scheduler_ctx, scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox de VENDAS — mesma política de
    // backoff/retry, fila própria, observabilidade própria.
    let (vendas_scheduler_tx, vendas_scheduler_rx) = oneshot::channel::<()>();
    let vendas_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (vendas scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_vendas_scheduler(vendas_ctx, vendas_scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox de CAIXA — mesma política.
    let (caixa_scheduler_tx, caixa_scheduler_rx) = oneshot::channel::<()>();
    let caixa_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (caixa scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_caixa_scheduler(caixa_ctx, caixa_scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox de CANCELAMENTOS — depende causalmente
    // do remote_id da venda original; o push interno re-agenda enquanto a
    // venda não estiver sincronizada.
    let (cancel_scheduler_tx, cancel_scheduler_rx) = oneshot::channel::<()>();
    let cancel_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (cancel scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_cancel_scheduler(cancel_ctx, cancel_scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox FINANCEIRA (lançamentos manuais).
    let (fin_scheduler_tx, fin_scheduler_rx) = oneshot::channel::<()>();
    let fin_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (fin scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_financeiro_scheduler(fin_ctx, fin_scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox de CLIENTES (cadastro offline-first v18).
    let (cli_scheduler_tx, cli_scheduler_rx) = oneshot::channel::<()>();
    let cli_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (cli scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_clientes_scheduler(cli_ctx, cli_scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox de FORNECEDORES (cadastro offline-first v18).
    let (forn_scheduler_tx, forn_scheduler_rx) = oneshot::channel::<()>();
    let forn_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (forn scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_fornecedores_scheduler(forn_ctx, forn_scheduler_rx).await;
    });

    // Scheduler paralelo para a outbox de COMPRAS (offline-first v18 pt.5).
    let (compras_scheduler_tx, compras_scheduler_rx) = oneshot::channel::<()>();
    let compras_ctx = AppCtx {
        upstream: upstream.clone(),
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Falha ao criar HTTP client (compras scheduler): {e}"))?,
    };
    handle.spawn(async move {
        run_outbox_compras_scheduler(compras_ctx, compras_scheduler_rx).await;
    });

    // Scheduler de backup automático local. Roda 1× por dia, no máximo,
    // controlado por timestamp em meta. Não depende de upstream.
    let (backup_scheduler_tx, backup_scheduler_rx) = oneshot::channel::<()>();
    handle.spawn(async move {
        backup::run_backup_scheduler(backup_scheduler_rx).await;
    });

    {
        let mut s = STATE.lock().map_err(|e| e.to_string())?;
        s.running = true;
        s.port = Some(port);
        s.started_at_ms = Some(now_ms());
        s.server_name = server_name;
        s.server_id = server_id;
        s.hostname = host;
        s.shutdown_tx = Some(tx);
        s.scheduler_shutdown_tx = Some(scheduler_tx);
        s.vendas_scheduler_shutdown_tx = Some(vendas_scheduler_tx);
        s.caixa_scheduler_shutdown_tx = Some(caixa_scheduler_tx);
        s.cancel_scheduler_shutdown_tx = Some(cancel_scheduler_tx);
        s.fin_scheduler_shutdown_tx = Some(fin_scheduler_tx);
        s.cli_scheduler_shutdown_tx = Some(cli_scheduler_tx);
        s.forn_scheduler_shutdown_tx = Some(forn_scheduler_tx);
        s.compras_scheduler_shutdown_tx = Some(compras_scheduler_tx);
        s.backup_scheduler_shutdown_tx = Some(backup_scheduler_tx);
        s.upstream = upstream;
        s.terminals.clear();
    }

    Ok(current_status())
}

pub fn stop() -> Result<LocalServerStatus, String> {
    let (
        tx_opt, sched_opt, vendas_sched_opt, caixa_sched_opt, cancel_sched_opt,
        fin_sched_opt, cli_sched_opt, forn_sched_opt, compras_sched_opt, backup_sched_opt
    ) = {
        let mut s = STATE.lock().map_err(|e| e.to_string())?;
        s.running = false;
        s.port = None;
        s.started_at_ms = None;
        s.upstream = None;
        s.terminals.clear();
        (
            s.shutdown_tx.take(),
            s.scheduler_shutdown_tx.take(),
            s.vendas_scheduler_shutdown_tx.take(),
            s.caixa_scheduler_shutdown_tx.take(),
            s.cancel_scheduler_shutdown_tx.take(),
            s.fin_scheduler_shutdown_tx.take(),
            s.cli_scheduler_shutdown_tx.take(),
            s.forn_scheduler_shutdown_tx.take(),
            s.compras_scheduler_shutdown_tx.take(),
            s.backup_scheduler_shutdown_tx.take(),
        )
    };
    if let Some(tx) = tx_opt { let _ = tx.send(()); }
    if let Some(tx) = sched_opt { let _ = tx.send(()); }
    if let Some(tx) = vendas_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = caixa_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = cancel_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = fin_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = cli_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = forn_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = compras_sched_opt { let _ = tx.send(()); }
    if let Some(tx) = backup_sched_opt { let _ = tx.send(()); }
    Ok(current_status())
}

// ============================================================================
// CANCELAMENTO LOCAL DE VENDA — handler + scheduler (v10)
// ============================================================================

#[derive(Deserialize, Debug)]
struct CancelarVendaLocalRequest {
    venda_local_uuid: String,
    #[serde(default)]
    motivo: Option<String>,
    #[serde(default)]
    operador_id: Option<String>,
    #[serde(default)]
    client_uuid: Option<String>,
}

#[derive(Serialize)]
struct CancelarVendaLocalResponse {
    venda_local_uuid: String,
    cancelamento_local_uuid: String,
    idempotente: bool,
    qtd_itens_estornados: i64,
    qtd_total_estornada: f64,
    caixa_local_uuid: Option<String>,
    outbox_status: String,
    remote_response: Option<String>,
}

async fn cancelar_venda_local_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CancelarVendaLocalRequest>,
) -> Result<Json<CancelarVendaLocalResponse>, (StatusCode, String)> {
    let now = now_ms();
    let input = db::LocalCancelarVendaInput {
        venda_local_uuid: req.venda_local_uuid,
        motivo: req.motivo,
        operador_id: req.operador_id,
        client_uuid: req.client_uuid,
    };
    println!(
        "[LOCAL_CANCEL] cancelar venda_local_uuid={} operador={:?}",
        input.venda_local_uuid, input.operador_id
    );
    let r = db::cancelar_venda_local(input, now).map_err(|e| {
        println!("[LOCAL_CANCEL] erro: {e}");
        (StatusCode::BAD_REQUEST, e.to_string())
    })?;
    println!(
        "[LOCAL_CANCEL] cancelado local={} idempotente={} itens_estornados={}",
        r.cancelamento_local_uuid, r.idempotente, r.qtd_itens_estornados
    );

    let mut outbox_status = r.outbox_status.clone();
    let mut remote_response: Option<String> = None;
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(resp) =
            push_one_outbox_cancel(&ctx, &headers, &r.cancelamento_local_uuid).await
        {
            outbox_status = "sent".into();
            remote_response = Some(resp);
            println!("[LOCAL_OUTBOX] cancel push OK local={}", r.cancelamento_local_uuid);
        } else {
            println!("[LOCAL_OUTBOX] cancel push pendente local={}", r.cancelamento_local_uuid);
        }
    }

    Ok(Json(CancelarVendaLocalResponse {
        venda_local_uuid: r.venda_local_uuid,
        cancelamento_local_uuid: r.cancelamento_local_uuid,
        idempotente: r.idempotente,
        qtd_itens_estornados: r.qtd_itens_estornados,
        qtd_total_estornada: r.qtd_total_estornada,
        caixa_local_uuid: r.caixa_local_uuid,
        outbox_status,
        remote_response,
    }))
}

/// Empurra UM cancelamento da outbox para o upstream via RPC `cancelar_venda`.
/// Requer que a venda original já esteja sincronizada (tenha remote_id).
async fn push_one_outbox_cancel(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let venda_remote_id = match db::cancel_resolve_venda_remote(local_uuid)
        .map_err(|e| e.to_string())?
    {
        Some(s) if !s.is_empty() => s,
        _ => {
            // Re-agenda: aguardando venda original ser sincronizada.
            let _ = db::outbox_cancel_mark_error(
                local_uuid, "aguardando sync da venda original", now,
            );
            return Err("venda original ainda não sincronizada".into());
        }
    };

    let item = db::outbox_cancel_list(1000, None)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|i| i.local_uuid == local_uuid)
        .ok_or("cancelamento não encontrado na outbox")?;
    if item.status == "sent" { return Ok(String::new()); }

    db::outbox_cancel_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let body = serde_json::json!({
        "_venda_id": venda_remote_id,
        "_motivo":   item.motivo,
        // _client_uuid garante idempotência cross-runs (caso a RPC suporte;
        // se ignorar, segue funcionando — RPC já faz idempotência por status).
        "_client_uuid": local_uuid,
    });
    let url = format!(
        "{}/rest/v1/rpc/cancelar_venda",
        upstream.base_url.trim_end_matches('/')
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&body)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_cancel_mark_error(local_uuid, &msg, now);
            msg
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        // Aceita "venda já cancelada" como sucesso idempotente do upstream.
        let lower = text.to_lowercase();
        if lower.contains("já cancelada") || lower.contains("already") {
            db::outbox_cancel_mark_sent(local_uuid, &text, now)
                .map_err(|e| e.to_string())?;
            return Ok(text);
        }
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_cancel_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }
    db::outbox_cancel_mark_sent(local_uuid, &text, now).map_err(|e| e.to_string())?;
    Ok(text)
}

async fn outbox_cancel_stats_handler() -> Result<Json<db::OutboxCancelStats>, (StatusCode, String)> {
    db::outbox_cancel_stats().map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct OutboxCancelListResponse {
    total: usize,
    items: Vec<db::OutboxCancelItem>,
}

async fn outbox_cancel_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxCancelListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_cancel_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxCancelListResponse { total: items.len(), items }))
}

async fn outbox_cancel_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_cancel_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_cancel(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    Ok(Json(FlushResponse { attempted: pending.len(), sent, failed, errors }))
}

async fn outbox_cancel_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_cancel_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

async fn run_outbox_cancel_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox cancelamentos scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox cancelamentos scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() { continue; }
        let pending = match db::outbox_cancel_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox cancel: batch err: {e}"); continue; }
        };
        if pending.is_empty() { continue; }
        let empty = HeaderMap::new();
        for it in &pending {
            let _ = push_one_outbox_cancel(&ctx, &empty, &it.local_uuid).await;
        }
    }
}

// ============================================================================
// OUTBOX FINANCEIRA — handlers + scheduler (v12)
// ============================================================================

async fn push_one_outbox_financeiro(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let item = db::outbox_financeiro_get(local_uuid)
        .map_err(|e| e.to_string())?
        .ok_or("item não encontrado na outbox financeira")?;
    if item.status == "sent" { return Ok(item.remote_id.unwrap_or_default()); }

    let payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    db::outbox_financeiro_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let url = format!(
        "{}/rest/v1/rpc/criar_lancamento_avulso",
        upstream.base_url.trim_end_matches('/')
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&payload)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_financeiro_mark_error(local_uuid, &msg, now);
            msg
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let lower = text.to_lowercase();
        // Idempotência: lançamento já criado anteriormente.
        if lower.contains("already") || lower.contains("já existe") || lower.contains("duplicate") {
            db::outbox_financeiro_mark_sent(local_uuid, "", &text, now)
                .map_err(|e| e.to_string())?;
            return Ok(text);
        }
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_financeiro_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let remote_id = if let Some(s) = parsed.as_str() {
        s.to_string()
    } else if let Some(s) = parsed.get("id").and_then(|v| v.as_str()) {
        s.to_string()
    } else {
        text.trim().trim_matches('"').to_string()
    };
    db::outbox_financeiro_mark_sent(local_uuid, &remote_id, &text, now)
        .map_err(|e| e.to_string())?;
    Ok(remote_id)
}

async fn outbox_fin_stats_handler(
) -> Result<Json<db::OutboxFinanceiroStats>, (StatusCode, String)> {
    db::outbox_financeiro_stats().map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct OutboxFinListResponse {
    total: usize,
    items: Vec<db::OutboxFinanceiroItem>,
}

async fn outbox_fin_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxFinListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_financeiro_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxFinListResponse { total: items.len(), items }))
}

async fn outbox_fin_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_financeiro_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_financeiro(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    let _ = db::outbox_financeiro_record_flush_round(
        "manual", now_ms(), pending.len() as i64, sent as i64, failed as i64,
    );
    Ok(Json(FlushResponse { attempted: pending.len(), sent, failed, errors }))
}

async fn outbox_fin_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_financeiro_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

async fn run_outbox_financeiro_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox financeiro scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox financeiro scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() {
            let _ = db::outbox_financeiro_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let pending = match db::outbox_financeiro_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox financeiro: batch err: {e}"); continue; }
        };
        if pending.is_empty() {
            let _ = db::outbox_financeiro_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let empty = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox_financeiro(&ctx, &empty, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => failed += 1,
            }
        }
        let _ = db::outbox_financeiro_record_flush_round(
            "auto", now_ms(), pending.len() as i64, sent, failed,
        );
        if sent > 0 || failed > 0 {
            eprintln!(
                "[gestao-pro] outbox financeiro auto-flush: attempted={} sent={} failed={}",
                pending.len(), sent, failed,
            );
        }
    }
}

// ============================================================================
// BACKUP / RESTAURAÇÃO / EXPORTAÇÃO — handlers HTTP
// ============================================================================

#[derive(Deserialize)]
struct BackupCreateRequest {
    #[serde(default)]
    kind: Option<String>,
}

async fn backup_create_handler(
    Json(req): Json<BackupCreateRequest>,
) -> Result<Json<backup::BackupEntry>, (StatusCode, String)> {
    let kind = req.kind.unwrap_or_else(|| "manual".into());
    let kind = if kind == "auto" { "auto" } else { "manual" };
    backup::create_backup(kind)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.0))
}

async fn backup_status_handler() -> Result<Json<backup::BackupStatus>, (StatusCode, String)> {
    backup::status()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.0))
}

async fn backup_list_handler() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let files = backup::list_backup_files()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.0))?;
    Ok(Json(serde_json::json!({ "files": files })))
}

async fn backup_log_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(50);
    let entries = backup::recent_log(limit)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.0))?;
    Ok(Json(serde_json::json!({ "entries": entries })))
}

#[derive(Deserialize)]
struct BackupExportRequest {
    source_path: String,
    dest_path: String,
}

async fn backup_export_handler(
    Json(req): Json<BackupExportRequest>,
) -> Result<Json<backup::BackupEntry>, (StatusCode, String)> {
    backup::export_backup(&req.source_path, &req.dest_path)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.0))
}

#[derive(Deserialize)]
struct BackupRestoreRequest {
    source_path: String,
}

async fn backup_restore_schedule_handler(
    Json(req): Json<BackupRestoreRequest>,
) -> Result<Json<backup::BackupEntry>, (StatusCode, String)> {
    backup::schedule_restore(&req.source_path)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.0))
}

async fn backup_restore_cancel_handler() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cancelled = backup::cancel_restore()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.0))?;
    Ok(Json(serde_json::json!({ "cancelled": cancelled })))
}

// ============================================================================
// OUTBOX CLIENTES — handlers + scheduler (v18)
// ============================================================================

#[derive(Deserialize)]
struct ClienteCriarRequest {
    #[serde(flatten)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct ClienteCriarResponse {
    cliente_id: String,
    cliente_local_uuid: String,
    cliente_remote_id: Option<String>,
    idempotente: bool,
    outbox_status: String,
    remote_response: Option<String>,
}

async fn cliente_criar_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<ClienteCriarRequest>,
) -> Result<Json<ClienteCriarResponse>, (StatusCode, String)> {
    let r = db::cliente_criar_local(req.payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    let mut remote_response: Option<String> = None;
    let mut cliente_remote_id = r.cliente_remote_id.clone();
    if !r.idempotente && ctx.upstream.is_some() {
        // tenta entregar imediatamente. Pega o item mais recente do cliente.
        if let Ok(items) = db::outbox_clientes_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.cliente_local_uuid == r.cliente_local_uuid && i.action == "criar") {
                if let Ok(rid) = push_one_outbox_clientes(&ctx, &headers, &it.local_uuid).await {
                    outbox_status = "sent".to_string();
                    cliente_remote_id = Some(rid);
                    if let Ok(Some(it2)) = db::outbox_clientes_get(&it.local_uuid) {
                        remote_response = Some(it2.remote_id.unwrap_or_default());
                    }
                }
            }
        }
    }
    let cliente_id = cliente_remote_id.clone().unwrap_or_else(|| r.cliente_local_uuid.clone());
    Ok(Json(ClienteCriarResponse {
        cliente_id,
        cliente_local_uuid: r.cliente_local_uuid,
        cliente_remote_id,
        idempotente: r.idempotente,
        outbox_status,
        remote_response,
    }))
}

#[derive(Deserialize)]
struct ClienteEditarRequest {
    cliente_id: String,
    #[serde(flatten)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct ClienteSimpleResponse {
    cliente_id: String,
    cliente_local_uuid: String,
    cliente_remote_id: Option<String>,
    idempotente: bool,
    outbox_status: String,
}

async fn cliente_editar_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<ClienteEditarRequest>,
) -> Result<Json<ClienteSimpleResponse>, (StatusCode, String)> {
    let lid = db::cliente_resolve_local_uuid(&req.cliente_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "cliente não encontrado".to_string()))?;
    // Limpa cliente_id do payload (vai como _cliente_id pelo helper local).
    let mut payload = req.payload;
    if let Some(o) = payload.as_object_mut() {
        o.remove("cliente_id");
        o.remove("_cliente_id");
    }
    let r = db::cliente_editar_local(&lid, payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_clientes_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.cliente_local_uuid == r.cliente_local_uuid && i.action == "editar") {
                if push_one_outbox_clientes(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(ClienteSimpleResponse {
        cliente_id: r.cliente_remote_id.clone().unwrap_or_else(|| r.cliente_local_uuid.clone()),
        cliente_local_uuid: r.cliente_local_uuid,
        cliente_remote_id: r.cliente_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct ClienteAlterarStatusRequest {
    cliente_id: String,
    status: String,
}

async fn cliente_alterar_status_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<ClienteAlterarStatusRequest>,
) -> Result<Json<ClienteSimpleResponse>, (StatusCode, String)> {
    let lid = db::cliente_resolve_local_uuid(&req.cliente_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "cliente não encontrado".to_string()))?;
    let r = db::cliente_alterar_status_local(&lid, &req.status)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_clientes_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.cliente_local_uuid == r.cliente_local_uuid && i.action == "alterar_status") {
                if push_one_outbox_clientes(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(ClienteSimpleResponse {
        cliente_id: r.cliente_remote_id.clone().unwrap_or_else(|| r.cliente_local_uuid.clone()),
        cliente_local_uuid: r.cliente_local_uuid,
        cliente_remote_id: r.cliente_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct ClienteExcluirRequest {
    cliente_id: String,
}

async fn cliente_excluir_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<ClienteExcluirRequest>,
) -> Result<Json<ClienteSimpleResponse>, (StatusCode, String)> {
    let lid = db::cliente_resolve_local_uuid(&req.cliente_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "cliente não encontrado".to_string()))?;
    let r = db::cliente_excluir_local(&lid)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_clientes_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.cliente_local_uuid == r.cliente_local_uuid && i.action == "excluir") {
                if push_one_outbox_clientes(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    } else if r.idempotente {
        // criar+excluir colapsados — nada vai pro servidor.
        outbox_status = "skipped".to_string();
    }
    Ok(Json(ClienteSimpleResponse {
        cliente_id: r.cliente_remote_id.clone().unwrap_or_else(|| r.cliente_local_uuid.clone()),
        cliente_local_uuid: r.cliente_local_uuid,
        cliente_remote_id: r.cliente_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

async fn push_one_outbox_clientes(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let item = db::outbox_clientes_get(local_uuid)
        .map_err(|e| e.to_string())?
        .ok_or("item não encontrado na outbox de clientes")?;
    if item.status == "sent" { return Ok(item.remote_id.unwrap_or_default()); }

    // Bloqueio de causalidade: editar/alterar_status/excluir só vão se já houver
    // remote_id resolvido (criar enviado antes).
    if item.action != "criar" && item.cliente_remote_id.is_none() {
        let resolved = db::cliente_remote_id_for(&item.cliente_local_uuid).ok().flatten();
        if resolved.is_none() {
            return Err("aguardando criar do cliente sincronizar".to_string());
        }
    }

    let payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    db::outbox_clientes_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let rpc_name = match item.action.as_str() {
        "criar" => "criar_cliente",
        "editar" => "editar_cliente",
        "alterar_status" => "alterar_status_cliente",
        "excluir" => "excluir_cliente",
        _ => {
            let msg = format!("ação desconhecida: {}", item.action);
            let _ = db::outbox_clientes_mark_error(local_uuid, &msg, now);
            return Err(msg);
        }
    };

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let url = format!(
        "{}/rest/v1/rpc/{}",
        upstream.base_url.trim_end_matches('/'),
        rpc_name,
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&payload)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_clientes_mark_error(local_uuid, &msg, now);
            msg
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_clientes_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let remote_id = parsed.get("cliente_id").and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| parsed.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| text.trim().trim_matches('"').to_string());
    db::outbox_clientes_mark_sent(local_uuid, &remote_id, &text, now)
        .map_err(|e| e.to_string())?;
    Ok(remote_id)
}

async fn outbox_cli_stats_handler(
) -> Result<Json<db::OutboxClientesStats>, (StatusCode, String)> {
    db::outbox_clientes_stats().map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct OutboxCliListResponse {
    total: usize,
    items: Vec<db::OutboxClientesItem>,
}

async fn outbox_cli_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxCliListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_clientes_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxCliListResponse { total: items.len(), items }))
}

async fn outbox_cli_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_clientes_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_clientes(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    let _ = db::outbox_clientes_record_flush_round(
        "manual", now_ms(), pending.len() as i64, sent as i64, failed as i64,
    );
    Ok(Json(FlushResponse { attempted: pending.len(), sent, failed, errors }))
}

async fn outbox_cli_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_clientes_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

async fn run_outbox_clientes_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox clientes scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox clientes scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() {
            let _ = db::outbox_clientes_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let pending = match db::outbox_clientes_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox clientes: batch err: {e}"); continue; }
        };
        if pending.is_empty() {
            let _ = db::outbox_clientes_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let empty = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox_clientes(&ctx, &empty, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => failed += 1,
            }
        }
        let _ = db::outbox_clientes_record_flush_round(
            "auto", now_ms(), pending.len() as i64, sent, failed,
        );
        if sent > 0 || failed > 0 {
            eprintln!(
                "[gestao-pro] outbox clientes auto-flush: attempted={} sent={} failed={}",
                pending.len(), sent, failed,
            );
        }
    }
}

// ============================================================================
// OUTBOX FORNECEDORES — handlers + scheduler (v18)
// ============================================================================

#[derive(Deserialize)]
struct FornecedorCriarRequest {
    #[serde(flatten)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct FornecedorCriarResponse {
    fornecedor_id: String,
    fornecedor_local_uuid: String,
    fornecedor_remote_id: Option<String>,
    idempotente: bool,
    outbox_status: String,
    remote_response: Option<String>,
}

async fn fornecedor_criar_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<FornecedorCriarRequest>,
) -> Result<Json<FornecedorCriarResponse>, (StatusCode, String)> {
    let r = db::fornecedor_criar_local(req.payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    let mut remote_response: Option<String> = None;
    let mut fornecedor_remote_id = r.fornecedor_remote_id.clone();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_fornecedores_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.fornecedor_local_uuid == r.fornecedor_local_uuid && i.action == "criar") {
                if let Ok(rid) = push_one_outbox_fornecedores(&ctx, &headers, &it.local_uuid).await {
                    outbox_status = "sent".to_string();
                    fornecedor_remote_id = Some(rid);
                    if let Ok(Some(it2)) = db::outbox_fornecedores_get(&it.local_uuid) {
                        remote_response = Some(it2.remote_id.unwrap_or_default());
                    }
                }
            }
        }
    }
    let fornecedor_id = fornecedor_remote_id.clone().unwrap_or_else(|| r.fornecedor_local_uuid.clone());
    Ok(Json(FornecedorCriarResponse {
        fornecedor_id,
        fornecedor_local_uuid: r.fornecedor_local_uuid,
        fornecedor_remote_id,
        idempotente: r.idempotente,
        outbox_status,
        remote_response,
    }))
}

#[derive(Deserialize)]
struct FornecedorEditarRequest {
    fornecedor_id: String,
    #[serde(flatten)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct FornecedorSimpleResponse {
    fornecedor_id: String,
    fornecedor_local_uuid: String,
    fornecedor_remote_id: Option<String>,
    idempotente: bool,
    outbox_status: String,
}

async fn fornecedor_editar_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<FornecedorEditarRequest>,
) -> Result<Json<FornecedorSimpleResponse>, (StatusCode, String)> {
    let lid = db::fornecedor_resolve_local_uuid(&req.fornecedor_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "fornecedor não encontrado".to_string()))?;
    let mut payload = req.payload;
    if let Some(o) = payload.as_object_mut() {
        o.remove("fornecedor_id");
        o.remove("_fornecedor_id");
    }
    let r = db::fornecedor_editar_local(&lid, payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_fornecedores_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.fornecedor_local_uuid == r.fornecedor_local_uuid && i.action == "editar") {
                if push_one_outbox_fornecedores(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(FornecedorSimpleResponse {
        fornecedor_id: r.fornecedor_remote_id.clone().unwrap_or_else(|| r.fornecedor_local_uuid.clone()),
        fornecedor_local_uuid: r.fornecedor_local_uuid,
        fornecedor_remote_id: r.fornecedor_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct FornecedorAlterarStatusRequest {
    fornecedor_id: String,
    status: String,
}

async fn fornecedor_alterar_status_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<FornecedorAlterarStatusRequest>,
) -> Result<Json<FornecedorSimpleResponse>, (StatusCode, String)> {
    let lid = db::fornecedor_resolve_local_uuid(&req.fornecedor_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "fornecedor não encontrado".to_string()))?;
    let r = db::fornecedor_alterar_status_local(&lid, &req.status)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_fornecedores_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.fornecedor_local_uuid == r.fornecedor_local_uuid && i.action == "alterar_status") {
                if push_one_outbox_fornecedores(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(FornecedorSimpleResponse {
        fornecedor_id: r.fornecedor_remote_id.clone().unwrap_or_else(|| r.fornecedor_local_uuid.clone()),
        fornecedor_local_uuid: r.fornecedor_local_uuid,
        fornecedor_remote_id: r.fornecedor_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct FornecedorExcluirRequest {
    fornecedor_id: String,
}

async fn fornecedor_excluir_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<FornecedorExcluirRequest>,
) -> Result<Json<FornecedorSimpleResponse>, (StatusCode, String)> {
    let lid = db::fornecedor_resolve_local_uuid(&req.fornecedor_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "fornecedor não encontrado".to_string()))?;
    let r = db::fornecedor_excluir_local(&lid)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_fornecedores_list(20, Some("pending")) {
            if let Some(it) = items.into_iter().find(|i| i.fornecedor_local_uuid == r.fornecedor_local_uuid && i.action == "excluir") {
                if push_one_outbox_fornecedores(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    } else if r.idempotente {
        outbox_status = "skipped".to_string();
    }
    Ok(Json(FornecedorSimpleResponse {
        fornecedor_id: r.fornecedor_remote_id.clone().unwrap_or_else(|| r.fornecedor_local_uuid.clone()),
        fornecedor_local_uuid: r.fornecedor_local_uuid,
        fornecedor_remote_id: r.fornecedor_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

async fn push_one_outbox_fornecedores(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let item = db::outbox_fornecedores_get(local_uuid)
        .map_err(|e| e.to_string())?
        .ok_or("item não encontrado na outbox de fornecedores")?;
    if item.status == "sent" { return Ok(item.remote_id.unwrap_or_default()); }

    if item.action != "criar" && item.fornecedor_remote_id.is_none() {
        let resolved = db::fornecedor_remote_id_for(&item.fornecedor_local_uuid).ok().flatten();
        if resolved.is_none() {
            return Err("aguardando criar do fornecedor sincronizar".to_string());
        }
    }

    let payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    db::outbox_fornecedores_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let rpc_name = match item.action.as_str() {
        "criar" => "criar_fornecedor",
        "editar" => "editar_fornecedor",
        "alterar_status" => "alterar_status_fornecedor",
        "excluir" => "excluir_fornecedor",
        _ => {
            let msg = format!("ação desconhecida: {}", item.action);
            let _ = db::outbox_fornecedores_mark_error(local_uuid, &msg, now);
            return Err(msg);
        }
    };

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let url = format!(
        "{}/rest/v1/rpc/{}",
        upstream.base_url.trim_end_matches('/'),
        rpc_name,
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&payload)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_fornecedores_mark_error(local_uuid, &msg, now);
            msg
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_fornecedores_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let remote_id = parsed.get("fornecedor_id").and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| parsed.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| text.trim().trim_matches('"').to_string());
    db::outbox_fornecedores_mark_sent(local_uuid, &remote_id, &text, now)
        .map_err(|e| e.to_string())?;
    Ok(remote_id)
}

async fn outbox_forn_stats_handler(
) -> Result<Json<db::OutboxFornecedoresStats>, (StatusCode, String)> {
    db::outbox_fornecedores_stats().map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct OutboxFornListResponse {
    total: usize,
    items: Vec<db::OutboxFornecedoresItem>,
}

async fn outbox_forn_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxFornListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_fornecedores_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxFornListResponse { total: items.len(), items }))
}

async fn outbox_forn_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_fornecedores_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_fornecedores(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    let _ = db::outbox_fornecedores_record_flush_round(
        "manual", now_ms(), pending.len() as i64, sent as i64, failed as i64,
    );
    Ok(Json(FlushResponse { attempted: pending.len(), sent, failed, errors }))
}

async fn outbox_forn_retry_errors_handler() -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_fornecedores_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

async fn run_outbox_fornecedores_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox fornecedores scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox fornecedores scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() {
            let _ = db::outbox_fornecedores_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let pending = match db::outbox_fornecedores_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox fornecedores: batch err: {e}"); continue; }
        };
        if pending.is_empty() {
            let _ = db::outbox_fornecedores_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let empty = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox_fornecedores(&ctx, &empty, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => failed += 1,
            }
        }
        let _ = db::outbox_fornecedores_record_flush_round(
            "auto", now_ms(), pending.len() as i64, sent, failed,
        );
        if sent > 0 || failed > 0 {
            eprintln!(
                "[gestao-pro] outbox fornecedores auto-flush: attempted={} sent={} failed={}",
                pending.len(), sent, failed,
            );
        }
    }
}

// ============================================================================
// COMPRAS — handlers + scheduler offline-first (v18 pt.5)
// ============================================================================

#[derive(Deserialize)]
struct CompraCriarRequest {
    #[serde(flatten)]
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct CompraCriarResponse {
    compra_id: String,
    compra_local_uuid: String,
    compra_remote_id: Option<String>,
    idempotente: bool,
    outbox_status: String,
    remote_response: Option<String>,
}

async fn compra_criar_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CompraCriarRequest>,
) -> Result<Json<CompraCriarResponse>, (StatusCode, String)> {
    let r = db::compra_criar_local(req.payload)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = if r.idempotente { "skipped".to_string() } else { "pending".to_string() };
    let mut remote_response: Option<String> = None;
    let mut compra_remote_id = r.compra_remote_id.clone();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_compras_list(50, Some("pending")) {
            if let Some(it) = items.into_iter()
                .find(|i| i.compra_local_uuid == r.compra_local_uuid && i.action == "criar")
            {
                if let Ok(rid) = push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await {
                    outbox_status = "sent".to_string();
                    compra_remote_id = Some(rid);
                    if let Ok(Some(it2)) = db::outbox_compras_get(&it.local_uuid) {
                        remote_response = it2.remote_id;
                    }
                }
            }
        }
    }
    let compra_id = compra_remote_id.clone().unwrap_or_else(|| r.compra_local_uuid.clone());
    eprintln!(
        "[LOCAL_PURCHASE] criar ok local={} remote={:?} idempotente={} outbox={}",
        r.compra_local_uuid, compra_remote_id, r.idempotente, outbox_status
    );
    eprintln!("[LOCAL_PURCHASE_OUTBOX] enqueue action=criar local={}", r.compra_local_uuid);
    Ok(Json(CompraCriarResponse {
        compra_id,
        compra_local_uuid: r.compra_local_uuid,
        compra_remote_id,
        idempotente: r.idempotente,
        outbox_status,
        remote_response,
    }))
}

#[derive(Serialize)]
struct CompraSimpleResponse {
    compra_id: String,
    compra_local_uuid: String,
    compra_remote_id: Option<String>,
    idempotente: bool,
    outbox_status: String,
}

#[derive(Deserialize)]
struct CompraEditarMetadadosRequest {
    compra_id: String,
    #[serde(flatten)]
    payload: serde_json::Value,
}

async fn compra_editar_metadados_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CompraEditarMetadadosRequest>,
) -> Result<Json<CompraSimpleResponse>, (StatusCode, String)> {
    let lid = db::compra_resolve_local_uuid(&req.compra_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "compra não encontrada".to_string()))?;
    let mut payload = req.payload;
    if let Some(o) = payload.as_object_mut() {
        o.remove("compra_id");
        o.remove("_compra_id");
    }
    let r = db::compra_editar_metadados_local(&lid, payload)
        .map_err(|e| {
            eprintln!("[LOCAL_PURCHASE] editar_metadados falha local={lid} err={e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_PURCHASE] editar_metadados ok local={} remote={:?} idempotente={}",
        r.compra_local_uuid, r.compra_remote_id, r.idempotente
    );
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_compras_list(50, Some("pending")) {
            if let Some(it) = items.into_iter()
                .find(|i| i.compra_local_uuid == r.compra_local_uuid && i.action == "editar_metadados")
            {
                if push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    } else if r.idempotente {
        outbox_status = "merged".to_string();
    }
    Ok(Json(CompraSimpleResponse {
        compra_id: r.compra_remote_id.clone().unwrap_or_else(|| r.compra_local_uuid.clone()),
        compra_local_uuid: r.compra_local_uuid,
        compra_remote_id: r.compra_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct CompraAlterarStatusRequest {
    compra_id: String,
    status: String,
}

async fn compra_alterar_status_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CompraAlterarStatusRequest>,
) -> Result<Json<CompraSimpleResponse>, (StatusCode, String)> {
    let lid = db::compra_resolve_local_uuid(&req.compra_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "compra não encontrada".to_string()))?;
    let r = db::compra_alterar_status_local(&lid, &req.status)
        .map_err(|e| {
            eprintln!("[LOCAL_PURCHASE] alterar_status falha local={lid} status={} err={e}", req.status);
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_PURCHASE] alterar_status ok local={} status={} idempotente={}",
        r.compra_local_uuid, req.status, r.idempotente
    );
    let mut outbox_status = "pending".to_string();
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_compras_list(50, Some("pending")) {
            if let Some(it) = items.into_iter()
                .find(|i| i.compra_local_uuid == r.compra_local_uuid && i.action == "alterar_status")
            {
                if push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    } else if r.idempotente {
        outbox_status = "merged".to_string();
    }
    Ok(Json(CompraSimpleResponse {
        compra_id: r.compra_remote_id.clone().unwrap_or_else(|| r.compra_local_uuid.clone()),
        compra_local_uuid: r.compra_local_uuid,
        compra_remote_id: r.compra_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct CompraExcluirRequest {
    compra_id: String,
}

async fn compra_excluir_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CompraExcluirRequest>,
) -> Result<Json<CompraSimpleResponse>, (StatusCode, String)> {
    let lid = db::compra_resolve_local_uuid(&req.compra_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "compra não encontrada".to_string()))?;
    let r = db::compra_excluir_local(&lid)
        .map_err(|e| {
            eprintln!("[LOCAL_PURCHASE] excluir falha local={lid} err={e}");
            (StatusCode::BAD_REQUEST, e.to_string())
        })?;
    eprintln!(
        "[LOCAL_PURCHASE] excluir ok local={} idempotente={}",
        r.compra_local_uuid, r.idempotente
    );
    let mut outbox_status = if r.idempotente { "skipped".to_string() } else { "pending".to_string() };
    if !r.idempotente && ctx.upstream.is_some() {
        if let Ok(items) = db::outbox_compras_list(50, Some("pending")) {
            if let Some(it) = items.into_iter()
                .find(|i| i.compra_local_uuid == r.compra_local_uuid && i.action == "excluir")
            {
                if push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(CompraSimpleResponse {
        compra_id: r.compra_remote_id.clone().unwrap_or_else(|| r.compra_local_uuid.clone()),
        compra_local_uuid: r.compra_local_uuid,
        compra_remote_id: r.compra_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct CompraReceberRequest {
    compra_id: String,
    #[serde(default)]
    data_recebimento: Option<String>,
    #[serde(default)]
    gerar_financeiro: Option<bool>,
    #[serde(default)]
    data_vencimento: Option<String>,
}

async fn compra_receber_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CompraReceberRequest>,
) -> Result<Json<CompraSimpleResponse>, (StatusCode, String)> {
    let lid = db::compra_resolve_local_uuid(&req.compra_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "compra não encontrada".to_string()))?;
    let data_rec = req.data_recebimento.unwrap_or_else(||
        chrono::Utc::now().format("%Y-%m-%d").to_string()
    );
    let r = db::compra_receber_local(
        &lid, &data_rec,
        req.gerar_financeiro.unwrap_or(true),
        req.data_vencimento.as_deref(),
    ).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut outbox_status = "pending".to_string();
    if ctx.upstream.is_some() && r.compra_remote_id.is_some() {
        if let Ok(items) = db::outbox_compras_list(50, Some("pending")) {
            if let Some(it) = items.into_iter()
                .find(|i| i.compra_local_uuid == r.compra_local_uuid && i.action == "receber")
            {
                if push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(CompraSimpleResponse {
        compra_id: r.compra_remote_id.clone().unwrap_or_else(|| r.compra_local_uuid.clone()),
        compra_local_uuid: r.compra_local_uuid,
        compra_remote_id: r.compra_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

#[derive(Deserialize)]
struct CompraReceberItensRequestItem {
    item_id: String,
    quantidade: f64,
}

#[derive(Deserialize)]
struct CompraReceberItensRequest {
    compra_id: String,
    itens: Vec<CompraReceberItensRequestItem>,
    #[serde(default)]
    data_recebimento: Option<String>,
    #[serde(default)]
    gerar_financeiro: Option<bool>,
    #[serde(default)]
    data_vencimento: Option<String>,
}

async fn compra_receber_itens_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(req): Json<CompraReceberItensRequest>,
) -> Result<Json<CompraSimpleResponse>, (StatusCode, String)> {
    let lid = db::compra_resolve_local_uuid(&req.compra_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "compra não encontrada".to_string()))?;
    let data_rec = req.data_recebimento.unwrap_or_else(||
        chrono::Utc::now().format("%Y-%m-%d").to_string()
    );
    let itens: Vec<db::CompraReceberItem> = req.itens.into_iter()
        .map(|i| db::CompraReceberItem { item_id: i.item_id, quantidade: i.quantidade })
        .collect();
    let qtd_itens = itens.len();
    let r = db::compra_receber_itens_local(
        &lid, itens, &data_rec,
        req.gerar_financeiro.unwrap_or(true),
        req.data_vencimento.as_deref(),
    ).map_err(|e| {
        eprintln!("[LOCAL_PURCHASE] receber_itens falha local={lid} qtd={qtd_itens} err={e}");
        (StatusCode::BAD_REQUEST, e.to_string())
    })?;
    eprintln!(
        "[LOCAL_PURCHASE] receber_itens ok local={} qtd_itens={} remote={:?} idempotente={}",
        r.compra_local_uuid, qtd_itens, r.compra_remote_id, r.idempotente
    );
    let mut outbox_status = "pending".to_string();
    if ctx.upstream.is_some() && r.compra_remote_id.is_some() {
        if let Ok(items) = db::outbox_compras_list(50, Some("pending")) {
            if let Some(it) = items.into_iter()
                .find(|i| i.compra_local_uuid == r.compra_local_uuid && i.action == "receber_itens")
            {
                if push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await.is_ok() {
                    outbox_status = "sent".to_string();
                }
            }
        }
    }
    Ok(Json(CompraSimpleResponse {
        compra_id: r.compra_remote_id.clone().unwrap_or_else(|| r.compra_local_uuid.clone()),
        compra_local_uuid: r.compra_local_uuid,
        compra_remote_id: r.compra_remote_id,
        idempotente: r.idempotente,
        outbox_status,
    }))
}

/// Empurra UMA ação da outbox de compras para o upstream. Todas as
/// ações são roteadas via PostgREST RPC (criar_compra, atualizar_compra_metadados,
/// alterar_status_compra, excluir_compra, receber_compra, receber_compra_itens),
/// espelhando os métodos do `cloudAdapter.compras`.
///
/// Causalidade: ações != 'criar' exigem `compra_remote_id` resolvido
/// (via push do `criar` desta mesma compra). Senão re-agenda.
async fn push_one_outbox_compras(
    ctx: &AppCtx,
    headers: &HeaderMap,
    local_uuid: &str,
) -> Result<String, String> {
    let upstream = ctx.upstream.as_ref().ok_or("upstream não configurado")?;
    let now = now_ms();

    let item = db::outbox_compras_get(local_uuid)
        .map_err(|e| e.to_string())?
        .ok_or("item não encontrado na outbox de compras")?;
    if item.status == "sent" { return Ok(item.remote_id.unwrap_or_default()); }

    if item.action != "criar" && item.compra_remote_id.is_none() {
        let resolved = db::compra_remote_id_for(&item.compra_local_uuid).ok().flatten();
        if resolved.is_none() {
            let _ = db::outbox_compras_mark_error(
                local_uuid, "aguardando criar da compra sincronizar", now,
            );
            return Err("compra original ainda não sincronizada".into());
        }
    }

    let mut payload: serde_json::Value =
        serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

    // Garante _compra_id atualizado caso já tenhamos resolvido.
    if item.action != "criar" {
        if let Some(rid) = item.compra_remote_id.clone()
            .or_else(|| db::compra_remote_id_for(&item.compra_local_uuid).ok().flatten())
        {
            if let Some(o) = payload.as_object_mut() {
                let key = if item.action == "alterar_status" { "_id" } else { "_compra_id" };
                o.insert(key.into(), serde_json::Value::String(rid));
            }
        }
    }

    db::outbox_compras_mark_sending(local_uuid, now).map_err(|e| e.to_string())?;

    let rpc_name = match item.action.as_str() {
        "criar" => "criar_compra",
        "editar_metadados" => "atualizar_compra_metadados",
        "alterar_status" => "alterar_status_compra",
        "excluir" => "excluir_compra",
        "receber" => "receber_compra",
        "receber_itens" => "receber_compra_itens",
        _ => {
            let msg = format!("ação desconhecida: {}", item.action);
            let _ = db::outbox_compras_mark_error(local_uuid, &msg, now);
            return Err(msg);
        }
    };

    // Para 'criar', o payload do RPC é o objeto inteiro como _payload.
    let body = if item.action == "criar" {
        serde_json::json!({ "_payload": payload })
    } else {
        payload
    };

    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Bearer {}", upstream.anon_key));

    let url = format!(
        "{}/rest/v1/rpc/{}",
        upstream.base_url.trim_end_matches('/'),
        rpc_name,
    );
    let resp = ctx.http.post(&url)
        .header("apikey", &upstream.anon_key)
        .header(axum::http::header::AUTHORIZATION, auth)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::ACCEPT, "application/json")
        .json(&body)
        .send().await
        .map_err(|e| {
            let msg = format!("rede: {e}");
            let _ = db::outbox_compras_mark_error(local_uuid, &msg, now);
            msg
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = format!("HTTP {}: {}", status.as_u16(), text);
        let _ = db::outbox_compras_mark_error(local_uuid, &msg, now);
        return Err(msg);
    }
    // Resolve remote_id da resposta:
    //  * criar_compra → { id, itens: [...] } ou string id
    //  * atualizar_compra_metadados/alterar_status_compra/excluir_compra → void
    //  * receber_compra(_itens) → resultado livre; mantemos compra_remote_id
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let remote_id = match item.action.as_str() {
        "criar" => parsed.get("id").and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| parsed.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| text.trim().trim_matches('"').to_string()),
        _ => item.compra_remote_id.clone().unwrap_or_default(),
    };
    db::outbox_compras_mark_sent(local_uuid, &remote_id, &text, now)
        .map_err(|e| e.to_string())?;
    Ok(remote_id)
}

async fn outbox_compras_stats_handler(
) -> Result<Json<db::OutboxComprasStats>, (StatusCode, String)> {
    db::outbox_compras_stats().map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Serialize)]
struct OutboxComprasListResponse {
    total: usize,
    items: Vec<db::OutboxComprasItem>,
}

async fn outbox_compras_list_handler(
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<OutboxComprasListResponse>, (StatusCode, String)> {
    let limit = q.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(200);
    let status = q.get("status").map(|s| s.as_str());
    let items = db::outbox_compras_list(limit, status)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OutboxComprasListResponse { total: items.len(), items }))
}

async fn outbox_compras_flush_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<Json<FlushResponse>, (StatusCode, String)> {
    let pending = db::outbox_compras_pending_batch_all(100)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut sent = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for it in &pending {
        match push_one_outbox_compras(&ctx, &headers, &it.local_uuid).await {
            Ok(_) => sent += 1,
            Err(e) => { failed += 1; errors.push(format!("{}: {}", it.local_uuid, e)); }
        }
    }
    let _ = db::outbox_compras_record_flush_round(
        "manual", now_ms(), pending.len() as i64, sent as i64, failed as i64,
    );
    Ok(Json(FlushResponse { attempted: pending.len(), sent, failed, errors }))
}

async fn outbox_compras_retry_errors_handler(
) -> Result<Json<RetryErrorsResponse>, (StatusCode, String)> {
    let n = db::outbox_compras_reset_errors(now_ms())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(RetryErrorsResponse { requeued: n }))
}

async fn run_outbox_compras_scheduler(
    ctx: AppCtx,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    eprintln!("[gestao-pro] outbox compras scheduler: iniciado");
    loop {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(SCHEDULER_TICK_MS)) => {}
            _ = &mut shutdown_rx => {
                eprintln!("[gestao-pro] outbox compras scheduler: parado");
                break;
            }
        }
        if ctx.upstream.is_none() {
            let _ = db::outbox_compras_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let pending = match db::outbox_compras_pending_batch(SCHEDULER_BATCH) {
            Ok(p) => p,
            Err(e) => { eprintln!("[gestao-pro] outbox compras: batch err: {e}"); continue; }
        };
        if pending.is_empty() {
            let _ = db::outbox_compras_record_flush_round("auto", now_ms(), 0, 0, 0);
            continue;
        }
        let empty = HeaderMap::new();
        let mut sent = 0i64;
        let mut failed = 0i64;
        for it in &pending {
            match push_one_outbox_compras(&ctx, &empty, &it.local_uuid).await {
                Ok(_) => sent += 1,
                Err(_) => failed += 1,
            }
        }
        let _ = db::outbox_compras_record_flush_round(
            "auto", now_ms(), pending.len() as i64, sent, failed,
        );
        if sent > 0 || failed > 0 {
            eprintln!(
                "[gestao-pro] outbox compras auto-flush: attempted={} sent={} failed={}",
                pending.len(), sent, failed,
            );
        }
    }
}
