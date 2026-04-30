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

import type { ProdutoBuscaResult } from "./types";

export interface ProdutosAdapter {
  /**
   * Busca um produto por qualquer código (barras, QR, SKU, interno,
   * alternativo) dentro do tenant do usuário autenticado.
   * Retorna `null` se nada for encontrado.
   */
  buscarPorCodigo(codigo: string): Promise<ProdutoBuscaResult | null>;
}

export interface DataAdapter {
  produtos: ProdutosAdapter;
  // Próximos a serem adicionados conforme a Fase 1 avança:
  // vendas: VendasAdapter;
  // estoque: EstoqueAdapter;
  // caixa: CaixaAdapter;
  // realtime: RealtimeAdapter;
}
