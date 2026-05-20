// Descoberta de servidor Gestão Pro na LAN via mDNS.
//
// O servidor local registra um serviço `_gestaopro._tcp.local.` com o IP da
// LAN, porta HTTP e metadados (server_id, server_name, hostname, versão).
// Terminais usam `discover_servers` para listar instâncias na rede sem
// precisar digitar IP. Tudo opcional e isolado — se mDNS falhar, o app
// continua funcionando normalmente via configuração manual.

use mdns_sd::{ServiceDaemon, ServiceInfo};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Duration;

const SERVICE_TYPE: &str = "_gestaopro._tcp.local.";

struct AdState {
    daemon: Option<ServiceDaemon>,
    full_name: Option<String>,
}

static AD: Lazy<Mutex<AdState>> = Lazy::new(|| {
    Mutex::new(AdState {
        daemon: None,
        full_name: None,
    })
});

fn local_ips() -> Vec<IpAddr> {
    match local_ip_address::list_afinet_netifas() {
        Ok(list) => list
            .into_iter()
            .filter_map(|(_name, ip)| {
                // Mantém só IPv4 não-loopback de redes privadas/link-local.
                match ip {
                    IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(ip),
                    _ => None,
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Inicia o anúncio mDNS. Idempotente: se já estiver rodando, faz unregister
/// e registra novamente com os novos dados (útil quando o usuário muda o
/// nome do servidor sem reiniciar o app).
pub fn start_advertise(
    port: u16,
    server_id: Option<&str>,
    server_name: Option<&str>,
    host_name: Option<&str>,
    version: &str,
) -> Result<(), String> {
    let ips = local_ips();
    if ips.is_empty() {
        return Err("Nenhum IP de LAN detectado para anunciar via mDNS.".into());
    }

    let mut st = AD.lock().map_err(|e| e.to_string())?;

    // Reaproveita daemon existente (ou cria) — re-registrando o serviço.
    let daemon = match st.daemon.take() {
        Some(d) => d,
        None => ServiceDaemon::new().map_err(|e| format!("mDNS daemon: {e}"))?,
    };

    // Se já tínhamos um serviço registrado, desregistra para evitar duplicata.
    if let Some(prev) = st.full_name.take() {
        let _ = daemon.unregister(&prev);
    }

    let host_label = host_name
        .map(sanitize_label)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "gestao-pro".into());

    // Nome único de instância: combina id curto + host para evitar colisão.
    let id_suffix = server_id
        .map(|s| s.chars().take(8).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("p{port}"));
    let instance = sanitize_label(&format!("{host_label}-{id_suffix}"));

    let host_for_mdns = format!("{host_label}.local.");

    let mut props: HashMap<String, String> = HashMap::new();
    if let Some(id) = server_id {
        props.insert("server_id".into(), id.into());
    }
    if let Some(name) = server_name {
        props.insert("server_name".into(), name.into());
    }
    if let Some(h) = host_name {
        props.insert("hostname".into(), h.into());
    }
    props.insert("version".into(), version.into());
    props.insert("app".into(), "gestao-pro".into());
    props.insert("path".into(), "/api/server-info".into());

    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &host_for_mdns,
        &ips[..],
        port,
        Some(props),
    )
    .map_err(|e| format!("mDNS ServiceInfo: {e}"))?;

    let full_name = info.get_fullname().to_string();
    daemon
        .register(info)
        .map_err(|e| format!("mDNS register: {e}"))?;

    st.daemon = Some(daemon);
    st.full_name = Some(full_name);
    Ok(())
}

pub fn stop_advertise() {
    let Ok(mut st) = AD.lock() else { return };
    let name = st.full_name.take();
    if let (Some(daemon), Some(name)) = (st.daemon.as_ref(), name) {
        let _ = daemon.unregister(&name);
    }
    if let Some(daemon) = st.daemon.take() {
        let _ = daemon.shutdown();
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct DiscoveredServer {
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub hostname: Option<String>,
    pub version: Option<String>,
    pub host: String,
    pub port: u16,
    pub base_url: String,
}

/// Procura serviços `_gestaopro._tcp.local.` na LAN durante `timeout_ms`
/// milissegundos e retorna a lista única (por server_id, ou host:port).
pub async fn discover_servers(timeout_ms: u64) -> Result<Vec<DiscoveredServer>, String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS daemon: {e}"))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("mDNS browse: {e}"))?;

    let mut out: HashMap<String, DiscoveredServer> = HashMap::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms.max(500));

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let recv = receiver.clone();
        // recv_async é Future; aplicamos timeout do tokio.
        let evt = match tokio::time::timeout(remaining, async move { recv.recv_async().await }).await {
            Ok(Ok(evt)) => evt,
            _ => break,
        };

        if let mdns_sd::ServiceEvent::ServiceResolved(info) = evt {
            let props = info.get_properties();
            let server_id = props.get_property_val_str("server_id").map(String::from);
            let server_name = props.get_property_val_str("server_name").map(String::from);
            let hostname = props.get_property_val_str("hostname").map(String::from);
            let version = props.get_property_val_str("version").map(String::from);
            let port = info.get_port();

            // Escolhe primeiro IPv4 utilizável.
            let host = info
                .get_addresses()
                .iter()
                .find_map(|ip| match ip {
                    IpAddr::V4(v4) if !v4.is_loopback() => Some(v4.to_string()),
                    _ => None,
                })
                .unwrap_or_else(|| info.get_hostname().trim_end_matches('.').to_string());

            let base_url = format!("http://{host}:{port}");
            let key = server_id
                .clone()
                .unwrap_or_else(|| format!("{host}:{port}"));

            out.insert(
                key,
                DiscoveredServer {
                    server_id,
                    server_name,
                    hostname,
                    version,
                    host,
                    port,
                    base_url,
                },
            );
        }
    }

    let _ = daemon.shutdown();
    let mut list: Vec<_> = out.into_values().collect();
    list.sort_by(|a, b| a.base_url.cmp(&b.base_url));
    Ok(list)
}

/// Sanitiza label DNS-SD: ASCII alfanumérico + hífen, lowercase, max 63.
fn sanitize_label(input: &str) -> String {
    let mut s: String = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    let s = s.trim_matches('-').to_string();
    if s.len() > 63 {
        s[..63].to_string()
    } else {
        s
    }
}
