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

  /* ===================== Onda 8 — exporters do hub ===================== */

  async cardVendas(): Promise<VendaCardDomain[]> {
    const { data, error } = await supabase
      .from("vendas")
      .select(
        "numero, data_emissao, total, status, status_pagamento, forma_pagamento, cliente:clientes(nome)",
      )
      .order("data_emissao", { ascending: false })
      .limit(1000);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((v: any) => ({
      numero: v.numero,
      data: v.data_emissao,
      cliente: v.cliente?.nome ?? "Consumidor",
      forma: v.forma_pagamento ?? "",
      total: Number(v.total) || 0,
      status: v.status,
      pagamento: v.status_pagamento,
    }));
  },

  async cardCompras(): Promise<CompraCardDomain[]> {
    const { data, error } = await supabase
      .from("compras")
      .select("numero, data_emissao, total, status, fornecedor:fornecedores(razao_social)")
      .order("data_emissao", { ascending: false })
      .limit(1000);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((c: any) => ({
      numero: c.numero,
      data: c.data_emissao,
      fornecedor: c.fornecedor?.razao_social ?? "—",
      total: Number(c.total) || 0,
      status: c.status,
    }));
  },

  async cardFluxoCaixa(): Promise<FluxoCaixaLinhaDomain[]> {
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select(
        "id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento",
      )
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

  async cardFinanceiro(): Promise<LancamentoFinanceiroDomain[]> {
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select(
        "id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, categoria_id, categoria:categorias_financeiras(id, nome), cliente:clientes(id, nome), fornecedor:fornecedores(id, razao_social, nome_fantasia)",
      )
      .neq("status", "cancelado")
      .order("data_vencimento", { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data ?? []).map(mapLancamentoFinanceiro);
  },

  async cardContasReceber(): Promise<LancamentoContasReceberDomain[]> {
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select(
        `id, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, observacoes, numero_documento, cliente_id, venda_id, conciliado_em,
         cliente:clientes(id, nome, nome_fantasia, documento, telefone, celular, email),
         venda:vendas(id, numero, data_emissao, total)`,
      )
      .eq("tipo", "receber")
      .neq("status", "cancelado")
      .order("data_vencimento", { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data ?? []).map(mapContasReceber);
  },

  async cardCaixas(): Promise<CaixaCardDomain[]> {
    const { data, error } = await supabase
      .from("caixas")
      .select(
        "data_abertura, data_fechamento, valor_inicial, total_vendas, total_sangrias, total_suprimentos, valor_esperado, valor_informado, diferenca, status",
      )
      .order("data_abertura", { ascending: false })
      .limit(1000);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((c: any) => ({
      abertura: c.data_abertura,
      fechamento: c.data_fechamento ?? null,
      inicial: Number(c.valor_inicial) || 0,
      vendas: Number(c.total_vendas) || 0,
      sangrias: Number(c.total_sangrias) || 0,
      suprimentos: Number(c.total_suprimentos) || 0,
      esperado: c.valor_esperado != null ? Number(c.valor_esperado) : null,
      informado: c.valor_informado != null ? Number(c.valor_informado) : null,
      diferenca: c.diferenca != null ? Number(c.diferenca) : null,
      status: c.status,
    }));
  },

  async cardNotasFiscais(): Promise<NotaFiscalCardDomain[]> {
    const { data, error } = await supabase
      .from("vendas")
      .select("numero, numero_nf, serie_nf, data_emissao, total, status")
      .not("numero_nf", "is", null)
      .order("data_emissao", { ascending: false })
      .limit(1000);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((v: any) => ({
      venda: v.numero,
      nf: v.numero_nf,
      serie: v.serie_nf ?? "",
      data: v.data_emissao,
      total: Number(v.total) || 0,
      status: v.status,
    }));
  },

  /* ===================== Onda 8 — relatorios.financeiro ===================== */

  async categoriasFinanceiras(): Promise<CategoriaFinanceiraDomain[]> {
    const { data, error } = await supabase
      .from("categorias_financeiras")
      .select("id, nome, tipo")
      .eq("ativo", true)
      .order("nome");
    if (error) throw error;
    return (data ?? []) as CategoriaFinanceiraDomain[];
  },

  async lancamentosFinanceiroPeriodo({ inicio, fim }: RelatorioRangeInput) {
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select(
        `id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento,
         data_pagamento, status, forma_pagamento, categoria_id,
         categoria:categorias_financeiras(id, nome),
         cliente:clientes(id, nome),
         fornecedor:fornecedores(id, razao_social, nome_fantasia)`,
      )
      .gte("data_vencimento", inicio)
      .lte("data_vencimento", fim)
      .neq("status", "cancelado")
      .order("data_vencimento", { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data ?? []).map(mapLancamentoFinanceiro);
  },

  async saldoAcumuladoFinanceiro(): Promise<SaldoAcumuladoFinanceiroDomain> {
    const [{ data: rec }, { data: desp }] = await Promise.all([
      supabase
        .from("financeiro_lancamentos")
        .select("valor_pago")
        .eq("status", "pago")
        .eq("tipo", "receita"),
      supabase
        .from("financeiro_lancamentos")
        .select("valor_pago")
        .eq("status", "pago")
        .eq("tipo", "despesa"),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recebido = (rec ?? []).reduce((a: number, r: any) => a + (Number(r.valor_pago) || 0), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pago = (desp ?? []).reduce((a: number, r: any) => a + (Number(r.valor_pago) || 0), 0);
    return { recebido, pago };
  },

  /* ===================== Onda 8 — contas a receber ===================== */

  async clientesOpcoes(): Promise<ClienteOpcaoDomain[]> {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nome, nome_fantasia, documento")
      .order("nome");
    if (error) throw error;
    return (data ?? []) as ClienteOpcaoDomain[];
  },

  async lancamentosContasReceber({ inicio, fim, campoData, clienteId }: ContasReceberFiltro) {
    let q = supabase
      .from("financeiro_lancamentos")
      .select(
        `id, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, observacoes, numero_documento, cliente_id, venda_id, conciliado_em,
         cliente:clientes(id, nome, nome_fantasia, documento, telefone, celular, email),
         venda:vendas(id, numero, data_emissao, total)`,
      )
      .eq("tipo", "receber")
      .order(
        campoData === "emissao"
          ? "data_emissao"
          : campoData === "pagamento"
            ? "data_pagamento"
            : "data_vencimento",
        { ascending: false },
      )
      .limit(2000);

    if (campoData === "vencimento") {
      q = q.gte("data_vencimento", inicio).lte("data_vencimento", fim);
    } else if (campoData === "emissao") {
      q = q.gte("data_emissao", inicio).lte("data_emissao", fim);
    } else {
      q = q
        .not("data_pagamento", "is", null)
        .gte("data_pagamento", inicio)
        .lte("data_pagamento", fim);
    }
    if (clienteId && clienteId !== "todos") q = q.eq("cliente_id", clienteId);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapContasReceber);
  },

  /* ===================== Onda 8 — caixa ===================== */

  async funcionariosAtivos(): Promise<OpcaoNomeDomain[]> {
    const { data, error } = await supabase
      .from("funcionarios")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome");
    if (error) throw error;
    return (data ?? []) as OpcaoNomeDomain[];
  },

  async terminaisAtivos(): Promise<OpcaoNomeDomain[]> {
    const { data, error } = await supabase
      .from("terminais")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome");
    if (error) throw error;
    return (data ?? []) as OpcaoNomeDomain[];
  },

  async caixasSessoes({ iniIso, fimIso, operadorId, terminalId, status }: CaixaSessoesFiltro) {
    let q = supabase
      .from("caixas")
      .select(
        "id, operador_id, terminal_id, data_abertura, data_fechamento, valor_inicial, total_vendas, total_sangrias, total_suprimentos, total_dinheiro, total_pix, total_debito, total_credito, total_boleto, total_ifood, total_fiado, total_outros, valor_esperado, valor_informado, diferenca, status, observacao, observacao_fechamento, qtd_vendas",
      )
      .gte("data_abertura", iniIso)
      .lte("data_abertura", fimIso)
      .order("data_abertura", { ascending: false })
      .limit(500);
    if (operadorId && operadorId !== "todos") q = q.eq("operador_id", operadorId);
    if (terminalId && terminalId !== "todos") q = q.eq("terminal_id", terminalId);
    if (status === "aberto") q = q.eq("status", "aberto");
    if (status === "fechado") q = q.eq("status", "fechado");

    const { data, error } = await q;
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((c: any): CaixaSessaoDomain => ({
      id: c.id,
      operador_id: c.operador_id,
      terminal_id: c.terminal_id,
      data_abertura: c.data_abertura,
      data_fechamento: c.data_fechamento,
      valor_inicial: Number(c.valor_inicial) || 0,
      total_vendas: Number(c.total_vendas) || 0,
      total_sangrias: Number(c.total_sangrias) || 0,
      total_suprimentos: Number(c.total_suprimentos) || 0,
      total_dinheiro: Number(c.total_dinheiro) || 0,
      total_pix: Number(c.total_pix) || 0,
      total_debito: Number(c.total_debito) || 0,
      total_credito: Number(c.total_credito) || 0,
      total_boleto: Number(c.total_boleto) || 0,
      total_ifood: Number(c.total_ifood) || 0,
      total_fiado: Number(c.total_fiado) || 0,
      total_outros: Number(c.total_outros) || 0,
      valor_esperado: c.valor_esperado != null ? Number(c.valor_esperado) : null,
      valor_informado: c.valor_informado != null ? Number(c.valor_informado) : null,
      diferenca: c.diferenca != null ? Number(c.diferenca) : null,
      status: c.status,
      observacao: c.observacao,
      observacao_fechamento: c.observacao_fechamento,
      qtd_vendas: Number(c.qtd_vendas) || 0,
    }));
  },

  async caixaMovimentos(caixaId: string): Promise<CaixaMovimentoDomain[]> {
    const { data, error } = await supabase
      .from("caixa_movimentos")
      .select("id, caixa_id, tipo, valor, motivo, created_at")
      .eq("caixa_id", caixaId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((m: any) => ({
      id: m.id,
      caixa_id: m.caixa_id,
      tipo: m.tipo,
      valor: Number(m.valor) || 0,
      motivo: m.motivo,
      created_at: m.created_at,
    }));
  },

  async atualizarObservacaoCaixa(caixaId: string, observacao: string | null) {
    const { error } = await supabase
      .from("caixas")
      .update({ observacao_fechamento: observacao })
      .eq("id", caixaId);
    if (error) throw error;
  },
  async produtosVendidosPeriodo({ inicio, fim }) {
    if (import.meta.env.DEV) {
      console.log("[PRODUTOS_VENDIDOS] cloud query", { inicio, fim });
    }
    const { data, error } = await supabase
      .from("vendas")
      .select(
        `id, numero, data_emissao, status, status_pagamento, forma_pagamento,
         cliente_id, operador_id, caixa_id,
         cliente:clientes(nome),
         itens:venda_itens(
           id, produto_id, descricao, quantidade, preco_unitario, total,
           produto:produtos(nome, sku, categoria_id, preco_custo)
         )`,
      )
      .gte("data_emissao", inicio)
      .lte("data_emissao", fim)
      // Aceitos: aprovada, faturada (+ qualquer status de pagamento pago/recebido/parcial).
      // Excluídas: cancelada (e rascunho que ainda não conta como venda real).
      .not("status", "in", "(cancelada,rascunho)")
      .order("data_emissao", { ascending: false })
      .limit(5000);
    if (error) {
      if (import.meta.env.DEV) console.error("[PRODUTOS_VENDIDOS] cloud error", error);
      throw error;
    }
    const out: import("../relatorios-adapter").ProdutoVendidoLinhaDomain[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const v of (data ?? []) as any[]) {
      const itens = (v.itens ?? []) as any[]; // eslint-disable-line
      for (const it of itens) {
        out.push({
          itemId: it.id,
          vendaId: v.id,
          vendaNumero: v.numero,
          dataEmissao: v.data_emissao,
          vendaStatus: v.status,
          vendaStatusPagamento: v.status_pagamento,
          formaPagamento: v.forma_pagamento,
          clienteId: v.cliente_id,
          clienteNome: v.cliente?.nome ?? null,
          operadorId: v.operador_id,
          caixaId: v.caixa_id,
          produtoId: it.produto_id,
          produtoNome: it.produto?.nome ?? it.descricao ?? "—",
          produtoSku: it.produto?.sku ?? "",
          categoriaId: it.produto?.categoria_id ?? null,
          precoCusto: Number(it.produto?.preco_custo) || 0,
          quantidade: Number(it.quantidade) || 0,
          precoUnitario: Number(it.preco_unitario) || 0,
          total: Number(it.total) || 0,
        });
      }
    }
    if (import.meta.env.DEV) {
      console.log("[PRODUTOS_VENDIDOS] cloud result", {
        vendas: (data ?? []).length,
        itens: out.length,
        origem: "cloud",
      });
    }
    return out;
  },
  async clientesPorIds(ids) {
    if (!ids.length) return [];
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nome")
      .in("id", ids);
    if (error) throw error;
    return (data ?? []) as import("../relatorios-adapter").OpcaoNomeDomain[];
  },
};

/* ===================== mappers ===================== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLancamentoFinanceiro(l: any): LancamentoFinanceiroDomain {
  return {
    id: l.id,
    descricao: l.descricao,
    tipo: l.tipo,
    valor: Number(l.valor) || 0,
    valor_pago: Number(l.valor_pago) || 0,
    data_emissao: l.data_emissao,
    data_vencimento: l.data_vencimento,
    data_pagamento: l.data_pagamento,
    status: l.status,
    forma_pagamento: l.forma_pagamento,
    categoria_id: l.categoria_id,
    categoria_nome: l.categoria?.nome ?? null,
    cliente_id: l.cliente?.id ?? null,
    cliente_nome: l.cliente?.nome ?? null,
    fornecedor_id: l.fornecedor?.id ?? null,
    fornecedor_nome: l.fornecedor?.nome_fantasia ?? l.fornecedor?.razao_social ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapContasReceber(l: any): LancamentoContasReceberDomain {
  const valor = Number(l.valor) || 0;
  const pago = Number(l.valor_pago) || 0;
  const cli = l.cliente as Record<string, unknown> | null;
  const ven = l.venda as Record<string, unknown> | null;
  return {
    id: String(l.id),
    descricao: String(l.descricao ?? ""),
    valor,
    valor_pago: pago,
    data_emissao: (l.data_emissao as string) ?? null,
    data_vencimento: String(l.data_vencimento),
    data_pagamento: (l.data_pagamento as string) ?? null,
    status: l.status as string,
    forma_pagamento: (l.forma_pagamento as string) ?? null,
    observacoes: (l.observacoes as string) ?? null,
    numero_documento: (l.numero_documento as string) ?? null,
    cliente_id: (l.cliente_id as string) ?? null,
    cliente_nome: cli ? ((cli.nome_fantasia as string) || (cli.nome as string)) : null,
    cliente_documento: cli ? ((cli.documento as string) ?? null) : null,
    cliente_telefone: cli ? ((cli.telefone as string) ?? null) : null,
    cliente_celular: cli ? ((cli.celular as string) ?? null) : null,
    cliente_email: cli ? ((cli.email as string) ?? null) : null,
    venda_id: ven ? ((ven.id as string) ?? null) : null,
    venda_numero: ven ? ((ven.numero as string) ?? null) : null,
    venda_data: ven ? ((ven.data_emissao as string) ?? null) : null,
    venda_total: ven ? Number(ven.total) || 0 : null,
    conciliado_em: (l.conciliado_em as string) ?? null,
  };
}
