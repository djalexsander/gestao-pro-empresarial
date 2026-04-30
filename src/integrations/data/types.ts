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

// -------------------- Vendas (PDV) --------------------

export type FormaPagamento =
  | "dinheiro"
  | "pix"
  | "cartao_debito"
  | "cartao_credito"
  | "boleto"
  | "ifood"
  | "fiado"
  | "transferencia"
  | "cheque"
  | "outro";

export type StatusPagamento = "pago" | "pendente" | "parcial" | "cancelado";

/**
 * Item de uma venda enviado ao backend. Inclui campos de auditoria de balança
 * (etiqueta lida, PLU extraído, peso, etc.) — todos opcionais.
 */
export interface FinalizarVendaItem {
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  descricao?: string | null;
  vendido_por_peso?: boolean;
  preco_por_kg?: number | null;
  codigo_lido?: string | null;
  plu_extraido?: string | null;
  peso_extraido?: number | null;
  valor_extraido?: number | null;
  tipo_interpretacao?: "peso" | "valor" | "manual" | null;
}

export interface FinalizarVendaPagamento {
  forma_pagamento: FormaPagamento;
  valor: number;
  valor_recebido?: number | null;
  troco?: number | null;
  parcelas?: number | null;
  observacao?: string | null;
}

/**
 * Payload completo para finalizar uma venda no PDV.
 *
 * IDEMPOTÊNCIA: o campo `client_uuid` é a chave de idempotência. Deve ser
 * gerado pelo PDV no início do carrinho e mantido estável até a venda ser
 * finalizada/cancelada/limpa. Reenviar o mesmo `client_uuid` retorna o ID da
 * venda já criada, sem duplicar nada (venda, itens, baixa de estoque,
 * pagamentos, lançamento financeiro ou movimento de caixa).
 */
// -------------------- Caixa --------------------

export type CaixaStatusDomain = "aberto" | "fechado";

export interface AbrirCaixaInput {
  valor_inicial: number;
  observacao?: string | null;
  operador_id?: string | null;
  terminal_id?: string | null;
}

export interface FecharCaixaInput {
  caixa_id: string;
  valor_informado: number;
  observacao?: string | null;
}

export interface FecharCaixaResult {
  caixa_id: string;
  valor_esperado: number;
  valor_informado: number;
  diferenca: number;
  fechado_em: string;
}

/**
 * Movimento operacional do caixa (sangria/suprimento).
 *
 * - **suprimento**: entrada operacional de dinheiro físico na gaveta.
 * - **sangria**: saída operacional de dinheiro físico da gaveta.
 *
 * Esses movimentos NÃO são receita nem despesa — não viram lançamento no
 * Financeiro. Eles existem apenas para o controle de caixa operacional.
 *
 * **Idempotência:** envie `client_uuid` estável (1 por modal aberto). Reenvio
 * com mesmo UUID retorna o id existente sem duplicar movimento.
 */
export interface RegistrarMovimentoCaixaInput {
  caixa_id: string;
  tipo: "sangria" | "suprimento";
  valor: number;
  motivo?: string | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE. */
  client_uuid?: string | null;
}

export interface FinalizarVendaInput {
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: FormaPagamento;
  status_pagamento: StatusPagamento;
  valor_recebido: number | null;
  troco: number | null;
  observacao: string | null;
  itens: FinalizarVendaItem[];
  pagamentos?: FinalizarVendaPagamento[];
  gerar_financeiro?: boolean;
  operador_id?: string | null;
  terminal_id?: string | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE no PDV. */
  client_uuid?: string | null;
}

// -------------------- Cancelar / Excluir venda --------------------

export interface CancelarVendaInput {
  venda_id: string;
  motivo?: string | null;
}

export interface ItemEstornado {
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  saldo_anterior: number;
  saldo_posterior: number;
  valor_total: number;
}

export interface LancamentoCancelado {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number;
  tipo: string;
  status_anterior: string;
}

/**
 * Resultado consolidado do cancelamento de venda.
 *
 * O cancelamento é uma **operação composta transacional** que afeta:
 *  - `vendas`           → status = 'cancelada', status_pagamento = 'cancelado'
 *  - `estoque_movimentacoes` → grava 1 linha 'devolucao' por item (estorno)
 *  - `financeiro_lancamentos` → marca todos os lançamentos vinculados como
 *    'cancelado' (mantém histórico, NÃO apaga)
 *
 * NÃO toca em `caixa_movimentos` da venda original (o movimento de caixa do
 * dia continua refletindo o que aconteceu fisicamente — o estorno é tratado
 * como evento separado pelo fluxo de caixa).
 */
export interface CancelarVendaResumo {
  venda_id: string;
  numero: string;
  total: number;
  motivo: string | null;
  cancelado_em: string;
  qtd_itens_estornados: number;
  qtd_total_estornada: number;
  itens_estornados: ItemEstornado[];
  qtd_lancamentos_cancelados: number;
  total_lancamentos_cancelados: number;
  lancamentos_cancelados: LancamentoCancelado[];
}

/**
 * Resultado da exclusão definitiva de uma venda **já cancelada**.
 *
 * Regras (validadas no banco):
 *  - SOMENTE vendas com status='cancelada' podem ser excluídas.
 *  - Pagamentos da venda (`venda_pagamentos`) são removidos fisicamente.
 *  - Lançamentos financeiros têm `venda_id` desvinculado (mantém histórico
 *    como lançamento avulso cancelado).
 *  - Movimentos de estoque têm `venda_id` desvinculado (mantém histórico
 *    do estorno).
 *  - A linha de `vendas` é deletada (itens caem por cascade).
 */
export interface ExcluirVendaCanceladaResult {
  venda_id: string;
  numero: string;
  excluida_em: string;
}
