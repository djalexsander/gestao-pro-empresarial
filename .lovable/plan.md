
# Refatoração — Motor Financeiro Real (proporcional, auditável, local-first)

Esta é uma refatoração grande. Para não quebrar PDV/caixa/estoque/sincronização, vou implementar em **ondas incrementais**, cada uma autocontida e testável. Abaixo o escopo completo e a ordem.

## Arquitetura proposta

```text
src/lib/finance/
  financeEngine.ts        ← núcleo puro (sem I/O): rateio, lucro/custo proporcional, líquido
  taxas.ts                ← tabela de taxas por forma de pagamento (Pix, débito, crédito, iFood)
  formasPagamento.ts      ← agregadores por forma (vendido, recebido, pendente, lucro, taxa)
  resultadoReal.ts        ← Resultado operacional real = recebido líquido − custos realizados − taxas − despesas
  fluxoCaixa.ts           ← separa Entradas Operacionais / Previstas / Saídas
  types.ts                ← VendaFinanceira, Recebimento, RateioProporcional, ResultadoReal…
  __tests__/              ← testes unitários do motor (Vitest)
```

Princípios:
- **Motor puro**: funções determinísticas, sem acesso a Supabase/SQLite. Recebem venda + pagamentos, devolvem números.
- **Adapters chamam o motor**: `cloud.ts`, `local-server.ts`, `local-terminal.ts` continuam responsáveis por buscar dados; passam para o motor calcular.
- **Sem migração obrigatória de schema** na primeira onda — todos os cálculos derivam de `vendas`, `venda_itens`, `lancamento_pagamentos`, `financeiro_lancamentos`, `ifood_repasses`. Migração só se for necessário persistir custo histórico (Onda 4).

## Fórmulas centrais

```text
percentual_recebido = valor_pago / valor_total
custo_realizado    = custo_total × percentual_recebido
lucro_realizado    = (valor_total − custo_total) × percentual_recebido
custo_pendente     = custo_total − custo_realizado
lucro_pendente     = lucro_total − lucro_realizado

receita_liquida    = Σ (valor_pago − taxa_forma_pagamento)
lucro_liquido      = receita_liquida − custo_realizado − despesas_proporcionais
resultado_real     = receita_liquida − custo_realizado − taxas − despesas
```

Recebimento misto: rateio proporcional do custo/lucro por forma usando `valor_forma / total_pago`.

## Ondas

### Onda 1 — Motor puro + testes (esta entrega)
- Criar `src/lib/finance/{types,taxas,financeEngine,formasPagamento,resultadoReal,fluxoCaixa}.ts`.
- Testes Vitest cobrindo: parcial proporcional, misto, fiado 0%, 100%, taxas cartão/Pix/iFood, resultado real.
- Logs `[FINANCE_ENGINE]`, `[LUCRO_PROPORCIONAL]`, `[CUSTO_PROPORCIONAL]` (apenas em DEV).
- Nenhuma tela alterada ainda → zero risco de regressão.

### Onda 2 — Indicadores financeiros usam o motor
- Refatorar `useFinanceiroIndicadores`, `usePosicaoFinanceira`, `usePerformancePeriodo` para chamar `financeEngine` em vez dos cálculos atuais.
- Adicionar campos: `receita_bruta`, `receita_liquida`, `recebido`, `previsto`, `pendente`, `lucro_bruto`, `lucro_liquido`, `custos_realizados`, `custos_pendentes`, `taxas`.
- Manter contratos antigos por trás (campos legados continuam preenchidos) para não quebrar telas.

### Onda 3 — Dashboard + página Financeiro
- Adicionar cards: Receita bruta, Receita líquida, Recebido (hoje/mês), Previsto, Pendente, Lucro bruto/líquido, Custos realizados/pendentes, Taxas, Vendas por forma de pagamento.
- Bloco "Vendas por forma de pagamento" com colunas: vendido / recebido / pendente / custo / lucro bruto / lucro líquido / taxa / ticket médio / qtd.

### Onda 4 — Fluxo de caixa reestruturado
- `relatorios.fluxo-caixa.tsx`: três seções — Entradas Operacionais / Entradas Previstas / Saídas — alimentadas por `fluxoCaixa.ts`.
- Card "Resultado Operacional Real".

### Onda 5 — Fiado por cliente + iFood detalhado
- `fiado.tsx`: colunas vendido / recebido / pendente / vencido / lucro realizado / lucro pendente por cliente.
- Bloco iFood: bruto / comissão / entrega / repasse / líquido / lucro líquido pós-taxas, alimentado por `ifood_repasses`.

### Onda 6 — Auditoria (opcional, depende de feedback)
- Migração: tabela `financeiro_auditoria_rateio` registrando, para cada `lancamento_pagamento`, o percentual realizado, custo proporcional, lucro proporcional, forma de pagamento, operador, terminal, venda.
- Trigger preenche no momento do recebimento.

## Garantias de não-quebra

- Motor é puro e novo → não afeta PDV, caixa, estoque, sincronização.
- Adapters atuais (`cloud.ts`, `local-server.ts`, `local-terminal.ts`) continuam funcionando; novos campos são aditivos.
- Offline/local-first preservado: todos os cálculos rodam no cliente a partir de dados já cacheados.
- Sem alteração em vendas históricas ou movimentações.

## Esta entrega (Onda 1)

Vou implementar agora **apenas a Onda 1**: criar o motor + testes. Isso valida as fórmulas antes de tocar nas telas. Nas próximas mensagens você pode pedir "seguir para Onda 2/3/…" e eu ligo o motor às telas progressivamente — assim cada passo é revisável no preview sem risco de quebrar o PDV.

Se você preferir que eu faça **todas as ondas de uma vez**, me avise e eu sigo direto (vai gerar um diff bem maior).
