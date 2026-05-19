# Plano — Onda 3: local-first nos demais domínios

Continuação da Onda 2 (Financeiro 100% local). Foco: eliminar as
chamadas `cloud (fallback)` que ainda restam em **Relatórios**,
**Compras**, **Estoque** e **Vendas (leituras)** quando o desktop
está no modo Servidor/Terminal.

## Princípios (herdados da Onda 2)
- Local-first via `127.0.0.1:<porta>` no adapter `local-server`, com
  `withCloudFallback(...)` em todos os métodos.
- Mesmo shape de retorno do `cloudAdapter` — sem mexer em hooks/telas.
- Filtros e agregações em SQL no Rust, nunca em memória no TS.
- Sem alterar mutations (escrita continua na cloud + sync).
- Sem novas migrations sempre que possível — preferir reusar
  `vendas_remote_cache`, `venda_itens_remote_cache`,
  `financeiro_lancamentos_local`, `caixa_movs_local`, `compras_local`,
  `produtos_local`, `estoque_movs_local`.

---

## Auditoria — o que ainda cai em `cloudAdapter`

Spreads `...cloudAdapter.X` no `src/integrations/data/adapters/local-server.ts`
mostram quais métodos herdam direto da cloud (sem fallback local):

### `relatorios` — faltam 4 métodos
| Método | Fonte SQLite sugerida | Risco |
|---|---|---|
| `cardContasReceber()` | `financeiro_lancamentos_local` (status=pendente, JSON1 cliente.nome) | baixo |
| `categoriasFinanceiras()` | já existe cache → criar endpoint leitura | baixo |
| `lancamentosContasReceber({inicio,fim,campoData,clienteId})` | `financeiro_lancamentos_local` (JSON1 filtros por data + cliente_id) | médio |
| `atualizarObservacaoCaixa(id, obs)` | **mutation** — manter cloud direto + invalidar cache local | n/a |

### `compras` — todas as leituras (4 métodos)
| Método | Fonte | Risco |
|---|---|---|
| `list({inicio,fim,status?,fornecedorId?})` | `compras_local` (filtros SQL) | médio |
| `obter(compraId)` | `compras_local` + `compra_itens_local` | médio |
| `listItens(compraId)` | `compra_itens_local` | baixo |
| `listPagamentos(compraId)` | depende de `compra_pagamentos_local` — verificar se existe | médio |

### `vendas` — leituras complementares (2 métodos)
| Método | Fonte | Risco |
|---|---|---|
| `list({inicio,fim,status?,clienteId?})` | `vendas_remote_cache` (JSON1) | médio |
| `obter(vendaId)` (se chamado pela UI) | `vendas_remote_cache` + `venda_itens_remote_cache` | médio |

### `estoque` — leituras secundárias
| Método | Fonte | Risco |
|---|---|---|
| `saldosLinhas()` | já tem override ✅ | — |
| `movimentacoes({inicio,fim,produtoId?,tipo?})` | já tem override ✅ | — |
| `historicoProduto(produtoId)` (se existir) | `estoque_movs_local` | baixo |

### `clientes` / `fornecedores` / `produtos`
- `list*` já têm override local. As mutations continuam cloud-only
  (correto, pois sync replica de volta).
- Verificar `buscarPorDocumento`, `buscarPorCodigo`, `buscarPorPlu`:
  hoje vão direto na cloud — adicionar leitura local em
  `produtos_local`/`clientes_local` por `documento`/`codigo`/`plu`.

### `dashboard.carregar()`
- Hoje é 100% cloud. Avaliar fatiar: a maior parte dos KPIs já
  existem nos endpoints locais de Financeiro/Relatórios. Pode virar
  uma composição local que reusa os endpoints já criados, sem nada
  novo no Rust.

---

## PRs sugeridos

### PR-O3-1 — Relatórios (4 métodos restantes)
- Rust:
  - `GET /api/relatorios/card-contas-receber`
  - `GET /api/relatorios/categorias-financeiras`
  - `GET /api/relatorios/lancamentos-contas-receber?inicio=&fim=&campoData=&clienteId=`
- TS: wrappers `withCloudFallback`. `atualizarObservacaoCaixa` segue cloud.
- Risco: baixo.

### PR-O3-2 — Compras (leituras)
- Confirmar tabelas `compras_local`, `compra_itens_local`,
  `compra_pagamentos_local` no `db.rs`. Criar migration se faltar
  apenas `compra_pagamentos_local`.
- Rust:
  - `GET /api/compras/list?inicio=&fim=&status=&fornecedor_id=`
  - `GET /api/compras/obter?id=`
  - `GET /api/compras/itens?compra_id=`
  - `GET /api/compras/pagamentos?compra_id=` (on-demand, padrão
    similar ao `pagamentos_local` da Onda 2 se necessário)
- TS: 4 wrappers `withCloudFallback`.
- Risco: médio (depende do estado atual do sync de compras).

### PR-O3-3 — Vendas (leituras)
- Rust:
  - `GET /api/vendas/list?inicio=&fim=&status=&cliente_id=`
    (JSON1 sobre `vendas_remote_cache`)
  - `GET /api/vendas/obter?id=` (cache existente + itens)
- TS: 2 wrappers.
- Risco: médio (volume — paginar se necessário).

### PR-O3-4 — Lookups rápidos (produtos/clientes)
- Rust:
  - `GET /api/produtos/por-codigo?codigo=`
  - `GET /api/produtos/por-plu?plu=`
  - `GET /api/clientes/por-documento?documento=`
- TS: 3 wrappers.
- Risco: baixo, ganho alto (PDV mais rápido offline).

### PR-O3-5 — Dashboard
- Reescrever `dashboard.carregar()` no `local-server` como
  composição de chamadas locais já existentes (relatórios + financeiro)
  com `Promise.all`. Fallback cloud só se algum branch quebrar.
- Risco: baixo (puro TS).

### PR-O3-6 — QA
- Mesmos 4 cenários da Onda 2 (servidor on/dados, on/vazio, offline,
  web). Comparar números com a cloud por 1 semana.

---

## Fora de escopo desta onda
- Auth, configurações de empresa, usuários — seguem cloud.
- Mutations (criar/editar/excluir/cancelar) — seguem cloud + sync.
- iFood ingest/conciliação — onda própria.
- Notas fiscais (emissão) — onda própria.

---

## Ordem recomendada
1. ~~**PR-O3-4** (lookups)~~ — ✅ já estava feito (`buscarPorCodigo`/`buscarPorPlu` local-first).
2. **PR-O3-1** (relatórios faltantes) — ✅ **parcial**:
   - ✅ `cardContasReceber`, `lancamentosContasReceber` — local-first via cache
     `financeiro_lancamentos_completo` (select expandido com `cliente.id/nome_fantasia`
     e `venda.id/data_emissao`).
   - ⏭️ `categoriasFinanceiras` — adiado: não há cache local de
     `categorias_financeiras`. Próxima sub-onda: adicionar cache via
     `proxy_with_incremental_sync` ou derivar do cache de lançamentos.
   - 🔒 `atualizarObservacaoCaixa` — mutation, segue cloud-only (correto).
3. **PR-O3-3** (vendas leituras) — ✅ **parcial**:
   - ✅ `vendas.list` já era local-first (de antes).
   - ✅ `vendas.metricasPeriodo` — novo endpoint
     `GET /api/vendas/metricas-periodo?inicio=&fim=` agrega
     `vendas_remote_cache` via JSON1 (`qtd_vendas`, `qtd_canceladas`,
     `total_vendido`, `ticket_medio`, `qtd_pendentes`, `valor_pendente`).
     Safety gate: 503 com fallback cloud se cache vazio. `valor_pendente`
     é aproximado por `SUM(total)` em status_pagamento != pago.
   - ⏭️ `vendas.detalhe(id)` — adiado: depende de pagamentos cruzados
     (vendas registradas localmente vs. vindas do sync), risco de
     drift. Cloud direto é aceitável para clique pontual.
   - ⏭️ `vendas.historico(id)` — adiado: requer cache novo de
     `vendas_status_historico`.
4. **PR-O3-2** (compras) — ✅ **parcial**:
   - ✅ `compras.list` já era local-first (de antes).
   - ✅ `compras.fornecedorMetricas` — novo endpoint
     `GET /api/compras/fornecedor-metricas` agrega `compras_local` +
     `fornecedores_local` espelhando o RPC `fornecedor_metricas`
     (inclui fornecedores sem compras, exclui `cancelada`, conta
     pendente/aprovada/recebida_parcial/rascunho em `compras_em_aberto`).
     Safety gate: 503 com fallback cloud se `fornecedores_local` vazio.
   - ⏭️ `compras.get(id)` — adiado: depende de `compra_itens_local` +
     join com produtos (sku/nome) e drift de `quantidade_recebida` em
     recebimentos parciais offline. Cloud direto é seguro para
     abrir o detalhe.
5. **PR-O3-5** (dashboard) — ⏭️ **adiado** (vira Onda 4):
   - `dashboard.carregar()` cruza 4 domínios (vendas 6 meses, compras
     6 meses, lançamentos financeiros, saldos de estoque) + joins de
     nome (clientes, fornecedores) e retorna um DTO único.
   - Composição puro-TS a partir dos endpoints locais atuais exigiria
     muitos round-trips e remapeamento — perdendo o ganho.
   - Caminho certo é um endpoint Rust dedicado
     `GET /api/dashboard/carregar` que faz a agregação em SQL (mesmo
     padrão de `vendas_metricas_periodo_local`), com safety gate por
     domínio (503 se algum cache estiver frio). Tratar em sub-onda
     própria por causa do volume e do risco de drift.
6. **PR-O3-6** (QA) — ✅ checklist em `.lovable/qa-onda3.md` (4 cenários × 5 grupos de método + regressão).
