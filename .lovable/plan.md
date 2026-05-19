## Objetivo

Separar definitivamente **Caixa Operacional (PDV)** de **Fluxo Financeiro Gerencial** em duas telas distintas, sem misturar movimentações.

Hoje existem dois pontos que misturam dados:
1. **`/financeiro` → aba "Fluxo de caixa"** — mistura `caixa_movimentos` (PDV) com `financeiro_lancamentos` (compras, despesas, fornecedores, iFood).
2. **`/relatorios/fluxo-caixa`** — mostra apenas `financeiro_lancamentos`, mas o título "Fluxo de Caixa" induz o operador a pensar que é o caixa do PDV.

## Mudanças

### 1. Aba "Fluxo de caixa" do Financeiro (`/financeiro?tab=fluxo`)
- Renomear aba para **"Caixa Operacional"**.
- Filtrar **apenas** movimentos de caixa: `abertura`, `venda`, `sangria`, `suprimento`, `fechamento`, `cancelamento`, `estorno`.
- **Remover** linhas vindas de `financeiro_lancamentos` (receitas/despesas administrativas, compras, taxas).
- Cards: Entradas operacionais, Saídas operacionais, Vendas, Sangrias, Suprimentos, Dinheiro físico, PIX, Cartão, Qtd vendas, Esperado na gaveta.
- Extrato com coluna "Origem: PDV/Caixa".

### 2. Nova aba "Fluxo Financeiro" no Financeiro
- Conteúdo atual de `relatorios.fluxo-caixa` (`financeiro_lancamentos`) movido para uma nova aba **"Fluxo Financeiro"** dentro de `/financeiro`.
- Mostra compras, despesas, fornecedores, contas a pagar/receber, iFood, receitas extras, retiradas, pagamentos administrativos.
- Cards: Receitas, Despesas, Saldo gerencial.

### 3. Rota `/relatorios/fluxo-caixa`
- Renomear título para **"Fluxo Financeiro Gerencial"** e descrição correspondente.
- Mantém dados de `financeiro_lancamentos` (já está correto, só o nome enganava).
- Atualizar entrada em `src/routes/relatorios.tsx` (label, descrição, prefixo de export).

### 4. Navegação (`src/components/layout/navigation.ts`)
- Em "Financeiro":
  - "Fluxo de caixa" → renomear para **"Fluxo Financeiro"** apontando para `/financeiro?tab=fluxo-financeiro`.
  - Adicionar item **"Caixa Operacional"** apontando para `/financeiro?tab=fluxo`.

### 5. Logs DEV
Adicionar em cada renderização/query:
- `[CAIXA_OPERACIONAL]` na aba operacional do financeiro.
- `[FINANCEIRO_GERENCIAL]` na nova aba financeira.
- `[FLUXO_OPERACIONAL]` / `[FLUXO_FINANCEIRO]` nos adapters (`movimentosCaixaPeriodo` vs `fluxoCaixa`).
Incluir: origem, período, totais, qtd registros.

## Não alterar
- Fechamento de caixa (modal/lógica).
- Offline-first / SQLite / outbox.
- PDV, estoque, DRE, dashboards, conciliação iFood.
- Schema do banco — apenas separação visual/leitura.
- Rota `/relatorios/caixa` (já é operacional, fica como está).

## Resultado
- Operador no PDV: abre **Caixa Operacional** e só vê movimentos do seu caixa.
- Gestor: abre **Fluxo Financeiro** e vê compras, despesas, contas, iFood, fornecedores.
- Nenhuma duplicação. Nenhum impacto em offline/finalização de venda/fechamento.
