# QA — Onda 3 (local-first reports + lookups + métricas)

Checklist de aceitação para os métodos migrados na Onda 3. Roda nos 4
cenários abaixo, comparando origem do dado (`x-gp-source` no devtools
ou log `[LOCAL_*]` no console) e valores entre local-server e cloud.

## Cenários

| # | Servidor local | Cache local | Internet | Origem esperada |
|---|---|---|---|---|
| A | ON | populado | ON | `local-server` (sem fallback) |
| B | ON | vazio (cold) | ON | `cloud (fallback)` via 503 |
| C | OFF (desktop fechado) | n/a | ON | `cloud (fallback)` direto |
| D | n/a (web puro) | n/a | ON | `cloud` (sem adapter local) |

Em todos: o número final na tela deve bater entre A↔C↔D dentro do mesmo
período (tolerância: diferenças apenas onde houver mutation pendente
em outbox local).

---

## Métodos da Onda 3

### 1. `relatorios.cardContasReceber()`
- Tela: **Relatórios → Contas a Receber → card resumo**.
- Local: `GET /api/financeiro/lancamentos-completo` filtrado por
  `tipo=receita` + `status=pendente`.
- Conferir: total e quantidade batem com cloud (cenário A vs D).
- Edge: cliente sem `nome_fantasia` cai em `razao_social`.

### 2. `relatorios.lancamentosContasReceber({inicio,fim,campoData,clienteId})`
- Tela: **Relatórios → Contas a Receber → tabela**.
- Local: mesmo endpoint, filtros TS por período + cliente.
- Conferir:
  - Trocar `campoData` (emissao vs vencimento) refiltra local.
  - Filtro por cliente único bate com cloud.
  - Período com 0 resultados retorna array vazio (não null).

### 3. `vendas.metricasPeriodo({inicio,fim})`
- Tela: **Vendas → cards de período** (qtd, total, ticket médio,
  pendentes).
- Local: `GET /api/vendas/metricas-periodo?inicio=&fim=`.
- Conferir:
  - `qtd_vendas` exclui `status=cancelado`.
  - `valor_pendente` ≈ `SUM(total)` onde `status_pagamento ∉
    {pago,recebido}` (aproximação documentada — tolerância vs cloud
    aceita se a cloud usar `total - valor_pago`).
  - Cache vazio → 503 → fallback cloud (cenário B).

### 4. `compras.fornecedorMetricas()`
- Tela: **Compras → lista de fornecedores → coluna métricas**.
- Local: `GET /api/compras/fornecedor-metricas`.
- Conferir:
  - Fornecedor sem nenhuma compra aparece com zeros (LEFT JOIN).
  - Compras com `status=cancelada` ficam fora de `total_compras` e
    `valor_total`.
  - `compras_em_aberto` conta `pendente|aprovada|recebida_parcial|
    rascunho`.
  - `ultima_compra` é a maior `data_emissao` não-cancelada (formato
    `YYYY-MM-DD`).

### 5. PDV lookups (`produtos.buscarPorCodigo`,
    `produtos.buscarPorPlu`, `clientes.buscarPorDocumento`)
- Tela: **PDV → bipar código / digitar PLU / consultar CPF**.
- Local: já era local-first (confirmado na auditoria).
- Conferir:
  - Cenário C (offline) ainda encontra produto/cliente cacheado.
  - Cenário B (cache vazio) cai para cloud sem travar PDV.

---

## Regressão (não pode quebrar)

- `compras.list` continua local (foi mexido o vizinho
  `fornecedorMetricas` — checar que `list` não regrediu).
- `vendas.list` continua local.
- `financeiro.*` da Onda 2 continuam local.
- Mutations (`atualizarStatus`, `receber`, `criar` de qualquer
  domínio) seguem cloud + outbox — testar 1 fluxo por domínio.

---

## Como rodar

1. **Cenário A**: abrir desktop, deixar sync rodar 1 min, abrir telas.
2. **Cenário B**: limpar caches locais (`compras_local`,
   `vendas_remote_cache`, `financeiro_lancamentos_local`,
   `fornecedores_local`) via SQL, recarregar telas.
3. **Cenário C**: fechar o desktop, recarregar a web app.
4. **Cenário D**: abrir a app no navegador sem desktop pareado.

Em A/B/C marcar origem em cada chamada via:
```js
window.__gp_dataSourceLog = []; // dump no console depois
```
ou olhar o painel de Diagnóstico (Configurações → Diagnóstico) se
habilitado.

---

## Critério de saída da Onda 3

- Todos os 5 grupos acima passam nos 4 cenários.
- Logs por 1 semana mostram que A↔D divergem em < 0,1 % nos KPIs
  agregados.
- Nenhum `console.error` novo aparece em produção pós-publish.
