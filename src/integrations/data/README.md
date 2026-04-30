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

interface DataAdapter {
  produtos: ProdutosAdapter;
}
```

## Como consumir

```ts
import { dataClient } from "@/integrations/data";

const produto = await dataClient.produtos.buscarPorCodigo("7891234567890");
const balanca = await dataClient.produtos.buscarPorPlu("000123");
const lista   = await dataClient.produtos.listar();
```

## Migração de hooks (Fase 1)

Para migrar um hook que hoje fala direto com Supabase:

1. Mover os tipos de domínio dele para `types.ts`.
2. Adicionar o método correspondente em `DataAdapter` (`adapter.ts`).
3. Implementar no `cloud.ts` (mesmo código que o hook fazia).
4. No hook, trocar a chamada Supabase por `dataClient.<modulo>.<método>(...)`.
5. Sem mudança de UI, sem mudança no React Query.

### Já migrado (somente leitura — risco zero)

| Hook / função                  | Método do adapter                  | Usado em |
|---|---|---|
| `buscarProdutoPorCodigo` / `useBuscarProdutoPorCodigo` | `produtos.buscarPorCodigo` | Scanner do PDV, busca rápida |
| `buscarProdutoPorPlu`          | `produtos.buscarPorPlu`            | Etiqueta de balança no PDV |
| `useProdutos`                  | `produtos.listar`                  | Cadastro de produtos, grade do PDV |

### Ainda usando Supabase direto neste módulo

`useProduto`, `useCategorias`, `useCreateCategoria`, `useCreateProduto`,
`useUpdateProduto`, `useDeleteProduto`, `useCreateVariacao`,
`useDeleteVariacao`, `useProdutoCodigos`, `useAddProdutoCodigo`,
`useDeleteProdutoCodigo` — migrar em lotes futuros (writes).

### Próximos recomendados

1. **`useVendas.criarVenda`** — primeiro **write** crítico. Vamos aproveitar
   para introduzir `client_uuid` (idempotência), que já é útil em produção
   cloud e indispensável quando houver LAN piscando entre terminal e
   servidor local.
2. `useEstoque` (consulta de saldo).
3. `useCaixa` (abrir/fechar/movimentos).
4. `useRealtimeSync` — abstrair a fonte realtime
   (Supabase Realtime ↔ WS LAN).

## Não-objetivos desta fase

- Não muda UI.
- Não muda React Query (`queryKey`, `staleTime`, etc.).
- Não muda RLS, schema ou auth.
- Não introduz banco local — apenas prepara o caminho.
