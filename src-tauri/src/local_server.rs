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
    started_at: Option<i64>,
    started_at_iso: Option<String>,
    port: Option<u16>,
    upstream_configured: bool,
    terminals_conectados: usize,
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
        )
    });
    let (server_name, server_id, hostname, started_at, port, upstream_configured, terminals_conectados) =
        snap.unwrap_or((None, None, None, None, None, false, 0));

    Json(ServerInfoResponse {
        app: APP_NAME,
        version: APP_VERSION,
        protocol_version: PROTOCOL_VERSION,
        role: "server",
        server_id,
        server_name,
        hostname,
        started_at,
        started_at_iso: started_at.and_then(iso_from_ms),
        port,
        upstream_configured,
        terminals_conectados,
    })
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

async fn proxy_with_incremental_sync(
    ctx: &AppCtx,
    headers: &HeaderMap,
    domain: &str,
    path: &str,
    base_query: &[(&str, String)],
    force: bool,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let now = now_ms();

    // 1) Lê estado de sync e decide estratégia.
    let state = db::get_domain_sync_state(domain).unwrap_or(db::DomainSyncState {
        last_remote_cursor_ms: None,
        last_strategy: None,
    });
    let strategy = match state.last_remote_cursor_ms {
        Some(_) => db::IngestStrategy::Incremental,
        None => db::IngestStrategy::Snapshot,
    };

    // 2) Sem `force`, podemos servir do local se ainda dentro do TTL — usamos
    //    o cache_kv como "freshness gate" sem reconsultar upstream.
    let key = build_cache_key(path, base_query);
    if !force {
        if let Ok(Some(_)) = db::cache_get(domain, &key, now) {
            // Cache marcador presente → serve direto da tabela local
            // (estado consolidado), sem chamar upstream.
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
    let mut q: Vec<(&str, String)> = base_query.to_vec();
    if let Some(cursor) = state.last_remote_cursor_ms {
        q.push(("updated_at", format!("gte.{}", iso_from_ms_z(cursor))));
        // Garantir ordenação por updated_at.asc para avançar cursor de forma
        // consistente. Sobrescreve qualquer `order` anterior anexando — o
        // PostgREST aceita múltiplos `order`, mas para clareza deixamos só este
        // quando estamos em modo incremental.
        q.retain(|(k, _)| *k != "order");
        q.push(("order", "updated_at.asc".into()));
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
                    "produtos" => {
                        match db::ingest_produtos(text, now, strategy) {
                            Ok((n, _)) => delta = n as i64,
                            Err(e) => {
                                let _ = db::record_sync_error(domain, now, &e.to_string());
                                eprintln!("[gestao-pro] ingest produtos falhou: {e}");
                            }
                        }
                    }
                    "clientes_lite" => {
                        match db::ingest_clientes(text, now, strategy) {
                            Ok((n, _)) => delta = n as i64,
                            Err(e) => {
                                let _ = db::record_sync_error(domain, now, &e.to_string());
                                eprintln!("[gestao-pro] ingest clientes falhou: {e}");
                            }
                        }
                    }
                    _ => {}
                }
                // Marca freshness no cache_kv (apenas para gating; não é a
                // fonte de leitura).
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
            // Fallback: tabela local mesmo "stale".
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
        "estoque_saldos" => db::read_saldos(),
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

// ---------- /api/estoque/saldos ----------

async fn estoque_saldos_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let params = vec![("select", "produto_id,variacao_id,tipo,quantidade".to_string())];
    let q_owned: Vec<(&str, String)> = params.iter().map(|(k, v)| (*k, v.clone())).collect();
    proxy_with_cache(
        &ctx,
        &headers,
        "estoque_saldos",
        "/rest/v1/estoque_movimentacoes",
        &q_owned,
    )
    .await
}

// ---------- /api/estoque/movimentacoes ----------

async fn estoque_movimentacoes_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let limit = q
        .get("limit")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(200);
    let mut params: Vec<(&str, String)> = vec![
        ("select", "*,produto:produtos(id,sku,nome)".into()),
        ("order", "data_movimentacao.desc".into()),
        ("limit", limit.to_string()),
    ];
    if let Some(p) = q.get("produto_id").filter(|s| !s.is_empty()) {
        params.push(("produto_id", format!("eq.{p}")));
    }
    proxy_get(
        &ctx,
        &headers,
        "/rest/v1/estoque_movimentacoes",
        &params.iter().map(|(k, v)| (*k, v.clone())).collect::<Vec<_>>(),
    )
    .await
}

// ---------- /api/clientes/lite ----------

async fn clientes_lite_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let mut params: Vec<(&str, String)> = vec![
        ("select", "id,nome,nome_fantasia,documento".into()),
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
        .route("/api/produtos/list", get(produtos_list_handler))
        .route("/api/estoque/saldos", get(estoque_saldos_handler))
        .route("/api/estoque/movimentacoes", get(estoque_movimentacoes_handler))
        .route("/api/clientes/lite", get(clientes_lite_handler))
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

pub fn start(
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

    let handle = tokio::runtime::Handle::try_current()
        .map_err(|_| "Runtime tokio não disponível neste contexto".to_string())?;

    let listener = handle
        .block_on(async { tokio::net::TcpListener::bind(addr).await })
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

    {
        let mut s = STATE.lock().map_err(|e| e.to_string())?;
        s.running = true;
        s.port = Some(port);
        s.started_at_ms = Some(now_ms());
        s.server_name = server_name;
        s.server_id = server_id;
        s.hostname = host;
        s.shutdown_tx = Some(tx);
        s.upstream = upstream;
        s.terminals.clear();
    }

    Ok(current_status())
}

pub fn stop() -> Result<LocalServerStatus, String> {
    let tx_opt = {
        let mut s = STATE.lock().map_err(|e| e.to_string())?;
        s.running = false;
        s.port = None;
        s.started_at_ms = None;
        s.upstream = None;
        s.terminals.clear();
        s.shutdown_tx.take()
    };
    if let Some(tx) = tx_opt {
        let _ = tx.send(());
    }
    Ok(current_status())
}
