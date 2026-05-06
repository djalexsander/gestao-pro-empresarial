/**
 * Relatórios adapter — Onda 7.
 *
 * Reúne queries somente-leitura usadas pelas páginas de relatórios. Como os
 * relatórios são em sua maioria recortes de tabelas existentes, expomos
 * métodos por relatório (DRE, fluxo-caixa, fiscal, compras, estoque, etc.)
 * em vez de generalizar.
 */

export interface RelatorioRangeInput {
  inicio: string; // YYYY-MM-DD
  fim: string;
}

export interface FluxoCaixaLinhaDomain {
  id: string;
  descricao: string | null;
  tipo: string;
  valor: number;
  valor_pago: number;
  emissao: string;
  vencimento: string;
  pagamento: string | null;
  status: string;
  forma: string | null;
}

export interface CompraResumoDomain {
  id: string;
  numero: string;
  data: string;
  fornecedor: string;
  total: number;
  status: string;
}

export interface NotaFiscalLinhaDomain {
  id: string;
  numero: string;
  nf: string;
  serie: string;
  data: string;
  total: number;
  status: string;
}

export interface EstoqueProdutoBaseDomain {
  id: string;
  sku: string | null;
  nome: string;
  unidade: string | null;
  preco_custo: number;
  preco_venda: number;
  estoque_minimo: number;
}

export interface MovimentacaoEstoqueAggDomain {
  produto_id: string;
  tipo: string;
  quantidade: number;
}

export interface DreTotaisDomain {
  receita_vendas: number;
  outras_receitas: number;
  despesas: number;
}

export interface PagamentoEmpresaDomain {
  id: string;
  referencia_tipo: string;
  descricao: string | null;
  valor: number;
  status: string;
  data_vencimento: string | null;
  data_pagamento: string | null;
  created_at: string;
  asaas_payment_id: string | null;
  asaas_invoice_url: string | null;
  asaas_pix_qrcode: string | null;
  asaas_pix_copia_cola: string | null;
  asaas_billing_type: string | null;
}

export interface RelatoriosAdapter {
  fluxoCaixa(input: RelatorioRangeInput): Promise<FluxoCaixaLinhaDomain[]>;
  compras(input: RelatorioRangeInput): Promise<CompraResumoDomain[]>;
  notasFiscais(input: RelatorioRangeInput): Promise<NotaFiscalLinhaDomain[]>;
  estoqueBase(): Promise<{
    produtos: EstoqueProdutoBaseDomain[];
    movimentos: MovimentacaoEstoqueAggDomain[];
  }>;
  dreTotais(input: RelatorioRangeInput): Promise<DreTotaisDomain>;
  pagamentosEmpresa(): Promise<PagamentoEmpresaDomain[]>;
}
