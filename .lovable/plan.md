
# Plano: Caixa/PDV Offline-First (Tauri + SQLite)

Objetivo: garantir que Caixa e PDV funcionem 100% no banco local SQLite quando o servidor local está ativo, com sincronização posterior idempotente para a nuvem. Sem reescrever o app, sem alterar layout, sem tocar em assinatura/módulos.

---

## Diagnóstico do travamento atual (ETAPA 1 — prioridade imediata)

O fluxo `caixa.abrir` no adapter `local-server.ts` ainda chama `postLocalAuthDetail("caixa/abrir", ...)`, que por sua vez tenta obter um JWT do Supabase (`supabase.auth.getSession()`). Quando está offline:

1. `getSession()` pode pendurar enquanto tenta refresh sem rede (mitigado parcialmente pelo timeout de 1s já existente, mas a sessão pode estar expirada → retorna sem token).
2. Sem JWT, o handler Rust `caixa/abrir` rejeita com 401 "Não autenticado" porque o RPC Supabase exige user JWT — e atualmente o handler **sempre** tenta dar push upstream antes de responder, mesmo após o spawn background.
3. Mesmo com push em background, a abertura local **ainda exige** um `user_id` resolvido via JWT para gravar a linha SQLite (validação no início do handler `caixa::abrir`).

Resultado: o frontend fica em "Abrindo..." até o timeout de 8s, e quando sai dá erro — não é uma abertura local real.

A correção é desacoplar **completamente** a abertura local da identidade Supabase: usar o `empresa_id` + `operador_id` + `terminal_id` já conhecidos pelo servidor local (vindos do `LOCAL_IDENTITY` cacheado) e do payload, gerar `client_uuid` no cliente, gravar no SQLite, e responder em <100ms.

---

## Mudanças por etapa

### Etapa 1 — Abrir caixa offline (foco do turno)

**Rust (`src-tauri/src/local_server.rs` — handler `caixa::abrir`)**
- Remover a exigência de JWT válido para gravar localmente. Resolver `usuario_id` por esta ordem: (1) JWT atual via `remember_auth`/`last_auth`, (2) último `usuario_id` cacheado em `LOCAL_IDENTITY`, (3) `null` (admin direto offline — registrado em coluna `usuario_id` permitindo null).
- Aceitar `client_uuid` do payload; se ausente, gerar `uuid_v7()` no Rust.
- Validar idempotência: `SELECT id FROM caixa WHERE client_uuid = ?` antes de inserir. Se existir, retornar o id existente (200 OK).
- Validar regra: não permitir 2 caixas abertos no mesmo `terminal_id` (consulta `WHERE terminal_id=? AND status='aberto'`). Se já houver, retornar o existente com flag `reused=true`.
- Gravar com `status='aberto'`, `synced=0`, `data_abertura=now()`.
- Enfileirar outbox `caixa_abertura` com `client_uuid`, `payload` JSON.
- Push upstream em `tokio::spawn` com timeout 3s — nunca bloquear a resposta.
- Responder em <100ms com `{ caixa_id, client_uuid, reused, source: 'local' }`.

**Frontend (`src/integrations/data/adapters/local-server.ts` — `caixa.abrir`)**
- Gerar `client_uuid` (crypto.randomUUID) antes da chamada. Salvar em sessionStorage para retry idempotente.
- Reduzir timeout local para 5s (operação puramente SQLite).
- Em modo servidor local: **nunca** cair para cloud. Erro = erro.
- Log estruturado: `[caixa.abrir] adapter=local payload=... t_ms=...`.

**Frontend (`src/components/caixa/AbrirCaixaDialog.tsx`)**
- Garantir que `onError` da mutation sai do estado pending (já é o comportamento do react-query, mas validar que `toast.error` aparece e o dialog não trava).
- Adicionar fallback visual: se `mutateAsync` rejeitar, manter dialog aberto com a mensagem e botão habilitado.

### Etapa 2 — Estado do caixa local
- `caixa.aberto({ operador_id, terminal_id })` no adapter local-server: consulta SQLite direto, sem cloud. Filtro: `status='aberto' AND terminal_id=? AND (operador_id=? OR operador_id IS NULL)`.
- `RequirePosSession` já usa `useCaixaAberto(operador.id)` — funcionará automaticamente quando o adapter retornar do SQLite.

### Etapa 3 — Movimentações (sangria/suprimento)
- Handler `caixa/movimento` já existe; aplicar mesma desacoplagem de JWT + idempotência por `client_uuid` (frontend já envia em `useRegistrarMovimentoCaixa`).
- Enfileirar outbox `caixa_movimento`.

### Etapa 4 — Venda offline vinculada ao caixa
- Vendas já passam pelo handler local. Validar que `caixa_id` enviado é o local (uuid gerado em Etapa 1).
- Outbox de venda deve enviar `caixa_client_uuid` em vez de id local, para o servidor resolver o id real após sync da abertura.
- Atualização de estoque local e financeiro local já são feitas pelo handler atual; revisar idempotência.

### Etapa 5 — Fechamento offline
- Handler `caixa/fechar` aceita fechamento local com totais calculados de `caixa_movimentos` + `vendas` locais.
- Enfileirar outbox `caixa_fechamento` — só roda upstream **depois** que abertura + vendas + movimentos do mesmo caixa estiverem sincronizados (ordering via dependência por `client_uuid`).

### Etapa 6 — Prevenção de inconsistência
- Constraint no SQLite: `CREATE UNIQUE INDEX caixa_terminal_aberto ON caixa(terminal_id) WHERE status='aberto'`.
- Migration `v25` adiciona o índice + coluna `client_uuid` se não existir.
- Recuperação ao reabrir app: handler `caixa/aberto` lê SQLite, sem dependência de cloud.

### Etapa 7 — Sincronização posterior
- Scheduler de outbox processa na ordem: `caixa_abertura` → `venda` / `caixa_movimento` → `caixa_fechamento`.
- Mapeamento `client_uuid → cloud_id` armazenado em tabela `id_map` para resolver FKs.
- Idempotência server-side via `client_uuid` único nas RPCs Supabase (já existe na maioria; validar `caixa_abrir`).

### Etapa 8 — Auditoria
- Log estruturado em SQLite (`audit_log`): `evento`, `caixa_id`, `terminal_id`, `operador_id`, `usuario_id`, `valor`, `timestamp`, `sync_status`.
- Relatório de caixa já existe; adicionar coluna "origem" (local/sincronizado).

### Etapa 9 — UI e erros
- `AbrirCaixaDialog` / `FecharCaixaDialog`: timeout duro de 10s no botão. Se exceder, force reset do estado pending + toast erro técnico.
- Banner contextual "Operando offline — será sincronizado depois" quando caixa aberto tem `synced=false`.

### Etapa 10 — Critério final
QA manual com Wi-Fi desligado: login PIN → abrir caixa → vender → sangria → fechar → reabrir app → religar internet → verificar sync.

---

## Escopo deste turno

Implementar **apenas a Etapa 1 + base da Etapa 6 (índice + client_uuid)** porque é o que destrava o usuário hoje. As etapas 2–10 são naturalmente habilitadas depois que a abertura local funciona, e cada uma merece seu próprio turno para QA isolado.

### Arquivos que serão modificados neste turno

1. `src-tauri/migrations/` — nova migration v25 (índice único + coluna `client_uuid` em `caixa` e `caixa_movimentos`).
2. `src-tauri/src/local_server.rs` — handler `caixa::abrir`: desacoplar JWT, idempotência por `client_uuid`, reuso de caixa aberto por terminal, resposta <100ms.
3. `src/integrations/data/adapters/local-server.ts` — `caixa.abrir`: gerar `client_uuid`, timeout 5s, sem fallback cloud em modo local.
4. `src/components/caixa/AbrirCaixaDialog.tsx` — proteção contra loading infinito (timeout client-side + reset garantido).

### Detalhes técnicos

- `client_uuid` no payload: `crypto.randomUUID()` no cliente, persistido em `sessionStorage` durante o tempo de vida do dialog para suportar retry idempotente sem duplicar caixa.
- Migration usa `IF NOT EXISTS` para ser segura em bancos já existentes (schema v24 → v25).
- Push upstream permanece em background com `tokio::spawn` — já está implementado, só garantir que a abertura local não depende dele.

Depois que o usuário confirmar que abrir caixa offline funciona, abrimos turnos separados para Etapas 2→10.
