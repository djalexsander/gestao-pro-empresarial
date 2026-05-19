# Plano — Financeiro 100% local no desktop (Onda 2)

Objetivo: eliminar as quedas `cloud (fallback)` nas telas de Financeiro
quando o app está rodando em modo **Servidor** ou **Terminal** desktop.
Hoje, vários métodos do domínio `financeiro` **herdam direto do
`cloudAdapter`** (via `...cloudAdapter.financeiro`) no `local-server`
adapter e nunca tentam o SQLite local.

Esta Onda 2 NÃO entra agora — está documentada para a próxima sessão.
Quick wins (badge, status, useFuncionarios) já foram aplicados.

---

## Princípios

1. **Local-first**: a UI chama `dataClient.financeiro.*`, o adapter
   `local-server` tenta `127.0.0.1:<porta>` primeiro e só cai em
   `cloudAdapter` se o backend local estiver indisponível.
2. **Mesma forma de retorno**: cada método novo no Rust deve devolver o
   payload já no formato dos tipos em
   `src/integrations/data/extra-types.ts` (`PosicaoFinanceiraDomain`,
   `PerformancePeriodoDomain`, `ReceberOrigemDomain`, etc.) para não
   precisar mexer nos hooks (`useFinanceiroSecoes`, `useFinanceiroIndicadores`).
3. **Filtros de período aplicados no SQL**, não em memória.
4. **Fallback cloud sempre disponível** via `withCloudFallback(...)` quando
   o local devolver `null` (servidor desligado, tabela vazia em primeiro uso).
5. **Sem migration nova**: as tabelas SQLite usadas abaixo já existem
   (`financeiro_lancamentos_completo`, `pagamentos_local`, `caixa_movimentos_local`,
   `vendas_local`, `vendas_pagamentos_local`, `ifood_pedidos_local`).

---

## Auditoria das tabelas SQLite (validação do plano)

Verificação contra `src-tauri/src/db.rs` antes de implementar:

| Tabela assumida no plano | Existe? | Observação |
|---|---|---|
| `financeiro_lancamentos_completo` (cache → `financeiro_lancamentos_local`) | ✅ | OK — payload JSON completo armazenado |
| `caixa_movimentos_local` | ✅ | Nome real: `caixa_movs_local` |
| `vendas_local` / `vendas_itens_local` | ✅ | OK (verificar se sync traz `custo_unitario`) |
| `venda_pagamentos_local` | ✅ | É de PAGAMENTOS DE VENDA, não de lançamento financeiro |
| `pagamentos_local` (pagamentos de lançamento financeiro) | ❌ | **NÃO existe** — precisa migration + sync |
| `ifood_pedidos_local` | ❌ | **NÃO existe** — precisa migration + sync |

### Implicações no roadmap

- Itens **9** (`pagamentosPorLancamento`) e **11** (`listIfoodPendentes`) ficam **bloqueados** até criar:
  1. Migration SQLite para `pagamentos_local` e `ifood_pedidos_local`.
  2. Sync incremental dessas tabelas (similar ao `financeiro_lancamentos_completo`).
- Item **10** (`lancamentoFks`) ✅ implementado nesta sessão usando o cache existente.

---

## Métodos pendentes — mapeamento

Legenda da coluna "Fonte SQLite": tabelas já existentes no `src-tauri/src/db.rs`.

| # | Método (dataClient.financeiro.*) | Endpoint Rust a criar                                  | Verbo | Fonte SQLite                                                                 | Fallback                                  | Status |
|---|----------------------------------|--------------------------------------------------------|-------|-------------------------------------------------------------------------------|-------------------------------------------|--------|
| 1 | `indicadoresMes()`               | `/api/financeiro/indicadores-mes?hoje=`                | GET   | `vendas_remote_cache` + `venda_itens_remote_cache` (custo embutido) + `financeiro_lancamentos_local` (AR/recebido hoje/vencidos) | `cloudAdapter.financeiro.indicadoresMes`  | ✅ **Feito** |
| 2 | `posicaoPeriodo({inicio,fim})`   | `/api/financeiro/posicao-periodo?inicio=&fim=`         | GET   | `financeiro_lancamentos_local` (JSON1: valor/valor_pago por tipo, filtro `data_vencimento_ms`) | `cloudAdapter.financeiro.posicaoPeriodo`  | ✅ **Feito** |
| 3 | `performancePeriodo({inicio,fim})` | `/api/financeiro/performance-periodo?inicio=&fim=` | GET | `vendas_remote_cache` + `venda_itens_remote_cache` (JSON1: `$.produto.preco_custo` já vem embutido via PostgREST) | `cloudAdapter.financeiro.performancePeriodo` | ✅ **Feito** |
| 4 | `receberOrigem({periodo,forma})` | `/api/financeiro/receber-origem?inicio=&fim=&forma=&hoje=` | GET | `financeiro_lancamentos_local` (JSON1: abertos fiado/ifood + pagos no período + vencidos < hoje) | `cloudAdapter.financeiro.receberOrigem`   | ✅ **Feito** |
| 5 | `listLancamentosCompleto({...})` | `/api/financeiro/lancamentos-completo` (já existe via proxy+cache) | GET | `financeiro_lancamentos_local`                                            | já existe                                 | ✅ (já local via proxy) |
| 6 | `fluxoPorForma({inicio,fim})`    | `/api/financeiro/fluxo-por-forma?inicio=&fim=`         | GET   | `venda_pagamentos_local` JOIN `vendas_local` (filtro por `created_at_ms`) | `cloudAdapter.financeiro.fluxoPorForma`   | ✅ **Feito** |
| 7 | `movimentosCaixaPeriodo({inicio,fim,caixaId?})` | `/api/financeiro/movimentos-caixa?inicio=&fim=` | GET | `caixa_movs_local` JOIN `caixa_local` (venda_id=null no cache) | `cloudAdapter.financeiro.movimentosCaixaPeriodo` | ✅ **Feito** |
| 8 | `lancamentosAvulsosPagos({inicio,fim})` | `/api/financeiro/avulsos-pagos?inicio=&fim=`    | GET   | `financeiro_lancamentos_local` (JSON1: caixa_id/venda_id null + data_pagamento) | `cloudAdapter.financeiro.lancamentosAvulsosPagos` | ✅ **Feito** |
| 9 | `pagamentosPorLancamento(lancId)`| `/api/financeiro/pagamentos?lancamento_id=`            | GET   | `pagamentos_local` (PR-F0): cache on-demand por `lancamento_id` — handler tenta upstream → ingest → fallback cache stale | `cloudAdapter.financeiro.pagamentosPorLancamento` | ✅ **Feito** |
|10 | `lancamentoFks(lancId)`          | `/api/financeiro/lancamento-fks?lancamento_id=`        | GET   | `financeiro_lancamentos_local.payload` (extrai FKs do JSON)                   | `cloudAdapter.financeiro.lancamentoFks`   | ✅ **Feito** |
|11 | `listIfoodPendentes({limit?})`   | `/api/financeiro/ifood-pendentes?limit=`               | GET   | `financeiro_lancamentos_local` (JSON1: forma_pagamento='ifood' AND status='pendente'; cliente.nome embutido via PostgREST) | `cloudAdapter.financeiro.listIfoodPendentes` | ✅ **Feito** |

### Status geral da Onda 2

✅ **Onda 2 completa** — todos os 11 métodos do `financeiro` são local-first
com `withCloudFallback`:
- ✅ 1, 2, 3, 4, 6, 7, 8, 10, 11 — agregações/leituras em caches existentes.
- ✅ 5 já era local via proxy/cache existente.
- ✅ 9 — novo cache `pagamentos_local` (PR-F0) populado on-demand pelo
  handler (upstream → ingest → cache stale offline).

---

## Estrutura do trabalho (PRs sugeridos)

### PR-F1 — Rust: endpoints somente-leitura simples (itens 5, 9, 10, 11)
- Reaproveitam tabelas já populadas pelo sync atual.
- Sem agregações complexas → 1 query SQL por endpoint.
- Risco: baixo.

### PR-F2 — Rust: agregações de período (itens 1, 2, 4, 6, 8)
- Cada endpoint encapsula 1 SQL com `SUM(...) FILTER (WHERE ...)` ou
  CTEs equivalentes para SQLite.
- Devolver payload já no shape do domínio (ver `extra-types.ts`).
- Risco: médio (precisão das somas vs. cloud).

### PR-F3 — Rust: agregações cruzando vendas/compras (itens 3, 7)
- `performancePeriodo` precisa ler `vendas_local` + `vendas_itens_local`
  (vendido, custo dos itens) — confirmar que o sync de vendas já carrega
  `custo_unitario`. Se não, adicionar no sync antes deste endpoint.
- `movimentosCaixaPeriodo` exige join de `caixa_movimentos_local` com
  `caixas_local` para trazer `caixa_nome` e `operador_nome`.
- Risco: médio-alto (custo de produto pode faltar offline).

### PR-F4 — TS: wrappear cada método no `local-server` adapter
- Para cada item acima, substituir o herdado de `...cloudAdapter.financeiro`
  por uma função usando `withCloudFallback(domain, method, localFetcher, cloudFetcher)`.
- O `localFetcher` chama `tryLocal<DTO>(...)` e mapeia para o tipo do domínio.
- Acrescentar `reportDataSource(...)` nos branches de sucesso/fallback.
- Risco: baixo (puramente de fiação).

### PR-F5 — QA
- Cenários:
  1. Servidor online + dados → tudo deve aparecer com badge **servidor local**.
  2. Servidor online + tabela vazia → badge **servidor local** (sem fallback).
  3. Servidor offline → badge **+ fallback cloud** apenas nas consultas que falharam.
  4. Web/PWA → continua 100% cloud, sem regressão.
- Comparar somas (mês vigente) com cloud por 1 semana antes de liberar.

---

## Notas de implementação Rust

- Reusar o helper `query_json` (ou similar) do `src-tauri/src/db.rs` em vez
  de escrever serializadores novos.
- Endpoints GET, todos retornam `200 { data: ... }` (envelope que o
  `tryLocal` já desempacota).
- Em caso de tabela ainda vazia (primeiro sync), preferir devolver `200`
  com dados zerados em vez de `503`, **exceto** para listas detalhadas
  (itens 5, 9, 10, 11) onde `[]` já é um resultado válido — o adapter
  só deve cair em fallback se a tabela inteira não existir ou der erro.
- Acrescentar `header x-gp-source: local-table` em todas as respostas
  para o logger DEV identificar a origem.

---

## Não fazer agora
- Sem refactor grande do `local-server.ts`.
- Sem alterar contratos públicos do `dataClient.financeiro.*`.
- Sem mexer em PDV, Caixa, Vendas, Compras, Estoque.
- Sem migrações novas de schema antes do PR-F1.
