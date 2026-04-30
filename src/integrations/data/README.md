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
| `types.ts` | Tipos de domínio (`ProdutoBuscaResult`, `CodigoTipo`, …). **Nenhum import de Supabase.** |
| `adapter.ts` | Define a interface `DataAdapter`. Cada hook migrado adiciona seu método aqui. |
| `mode.ts` | Decide o modo em runtime via `VITE_DATA_MODE` (default `"cloud"`). |
| `adapters/cloud.ts` | Implementação atual: chama `supabase`. |
| `client.ts` | Cria a instância `dataClient` correta para o modo ativo. |
| `index.ts` | Barrel público (única coisa que hooks importam). |

## Como consumir

```ts
import { dataClient, type ProdutoBuscaResult } from "@/integrations/data";

const produto: ProdutoBuscaResult | null =
  await dataClient.produtos.buscarPorCodigo("7891234567890");
```

## Migração de hooks (Fase 1)

Para migrar um hook que hoje fala direto com Supabase:

1. Mover os tipos de domínio dele para `types.ts`.
2. Adicionar o método correspondente em `DataAdapter` (`adapter.ts`).
3. Implementar no `cloud.ts` (mesmo código que o hook fazia).
4. No hook, trocar a chamada Supabase por `dataClient.<modulo>.<método>(...)`.
5. Sem mudança de UI, sem mudança no React Query.

### Já migrado
- `buscarPorCodigo` (PoC) — usado por `useBuscarProdutoPorCodigo` e
  pelo PDV (scanner / leitura de código de barras).

### Próximos recomendados (ordem de prioridade)
1. `useProdutos` (lista paginada) — leitura quente do ERP/PDV.
2. `useProdutoPorPlu` — também usado pelo scanner.
3. `useEstoque` (consulta de saldo) — leitura.
4. `useVendas.criarVenda` — primeiro write, exige idempotência (`client_uuid`).
5. `useCaixa` — abertura/fechamento.
6. `useRealtimeSync` — abstrair fonte (Supabase Realtime ↔ WS LAN).

## Não-objetivos desta fase

- Não muda UI.
- Não muda React Query (`queryKey`, `staleTime`, etc.).
- Não muda RLS, schema ou auth.
- Não introduz banco local — apenas prepara o caminho.
