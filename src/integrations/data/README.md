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

### Próximos recomendados (writes)

1. **`useCancelarVenda`** + **`useExcluirVendaCancelada`** — fechar o ciclo
   da venda na camada.
2. **`useAlterarStatusVenda`** — fluxo financeiro ↔ vendas.
3. **`useFinanceiro` / `useLancamentos`** — escrita financeira independente.
4. **`useEstoque` ajustes manuais** — entradas/saídas avulsas.
5. **`useRealtimeSync`** — abstrair a fonte realtime (Supabase Realtime ↔ WS LAN).

## Não-objetivos desta fase

- Não muda UI.
- Não muda React Query (`queryKey`, `staleTime`, etc.).
- Não muda RLS, schema de tabelas existentes (apenas adiciona índices/colunas
  de hardening).
- Não introduz banco local — apenas prepara o caminho.
