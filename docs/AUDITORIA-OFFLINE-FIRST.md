# Auditoria Offline-First — Chamadas diretas a Supabase fora de `dataClient`

Gerada automaticamente. **42 arquivos · 140 chamadas diretas** ao
`@/integrations/supabase/client` fora da camada `src/integrations/data/`.

Cada uma dessas chamadas é candidata a travar a tela quando a internet cair
(timeout longo do Supabase, sem fallback). A meta é migrar todas para o
`dataClient`, que já tem adapters por modo (`cloud`, `local-server`,
`local-terminal`).

---

## Prioridade 🔴 ALTA — telas operacionais (PDV / Caixa / Estoque / Financeiro)

Estas afetam o uso diário no balcão e devem ser as primeiras migradas:

| Arquivo | Calls | Tabelas |
|---|---|---|
| `src/hooks/useDashboard.ts` | 7 | vendas, compras, clientes, fornecedores |
| `src/components/dashboard/KpiDetailDialog.tsx` | 11 | vendas, clientes, compras, fornecedores |
| `src/hooks/useVendas.ts` | 5 | vendas, venda_itens, venda_pagamentos, financeiro_lancamentos |
| `src/hooks/useCompras.ts` | 8 | compras, compra_itens, rpc(receber_compra) |
| `src/hooks/useProdutos.ts` | 4 | produtos, categorias_produto, produto_variacoes |
| `src/hooks/useClientes.ts` | 1 | clientes |
| `src/hooks/useCaixa.ts` | 1 | channel realtime caixa-resumo |
| `src/hooks/useFinanceiroIndicadores.ts` | 5 | financeiro_lancamentos, vendas, venda_itens |
| `src/hooks/useFinanceiroSecoes.ts` | 6 | financeiro_lancamentos, vendas, venda_itens |
| `src/hooks/useNotificacoes.ts` | 8 | notificacao_estados, financeiro_lancamentos, produtos, estoque_movimentacoes |
| `src/routes/financeiro.tsx` | 6 | financeiro_lancamentos, vendas, venda_pagamentos, caixa_movimentos |
| `src/routes/fiado.tsx` | 1 | financeiro_lancamentos |
| `src/components/financeiro/LancamentoFormDialog.tsx` | 1 | categorias_financeiras |
| `src/components/financeiro/LancamentoDetalheDialog.tsx` | 1 | financeiro_lancamentos |
| `src/components/financeiro/ConciliarIfoodDialog.tsx` | 1 | financeiro_lancamentos |
| `src/components/caixa/CaixaRelatorioDialog.tsx` | 2 | caixas, funcionarios |

## Prioridade 🟡 MÉDIA — relatórios (não bloqueiam operação)

Relatórios rodam sob demanda; podem ficar com fallback "indisponível offline":

- `relatorios.tsx` (12), `relatorios.caixa.tsx` (5), `relatorios.financeiro.tsx` (4)
- `relatorios.dre.tsx` (2), `relatorios.estoque.tsx` (2), `relatorios.contas-receber.tsx` (2)
- `relatorios.compras.tsx` (1), `relatorios.fiscal.tsx` (1), `relatorios.fluxo-caixa.tsx` (1)
- `routes/produtos-vendidos.tsx` (1)

## Prioridade 🟢 BAIXA — admin / SaaS / config

Telas administrativas e SaaS (cobranças, planos, sócios) — só funcionam online
mesmo, mas precisam de timeout curto pra não travar a UI:

- `useAdmin.ts` (12), `useEmpresa.ts` (2), `useUserRole.ts` (1)
- `useSaasCliente.ts` (1), `useTerminais.ts` (4), `useQa.ts` (8)
- `useConfigEmpresa.ts` (3), `lib/export-empresa-header.ts` (1)
- `components/auth/*` (2), `components/configuracoes/*` (3)
- `components/saas/*` (3), `routes/cobrancas.tsx` (1)

---

## Próximas ondas sugeridas

**Onda 1 (entrega rápida, alto impacto):** migrar `useDashboard`, `useProdutos`,
`useClientes`, `useFornecedores`, `useVendas`, `useCompras`, `useFinanceiroIndicadores`
para `dataClient`. São hooks já tipados — basta trocar o `supabase.from(...)`
pelo método correspondente no adapter; muitos já existem no `cloudAdapter`.

**Onda 2:** envolver chamadas restantes (relatórios, admin) com `withTimeout`
(2-3s) para não travar UI quando offline.

**Onda 3:** transformar `local-server.ts` num adapter real apoiado em SQLite
local (via Tauri command), com replicação para Supabase em background. Hoje
ele só delega ao cloud — não há banco local de fato.

**Onda 4:** outbox + sync bidirecional. Tabela local `outbox` com mutations
pendentes; worker que dispara quando `online` e o ping ao Supabase
responde abaixo de Xms.

---

## O que já foi entregue nesta iteração

- `src/lib/withTimeout.ts` — `withTimeout` e `withTimeoutFallback` para
  envolver qualquer promise (Supabase, fetch da LAN) com tempo máximo + fallback.
- `src/hooks/useNetworkStatus.ts` — sinal reativo de online/offline.
- `src/components/shared/OfflineBanner.tsx` — aviso discreto fixo (rodapé) que
  só aparece quando cai a internet. Mensagem muda em desktop (modo local).
- Banner integrado em `src/routes/__root.tsx`.
