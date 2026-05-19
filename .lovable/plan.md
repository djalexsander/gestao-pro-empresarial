## PR-F0 — Infraestrutura de sync para destravar Financeiro local-first

Esta é a fundação que falta para finalizar os 4 itens 🚫 bloqueados da Onda 2
(`indicadoresMes`, `performancePeriodo`, `pagamentosPorLancamento`,
`listIfoodPendentes`). É um PR de plumbing, sem mudança visível de UI.

### Escopo

Criar 3 novos caches SQLite alimentados pelo orquestrador de sync já existente,
seguindo o mesmo padrão de `financeiro_lancamentos_completo`/`vendas_remote_cache`:

| Cache novo                  | Origem (cloud)                         | Desbloqueia                                              |
|-----------------------------|----------------------------------------|----------------------------------------------------------|
| `pagamentos_local`          | `financeiro_pagamentos`                | item 9 (`pagamentosPorLancamento`)                       |
| `ifood_pedidos_local`       | `ifood_pedidos` (pendentes)            | item 11 (`listIfoodPendentes`)                           |
| `venda_itens_remote_cache`  | `venda_itens` JOIN `produtos.preco_custo` | itens 1 e 3 (`indicadoresMes`, `performancePeriodo`) |

### Trabalho por arquivo

**`src-tauri/src/db.rs`** — 3 migrations + 3 ingest + 3 read helpers
- `CREATE TABLE pagamentos_local(id PK, lancamento_id, data_pagamento_ms, payload, deleted_at_ms, updated_at_remote_ms, synced_at_ms)` + índice por `lancamento_id`.
- `CREATE TABLE ifood_pedidos_local(id PK, status, created_at_ms, payload, deleted_at_ms, ...)`.
- `CREATE TABLE venda_itens_remote_cache(id PK, venda_id, produto_id, payload, deleted_at_ms, ...)` + índice por `venda_id`.
- `ingest_pagamentos`, `ingest_ifood_pedidos`, `ingest_venda_itens_remote` no shape de `ingest_lancamentos_completo`.
- `read_pagamentos_por_lancamento(lanc_id)`, `read_ifood_pendentes(limit)`, helpers de JSON-extract para itens.

**`src-tauri/src/local_server.rs`** — dispatch + endpoints
- 3 arms novos no `match domain` de ingest (linhas ~580-660).
- `GET /api/financeiro/pagamentos?lancamento_id=` → `db::read_pagamentos_por_lancamento`.
- `GET /api/financeiro/ifood-pendentes?limit=` → `db::read_ifood_pendentes`.
- `GET /api/financeiro/performance-periodo?inicio=&fim=` → agrega `vendas_remote_cache` + `venda_itens_remote_cache` + `produtos_local.payload` via JSON1 (preco_custo).
- `GET /api/financeiro/indicadores-mes` → reusa o acima + agrega financeiro/caixa do mês.
- Headers `x-gp-source: local-table` em todas.

**`src/integrations/data/adapters/local-terminal.ts`** — registrar 3 domínios novos
- Adicionar `"pagamentos"`, `"ifood_pedidos"`, `"venda_itens_remote"` em todas as listas de orquestração de sync (bootstrap, full refresh, incremental, drain, ~10 ocorrências).

**`src/integrations/data/adapters/local-server.ts`** — local-first nos 4 métodos
- Substituir `pagamentosPorLancamento`, `listIfoodPendentes`, `performancePeriodo`, `indicadoresMes` (hoje herdados de `cloudAdapter`) por wrappers `withCloudFallback(...)` chamando os novos endpoints `/api/financeiro/*`.

### Estratégia de entrega (em 4 sub-PRs sequenciais para reduzir risco)

```text
PR-F0.1  pagamentos_local      → destrava item 9   (mais simples — 1 query, 1 endpoint)
PR-F0.2  ifood_pedidos_local   → destrava item 11
PR-F0.3  venda_itens cache     → destrava itens 1 e 3 (mais complexo — JOIN com produtos)
PR-F0.4  QA + atualizar plano  → marcar 1, 3, 9, 11 como ✅
```

Cada sub-PR fecha sozinho: migration + ingest + endpoint + adapter wrapper + verificação
de build, sem deixar o repo em estado intermediário.

### Premissas a confirmar

1. As tabelas cloud `financeiro_pagamentos`, `ifood_pedidos` e `venda_itens` existem
   com `updated_at` para sync incremental. Caso `ifood_pedidos` não exista (Onda 1
   removeu o módulo iFood?), pulamos PR-F0.2 e marcamos item 11 como descontinuado.
2. `produtos_local.payload` já contém `preco_custo` (já confirmado: `db.rs:2385`).
3. Nada do que está atualmente ✅ regride — todos os endpoints novos só adicionam,
   nunca alteram tabelas/funções existentes.

### Não fazer agora

- Sem refactor do orquestrador de sync — só registrar novos domínios.
- Sem mexer em PDV/Caixa/Vendas/Compras/Estoque.
- Sem alterar contratos de `dataClient.financeiro.*`.
- Sem migration no Supabase (cloud) — só SQLite local.

### Próximo passo

Começo por **PR-F0.1 (`pagamentos_local`)** assim que aprovado.