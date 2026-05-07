/**
 * Relatórios adapter — Onda 7 + 8.
 *
 * Reúne queries somente-leitura usadas pelas páginas de relatórios.
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

/* ===== Onda 8 ===== */

export interface VendaCardDomain {
  numero: string;
  data: string;
  cliente: string;
  forma: string;
  total: number;
  status: string;
  pagamento: string;
}

export interface CompraCardDomain {
  numero: string;
  data: string;
  fornecedor: string;
  total: number;
  status: string;
}

export interface CaixaCardDomain {
  abertura: string;
  fechamento: string | null;
  inicial: number;
  vendas: number;
  sangrias: number;
  suprimentos: number;
  esperado: number | null;
  informado: number | null;
  diferenca: number | null;
  status: string;
}

export interface NotaFiscalCardDomain {
  venda: string;
  nf: string;
  serie: string;
  data: string;
  total: number;
  status: string;
}

export interface CategoriaFinanceiraDomain {
  id: string;
  nome: string;
  tipo: "receita" | "despesa";
}

export interface LancamentoFinanceiroDomain {
  id: string;
  descricao: string;
  tipo: "receita" | "despesa";
  valor: number;
  valor_pago: number;
  data_emissao: string;
  data_vencimento: string;
  data_pagamento: string | null;
  status: "pago" | "pendente" | "atrasado" | "cancelado";
  forma_pagamento: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
}

export interface LancamentoContasReceberDomain {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number;
  data_emissao: string | null;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string;
  forma_pagamento: string | null;
  observacoes: string | null;
  numero_documento: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_documento: string | null;
  cliente_telefone: string | null;
  cliente_celular: string | null;
  cliente_email: string | null;
  venda_id: string | null;
  venda_numero: string | null;
  venda_data: string | null;
  venda_total: number | null;
  conciliado_em: string | null;
}

export interface ClienteOpcaoDomain {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  documento: string | null;
}

export interface ContasReceberFiltro {
  inicio: string;
  fim: string;
  campoData: "vencimento" | "emissao" | "pagamento";
  clienteId?: string | null;
}

export interface CaixaSessaoDomain {
  id: string;
  operador_id: string | null;
  terminal_id: string | null;
  data_abertura: string;
  data_fechamento: string | null;
  valor_inicial: number;
  total_vendas: number;
  total_sangrias: number;
  total_suprimentos: number;
  total_dinheiro: number;
  total_pix: number;
  total_debito: number;
  total_credito: number;
  total_boleto: number;
  total_ifood: number;
  total_fiado: number;
  total_outros: number;
  valor_esperado: number | null;
  valor_informado: number | null;
  diferenca: number | null;
  status: "aberto" | "fechado";
  observacao: string | null;
  observacao_fechamento: string | null;
  qtd_vendas: number;
}

export interface CaixaMovimentoDomain {
  id: string;
  caixa_id: string;
  tipo: string;
  valor: number;
  motivo: string | null;
  created_at: string;
}

export interface CaixaSessoesFiltro {
  iniIso: string;
  fimIso: string;
  operadorId?: string | null;
  terminalId?: string | null;
  status?: "aberto" | "fechado" | null;
}

export interface OpcaoNomeDomain {
  id: string;
  nome: string;
}

export interface SaldoAcumuladoFinanceiroDomain {
  recebido: number;
  pago: number;
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

  // Onda 8 — exporters do hub /relatorios
  cardVendas(): Promise<VendaCardDomain[]>;
  cardCompras(): Promise<CompraCardDomain[]>;
  cardFluxoCaixa(): Promise<FluxoCaixaLinhaDomain[]>;
  cardFinanceiro(): Promise<LancamentoFinanceiroDomain[]>;
  cardContasReceber(): Promise<LancamentoContasReceberDomain[]>;
  cardCaixas(): Promise<CaixaCardDomain[]>;
  cardNotasFiscais(): Promise<NotaFiscalCardDomain[]>;

  // Onda 8 — relatorios.financeiro
  categoriasFinanceiras(): Promise<CategoriaFinanceiraDomain[]>;
  lancamentosFinanceiroPeriodo(input: RelatorioRangeInput): Promise<LancamentoFinanceiroDomain[]>;
  saldoAcumuladoFinanceiro(): Promise<SaldoAcumuladoFinanceiroDomain>;

  // Onda 8 — relatorios.contas-receber
  clientesOpcoes(): Promise<ClienteOpcaoDomain[]>;
  lancamentosContasReceber(input: ContasReceberFiltro): Promise<LancamentoContasReceberDomain[]>;

  // Onda 8 — relatorios.caixa
  funcionariosAtivos(): Promise<OpcaoNomeDomain[]>;
  terminaisAtivos(): Promise<OpcaoNomeDomain[]>;
  caixasSessoes(input: CaixaSessoesFiltro): Promise<CaixaSessaoDomain[]>;
  caixaMovimentos(caixaId: string): Promise<CaixaMovimentoDomain[]>;
  atualizarObservacaoCaixa(caixaId: string, observacao: string | null): Promise<void>;

  // Onda 11 — produtos vendidos / KPIs
  produtosVendidosPeriodo(input: RelatorioRangeInput): Promise<ProdutoVendidoLinhaDomain[]>;
  clientesPorIds(ids: string[]): Promise<OpcaoNomeDomain[]>;
}

export interface ProdutoVendidoLinhaDomain {
  itemId: string;
  vendaId: string;
  vendaNumero: string;
  dataEmissao: string;
  vendaStatus: string;
  vendaStatusPagamento: string | null;
  formaPagamento: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  operadorId: string | null;
  caixaId: string | null;
  produtoId: string | null;
  produtoNome: string;
  produtoSku: string;
  categoriaId: string | null;
  precoCusto: number;
  quantidade: number;
  precoUnitario: number;
  total: number;
}
