## Objetivo

Criar uma camada **realtime local centralizada** que atualiza ERP/PDV/terminais/dashboards quando algo muda no SQLite local — **sem depender de Supabase Realtime** e **sem quebrar offline/PDV/caixa/financeiro/sync**.

Stack alvo:
- Backend: Rust + axum (já existe em `src-tauri/src/local_server.rs`).
- Transporte: **SSE** (`text/event-stream`) — mais simples, atravessa proxy/firewall LAN, reconexão nativa do browser.
- Frontend: cliente único `localRealtimeClient.ts` + integração com React Query.

Não vou:
- trocar para WebSocket;
- emitir eventos "tela por tela" espalhados;
- mandar dados sensíveis (PIN/senha/token/payload completo);
- depender de Supabase Realtime;
- mexer em RLS, schema SQLite ou outbox;
- refatorar adapters de domínio existentes.

---

## Arquitetura

```text
 ┌────────────────────────────────────────────────┐
 │ Comandos de domínio no Rust                    │
 │ (vendas, caixa, estoque, produtos, sync, ...)  │
 └────────────┬───────────────────────────────────┘
              │ após COMMIT SQLite OK
              ▼
 ┌────────────────────────────────────────────────┐
 │ event_bus.rs  (tokio::sync::broadcast)         │
 │ - publish(LocalEvent)                          │
 │ - subscribe() -> Receiver                       │
 └────────────┬───────────────────────────────────┘
              ▼
 ┌────────────────────────────────────────────────┐
 │ GET /api/events  (SSE handler axum)            │
 │ - heartbeat 15s                                │
 │ - filtra por empresa_id (query param)          │
 └────────────┬───────────────────────────────────┘
              ▼
 ┌────────────────────────────────────────────────┐
 │ localRealtimeClient.ts                         │
 │ - EventSource + reconnect/backoff              │
 │ - debounce/coalesce por domain                 │
 │ - dispara invalidate no QueryClient            │
 └────────────────────────────────────────────────┘
```

---

## Mudanças (escopo fechado — onda 1)

Onda 1 cobre: **vendas, caixa, estoque, produtos, sync/outbox, terminais**.
Onda 2 (futura, não nesta PR): financeiro, contas a receber/pagar, clientes, fornecedores, funcionários, compras, dashboard.

### Backend Rust

1. **`src-tauri/src/event_bus.rs`** (novo)
   - `tokio::sync::broadcast::channel::<LocalEvent>(1024)` armazenado em `AppState`.
   - Struct `LocalEvent` serializável com os campos exatos do brief: `id`, `type`, `domain`, `action`, `entity_id`, `empresa_id`, `terminal_id`, `operator_id`, `timestamp` (ms), `source`, `version: 1`.
   - Helper `publish_after_commit(bus, event)` — chamada **apenas após** o `tx.commit()? ` retornar `Ok`.
   - Slow-consumer policy: `RecvError::Lagged` → cliente recebe um evento `{ type: "realtime.lagged" }` e re-sincroniza via invalidate global.

2. **`src-tauri/src/local_server.rs`** — adicionar rota `GET /api/events`
   - Handler SSE com `axum::response::sse`.
   - Query param opcional `empresa_id` para filtrar.
   - Keep-alive 15s (`KeepAlive::default().interval(Duration::from_secs(15))`).
   - Header `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
   - Stream que faz `BroadcastStream` → `Event::default().id(uuid).event("message").json_data(evt)`.

3. **Pontos de publicação (onda 1)** — inserir 1 `bus.publish(...)` logo após cada `commit`:
   - venda finalizar → `vendas.created` + `estoque.updated` + `caixa.updated`
   - venda cancelar/atualizar item → `vendas.updated` + `estoque.updated`
   - caixa abrir → `caixa.opened`
   - caixa fechar → `caixa.closed`
   - movimento de caixa → `caixa.updated`
   - produto upsert/delete → `produtos.updated`
   - movimento de estoque → `estoque.updated`
   - sync orquestrador ao terminar lote → `sync.updated`
   - terminal heartbeat (já existe) → `terminais.updated` (com debounce 5s no lado do bus)

### Frontend

4. **`src/integrations/realtime/localRealtimeClient.ts`** (novo)
   - Singleton com `connect(baseUrl, empresaId, queryClient)`.
   - `new EventSource(\`${baseUrl}/api/events?empresa_id=...\`)`.
   - `onmessage` → parse → coalescer (50ms) → `dispatchInvalidate(domain)`.
   - Reconnect com backoff exponencial: 1s → 2s → 5s → 10s → 30s (cap).
   - `onerror`: marca status `reconnecting`; após 3 falhas seguidas → `disconnected`.
   - Cleanup em `disconnect()`.
   - Logs: `[LOCAL_REALTIME]`, `[REALTIME_EVENT]`, `[REALTIME_SSE]`, `[REALTIME_RECONNECT]`, `[REALTIME_INVALIDATE]`.

5. **`src/integrations/realtime/invalidationMap.ts`** (novo)
   - Map estático `domain → queryKey[]`:
     ```ts
     vendas    → ["vendas","dashboard","caixa","financeiro"]
     estoque   → ["estoque","produtos","dashboard"]
     caixa     → ["caixa","dashboard","financeiro"]
     produtos  → ["produtos","pdv-busca-local"]
     sync      → ["sync"]
     terminais → ["terminais"]
     ```
   - `invalidate(qc, domain)` itera e chama `qc.invalidateQueries({ queryKey: [k] })`.

6. **`src/hooks/useLocalRealtime.ts`** (novo)
   - Lê `serverConnection` (host/port atual) + `empresaId` do contexto.
   - Em `useEffect`, conecta o singleton; desconecta no unmount.
   - Expõe `{ status: 'connected'|'reconnecting'|'disconnected' }`.

7. **Integração no `__root.tsx`** (1 linha)
   - Renderiza `<LocalRealtimeProvider />` que apenas chama o hook acima e injeta o `QueryClient`.
   - Sem UI invasiva.

8. **`src/components/layout/RealtimeStatusDot.tsx`** (novo, discreto)
   - Bolinha 6px ao lado do `SyncStatusPill` no header desktop:
     - verde = `connected`, amarelo = `reconnecting`, cinza = `disconnected`.
   - Tooltip: "Realtime local: conectado/reconectando/desconectado".

### Segurança/Performance

- Payload do evento NÃO inclui senha/PIN/token/colunas sensíveis — só metadados (`entity_id`, `domain`, `action`, IDs).
- Coalescing de 50ms no front: múltiplos eventos do mesmo domínio em janela curta = 1 invalidate.
- Debounce 5s no `terminais.heartbeat` no servidor para evitar flood.
- `invalidateQueries` com `refetchType: 'active'` — só refetcha o que está na tela.

---

## Detalhes técnicos

**Crates Rust já presentes** (verificar `Cargo.toml`): `axum`, `tokio`, `serde`, `uuid`. SSE precisa de feature `axum/sse` ou `axum::response::sse` (incluso por padrão no axum 0.7+). Se faltar `tokio-stream` para `BroadcastStream`, adicionar com feature `sync`.

**LocalEvent (Rust)**:
```rust
#[derive(Clone, Serialize, Debug)]
pub struct LocalEvent {
  pub id: String,
  #[serde(rename = "type")] pub kind: String,        // "entity.changed"
  pub domain: String,                                // "vendas" | ...
  pub action: String,                                // "created"|"updated"|"deleted"|...
  pub entity_id: Option<String>,
  pub empresa_id: Option<String>,
  pub terminal_id: Option<String>,
  pub operator_id: Option<String>,
  pub timestamp: i64,                                // ms
  pub source: String,                                // "local"|"lan"|"sync"|"cloud"
  pub version: u32,                                  // 1
}
```

**AppState**: adicionar campo `pub event_bus: broadcast::Sender<LocalEvent>`. Inicializar com `broadcast::channel(1024).0` no startup.

**Ordem de commit**: nunca chamar `bus.send` dentro do escopo de uma transação. Padrão:
```rust
let result = {
  let mut tx = conn.transaction()?;
  // ... writes ...
  tx.commit()?;
  outcome
};
let _ = state.event_bus.send(LocalEvent { ... });
Ok(result)
```

**Cliente SSE — reconnect**: o `EventSource` nativo já reconecta, mas com janela fixa. Para honrar o backoff exponencial pedido, fechamos manualmente em `onerror` e reagendamos via `setTimeout` com jitter.

**Filtragem por empresa**: lado Rust descarta eventos cujo `empresa_id` ≠ ao filtro do cliente (Option compare; se cliente não passou, recebe tudo — útil pra debug).

**Sem quebra**:
- Tudo é aditivo. Se o servidor Rust falhar ao subir o broadcast, rotas existentes continuam funcionando.
- Se `/api/events` não responder, o front continua usando refetch periódico (já existe via `staleTime` do React Query).

---

## Tarefas (ordem de execução)

1. Rust: `event_bus.rs` + integrar no `AppState`.
2. Rust: rota `GET /api/events` (SSE).
3. Rust: publicar nos 6 domínios da onda 1 após commit.
4. Front: `localRealtimeClient.ts` + `invalidationMap.ts`.
5. Front: `useLocalRealtime` + `LocalRealtimeProvider` no `__root.tsx`.
6. Front: `RealtimeStatusDot` no header.
7. Validação: smoke test manual (venda → estoque atualiza sem F5).

---

## Out of scope desta PR

- WebSocket / fallback.
- Onda 2 (financeiro, contas, clientes, fornecedores, funcionários, compras, dashboard agregado).
- Push para terminais via mDNS/broadcast — terminais já se conectam ao servidor local via HTTP, então o mesmo `/api/events` resolve.
- Persistência de eventos / replay histórico.
- Testes automatizados (a verificação é manual nesta onda).

Confirma que posso seguir com a onda 1 nesses termos?