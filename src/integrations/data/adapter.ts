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
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
} from "./types";

export interface ProdutosAdapter {
  /**
   * Busca um produto por qualquer código (barras, QR, SKU, interno,
   * alternativo) dentro do tenant do usuário autenticado.
   * Retorna `null` se nada for encontrado.
   *
   * Usado por: scanner do PDV, busca rápida, leitura de etiqueta.
   */
  buscarPorCodigo(codigo: string): Promise<ProdutoBuscaResult | null>;

  /**
   * Busca um produto pelo PLU (código base usado pela balança).
   * Estratégia: tenta `plu` → `sku` → `codigo_interno`. Se nada bate,
   * tenta novamente sem zeros à esquerda (PLU 00123 = 123).
   *
   * Usado por: PDV ao receber código de etiqueta de balança.
   */
  buscarPorPlu(plu: string): Promise<ProdutoPluResult | null>;

  /**
   * Lista todos os produtos do tenant, com a categoria já “joinada”,
   * ordenados por nome. Usado pelo cadastro de produtos do ERP e pela
   * grade de produtos do PDV.
   */
  listar(): Promise<ProdutoComCategoria[]>;
}

export interface DataAdapter {
  produtos: ProdutosAdapter;
  // Próximos a serem adicionados conforme a Fase 1 avança:
  // vendas: VendasAdapter;
  // estoque: EstoqueAdapter;
  // caixa: CaixaAdapter;
  // realtime: RealtimeAdapter;
}
