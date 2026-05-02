# Offline-First Local — Visão consolidada

> Documento de referência para a frente local/offline-first do Gestão Pro
> Desktop/Tauri. Espelha o estado atual após a etapa de consolidação. Atualize
> aqui sempre que acrescentar um novo domínio à arquitetura local.

---

## 1. Princípios

1. **Local-first, eventually consistent**: toda escrita crítica passa primeiro
   pelo SQLite local (`db.rs`); o upstream (Lovable Cloud) é alimentado de
   forma assíncrona via outboxes.
2. **Idempotência ponta-a-ponta**: cada escrita carrega um `client_uuid`
   estável (= `local_uuid` quando existir) que é usado tanto na unicidade
   local quanto no contrato com o upstream. Reenvios nunca duplicam.
3. **Ordem causal preservada**: cancelamentos só são empurrados após a venda
   original ter sincronizado (`waiting_venda_sync`).
4. **Retry exponencial com backoff**: schedulers próprios por domínio,
   `next_attempt_at_ms` controlando elegibilidade, `MAX_AUTO_ATTEMPTS`
   limitando tentativas automáticas; estouro vira `error`, recuperável via
   "Reenfileirar erros".
5. **Observabilidade obrigatória**: cada outbox expõe `/stats`, `/flush`,
   `/retry-errors` e aparece no DesktopTab (visão geral + card detalhado).

---

## 2. Domínios locais

| Domínio        | Tabela local                          | Outbox                          | Endpoint upstream (RPC)              |
|----------------|---------------------------------------|---------------------------------|--------------------------------------|
| Estoque        | `estoque_movs_local`                  | `outbox_estoque_movs`           | `rpc/registrar_movimentacao_estoque` |
| Vendas         | `vendas_local` + `vendas_itens_local` | `outbox_vendas`                 | `rpc/registrar_venda_completa`       |
| Caixa          | `caixas_local` + `caixa_movs_local`   | `outbox_caixa` (`action`)       | múltiplos RPCs (`abrir/mov/fechar`)  |
| Cancelamentos  | colunas em `vendas_local`             | `outbox_cancelamentos_venda`    | `rpc/cancelar_venda`                 |
| Financeiro     | `lancamentos_financeiros_local`       | `outbox_financeiro`             | `rpc/criar_lancamento_avulso`        |

Schema atual: **v12** (`db.rs::CURRENT_SCHEMA_VERSION`).

---

## 3. Anatomia de uma outbox

Toda outbox segue o mesmo formato canônico:

```sql
CREATE TABLE outbox_<dominio> (
  local_uuid          TEXT PRIMARY KEY,
  client_uuid         TEXT,              -- UNIQUE parcial p/ idempotência
  payload             TEXT NOT NULL,     -- JSON pronto p/ upstream
  status              TEXT NOT NULL,     -- pending|sending|sent|error
  attempts            INTEGER DEFAULT 0,
  last_error          TEXT,
  remote_id           TEXT,
  created_at_ms       INTEGER,
  updated_at_ms       INTEGER,
  sent_at_ms          INTEGER,
  next_attempt_at_ms  INTEGER            -- backoff exponencial
);
```

Índices padrão: `(status, created_at_ms)`, `(status, next_attempt_at_ms)`,
unique parcial em `client_uuid`. Quando há vínculo causal (cancelamento ↔
venda) há índice/unique adicional em `<vinculo>_local_uuid`.

---

## 4. Schedulers

Cada domínio tem seu `run_outbox_<dominio>_scheduler` em `local_server.rs`,
com:

- tick periódico (5–15s);
- backoff exponencial baseado em `attempts` (mín. ~5s, máx. ~5min);
- `MAX_AUTO_ATTEMPTS` antes de marcar `error`;
- telemetria gravada na própria stats (`last_auto_*`);
- tratamento idempotente de "já existe" como sucesso (HTTP 409 / unique
  violation).

---

## 5. Sync incremental de leitura

Tabelas de cadastro (produtos, clientes) são ingeridas por
`updated_at_remote_ms`/cursor, com soft-delete por status (`is_tombstoned_status`).
Movimentos append-only (estoque) usam `data_movimentacao` como cursor e
**não** geram tombstones por ausência. Saldos (`estoque_saldos_local`) são
**derivados** das movimentações ingeridas.

Limitação conhecida (fora do escopo desta frente): hard-delete real exigiria
endpoint dedicado de tombstones no upstream — o `deleted_at_ms` local já
existe e está pronto para receber.

---

## 6. Fluxo oficial: local → fila → upstream

```
[UI / PDV]
   │ 1. usuário confirma ação
   ▼
[adapter local-terminal.ts]
   │ 2. chama HTTP do daemon Tauri
   ▼
[local_server.rs / db.rs]
   │ 3. transação: escrita local + INSERT outbox
   ▼
[scheduler do domínio]
   │ 4. seleciona pending elegíveis (next_attempt_at_ms<=now)
   │ 5. push_one_outbox_<dominio> → upstream
   │ 6. sucesso → status=sent, sync_status=synced, remote_id preenchido
   │    falha   → attempts++, backoff, eventualmente status=error
   ▼
[DesktopTab]
   │ stats polling 5s + visão geral unificada
```

---

## 7. Observabilidade no DesktopTab

- **Visão geral — filas offline**: tabela única com pendentes / prontas /
  enviadas / erros / próx. auto / saúde por domínio.
- **Card por fila**: detalhes por status, último envio, último erro,
  telemetria do scheduler, botões "Sincronizar agora" e "Reenfileirar erros".
- **Tabela do domínio** (ex: Financeiro local): badge `sync_status` +
  prefixo do `remote_id` quando aplicável.
- Polling rápido (5s) para todas as stats; polling completo (30s) para
  cadastros + resumos.

---

## 8. Arquivos críticos

| Camada                | Arquivo                                                   |
|-----------------------|-----------------------------------------------------------|
| Schema + transações   | `src-tauri/src/db.rs`                                     |
| HTTP local + schedulers | `src-tauri/src/local_server.rs`                         |
| Helpers TS            | `src/integrations/desktop/serverConnection.ts`            |
| Adapter               | `src/integrations/data/adapters/local-terminal.ts`        |
| UI / observabilidade  | `src/components/configuracoes/DesktopTab.tsx`             |
| Documentação          | `.lovable/arquitetura-rede-local.md` (visão estratégica) |
|                       | `.lovable/offline-first-overview.md` (este arquivo)       |

---

## 9. Convenções e coerência entre domínios

- **Naming**: `<dominio>_local`, `outbox_<dominio>`, `run_outbox_<dominio>_scheduler`,
  `push_one_outbox_<dominio>`, `flush_outbox_<dominio>`,
  `fetchOutbox<Dominio>Stats`, `handleFlush<Dominio>`, `handleRetryErrors<Dominio>`.
- **Status local**: `local_only` → `pending` → `synced` | `error`.
- **Status outbox**: `pending` → `sending` → `sent` | `error`.
- **Idempotência**: sempre por `client_uuid` (= `local_uuid` quando há
  registro local correspondente).
- **Fallback de leitura**: `local-table-stale` quando a nuvem cai.

---

## 10. Fora do escopo desta frente

Itens conhecidos que ficam para frentes futuras (não bloqueiam o uso atual):

1. **Endpoint upstream de tombstones** para hard-delete real de cadastros.
2. **Conciliação automática** entre `lancamentos_financeiros_local` (derivados)
   e `financeiro_lancamentos` na nuvem (hoje a nuvem segue como fonte da
   verdade do financeiro real, derivados locais são auxiliares).
3. **Multi-terminal merge** com resolução de conflito explícita
   (atualmente a unicidade por `client_uuid` evita duplicação, mas não há
   merge de divergências semânticas).
4. **Compactação/arquivamento** de outboxes antigas (`status=sent` há > N
   dias) — hoje crescem indefinidamente.
