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

## Lançamento financeiro avulso (a pagar / a receber sem venda)

Adapter: `dataClient.financeiro` (mesma seção do CRUD de pagamentos). Cobre
o **CRUD do título avulso**: criar, editar e excluir lançamentos sem venda
nem compra atrelada. Pagamento, cancelamento, reabertura e alteração de
vencimento já estavam migrados em bloco anterior — todos juntos fecham o
ciclo financeiro inteiro na camada `dataClient`.

> Nesta etapa **não há UI nova**. O botão "Novo lançamento" da página
> Financeiro continua sem `onClick`. A infra fica pronta para um próximo
> bloco plugar o dialog com segurança.

### Métodos novos

- `criarLancamentoAvulso(input)` — RPC `criar_lancamento_avulso`.
- `editarLancamentoAvulso(input)` — RPC `editar_lancamento_avulso`.
- `excluirLancamentoAvulso(id)` — RPC `excluir_lancamento_avulso`.

### Garantias server-side

- **Criar**:
  - tipo restrito a `receber`/`pagar`,
  - descrição/valor/vencimento obrigatórios; valor > 0,
  - status inicial sempre `pendente`,
  - vincular a venda/compra é **bloqueado** (esses fluxos têm RPCs próprias),
  - **idempotente** por `(owner_id, client_uuid)` único parcial.
- **Editar**:
  - lock do título (`SELECT ... FOR UPDATE`) antes de mexer → não corre com
    pagamento simultâneo,
  - **bloqueia** títulos vinculados a venda/compra,
  - **bloqueia** títulos `cancelado`, `pago` ou `recebido`,
  - **bloqueia** reduzir `valor` abaixo do `valor_pago`,
  - `tipo` (receber/pagar) NÃO pode ser alterado por aqui,
  - **idempotente** no MESMO lançamento; reuso do UUID em outro lançamento
    é rejeitado (proteção contra erro de programação).
- **Excluir** (hard delete):
  - permitido SOMENTE se não vinculado a venda/compra,
  - permitido SOMENTE sem nenhum pagamento em `lancamento_pagamentos`,
  - permitido SOMENTE em status `pendente` ou `cancelado`,
  - para qualquer outro caso → `cancelarLancamento` (preserva histórico).

### Pontos de concorrência (multi-terminal)

- **Dois terminais editando o mesmo título:** `FOR UPDATE` na RPC de
  edição serializa — o segundo espera o primeiro fechar a transação e
  recebe o estado já atualizado.
- **Edição concorrente com pagamento:** o lock segura a edição até o
  pagamento gravar; a checagem `valor < valor_pago` então enxerga o
  pagamento novo e barra a redução indevida.
- **Excluir + pagar simultâneo:** o `FOR UPDATE` em ambos serializa; quem
  chegar primeiro vence. Se o pagamento ganhou, a exclusão falha pela
  checagem de "0 pagamentos".
- **Duplo clique em "Salvar" no dialog (cenário LAN):** `client_uuid`
  estável por dialog garante que reenvio retorne o mesmo `lancamento_id`
  sem duplicar título nem reaplicar mudança.

### Riscos restantes (fora desta etapa)

- Categoria/cliente/fornecedor enviados não são validados como pertencentes
  ao mesmo `owner_id` — o RLS dessas tabelas já filtra leitura, mas a RPC
  aceita o id "cego". Se o front enviar id de outro tenant, vira FK órfã
  visível só pela ausência no JOIN. Endurecimento Fase 2: validar tenant
  desses 3 ids dentro da RPC.
- Não há histórico de alterações (audit trail) do lançamento. Se o cliente
  editar valor/vencimento várias vezes, a versão anterior se perde.
  Endurecimento futuro: trigger `audit_logs` por UPDATE com `OLD/NEW`.
- O cliente do `client_uuid` na edição é "consumido" depois (vira o UUID
  daquele lançamento). Reabrir o mesmo dialog e re-editar precisa gerar
  um novo UUID, ou as próximas edições passam direto pela checagem
  idempotente. A regra prática: **gerar UUID novo a cada abertura do
  dialog** — mesmo padrão dos outros blocos.

### Próximos recomendados (writes)

1. **CRUD de cliente/fornecedor** — escrita simples, ainda direto no
   `supabase` em diversos diálogos. Bom para zerar o uso direto do client.
2. **Plugar UI no botão "Novo lançamento"** — agora que a infra está
   pronta, só montar dialog `LancamentoFormDialog` (criar/editar) e
   `useCriarLancamento` / `useEditarLancamento` / `useExcluirLancamento`
   que delegam para o adapter.
3. **CRUD de produto** (criar/editar/inativar) — toca em `produtos`,
   `produto_codigos`, `produto_variacoes`, `lotes_produto`.
4. **`useRealtimeSync`** — abstrair a fonte realtime (Supabase Realtime ↔
   WS LAN), já com a base toda preparada.

## Não-objetivos desta fase

- Não muda UI.
- Não muda React Query (`queryKey`, `staleTime`, etc.).
- Não muda RLS, schema de tabelas existentes (apenas adiciona índices/colunas
  de hardening).
- Não introduz banco local — apenas prepara o caminho.

---

## Bloco 8 — CRUD de Cliente / Fornecedor

### Métodos do adapter

`dataClient.clientes`:
- `criar(input)` — `client_uuid` para idempotência de criação.
- `editar(input)`
- `alterarStatus({ cliente_id, status })` — soft delete (ativo/inativo).
- `excluir(clienteId)` — hard delete; bloqueado pela RPC se houver vínculos.

`dataClient.fornecedores`:
- `criar(input)` — idem.
- `editar(input)`
- `alterarStatus({ fornecedor_id, status })`
- `excluir(fornecedorId)` — bloqueado se houver compras/lançamentos vinculados.

### Diferença "soft delete" vs "hard delete"

| Operação | Quando usar | Efeito histórico |
|---|---|---|
| `alterarStatus('inativo')` | **Padrão**. Sempre seguro: o cadastro some das listas ativas mas continua referenciado por vendas, compras e lançamentos antigos. | Preservado integralmente. |
| `excluir(id)` | Apenas para cadastro **sem nenhum vínculo** (criado por engano). | Apaga a linha. RPC bloqueia se houver qualquer venda, compra ou lançamento — então é seguro chamar; nunca gera FK órfã. |

A UI deve sempre tentar `excluir` primeiro: se a RPC retornar erro `23503`,
apresentar opção de inativar.

### Garantias de consistência

- **Tenant resolvido no banco** (`auth.uid()`), nunca confiando no payload.
- **Documento normalizado** server-side (`regexp_replace '\D+' → ''`).
- **Idempotência de criação** via `client_uuid` (`UNIQUE(owner_id, client_uuid)`),
  cobre duplo-clique e retry de rede do React Query.
- **Lock por linha** em editar/excluir (`SELECT ... FOR UPDATE`) evita corrida
  entre terminais editando o mesmo cadastro.
- **Hard delete só sem vínculos**: contagem de `vendas`/`compras`/
  `financeiro_lancamentos` antes de `DELETE`. Em caso de vínculo, exceção
  `23503` com a contagem informada.

### Riscos identificados

- O front continua fazendo `select` direto após `criar`/`editar` para retornar
  o objeto `Cliente`/`Fornecedor` completo (compatibilidade com o `onSaved`
  do PDV e dos dialogs). Isso é leitura, não write — a fonte de leitura será
  abstraída em uma fase posterior, junto com `useProdutos`/`useVendasList`.
- `checkDocumentoDuplicado` em `useClientes` ainda usa `supabase` direto
  (leitura). Migra junto com a abstração de queries.
- Não há trail de auditoria de alterações de cadastro. Mesmo gap dos outros
  blocos — abordagem unificada via trigger `audit_logs` em fase própria.

### Próximos writes recomendados

1. **CRUD de produto** — `produtos`, `produto_codigos`, `produto_variacoes`,
   `lotes_produto`. Maior superfície que cliente/fornecedor; precisa de
   transação ao criar produto + códigos + variações iniciais.
2. **CRUD de categorias** (produto e financeira) — pequeno, fecha cadastros.
3. **CRUD de funcionários (operadores PDV)** — toca em `funcionarios.pin_hash`
   (sensível: hash precisa ser feito no banco, nunca no cliente).
4. **Plugar UI do "Novo lançamento financeiro"** já com infra pronta.
5. **Abstração de leitura** (`useQuery` → `dataClient.*.list/get`), que
   destrava a futura troca de fonte sem reescrever hooks.

---

## Bloco 9 — Produto

### Métodos do adapter

`dataClient.produtos`:
- `criar(input)` — `client_uuid` para idempotência (duplo-clique no Salvar do `ProdutoDialog`).
- `editar(input)`
- `alterarStatus({ produto_id, status })` — soft delete (`ativo` / `inativo` / `descontinuado`).
- `excluir(produtoId)` — hard delete; bloqueado pela RPC se houver vínculos (`venda_itens`, `compra_itens`, `estoque_movimentacoes`, `lotes_produto`).
- `adicionarCodigo(input)` — registra `codigo_barras` / `qr_code` / `sku` / `interno` / `alternativo` extra; idempotente.
- `excluirCodigo(codigoId)`.
- `criarVariacao(input)` — cria SKU filho idempotente.
- `excluirVariacao(variacaoId)` — bloqueado se a variação já tiver vendas/compras/movimentações.
- `criarCategoria(input)` — categoria de produto idempotente.

### Diagnóstico do fluxo atual

- `ProdutoDialog` chama `useCreateProduto` / `useUpdateProduto`, agora delegando 100% a `dataClient.produtos.criar` / `editar`.
- `useProdutoCodigo` (gerenciamento de códigos auxiliares na aba "Códigos" do produto) faz add/remove via `dataClient.produtos.adicionarCodigo` / `excluirCodigo`.
- `useDeleteProduto` tenta hard delete primeiro; se a RPC retornar `23503`, a UI deve oferecer inativação (mesmo padrão do Bloco 8).
- Categorias de produto criadas no `CategoriaCombobox` passam pela RPC `criar_categoria_produto`.
- **Leitura** (`useProdutos`, `useBuscarProduto`, etc.) continua via `supabase` direto — abstração de queries é fase posterior.

### Garantias de consistência

- **Tenant resolvido no banco** (`auth.uid() → owner_id`); o cliente nunca passa `owner_id`.
- **Idempotência** via `client_uuid` em `produtos`, `produto_codigos`, `produto_variacoes`, `categorias_produto` (índices únicos parciais por `owner_id`).
- **Locks** (`SELECT ... FOR UPDATE`) em editar/excluir → serializa terminais editando o mesmo produto.
- **Hard delete só sem vínculos**: contagem em `venda_itens` + `compra_itens` + `estoque_movimentacoes` + `lotes_produto` antes do `DELETE`. Em vínculo → exceção `23503` com a contagem.
- **Validações server-side**: SKU obrigatório, preço ≥ 0, unicidade de SKU/código de barras por tenant.

### Riscos identificados

- **Sem transação cross-tabela no fluxo "criar produto + códigos + variações iniciais"**: hoje o `ProdutoDialog` cria o produto e, na sequência, abre a aba de códigos/variações para o usuário. Se um terminal cair entre as etapas, o produto fica criado sem códigos auxiliares. Não há corrupção (o produto é válido sozinho), mas é um gap que merece uma RPC composta no futuro.
- **`lotes_produto` está modelado no banco** (com colunas, FK para `produtos`, e referência por `estoque_movimentacoes.lote_id`), mas **não há CRUD na UI atual** — não existe dialog para criar/editar/excluir lote, e nenhum hook em `src/hooks/` toca essa tabela. Ficou **mapeado como gap para etapa futura** (provavelmente junto com o módulo de validade/perecíveis e a entrada de NF-e que gera lotes automaticamente).
- Reativar produto `descontinuado` é permitido pela RPC `alterar_status_produto`, mas a UI hoje não expõe esse caminho — apenas alterna `ativo`/`inativo`. Não é bug, é limitação de UI.
- Leituras ainda batem em `supabase` direto, então uma futura troca de fonte (servidor local) exige migrar `useProdutos.list` antes do read.

### Pontos de concorrência relevantes (multi-terminal)

- Dois terminais editando o mesmo produto simultaneamente: o segundo `editar` espera o lock do primeiro, e a versão final é a do segundo (sem merge — comportamento esperado de "last write wins" com lock).
- Dois terminais cadastrando o mesmo SKU ao mesmo tempo: o índice único por `owner_id + sku` rejeita o segundo com erro claro.
- Duplo-clique em "Salvar" no `ProdutoDialog`: protegido por `client_uuid` → segundo clique retorna o mesmo `produto_id` sem duplicar.

### Próximos writes recomendados (depois do Bloco 9)

1. **CRUD de categorias financeiras** — espelha `criar_categoria_produto`, fecha o conjunto de cadastros auxiliares.
2. **CRUD de funcionários (operadores PDV)** — sensível: `pin_hash` deve ser gerado **no banco** via `crypt()` + `gen_salt('bf')`, nunca no cliente.
3. **CRUD de `lotes_produto`** quando a UI de validade/lote entrar no roadmap (gap acima).
4. **Plugar UI do "Novo lançamento financeiro"** com a infra do Bloco 7 já pronta.
5. **Abstração de leitura** (`useQuery` → `dataClient.*.list/get`) para destravar a troca de fonte (cloud → servidor local + terminais) sem reescrever hooks.

---

## Bloco 10 — Funcionários (operadores PDV)

### Métodos do adapter

`dataClient.funcionarios`:
- `criar(input)` — `client_uuid` para idempotência. PIN em texto, hash bcrypt feito **só no banco**.
- `editar(input)` — altera `nome` / `login` / `role`. **Não toca no PIN.**
- `alterarStatus({ funcionario_id, ativo })` — soft delete (ativar/inativar).
- `excluir(funcionarioId)` — hard delete; bloqueado se houver caixas, movimentos de caixa ou vendas vinculadas.
- `resetarPin({ funcionario_id, pin })` — única forma de trocar o PIN. PIN em texto, hash no banco.
- `validarPin({ funcionario_id, pin })` — login do operador. Retorna `OperadorSessaoDomain` (sem hash).

### Diagnóstico do fluxo atual

- `FuncionariosTab` chama `useCriarFuncionario` / `useResetarPinFuncionario` / `useToggleFuncionarioAtivo` / `useExcluirFuncionario`, agora todos via `dataClient.funcionarios`.
- `OperadorPinDialog` valida PIN via `validarPinOperador`, que delega a `dataClient.funcionarios.validarPin`.
- `OperadorProvider` consome `OperadorSessao` (re-export de `OperadorSessaoDomain`).
- Listagens (`useFuncionarios`, `useFuncionariosAtivos`) seguem em `supabase.rpc("funcionarios_listar")` direto — leitura entra na fase de "abstração de queries".

### Segurança do PIN

| Camada | O que faz | O que NUNCA faz |
|---|---|---|
| **Cliente (UI/hook)** | Coleta o PIN, valida formato (4-8 dígitos), envia em texto pelo TLS para a RPC. | Nunca calcula hash. Nunca persiste o PIN em estado/local storage. Nunca faz log. |
| **Adapter (`cloud.ts`)** | Encaminha o texto puro para a RPC e devolve o resultado. | Nunca grava o PIN em variáveis de longa duração. |
| **Banco (RPC)** | Aplica `extensions.crypt(pin, gen_salt('bf', 8))` para hash bcrypt e armazena em `funcionarios.pin_hash`. Compara via `crypt(pin, stored_hash)`. | Nunca devolve `pin_hash` para o cliente. As RPCs de listagem omitem essa coluna. |

Trocar para outra função de hash (Argon2 etc.) é mudança server-side pura — o cliente não precisa saber.

### Garantias de consistência

- **Tenant resolvido no banco** (`auth.uid() → owner_id`) em todas as RPCs.
- **Idempotência** em `criar` via `UNIQUE(owner_id, client_uuid)` — duplo clique e retry de rede ficam neutros.
- **Login único por owner**: índice `UNIQUE(owner_id, lower(login))` impede dois funcionários com o mesmo login na mesma empresa.
- **Locks** (`SELECT ... FOR UPDATE`) em `editar` / `alterarStatus` / `excluir` → serializa edições concorrentes do mesmo funcionário entre terminais.
- **Regra do "último gerente ativo"**: tanto `editar` (rebaixar role) quanto `alterarStatus(false)` quanto `excluir` validam que sobra ao menos um gerente ativo na empresa. Bloqueio retorna mensagem clara.
- **Hard delete só sem vínculos**: contagem em `caixas` + `caixa_movimentos` + `vendas.operador_id` (com fallback graceful se a coluna não existir). Em vínculo → `23503`.

### Riscos identificados

- **PIN em texto na rede**: mitigado por TLS (Supabase). No cenário futuro de servidor local, a comunicação terminal ↔ servidor PRECISA também ser TLS (ou mTLS); senão um sniffer da LAN captura o PIN. Recomendado adicionar essa exigência ao spec do servidor local.
- **Brute force de PIN**: PIN tem só 4-8 dígitos (10⁴ a 10⁸ combinações). Hoje **não há rate limit nem lockout** após N tentativas erradas. Risco maior no cenário multi-terminal — qualquer terminal pode tentar PINs em massa. **Recomendado próximo write**: tabela `funcionario_tentativas_pin` + bloqueio temporário (ex.: 5 erros em 10 min → bloqueia por 15 min).
- **Sem auditoria de quem alterou PIN/role**: não rastreamos quem trocou o PIN de quem. Entra junto com a fase geral de `audit_logs`.
- **`ultimo_acesso` é atualizado dentro da própria RPC de validação** — se a transação falhar depois da escrita, o tempo fica "futuro" no banco. Baixo impacto, mas vale notar.
- Os **263 warnings genéricos** do linter Supabase (`SECURITY DEFINER` com `EXECUTE` para `public`) são pré-existentes do projeto e não foram introduzidos por este bloco — todas as novas RPCs validam `auth.uid() IS NULL` no topo.

### Pontos de concorrência relevantes (multi-terminal)

- Dois terminais cadastrando funcionário com o mesmo login: índice único rejeita o segundo com mensagem amigável.
- Dois terminais editando o mesmo funcionário: o segundo espera o lock. "Last write wins" — comportamento esperado.
- Reset de PIN em paralelo com login: quem chegar primeiro no lock vence; o segundo login com PIN antigo falha.
- Inativar/excluir o último gerente em terminais diferentes ao mesmo tempo: o lock + a contagem dentro da transação garantem que pelo menos um gerente sobre.
- Validação de PIN agora usa `SELECT ... FOR UPDATE` em `funcionarios` + `funcionario_lockouts`, serializando tentativas concorrentes do mesmo operador entre terminais diferentes (ver Bloco 11).

---

## Bloco 11 — Rate limit / lockout de PIN do operador

### Diagnóstico do fluxo atual

`OperadorPinSelector` → `validarPinOperador(funcionarioId, pin, terminalId?)` → `dataClient.funcionarios.validarPin({...})` → RPC **`funcionario_validar_pin(_funcionario_id, _pin, _terminal_id, _ip_address, _user_agent)`**.

Antes deste bloco, a RPC só comparava `crypt(pin, pin_hash)` e devolvia a sessão. Não havia rate limit, lockout, nem log de tentativa. Como o cliente fala direto com o Postgres via PostgREST, o frontend nunca foi uma barreira real — qualquer requisição autenticada da mesma empresa podia varrer todo o espaço de PINs (10⁴ a 10⁸).

### Estrutura adicionada

| Tabela | Função | Campos chave |
|---|---|---|
| `funcionario_tentativas_pin` | Log append-only de toda tentativa (válida ou não), inclusive as recusadas por lockout. Base de auditoria e investigação. | `owner_id`, `funcionario_id`, `sucesso`, `terminal_id`, `ip_address`, `user_agent`, `created_at` |
| `funcionario_lockouts` | Estado **atual** por operador: contador de falhas na janela, início da janela, última tentativa, `bloqueado_ate`, `total_bloqueios`. 1 linha por funcionário. | `funcionario_id` (PK), `owner_id`, `tentativas_na_janela`, `janela_iniciada_em`, `bloqueado_ate`, `total_bloqueios` |

### Política de bloqueio (server-side)

Constantes embutidas em `funcionario_validar_pin`:

- **Janela**: 10 minutos
- **Limite**: 5 falhas dentro da janela
- **Bloqueio**: 15 minutos após estourar
- **Sucesso**: zera contador, limpa `bloqueado_ate`, atualiza `funcionarios.ultimo_acesso`

Fluxo de cada chamada:
1. `SELECT ... FOR UPDATE` no funcionário e na linha de lockout (cria se não existir).
2. Se `bloqueado_ate > now()` → registra tentativa como falha, aborta com `P0003` e **mensagem com tempo restante em segundos**. PIN nem é comparado.
3. Se janela expirou → reseta contador.
4. Compara `crypt(_pin, pin_hash)`.
5. Em sucesso → libera tudo. Em falha → incrementa; se atingir o limite, define `bloqueado_ate = now() + 15min` e aborta com **mensagem de bloqueio**; senão aborta com **mensagem mostrando tentativas restantes**.

### Mensagens devolvidas (capturadas no toast da UI sem mudar layout)

| ERRCODE | Mensagem |
|---|---|
| `P0001` | `PIN incorreto. N tentativa(s) restante(s).` |
| `P0001` | `Operador inativo` |
| `P0002` | `Operador não encontrado` |
| `P0003` | `Operador temporariamente bloqueado. Tente novamente em N segundo(s).` |
| `P0003` | `Muitas tentativas inválidas. Operador bloqueado por N segundo(s).` |

### Métodos no adapter (`dataClient.funcionarios`)

- `validarPin({ funcionario_id, pin, terminal_id?, ip_address?, user_agent? })` — agora envia contexto opcional para auditoria. Política de lockout é **por funcionário** (não por terminal): trocar de terminal não burla o limite.
- `desbloquearPin({ funcionario_id })` — desbloqueio manual antes do prazo. Server valida que o caller é owner ou admin da empresa (`42501` se não for). Pronto para um botão futuro no painel admin de funcionários.

### Regras de acesso (RLS)

- `funcionario_tentativas_pin` e `funcionario_lockouts`: SELECT permitido apenas para owner ou membro `owner`/`admin` da empresa. **Sem policies de INSERT/UPDATE/DELETE** — toda escrita ocorre nas funções `SECURITY DEFINER`. Isso impede um terminal de zerar o próprio contador via PostgREST.
- Funções têm `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.

### Garantias de consistência

- Lock pessimista em `funcionarios` + `funcionario_lockouts` serializa tentativas paralelas do mesmo operador, mesmo vindas de múltiplos terminais — não dá para "espremer" 50 tentativas em paralelo dentro do limite.
- Tentativa registrada **antes** do erro ser lançado → o `RAISE EXCEPTION` desfaz tudo? **Não nesta RPC**: a inserção em `funcionario_tentativas_pin` está dentro da mesma transação implícita da função, então o `RAISE` faz rollback da tentativa também. **Isso é proposital** para o caso "bloqueado": queremos manter a contagem no estado em que estava (`UPDATE` foi feito antes de qualquer raise no caminho de sucesso). No caminho de falha, o `UPDATE` em `funcionario_lockouts` ocorre **antes** do `RAISE`, então a contagem persiste; o que é desfeito é apenas o `INSERT` de log dessa tentativa específica. Trade-off aceito: log perde 1 linha por falha, mas o contador (parte que importa para a segurança) sobrevive. Ver "Riscos" abaixo.
- Idempotência: nesta RPC não usamos `client_uuid` — cada tentativa **deve** contar. Reenvio de rede em PIN errado é, do ponto de vista de segurança, uma nova tentativa.

### Riscos encontrados

- **Log de tentativas perde linhas em caminho de erro** (rollback da transação). Para auditoria forense crítica, mover o `INSERT` em `funcionario_tentativas_pin` para uma função separada com `PRAGMA AUTONOMOUS TRANSACTION` (não nativo no Postgres — exige `dblink` ou um worker `pg_net`). Não bloqueia o uso atual, mas vale registrar para a fase de auditoria unificada.
- **PIN curto (4-8 dígitos)**: mesmo com lockout, atacante paciente pode tentar 5 PINs a cada 15 min ≈ 480/dia. Mitigação real exige PIN ≥ 6 dígitos OU 2º fator (face/cartão) — fica para roadmap.
- **PIN trafega em texto até a RPC**: TLS protege na nuvem; no cenário LAN futuro, terminal↔servidor local **precisa** TLS/mTLS — caso contrário, sniffer captura PIN antes do hash.
- **Sem registro de IP real**: o cliente envia `_ip_address` no input mas o navegador não conhece o IP público; só vale se uma camada intermediária (edge function/proxy) preencher. Hoje fica `NULL`. Para LAN, o servidor local poderá injetar o IP do terminal.
- **Lockout não notifica o admin**: hoje só fica registrado em `funcionario_lockouts`. Para reagir a ataque, o admin precisa abrir o painel. Próximo passo natural: alerta em `notificacao_estados`.
- **Compartilhamento de PIN entre operadores**: o lockout é por funcionário; se a equipe compartilha PIN (prática ruim), erros de outros operadores bloqueiam quem está em uso. Documentar e desincentivar.

### Concorrência relevante

- N terminais tentando PIN do mesmo operador simultaneamente: serializados pelo `FOR UPDATE`. Não há "vence quem chega primeiro" no contador.
- Reset de PIN durante lockout: o reset não limpa `bloqueado_ate` automaticamente. Decisão de design — admin deve usar `desbloquearPin` se quiser liberar imediato. Documentado.
- Desbloqueio manual durante uma tentativa em andamento: o `UPDATE` em `funcionario_lockouts` no desbloqueio espera o lock da validação em curso; ordem natural mantém estado coerente.

### Próximos writes recomendados (depois do Bloco 11)

1. **CRUD de categorias financeiras** — espelha `criar_categoria_produto`; fecha o conjunto de cadastros auxiliares.
2. **CRUD de `lotes_produto`** quando a UI de validade/lote entrar (gap do Bloco 9).
3. **Plugar UI do "Novo lançamento financeiro"** com a infra do Bloco 7.
4. **Painel admin de lockouts** — listar `funcionario_lockouts` ativos e expor botão `desbloquearPin` (já pronto no adapter).
5. **Notificação de lockout** via `notificacao_estados` para o admin reagir a ataques em andamento.
6. **Auditoria unificada** (`audit_logs` via trigger) cobrindo cliente, fornecedor, produto, funcionário e tentativas de PIN num só passe.
7. **Abstração de leitura** (`useQuery` → `dataClient.*.list/get`) para destravar a troca de fonte (cloud → servidor local + terminais) sem reescrever hooks.
