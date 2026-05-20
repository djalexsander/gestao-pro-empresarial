// ============================================================================
// event_bus.rs — Realtime local centralizado (onda 1)
// ============================================================================
//
// Pequena camada pub/sub em memória, baseada em `tokio::sync::broadcast`,
// usada pelo endpoint SSE `GET /api/events` para empurrar mudanças do
// SQLite local para o front (ERP/PDV/terminais) sem depender de cloud.
//
// Regras importantes:
//   - Publicar SEMPRE depois do `commit()` da transação SQLite.
//   - Payload não carrega dados sensíveis — só metadados (IDs, domínio,
//     ação, timestamp). Senhas/PIN/tokens nunca entram aqui.
//   - Se ninguém estiver escutando, `send` retorna `Err` e nós ignoramos.
//   - Se o canal estourar (slow consumer), o cliente recebe um evento
//     `realtime.lagged` e re-sincroniza via invalidate global.
// ============================================================================

use once_cell::sync::OnceCell;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::broadcast;

/// Capacidade do canal. ~1024 eventos pendentes por consumidor é suficiente
/// para pequenas lojas / 2-8 terminais; o `Lagged` cobre o resto.
const CHANNEL_CAPACITY: usize = 1024;

/// Tamanho do ring buffer de replay. Cobre reconexões curtas (até alguns
/// minutos de tráfego intenso) sem inflar memória. Eventos mais antigos
/// caem para o resync global (`realtime.lagged`).
const REPLAY_CAPACITY: usize = 500;

/// Bus global. Inicializado uma única vez no boot do servidor local.
/// Acessível por qualquer handler / scheduler sem precisar passar `AppCtx`.
static BUS: OnceCell<broadcast::Sender<LocalEvent>> = OnceCell::new();

/// Sequência monotônica global. Cada evento publicado recebe um seq único.
/// O front usa esse seq como `Last-Event-ID` na reconexão SSE.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Ring buffer (seq, evento) para replay em reconexões. Protegido por
/// `std::sync::Mutex` — locks são micro (push/drena), sem await dentro.
static REPLAY: OnceCell<Mutex<VecDeque<(u64, LocalEvent)>>> = OnceCell::new();

/// Evento padronizado emitido pelo servidor local.
/// Mantém os campos exatos definidos no brief de realtime.
#[derive(Clone, Debug, Serialize)]
pub struct LocalEvent {
    pub id: String,
    /// Seq monotônico atribuído na publicação. 0 antes do publish.
    /// Vai como `id:` do SSE para suportar `Last-Event-ID` no replay.
    #[serde(default)]
    pub seq: u64,
    /// Tipo de evento — por padrão "entity.changed". Reservamos
    /// "realtime.lagged" para reportar slow-consumer e "realtime.hello"
    /// para o evento inicial enviado ao conectar.
    #[serde(rename = "type")]
    pub kind: String,
    pub domain: String,
    pub action: String,
    pub entity_id: Option<String>,
    pub empresa_id: Option<String>,
    pub terminal_id: Option<String>,
    pub operator_id: Option<String>,
    pub timestamp: i64,
    pub source: String,
    pub version: u32,
}

impl LocalEvent {
    pub fn new(domain: &str, action: &str) -> Self {
        Self {
            id: gen_id(),
            seq: 0,
            kind: "entity.changed".into(),
            domain: domain.into(),
            action: action.into(),
            entity_id: None,
            empresa_id: None,
            terminal_id: None,
            operator_id: None,
            timestamp: now_ms(),
            source: "local".into(),
            version: 1,
        }
    }

    pub fn with_entity(mut self, id: impl Into<String>) -> Self {
        self.entity_id = Some(id.into());
        self
    }

    #[allow(dead_code)]
    pub fn with_empresa(mut self, id: Option<String>) -> Self {
        self.empresa_id = id;
        self
    }

    #[allow(dead_code)]
    pub fn with_terminal(mut self, id: Option<String>) -> Self {
        self.terminal_id = id;
        self
    }

    #[allow(dead_code)]
    pub fn with_source(mut self, source: &str) -> Self {
        self.source = source.into();
        self
    }
}

/// Inicializa o bus uma única vez. Idempotente.
pub fn init() -> broadcast::Sender<LocalEvent> {
    REPLAY.get_or_init(|| Mutex::new(VecDeque::with_capacity(REPLAY_CAPACITY)));
    BUS.get_or_init(|| {
        let (tx, _rx) = broadcast::channel(CHANNEL_CAPACITY);
        eprintln!(
            "[LOCAL_REALTIME] bus inicializado cap={CHANNEL_CAPACITY} replay={REPLAY_CAPACITY}"
        );
        tx
    })
    .clone()
}

/// Retorna o sender atual (ou inicializa sob demanda).
#[allow(dead_code)]
pub fn sender() -> broadcast::Sender<LocalEvent> {
    init()
}

/// Cria um novo subscriber. Cada cliente SSE consome um receiver próprio.
pub fn subscribe() -> broadcast::Receiver<LocalEvent> {
    init().subscribe()
}

/// Publica um evento. Atribui seq monotônico, armazena no ring buffer de
/// replay e dispara para os subscribers. Fire-and-forget se 0 consumidores.
pub fn publish(mut evt: LocalEvent) {
    init();
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    evt.seq = seq;

    if let Some(ring) = REPLAY.get() {
        if let Ok(mut r) = ring.lock() {
            if r.len() >= REPLAY_CAPACITY {
                r.pop_front();
            }
            r.push_back((seq, evt.clone()));
        }
    }

    if let Some(tx) = BUS.get() {
        let domain = evt.domain.clone();
        let action = evt.action.clone();
        match tx.send(evt) {
            Ok(n) => {
                eprintln!(
                    "[REALTIME_EVENT] published seq={} domain={} action={} subscribers={}",
                    seq, domain, action, n
                );
            }
            Err(_) => {
                // 0 subscribers — totalmente OK em modo single-user.
            }
        }
    }
}

/// Helper: publica vários eventos de uma vez (ex.: venda dispara
/// vendas.created + estoque.updated + caixa.updated).
pub fn publish_many<I: IntoIterator<Item = LocalEvent>>(events: I) {
    for e in events {
        publish(e);
    }
}

/// Retorna eventos com seq > `since`, ordenados crescente. Usado pelo SSE
/// quando o cliente reconecta enviando `Last-Event-ID`.
/// Se `since` estiver abaixo do menor seq do ring (gap real), devolve
/// `None` para o handler emitir `realtime.lagged` e forçar resync global.
pub fn replay_since(since: u64) -> Option<Vec<LocalEvent>> {
    init();
    let ring = REPLAY.get()?;
    let r = ring.lock().ok()?;
    if r.is_empty() {
        return Some(Vec::new());
    }
    let oldest = r.front().map(|(s, _)| *s).unwrap_or(0);
    if since + 1 < oldest {
        // Gap — eventos perdidos caíram fora do buffer.
        return None;
    }
    Some(
        r.iter()
            .filter(|(s, _)| *s > since)
            .map(|(_, e)| e.clone())
            .collect(),
    )
}


fn gen_id() -> String {
    // UUID v4 simples sem dependência extra: 16 bytes random hex.
    let mut buf = [0u8; 16];
    if getrandom::getrandom(&mut buf).is_err() {
        // Fallback determinístico via timestamp — nunca deveria acontecer.
        let t = now_ms() as u128;
        buf.copy_from_slice(&t.to_be_bytes());
    }
    buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
    buf[8] = (buf[8] & 0x3f) | 0x80; // variant
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        buf[0], buf[1], buf[2], buf[3],
        buf[4], buf[5],
        buf[6], buf[7],
        buf[8], buf[9],
        buf[10], buf[11], buf[12], buf[13], buf[14], buf[15],
    )
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
