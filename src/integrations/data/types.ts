/**
 * ============================================================================
 * Camada de Dados — Tipos compartilhados
 * ============================================================================
 *
 * Tipos de domínio independentes da fonte de dados (cloud, local-server,
 * local-terminal, hybrid). Os adapters implementam a interface `DataAdapter`
 * usando esses tipos. Hooks/componentes consomem APENAS estes tipos — nunca
 * tipos específicos do Supabase.
 *
 * Manter este arquivo livre de qualquer import de cliente concreto
 * (sem `@/integrations/supabase/...`).
 */

export type CodigoTipo =
  | "codigo_barras"
  | "qr_code"
  | "sku"
  | "interno"
  | "alternativo";

export interface ProdutoBuscaResult {
  produto_id: string;
  sku: string;
  nome: string;
  codigo_barras: string | null;
  qr_code: string | null;
  codigo_interno: string | null;
  tipo_identificacao_principal: string;
  preco_venda: number;
  preco_custo: number;
  unidade: string;
  status: "ativo" | "inativo" | "descontinuado";
  categoria_id: string | null;
  categoria_nome: string | null;
  fonte: CodigoTipo;
  saldo_estoque: number;
}
