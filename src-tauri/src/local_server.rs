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
    extract::{Query, State},
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

    let (server_id, server_name, server_match) = {
        let mut s = STATE.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        s.terminals.insert(req.terminal_id.clone(), hb);
        let m = req
            .expected_server_id
            .as_ref()
            .map(|exp| s.server_id.as_deref() == Some(exp.as_str()));
        (s.server_id.clone(), s.server_name.clone(), m)
    };

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

// ---------- /api/produtos/list ----------

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
    proxy_get(&ctx, &headers, "/rest/v1/produtos", &params.iter().map(|(k, v)| (*k, v.clone())).collect::<Vec<_>>()).await
}

// ---------- /api/estoque/saldos ----------

async fn estoque_saldos_handler(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let params = vec![("select", "produto_id,variacao_id,tipo,quantidade".to_string())];
    proxy_get(
        &ctx,
        &headers,
        "/rest/v1/estoque_movimentacoes",
        &params.iter().map(|(k, v)| (*k, v.clone())).collect::<Vec<_>>(),
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
    proxy_get(
        &ctx,
        &headers,
        "/rest/v1/clientes",
        &params.iter().map(|(k, v)| (*k, v.clone())).collect::<Vec<_>>(),
    )
    .await
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
        let _ = axum::serve(listener, app)
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
