/**
 * Cloud impl do RelatoriosAdapter — Onda 7.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  CaixaCardDomain,
  CaixaMovimentoDomain,
  CaixaSessaoDomain,
  CaixaSessoesFiltro,
  CategoriaFinanceiraDomain,
  ClienteOpcaoDomain,
  CompraCardDomain,
  CompraResumoDomain,
  ContasReceberFiltro,
  DreTotaisDomain,
  EstoqueProdutoBaseDomain,
  FluxoCaixaLinhaDomain,
  LancamentoContasReceberDomain,
  LancamentoFinanceiroDomain,
  MovimentacaoEstoqueAggDomain,
  NotaFiscalCardDomain,
  NotaFiscalLinhaDomain,
  OpcaoNomeDomain,
  PagamentoEmpresaDomain,
  RelatorioRangeInput,
  RelatoriosAdapter,
  SaldoAcumuladoFinanceiroDomain,
  VendaCardDomain,
} from "../relatorios-adapter";

export const cloudRelatoriosAdapter: RelatoriosAdapter = {
  async fluxoCaixa({ inicio, fim }: RelatorioRangeInput): Promise<FluxoCaixaLinhaDomain[]> {
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select(
        "id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento",
      )
      .gte("data_vencimento", inicio)
      .lte("data_vencimento", fim)
      .order("data_vencimento", { ascending: false })
      .limit(1000);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((l: any) => ({
      id: l.id,
      descricao: l.descricao,
      tipo: l.tipo,
      valor: Number(l.valor) || 0,
      valor_pago: Number(l.valor_pago) || 0,
      emissao: l.data_emissao,
      vencimento: l.data_vencimento,
      pagamento: l.data_pagamento,
      status: l.status,
      forma: l.forma_pagamento,
    }));
  },

  async compras({ inicio, fim }) {
    const { data, error } = await supabase
      .from("compras")
      .select("id, numero, data_emissao, total, status, fornecedor:fornecedores(razao_social)")
      .gte("data_emissao", inicio)
      .lte("data_emissao", fim)
      .order("data_emissao", { ascending: false })
      .limit(500);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((c: any): CompraResumoDomain => ({
      id: c.id,
      numero: c.numero,
      data: c.data_emissao,
      fornecedor: c.fornecedor?.razao_social ?? "—",
      total: Number(c.total) || 0,
      status: c.status,
    }));
  },

  async notasFiscais({ inicio, fim }) {
    const { data, error } = await supabase
      .from("vendas")
      .select("id, numero, numero_nf, serie_nf, data_emissao, total, status")
      .not("numero_nf", "is", null)
      .gte("data_emissao", inicio)
      .lte("data_emissao", fim)
      .order("data_emissao", { ascending: false })
      .limit(1000);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((v: any): NotaFiscalLinhaDomain => ({
      id: v.id,
      numero: v.numero,
      nf: v.numero_nf,
      serie: v.serie_nf ?? "",
      data: v.data_emissao,
      total: Number(v.total) || 0,
      status: v.status,
    }));
  },

  async estoqueBase() {
    const [prodRes, movRes] = await Promise.all([
      supabase
        .from("produtos")
        .select("id, sku, nome, unidade, preco_custo, preco_venda, estoque_minimo")
        .eq("status", "ativo")
        .order("nome", { ascending: true })
        .limit(2000),
      supabase.from("estoque_movimentacoes").select("produto_id, tipo, quantidade"),
    ]);
    if (prodRes.error) throw prodRes.error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const produtos: EstoqueProdutoBaseDomain[] = (prodRes.data ?? []).map((p: any) => ({
      id: p.id,
      sku: p.sku,
      nome: p.nome,
      unidade: p.unidade,
      preco_custo: Number(p.preco_custo) || 0,
      preco_venda: Number(p.preco_venda) || 0,
      estoque_minimo: Number(p.estoque_minimo) || 0,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const movimentos: MovimentacaoEstoqueAggDomain[] = (movRes.data ?? []).map((m: any) => ({
      produto_id: m.produto_id,
      tipo: m.tipo,
      quantidade: Number(m.quantidade) || 0,
    }));
    return { produtos, movimentos };
  },

  async dreTotais({ inicio, fim }): Promise<DreTotaisDomain> {
    const [vendasRes, lancRes] = await Promise.all([
      supabase
        .from("vendas")
        .select("total, status")
        .gte("data_emissao", inicio)
        .lte("data_emissao", fim)
        .neq("status", "cancelada"),
      supabase
        .from("financeiro_lancamentos")
        .select("tipo, valor_pago, status")
        .gte("data_pagamento", inicio)
        .lte("data_pagamento", fim)
        .eq("status", "pago"),
    ]);
    if (vendasRes.error) throw vendasRes.error;
    if (lancRes.error) throw lancRes.error;
    const receita_vendas = (vendasRes.data ?? []).reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: number, v: any) => a + (Number(v.total) || 0),
      0,
    );
    const outras_receitas = (lancRes.data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((l: any) => l.tipo === "receita")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((a: number, l: any) => a + (Number(l.valor_pago) || 0), 0);
    const despesas = (lancRes.data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((l: any) => l.tipo === "despesa")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((a: number, l: any) => a + (Number(l.valor_pago) || 0), 0);
    return { receita_vendas, outras_receitas, despesas };
  },

  async pagamentosEmpresa() {
    const { data, error } = await supabase
      .from("pagamentos")
      .select(
        "id, referencia_tipo, descricao, valor, status, data_vencimento, data_pagamento, created_at, asaas_payment_id, asaas_invoice_url, asaas_pix_qrcode, asaas_pix_copia_cola, asaas_billing_type",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as unknown as PagamentoEmpresaDomain[];
  },
};
