/**
 * Tipos de domínio adicionados na Onda 1 da migração offline-first.
 * Mantidos em arquivo separado pra evitar conflito com `types.ts`.
 */
import type { FormaPagamento, StatusPagamento } from "./types";

// =============== Vendas — leituras ===============
export type VendaStatus = "rascunho" | "aprovada" | "faturada" | "cancelada" | string;

export interface VendaListItemDomain {
  id: string;
  numero: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  data_emissao: string;
  data_finalizacao: string | null;
  total: number;
  status: VendaStatus;
  status_pagamento: StatusPagamento | string;
  forma_pagamento: FormaPagamento | null;
  caixa_id: string | null;
  operador_id: string | null;
  terminal_id: string | null;
}

export interface VendaDetalheDomain {
  id: string;
  numero: string;
  cliente_nome: string | null;
  data_emissao: string;
  data_finalizacao: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  valor_recebido: number | null;
  troco: number | null;
  valor_pago_total: number;
  valor_restante: number;
  status: VendaStatus;
  status_pagamento: string;
  forma_pagamento: FormaPagamento | null;
  observacoes: string | null;
  itens: Array<{
    id: string;
    produto_id: string;
    descricao: string | null;
    quantidade: number;
    preco_unitario: number;
    desconto: number;
    total: number;
    produto_nome: string | null;
    sku: string | null;
  }>;
  pagamentos: Array<{
    id: string;
    forma_pagamento: FormaPagamento;
    valor: number;
    valor_recebido: number | null;
    troco: number | null;
    parcelas: number | null;
    observacao: string | null;
  }>;
}

export interface VendaStatusHistoricoDomain {
  id: string;
  status_anterior: string | null;
  status_novo: string;
  origem: "financeiro" | "vendas" | "sistema";
  alterado_por: string | null;
  motivo: string | null;
  created_at: string;
}

export interface VendaMetricasDomain {
  qtd_vendas: number;
  qtd_canceladas: number;
  total_vendido: number;
  ticket_medio: number;
  qtd_pendentes: number;
  valor_pendente: number;
}

// =============== Compras ===============
export type CompraStatusDomain =
  | "rascunho"
  | "pendente"
  | "aprovada"
  | "recebida_parcial"
  | "recebida"
  | "cancelada";

export interface CompraItemDomain {
  id: string;
  compra_id: string;
  produto_id: string;
  variacao_id: string | null;
  descricao: string | null;
  quantidade: number;
  quantidade_recebida: number;
  preco_unitario: number;
  desconto: number;
  total: number;
}

export interface CompraDomain {
  id: string;
  numero: string;
  fornecedor_id: string | null;
  data_emissao: string;
  data_prevista: string | null;
  data_vencimento: string | null;
  data_recebimento: string | null;
  numero_nf: string | null;
  serie_nf: string | null;
  subtotal: number;
  desconto: number;
  frete: number;
  outros: number;
  total: number;
  status: CompraStatusDomain;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompraComFornecedorDomain extends CompraDomain {
  fornecedor: { id: string; razao_social: string; nome_fantasia: string | null } | null;
}

export interface CompraDetalheDomain extends CompraComFornecedorDomain {
  itens: Array<CompraItemDomain & { produto: { id: string; sku: string; nome: string } | null }>;
}

export interface CompraItemInputDomain {
  produto_id: string;
  variacao_id?: string | null;
  descricao?: string | null;
  quantidade: number;
  preco_unitario: number;
  desconto?: number;
}

export interface CriarCompraInput {
  numero: string;
  fornecedor_id: string | null;
  data_emissao: string;
  data_prevista?: string | null;
  data_vencimento?: string | null;
  numero_nf?: string | null;
  serie_nf?: string | null;
  desconto?: number;
  frete?: number;
  outros?: number;
  observacoes?: string | null;
  itens: CompraItemInputDomain[];
}

export interface CompraMetadadosInput {
  id: string;
  data_vencimento?: string | null;
  data_prevista?: string | null;
  fornecedor_id?: string | null;
  numero_nf?: string | null;
  serie_nf?: string | null;
  observacoes?: string | null;
}

export interface ReceberCompraInput {
  id: string;
  data_recebimento?: string;
  gerar_financeiro?: boolean;
  data_vencimento?: string | null;
}

export interface ReceberItemCompraInput {
  item_id: string;
  quantidade: number;
}

export interface ReceberCompraItensInput {
  compra_id: string;
  itens: ReceberItemCompraInput[];
  data_recebimento?: string;
  gerar_financeiro?: boolean;
  data_vencimento?: string | null;
}

export interface ReceberCompraItensResult {
  compra_id: string;
  status: CompraStatusDomain;
  pendente_total: number;
  recebido_total: number;
  itens_recebidos: number;
}

export interface FornecedorMetricaDomain {
  fornecedor_id: string;
  total_compras: number;
  valor_total: number;
  ultima_compra: string | null;
  compras_em_aberto: number;
}

// =============== Dashboard ===============
export interface DashboardData {
  vendasMes: number;
  vendasMesAnterior: number;
  comprasMes: number;
  comprasMesAnterior: number;
  lucroMes: number;
  margem: number;
  contasPagar: number;
  qtdContasPagar: number;
  contasReceber: number;
  qtdContasReceber: number;
  estoqueBaixo: number;
  vendasPorMes: Array<{ month: string; vendas: number; compras: number }>;
  fluxoCaixa: Array<{ day: string; entrada: number; saida: number }>;
  ultimasVendas: Array<{
    id: string;
    numero: string;
    cliente: string;
    valor: number;
    status: string;
    data: string;
  }>;
  ultimasCompras: Array<{
    id: string;
    numero: string;
    fornecedor: string;
    valor: number;
    status: string;
    data: string;
  }>;
}

// =============== Estoque adicional ===============
/** Map produto_id -> saldo */
export type SaldosEstoqueLote = Map<string, number>;

// =============== Vendas — input listas/métricas ===============
export interface VendasListInput {
  limit?: number;
}

export interface VendaMetricasPeriodoInput {
  data_inicio: string;
  data_fim: string;
}

// =============== Financeiro — indicadores e seções ===============
export interface FinanceiroPeriodoDomain {
  inicio: string;
  fim: string;
  inicioTs: string;
  fimTs: string;
  hoje: string;
}

export interface FinanceiroPeriodoRangeInput {
  inicio: string;
  fim: string;
  inicioTs: string;
  fimTs: string;
}

export interface FinanceiroVendaItemDetalheDomain {
  venda_id: string;
  venda_numero: string;
  data: string;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
  preco_custo: number;
  total_venda: number;
  total_custo: number;
  lucro: number;
  sem_custo: boolean;
}

export interface FinanceiroVendaResumoDomain {
  id: string;
  numero: string;
  data: string;
  cliente_nome: string | null;
  forma_pagamento: string | null;
  status_pagamento: string;
  total: number;
}

export interface FinanceiroIndicadoresMesDomain {
  periodo: FinanceiroPeriodoDomain;
  totalVendido: number;
  custoTotal: number;
  lucroBruto: number;
  margemPct: number;
  qtdVendas: number;
  qtdItensSemCusto: number;
  qtdItens: number;
  fiadoEmAberto: number;
  qtdFiado: number;
  ifoodAReceber: number;
  qtdIfood: number;
  recebidoHoje: number;
  qtdRecebimentosHoje: number;
  vencidosTotal: number;
  qtdVencidos: number;
  itensDetalhe: FinanceiroVendaItemDetalheDomain[];
  vendasDetalhe: FinanceiroVendaResumoDomain[];
}

export interface PosicaoFinanceiraDomain {
  totalReceber: number;
  qtdReceber: number;
  totalPagar: number;
  qtdPagar: number;
  saldo: number;
}

export interface PerformancePeriodoDomain {
  totalVendido: number;
  qtdVendas: number;
  custoTotal: number;
  qtdItens: number;
  qtdItensSemCusto: number;
  lucroBruto: number;
  margemPct: number;
}

export type FinanceiroFormaFiltro = "todos" | "fiado" | "ifood" | string;

export interface ReceberOrigemInput {
  periodo: FinanceiroPeriodoRangeInput;
  forma: FinanceiroFormaFiltro;
}

export interface ReceberOrigemDomain {
  fiadoEmAberto: number;
  qtdFiado: number;
  ifoodAReceber: number;
  qtdIfood: number;
  recebidoPeriodo: number;
  qtdRecebimentos: number;
  vencidosTotal: number;
  qtdVencidos: number;
}

export interface CobrancaPendenteItemDomain {
  tipo: "plano" | "modulo";
  plano_id: string | null;
  modulo_id: string | null;
  descricao: string | null;
  valor: number;
}

export interface CobrancaPendenteDomain {
  pagamento_id: string;
  valor: number;
  descricao: string | null;
  data_vencimento: string | null;
  asaas_payment_id: string | null;
  invoice_url: string | null;
  pix_qrcode: string | null;
  pix_copia_cola: string | null;
  created_at: string;
  itens: CobrancaPendenteItemDomain[];
}
