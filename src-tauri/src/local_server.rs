// ============================================================================
// Backend HTTP local — roda apenas no Desktop em modo "Servidor Local".
// ============================================================================
//
// Esta é a primeira base real de comunicação local entre Servidor e Terminal.
// Nesta etapa expõe somente endpoints leves de identidade/saúde:
//
//   GET /health       → { status: "ok", timestamp, uptime_ms, version }
//   GET /server-info  → { app, version, role, server_name, started_at, ... }
//
// Não há banco local nem rotas de dados aqui — isso vem na próxima etapa.
// O servidor é iniciado/parado por comandos Tauri (start_local_server /
// stop_local_server / local_server_status) chamados pelo frontend quando o
// papel da máquina é "server".

use axum::{routing::get, Json, Router};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Mutex;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

// ---------- Estado global do servidor local ----------

#[derive(Default)]
struct ServerState {
    running: bool,
    port: Option<u16>,
    started_at_ms: Option<i64>,
    server_name: Option<String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

static STATE: Lazy<Mutex<ServerState>> = Lazy::new(|| Mutex::new(ServerState::default()));

const APP_NAME: &str = "Gestao Pro";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------- Tipos retornados pelos endpoints ----------

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    app: &'static str,
    version: &'static str,
    role: &'static str,
    timestamp: i64,
    uptime_ms: i64,
}

#[derive(Serialize)]
struct ServerInfoResponse {
    app: &'static str,
    version: &'static str,
    role: &'static str,
    server_name: Option<String>,
    started_at: Option<i64>,
    port: Option<u16>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub started_at: Option<i64>,
    pub server_name: Option<String>,
    pub app: &'static str,
    pub version: &'static str,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---------- Handlers ----------

async fn health_handler() -> Json<HealthResponse> {
    let started = STATE.lock().ok().and_then(|s| s.started_at_ms).unwrap_or_else(now_ms);
    Json(HealthResponse {
        status: "ok",
        app: APP_NAME,
        version: APP_VERSION,
        role: "server",
        timestamp: now_ms(),
        uptime_ms: now_ms() - started,
    })
}

async fn server_info_handler() -> Json<ServerInfoResponse> {
    let (server_name, started_at, port) = STATE
        .lock()
        .ok()
        .map(|s| (s.server_name.clone(), s.started_at_ms, s.port))
        .unwrap_or((None, None, None));

    Json(ServerInfoResponse {
        app: APP_NAME,
        version: APP_VERSION,
        role: "server",
        server_name,
        started_at,
        port,
    })
}

fn build_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health_handler))
        .route("/server-info", get(server_info_handler))
        .layer(cors)
}

// ---------- API pública (chamada por commands Tauri) ----------

pub fn current_status() -> LocalServerStatus {
    let s = STATE.lock().expect("local_server state poisoned");
    LocalServerStatus {
        running: s.running,
        port: s.port,
        started_at: s.started_at_ms,
        server_name: s.server_name.clone(),
        app: APP_NAME,
        version: APP_VERSION,
    }
}

/// Inicia o backend local. Idempotente: chamadas duplicadas são ignoradas
/// se já houver um servidor ativo na mesma porta.
pub fn start(port: u16, server_name: Option<String>) -> Result<LocalServerStatus, String> {
    {
        let s = STATE.lock().map_err(|e| e.to_string())?;
        if s.running {
            return Ok(LocalServerStatus {
                running: true,
                port: s.port,
                started_at: s.started_at_ms,
                server_name: s.server_name.clone(),
                app: APP_NAME,
                version: APP_VERSION,
            });
        }
    }

    let addr: SocketAddr = format!("0.0.0.0:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("Endereço inválido: {e}"))?;

    let app = build_router();

    // Bind síncrono via tokio Handle do Tauri.
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
        s.shutdown_tx = Some(tx);
    }

    Ok(current_status())
}

pub fn stop() -> Result<LocalServerStatus, String> {
    let tx_opt = {
        let mut s = STATE.lock().map_err(|e| e.to_string())?;
        s.running = false;
        s.port = None;
        s.started_at_ms = None;
        s.shutdown_tx.take()
    };
    if let Some(tx) = tx_opt {
        let _ = tx.send(());
    }
    Ok(current_status())
}
