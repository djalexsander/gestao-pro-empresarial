/**
 * ============================================================================
 * DataAdapter — Interface única de acesso a dados
 * ============================================================================
 *
 * Toda operação de dados que for migrada para esta camada DEVE passar pela
 * interface `DataAdapter`. Isso desacopla os hooks/componentes do Supabase
 * (ou de qualquer outra fonte futura).
 *
 * Implementações:
 *   - adapters/cloud.ts          → Supabase remoto (atual)
 *   - adapters/local.ts          → API local na LAN (futuro)
 *   - adapters/hybrid.ts         → local + sync com nuvem (futuro)
 *
 * Regra: a interface só cresce. Cada hook migrado adiciona seu método aqui,
 * e TODAS as implementações precisam fornecê-lo (TypeScript garante).
 */

import type {
  FinalizarVendaInput,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
} from "./types";

export interface ProdutosAdapter {
  /**
   * Busca um produto por qualquer código (barras, QR, SKU, interno,
   * alternativo) dentro do tenant do usuário autenticado.
   */
  buscarPorCodigo(codigo: string): Promise<ProdutoBuscaResult | null>;

  /**
   * Busca um produto pelo PLU (código base usado pela balança).
   * Estratégia: tenta `plu` → `sku` → `codigo_interno`. Se nada bate,
   * tenta novamente sem zeros à esquerda (PLU 00123 = 123).
   */
  buscarPorPlu(plu: string): Promise<ProdutoPluResult | null>;

  /**
   * Lista todos os produtos do tenant, com a categoria já “joinada”,
   * ordenados por nome.
   */
  listar(): Promise<ProdutoComCategoria[]>;
}

export interface VendasAdapter {
  /**
   * Finaliza uma venda no PDV.
   *
   * **Idempotência:** se `input.client_uuid` for enviado e já houver uma
   * venda com esse UUID para o mesmo owner, o backend retorna o ID da venda
   * existente sem duplicar venda, itens, baixa de estoque, pagamentos,
   * lançamento financeiro ou movimento de caixa.
   *
   * Comportamento esperado do chamador (PDV):
   *  - Gerar `client_uuid` (crypto.randomUUID()) ao iniciar o carrinho.
   *  - Manter o mesmo UUID até a venda ser efetivada/cancelada/limpa.
   *  - Ao limpar/cancelar o carrinho, gerar um novo UUID para a próxima.
   *
   * Retorna o `venda_id` (string).
   */
  finalizar(input: FinalizarVendaInput): Promise<string>;
}

export interface DataAdapter {
  produtos: ProdutosAdapter;
  vendas: VendasAdapter;
  // Próximos a serem adicionados conforme a Fase 1 avança:
  // estoque: EstoqueAdapter;
  // caixa: CaixaAdapter;
  // realtime: RealtimeAdapter;
}
