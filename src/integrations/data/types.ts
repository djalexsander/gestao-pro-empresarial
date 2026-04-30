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

// -------------------- Códigos de produto --------------------

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

// -------------------- PLU (balança) --------------------

export interface ProdutoPluResult {
  produto_id: string;
  sku: string;
  nome: string;
  unidade: string;
  preco_venda: number;
  vendido_por_peso: boolean;
  aceita_etiqueta_balanca: boolean;
  plu: string | null;
  status: "ativo" | "inativo" | "descontinuado";
}

// -------------------- Listagem de produtos --------------------

export type TipoIdentificacao =
  | "sku"
  | "codigo_barras"
  | "qr_code"
  | "codigo_interno";

export type Produto = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  qr_code: string | null;
  codigo_interno: string | null;
  tipo_identificacao_principal: TipoIdentificacao;
  observacao_tecnica: string | null;
  nome: string;
  descricao: string | null;
  marca: string | null;
  unidade: string;
  categoria_id: string | null;
  preco_custo: number;
  preco_venda: number;
  estoque_minimo: number;
  estoque_inicial: number;
  status: "ativo" | "inativo" | "descontinuado";
  ncm: string | null;
  created_at: string;
  updated_at: string;
};

export type ProdutoComCategoria = Produto & {
  categoria: { id: string; nome: string } | null;
};
