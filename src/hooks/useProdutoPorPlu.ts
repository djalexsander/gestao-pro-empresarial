import { dataClient } from "@/integrations/data";
import type { ProdutoPluResult } from "@/integrations/data";

// Re-export para preservar a API pública anterior do módulo.
export type { ProdutoPluResult };

/**
 * Busca um produto pelo PLU (código base usado pela balança) dentro do owner do
 * usuário autenticado. Tenta primeiro a coluna `plu`, depois cai para `sku` e
 * `codigo_interno` para casos em que o admin ainda não preencheu PLU.
 *
 * Desde a Fase 1 da arquitetura desktop, esta função delega para
 * `@/integrations/data`, que decide em runtime se a leitura vai para o
 * Supabase cloud (atual) ou para o servidor local da loja (futuro).
 */
export async function buscarProdutoPorPlu(
  plu: string,
): Promise<ProdutoPluResult | null> {
  return dataClient.produtos.buscarPorPlu(plu);
}
