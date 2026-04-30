# `src/integrations/data/` — Camada de acesso a dados

Camada de abstração que desacopla o app da fonte de dados (hoje Supabase
cloud, futuramente Postgres local na loja + sync opcional com nuvem).

## Estrutura

```
src/integrations/data/
├── README.md              ← este arquivo
├── index.ts               ← barrel público
├── client.ts              ← `dataClient` resolvido em runtime
├── adapter.ts             ← interface `DataAdapter`
├── mode.ts                ← detecção do modo (cloud | local-* | hybrid)
├── types.ts               ← tipos de domínio (sem deps de fornecedor)
└── adapters/
    └── cloud.ts           ← implementação atual (Supabase)
    # futuros:
    # ├── local.ts         ← API local na LAN (Fase 4)
    # └── hybrid.ts        ← local + sync cloud (Fase 5)
```

## Responsabilidades

| Arquivo | Responsabilidade |
|---|---|
| `types.ts` | Tipos de domínio (`ProdutoBuscaResult`, `ProdutoPluResult`, `Produto`, `ProdutoComCategoria`, …). **Nenhum import de Supabase.** |
| `adapter.ts` | Define a interface `DataAdapter`. Cada hook migrado adiciona seu método aqui. |
| `mode.ts` | Decide o modo em runtime via `VITE_DATA_MODE` (default `"cloud"`). |
| `adapters/cloud.ts` | Implementação atual: chama `supabase`. |
| `client.ts` | Cria a instância `dataClient` correta para o modo ativo. |
| `index.ts` | Barrel público (única coisa que hooks importam). |

## Contrato atual (`DataAdapter`)

```ts
interface ProdutosAdapter {
  buscarPorCodigo(codigo: string): Promise<ProdutoBuscaResult | null>;
  buscarPorPlu(plu: string):       Promise<ProdutoPluResult | null>;
  listar():                         Promise<ProdutoComCategoria[]>;
}

interface VendasAdapter {
  /** Idempotente quando `input.client_uuid` é enviado (recomendado). */
  finalizar(input: FinalizarVendaInput):           Promise<string /* venda_id */>;
  /** Cancela a venda + estorna estoque + cancela lançamentos vinculados. */
  cancelar(input: CancelarVendaInput):             Promise<CancelarVendaResumo>;
  /** Apaga venda já cancelada (delete físico, valida status no banco). */
  excluirCancelada(vendaId: string):               Promise<ExcluirVendaCanceladaResult>;
}

interface CaixaAdapter {
  abrir(input: AbrirCaixaInput):                       Promise<string /* caixa_id */>;
  fechar(input: FecharCaixaInput):                     Promise<FecharCaixaResult>;
  /** Idempotente quando `input.client_uuid` é enviado (recomendado). */
  registrarMovimento(input: RegistrarMovimentoCaixaInput): Promise<string>;
  excluir(caixaId: string):                            Promise<unknown>;
}

interface DataAdapter {
  produtos: ProdutosAdapter;
  vendas:   VendasAdapter;
  caixa:    CaixaAdapter;
}
```

## Como consumir

```ts
import { dataClient } from "@/integrations/data";

const produto = await dataClient.produtos.buscarPorCodigo("7891234567890");
const balanca = await dataClient.produtos.buscarPorPlu("000123");
const lista   = await dataClient.produtos.listar();

const vendaId = await dataClient.vendas.finalizar({
  ...payload,
  client_uuid: cartUuid, // gerado pelo PDV no início do carrinho
});
```

## Idempotência de vendas (write crítico)

A operação `vendas.finalizar` é **idempotente ponta-a-ponta** quando recebe
`client_uuid`:

- **Frontend (PDV)** gera um UUID via `crypto.randomUUID()` ao montar o
  carrinho e o renova a cada `clearVenda()`. O mesmo UUID acompanha todas
  as tentativas de finalizar a mesma venda.
- **Backend** (`finalizar_venda_pdv`):
  - Antes de inserir, faz `SELECT id FROM vendas WHERE owner_id = auth.uid()
    AND client_uuid = _client_uuid`. Se já existe, retorna o id e
    **não duplica** venda, itens, baixa de estoque, pagamentos, lançamento
    financeiro nem movimento de caixa.
  - Em concorrência extrema, o índice único parcial
    `vendas_owner_client_uuid_uniq (owner_id, client_uuid) WHERE client_uuid
    IS NOT NULL` garante que apenas uma chamada vence; a outra cai no
    `EXCEPTION unique_violation` e retorna o id existente.
  - Cada reenvio incrementa `vendas.idempotent_replay_count` (auditoria
    interna, transparente para o usuário).

**Cenários cobertos:** duplo clique no botão, Enter repetido, retry de rede,
abas duplicadas, e (futuro) reenvio offline pela fila do terminal.

## Migração de hooks (Fase 1)

Para migrar um hook que hoje fala direto com Supabase:

1. Mover os tipos de domínio dele para `types.ts`.
2. Adicionar o método correspondente em `DataAdapter` (`adapter.ts`).
3. Implementar no `cloud.ts`.
4. No hook, trocar a chamada Supabase por `dataClient.<modulo>.<método>(...)`.
5. Sem mudança de UI, sem mudança no React Query.

### Já migrado

| Hook / função                                        | Método do adapter             | Notas |
|---|---|---|
| `buscarProdutoPorCodigo` / `useBuscarProdutoPorCodigo` | `produtos.buscarPorCodigo`    | leitura |
| `buscarProdutoPorPlu`                                | `produtos.buscarPorPlu`       | leitura |
| `useProdutos`                                        | `produtos.listar`             | leitura |
| `useFinalizarVendaPDV`                               | `vendas.finalizar`            | write idempotente (client_uuid) |
| **`useAbrirCaixa`**                                  | **`caixa.abrir`**             | **write protegido por índice único parcial (1 caixa aberto por terminal e por operador)** |
| **`useFecharCaixa`**                                 | **`caixa.fechar`**            | **write com `SELECT FOR UPDATE` — sem fechamento concorrente** |
| **`useRegistrarMovimentoCaixa`**                     | **`caixa.registrarMovimento`** | **write idempotente (client_uuid por modal aberto)** |
| **`useExcluirCaixa`**                                | **`caixa.excluir`**           | write |
| **`useCancelarVenda`**                               | **`vendas.cancelar`**         | **write composto: estorna estoque + cancela lançamentos + muda status** |
| **`useExcluirVendaCancelada`**                       | **`vendas.excluirCancelada`** | **delete físico (apenas vendas canceladas)** |

## Caixa — garantias de consistência

- **1 caixa aberto por terminal**: índice único parcial
  `caixas_owner_terminal_aberto_uniq (owner_id, terminal_id) WHERE status='aberto'`.
- **1 caixa aberto por operador**: índice único parcial
  `caixas_owner_operador_aberto_uniq (owner_id, COALESCE(operador_id, …)) WHERE status='aberto'`.
- **Fechamento concorrente**: `fechar_caixa` faz `SELECT … FOR UPDATE` no
  caixa antes de calcular o resumo e atualizar — dois cliques simultâneos
  serializam, o segundo recebe "Caixa já está fechado".
- **Sangria/suprimento**: `client_uuid` no `caixa_movimentos` com índice
  único parcial. Reenvio retorna o id existente.
- **Separação operacional × financeiro**:
  - **suprimento** = entrada operacional de dinheiro físico (gaveta).
  - **sangria** = saída operacional de dinheiro físico (gaveta).
  - **NÃO viram lançamento no Financeiro.** Ficam só em `caixa_movimentos`.
  - Apenas iFood, fiado e "outros" geram lançamento financeiro no fechamento.

## Cancelar × Excluir venda — regra de negócio

**`vendas.cancelar(input)`** — operação reversível em termos contábeis,
realizada em UMA transação no banco:

| Tabela / efeito                  | O que acontece |
|---|---|
| `vendas.status`                  | → `cancelada` |
| `vendas.status_pagamento`        | → `cancelado` |
| `estoque_movimentacoes`          | +1 linha `tipo='devolucao'` por item, com `saldo_anterior` e `saldo_posterior` capturados (estoque volta) |
| `financeiro_lancamentos`         | TODOS os lançamentos com `venda_id = X` viram `status='cancelado'` (mantém histórico, anota motivo em `observacoes`) |
| `caixa_movimentos` da venda      | NÃO é tocado — o evento operacional do dia (entrada de dinheiro original) permanece registrado |
| `venda_pagamentos`               | NÃO é tocado — preserva o registro de como a venda foi paga |

Pré-requisito: a venda **não pode** já estar cancelada.

**`vendas.excluirCancelada(vendaId)`** — operação destrutiva, **só roda em
vendas já canceladas**:

| Tabela / efeito                  | O que acontece |
|---|---|
| `vendas`                         | DELETE físico (linha removida) |
| `venda_itens`                    | apagados via cascade |
| `venda_pagamentos`               | DELETE físico (sem cascade na FK) |
| `financeiro_lancamentos.venda_id`| → NULL (lançamento cancelado fica no histórico, mas perde a referência ao número da venda) |
| `estoque_movimentacoes.venda_id` | → NULL (movimento de venda + estorno ficam, perdem referência) |
| `auditoria_logs`                 | +1 entrada `excluir_venda_cancelada` (best-effort) |

Pré-requisito: status='cancelada'. Roda dentro de `SELECT … FOR UPDATE`
para evitar exclusão concorrente.

**Diferença chave para o usuário final:**
- *Cancelar* = "essa venda foi um erro/devolução; volta o estoque, anula a cobrança, mas o histórico fica".
- *Excluir cancelada* = "essa venda nunca devia ter aparecido; some do histórico de vendas, mas os movimentos colaterais ficam órfãos para auditoria".

## Vendas — garantias de consistência

- **Idempotência de criação**: `client_uuid` em `vendas` + índice único parcial.
- **Cancelamento atômico**: tudo numa transação plpgsql; falha em qualquer
  passo aborta estoque, lançamentos e mudança de status juntos.
- **Sem dupla devolução de estoque**: a função recusa cancelar venda já
  cancelada (`IF v_status = 'cancelada' THEN RAISE`), então não é possível
  acumular `devolucao` em loop.
- **Histórico financeiro preservado**: lançamentos cancelados nunca somem —
  viram `status='cancelado'` com nota e motivo em `observacoes`.
- **Exclusão protegida**: `excluir_venda_cancelada` recusa qualquer venda
  fora de `status='cancelada'` e usa `FOR UPDATE` para serializar.

## Alterar status da venda (`vendas.alterarStatus`)

Migra `useAlterarStatusVenda` para o adapter, reaproveitando a RPC
`alterar_status_venda` (que já era SECURITY DEFINER, atômica, e valida
permissão por `acessa_owner_id`).

**Estados suportados**: `pago` · `pendente` · `parcial` · `vencido` · `cancelado`.

**Idempotência por estado** (não por chave): a RPC sempre converge cada
lançamento vinculado ao estado-alvo; chamadas repetidas com o mesmo
`novo_status` não acumulam efeito.

| Novo status  | Efeito em `financeiro_lancamentos`                                 | Efeito em `lancamento_pagamentos`                              |
|--------------|---------------------------------------------------------------------|----------------------------------------------------------------|
| `pago`       | quita saldo restante (`valor - valor_pago`)                         | INSERT do saldo restante; nada se já está quitado              |
| `pendente`   | `status='pendente'`, `valor_pago=0`, `data_pagamento=NULL`          | DELETE de todos os pagamentos                                  |
| `parcial`    | mantém `valor_pago`; força status coerente                          | mantém                                                         |
| `vencido`    | força `pendente` (vencido é derivado do `data_vencimento`)          | mantém                                                         |
| `cancelado`  | `status='cancelado'` (NÃO mexe em estoque nem na venda)             | mantém histórico                                               |

**Restrição importante**: vendas com `status='cancelada'` não podem ter status
alterado por aqui — `RAISE EXCEPTION` no banco. Para cancelamento real (com
estorno de estoque), use `vendas.cancelar`.

**Diferença vs. `vendas.cancelar`**: `alterarStatus({novo_status:'cancelado'})`
cancela apenas os LANÇAMENTOS (limpeza administrativa de pendência);
`cancelar` cancela a VENDA, estorna estoque e marca lançamentos juntos.

## Financeiro (`financeiro.*`)

Migra os 5 writes financeiros principais para o adapter, todos via RPC
`SECURITY DEFINER` no banco — nada mais de UPDATE/DELETE direto na tabela
a partir da UI.

| Operação                  | RPC do banco                        | Idempotência                         |
|---------------------------|-------------------------------------|--------------------------------------|
| Registrar pagamento       | `registrar_pagamento_lancamento`    | `client_uuid` (1 por modal aberto)   |
| Remover pagamento         | `remover_pagamento_lancamento`      | retorna `{idempotente:true}` se sumiu|
| Cancelar título           | `cancelar_lancamento`               | idempotente em título já cancelado   |
| Reabrir título            | `reabrir_lancamento`                | recalcula status pelo total pago     |
| Alterar vencimento        | `alterar_vencimento_lancamento`     | bloqueado se pago/recebido/cancelado |
| Conciliar iFood (1)       | `conciliar_ifood_lancamento`        | gerenciada pela RPC existente        |
| Conciliar iFood (lote)    | `conciliar_ifood_lote`              | gerenciada pela RPC existente        |

### Convergência automática (triggers do banco)

A consistência entre `financeiro_lancamentos` e `lancamento_pagamentos` é
mantida por **2 triggers** que continuam ativas:

- **`validar_pagamento_lancamento`** (BEFORE INSERT/UPDATE):
  - rejeita pagamento que ultrapasse o saldo do título;
  - bloqueia pagamento em título `cancelado`.
- **`recalcular_lancamento_apos_pagamento`** (AFTER INSERT/UPDATE/DELETE):
  - recalcula `valor_pago = SUM(pagamentos.valor)`;
  - recalcula `data_pagamento` (a mais recente);
  - recalcula `status` → `pendente` (sem pagamento) / `parcial` (parcial) /
    `pago`/`recebido` (quitado, conforme `tipo`).

Ou seja: a UI só registra/remove pagamentos. Quem decide o status do título
é o banco, sempre. Isso elimina divergência entre cliente e servidor e é a
base para o cenário LAN futuro.

### Reflexo no status_pagamento da venda

Quando o título é `venda_id != null`, o operador pode usar o fluxo
`vendas.alterarStatus` (já migrado) para sincronizar `vendas.status_pagamento`
com o estado financeiro. As duas camadas são independentes mas coerentes:
o trigger ajusta o lançamento; o `alterarStatus` ajusta a venda.

### Pontos de concorrência endurecidos

- **Duplo-clique em "Pagar"** → `client_uuid` impede duplicação. Mesmo se a
  rede oscilar e a UI reenviar, o backend retorna o pagamento existente.
- **Remover pagamento concorrente** → RPC faz `SELECT FOR UPDATE` no título
  pai antes do DELETE. Sem race entre 2 terminais quitando/removendo
  pagamentos do mesmo título.
- **Cancelar/reabrir/alterar vencimento** → todas usam `FOR UPDATE` no
  título; a última operação ganha de forma determinística.
- **Pagamento que ultrapassa saldo** → trigger rejeita com `RAISE EXCEPTION`,
  mesmo com 2 caixas batendo no mesmo fiado.

### Riscos restantes (fora desta etapa)

- A RPC de pagamento aceita `forma_pagamento NULL` (compatibilidade com
  comportamento legado de `alterar_status_venda`). Em painéis de DRE/repasse,
  pagamentos sem forma somem da quebra por método. Endurecimento opcional na
  Fase 2 (tornar obrigatório quando vier de UI manual).
- **Edição de vencimento** ainda não tem UI — a RPC já existe; basta um
  pequeno modal quando o produto pedir.

## Estoque (ajustes manuais)

Adapter: `dataClient.estoque`. Cobre **somente movimentação manual avulsa**
(entrada manual, saída manual, ajuste de saldo, devolução avulsa,
transferência). Movimentações automáticas (venda → baixa, compra → entrada,
cancelamento → devolução) continuam saindo das RPCs de venda/compra/
cancelamento — não passam por aqui.

### Métodos

- `registrarMovimento(input)` — RPC `registrar_movimento_estoque`.

### Garantias server-side

- **Lock por produto:** `pg_advisory_xact_lock(produto_id)` serializa
  movimentações concorrentes do MESMO item entre vários terminais. Cada
  movimento vê o saldo já atualizado pelo anterior antes de gravar.
- **Recálculo no servidor:** `saldo_anterior` e `saldo_posterior` são
  calculados a partir do histórico — o cliente não dita o saldo. Mesmo se
  dois terminais mandarem `saldo_atual` diferente, o banco grava certo.
- **Saldo negativo bloqueado:** saída/transferência que deixaria o estoque
  negativo é rejeitada com `RAISE EXCEPTION`.
- **Idempotência:** `client_uuid` por modal aberto — duplo clique, Enter
  repetido e retry de rede retornam o mesmo `movimento_id` sem duplicar
  baixa/entrada.
- **Histórico íntegro:** toda chamada gera linha em `estoque_movimentacoes`
  (mesmo idempotente devolve a linha original). Nada é apagado.

### Pontos de concorrência (multi-terminal)

- **Dois terminais ajustando o mesmo produto:** serializados pelo advisory
  lock; o segundo espera o primeiro fechar a transação.
- **Terminal ajustando + venda baixando o mesmo produto:** a RPC de venda
  também grava em `estoque_movimentacoes`, mas NÃO usa o mesmo lock
  advisory. Em cenário LAN, vale unificar — ver "Riscos restantes".
- **Cliente lendo `useEstoqueSaldos` desatualizado:** a UI pode mostrar
  saldo defasado, mas o servidor recalcula no momento da gravação. Cliente
  só perde a checagem visual de "saldo previsto", nunca grava errado.

### Riscos restantes (fora desta etapa)

- O lock advisory é por produto e só vale durante a transação atual. Se a
  RPC `finalizar_venda_pdv` não pegar o mesmo lock, baixas concorrentes
  entre venda e ajuste manual podem ainda gerar `saldo_anterior` defasado
  (o saldo final fica certo, mas a coluna histórica do registro do ajuste
  pode ficar fora de ordem). Endurecimento na Fase 2: estender o lock
  para todos os caminhos que escrevem em `estoque_movimentacoes`.
- `useEstoqueSaldos` ainda agrega no cliente. Para volumes maiores ou
  cenário LAN com muitos terminais, vale promover a uma view materializada
  ou RPC `get_saldos_estoque` com cache server-side.

### Próximos recomendados (writes)

1. **CRUD de cliente/fornecedor** — escrita simples, ainda direto no
   `supabase` em diversos diálogos. Bom para zerar o uso direto do client.
2. **Edição/criação avulsa de lançamento financeiro** (a pagar/receber sem
   venda) — fechar o ciclo CRUD financeiro completo.
3. **CRUD de produto** (criar/editar/inativar) — toca em `produtos`,
   `produto_codigos`, `produto_variacoes`, `lotes_produto`. Migrar para
   adapter prepara o cenário multi-terminal de cadastro.
4. **`useRealtimeSync`** — abstrair a fonte realtime (Supabase Realtime ↔
   WS LAN), já com a base toda preparada.

## Não-objetivos desta fase

- Não muda UI.
- Não muda React Query (`queryKey`, `staleTime`, etc.).
- Não muda RLS, schema de tabelas existentes (apenas adiciona índices/colunas
  de hardening).
- Não introduz banco local — apenas prepara o caminho.
