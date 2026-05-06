/**
 * ============================================================================
 * Cloud Adapter — Supabase remoto (arquitetura atual)
 * ============================================================================
 *
 * Implementação 1:1 do que o app já fazia chamando `supabase` direto.
 * Não introduz nenhuma mudança de comportamento — só centraliza o acesso.
 *
 * Quando a Fase 3 (servidor local) entrar, criamos `local.ts` implementando
 * a mesma interface `DataAdapter` e o `client.ts` decide qual usar.
 */

import { supabase } from "@/integrations/supabase/client";
import type { DataAdapter } from "../adapter";
import type {
  AbrirCaixaInput,
  AdicionarProdutoCodigoInput,
  AdicionarProdutoCodigoResult,
  AlterarStatusClienteInput,
  AlterarStatusClienteResult,
  AlterarStatusFornecedorInput,
  AlterarStatusFornecedorResult,
  AlterarStatusProdutoInput,
  AlterarStatusProdutoResult,
  AlterarStatusVendaInput,
  AlterarStatusVendaResult,
  AlterarVencimentoLancamentoInput,
  AlterarVencimentoLancamentoResult,
  CancelarLancamentoInput,
  CancelarLancamentoResult,
  CancelarVendaInput,
  CancelarVendaResumo,
  CodigoTipo,
  ConciliarIfoodIndividualInput,
  ConciliarIfoodLoteInput,
  CriarCategoriaProdutoInput,
  CriarCategoriaProdutoResult,
  CriarClienteInput,
  CriarClienteResult,
  CriarFornecedorInput,
  CriarFornecedorResult,
  CriarLancamentoAvulsoInput,
  CriarLancamentoAvulsoResult,
  CriarProdutoInput,
  CriarProdutoResult,
  CriarProdutoVariacaoInput,
  CriarProdutoVariacaoResult,
  EditarClienteInput,
  EditarClienteResult,
  EditarFornecedorInput,
  EditarFornecedorResult,
  EditarLancamentoAvulsoInput,
  EditarLancamentoAvulsoResult,
  EditarProdutoInput,
  EditarProdutoResult,
  ExcluirClienteResult,
  ExcluirFornecedorResult,
  ExcluirLancamentoAvulsoResult,
  ExcluirProdutoCodigoResult,
  ExcluirProdutoResult,
  ExcluirProdutoVariacaoResult,
  ExcluirVendaCanceladaResult,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  ItemEstornado,
  LancamentoCancelado,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  ReabrirLancamentoResult,
  RegistrarMovimentoCaixaInput,
  RegistrarMovimentoEstoqueInput,
  RegistrarMovimentoEstoqueResult,
  RegistrarPagamentoLancamentoInput,
  RegistrarPagamentoLancamentoResult,
  RemoverPagamentoLancamentoResult,
  StatusVendaEditavelDomain,
} from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPluRow(row: any): ProdutoPluResult {
  return {
    produto_id: row.id,
    sku: row.sku,
    nome: row.nome,
    unidade: row.unidade,
    preco_venda: Number(row.preco_venda ?? 0),
    vendido_por_peso: Boolean(row.vendido_por_peso),
    aceita_etiqueta_balanca: Boolean(row.aceita_etiqueta_balanca),
    plu: row.plu ?? row.codigo_interno ?? row.sku ?? null,
    status: row.status,
  };
}

const PLU_COLUMNS =
  "id, sku, nome, unidade, preco_venda, vendido_por_peso, aceita_etiqueta_balanca, plu, codigo_interno, status";

const produtos: DataAdapter["produtos"] = {
  async buscarPorCodigo(codigo) {
    const valor = codigo.trim();
    if (!valor) return null;

    // Cast para `any` porque a função RPC ainda não está em supabase/types.ts
    // (gerado automaticamente). Após a próxima sincronização de tipos, sai.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("buscar_produto_por_codigo", {
      _codigo: valor,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    const result: ProdutoBuscaResult = {
      produto_id: row.produto_id,
      sku: row.sku,
      nome: row.nome,
      codigo_barras: row.codigo_barras,
      qr_code: row.qr_code,
      codigo_interno: row.codigo_interno,
      tipo_identificacao_principal: row.tipo_identificacao_principal,
      preco_venda: Number(row.preco_venda ?? 0),
      preco_custo: Number(row.preco_custo ?? 0),
      unidade: row.unidade,
      status: row.status,
      categoria_id: row.categoria_id,
      categoria_nome: row.categoria_nome,
      fonte: row.fonte as CodigoTipo,
      saldo_estoque: Number(row.saldo_estoque ?? 0),
    };
    return result;
  },

  async buscarPorPlu(plu) {
    const valor = plu.trim();
    if (!valor) return null;

    // RLS já restringe ao owner; basta filtrar por valor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("produtos")
      .select(PLU_COLUMNS)
      .or(`plu.eq.${valor},sku.eq.${valor},codigo_interno.eq.${valor}`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      // Tenta sem zeros à esquerda (ex.: PLU 00123 cadastrado como 123).
      const stripped = valor.replace(/^0+/, "");
      if (stripped && stripped !== valor) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r2 = await (supabase as any)
          .from("produtos")
          .select(PLU_COLUMNS)
          .or(`plu.eq.${stripped},sku.eq.${stripped},codigo_interno.eq.${stripped}`)
          .limit(1)
          .maybeSingle();
        if (r2.error) throw r2.error;
        if (!r2.data) return null;
        return mapPluRow(r2.data);
      }
      return null;
    }
    return mapPluRow(data);
  },

  async listar() {
    const { data, error } = await supabase
      .from("produtos")
      .select("*, categoria:categorias_produto(id, nome)")
      .order("nome");
    if (error) throw error;
    return (data ?? []) as unknown as ProdutoComCategoria[];
  },

  // ---------------------------- Writes ----------------------------

  async criar(input: CriarProdutoInput): Promise<CriarProdutoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("criar_produto", {
      _sku: input.sku,
      _nome: input.nome,
      _unidade: input.unidade,
      _preco_custo: input.preco_custo,
      _preco_venda: input.preco_venda,
      _estoque_minimo: input.estoque_minimo,
      _status: input.status,
      _tipo_identificacao_principal: input.tipo_identificacao_principal ?? "sku",
      _codigo_barras: input.codigo_barras ?? null,
      _qr_code: input.qr_code ?? null,
      _codigo_interno: input.codigo_interno ?? null,
      _observacao_tecnica: input.observacao_tecnica ?? null,
      _descricao: input.descricao ?? null,
      _marca: input.marca ?? null,
      _categoria_id: input.categoria_id ?? null,
      _estoque_inicial: input.estoque_inicial ?? 0,
      _ncm: input.ncm ?? null,
      _vendido_por_peso: input.vendido_por_peso ?? false,
      _plu: input.plu ?? null,
      _aceita_etiqueta_balanca: input.aceita_etiqueta_balanca ?? false,
      _casas_decimais_quantidade: input.casas_decimais_quantidade ?? 3,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      produto_id: String(d.produto_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editar(input: EditarProdutoInput): Promise<EditarProdutoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("editar_produto", {
      _produto_id: input.produto_id,
      _sku: input.sku,
      _nome: input.nome,
      _unidade: input.unidade,
      _preco_custo: input.preco_custo,
      _preco_venda: input.preco_venda,
      _estoque_minimo: input.estoque_minimo,
      _status: input.status,
      _tipo_identificacao_principal: input.tipo_identificacao_principal ?? "sku",
      _codigo_barras: input.codigo_barras ?? null,
      _qr_code: input.qr_code ?? null,
      _codigo_interno: input.codigo_interno ?? null,
      _observacao_tecnica: input.observacao_tecnica ?? null,
      _descricao: input.descricao ?? null,
      _marca: input.marca ?? null,
      _categoria_id: input.categoria_id ?? null,
      _estoque_inicial: input.estoque_inicial ?? null,
      _ncm: input.ncm ?? null,
      _vendido_por_peso: input.vendido_por_peso ?? null,
      _plu: input.plu ?? null,
      _aceita_etiqueta_balanca: input.aceita_etiqueta_balanca ?? null,
      _casas_decimais_quantidade: input.casas_decimais_quantidade ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return { produto_id: String(d.produto_id ?? input.produto_id) };
  },

  async alterarStatus(input: AlterarStatusProdutoInput): Promise<AlterarStatusProdutoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("alterar_status_produto", {
      _produto_id: input.produto_id,
      _status: input.status,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      produto_id: String(d.produto_id ?? input.produto_id),
      status: (d.status as AlterarStatusProdutoResult["status"]) ?? input.status,
    };
  },

  async excluir(produtoId: string): Promise<ExcluirProdutoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_produto", {
      _produto_id: produtoId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      produto_id: String(d.produto_id ?? produtoId),
      excluido: Boolean(d.excluido),
    };
  },

  async adicionarCodigo(input: AdicionarProdutoCodigoInput): Promise<AdicionarProdutoCodigoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("adicionar_produto_codigo", {
      _produto_id: input.produto_id,
      _tipo_codigo: input.tipo_codigo,
      _valor_codigo: input.valor_codigo,
      _variacao_id: input.variacao_id ?? null,
      _observacao: input.observacao ?? null,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      codigo_id: String(d.codigo_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluirCodigo(codigoId: string): Promise<ExcluirProdutoCodigoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_produto_codigo", {
      _codigo_id: codigoId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      codigo_id: String(d.codigo_id ?? codigoId),
      excluido: Boolean(d.excluido),
    };
  },

  async criarVariacao(input: CriarProdutoVariacaoInput): Promise<CriarProdutoVariacaoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("criar_produto_variacao", {
      _produto_id: input.produto_id,
      _sku: input.sku,
      _nome: input.nome,
      _atributos: input.atributos ?? {},
      _preco_custo: input.preco_custo ?? null,
      _preco_venda: input.preco_venda ?? null,
      _codigo_barras: input.codigo_barras ?? null,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      variacao_id: String(d.variacao_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluirVariacao(variacaoId: string): Promise<ExcluirProdutoVariacaoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_produto_variacao", {
      _variacao_id: variacaoId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      variacao_id: String(d.variacao_id ?? variacaoId),
      excluido: Boolean(d.excluido),
    };
  },

  async criarCategoria(input: CriarCategoriaProdutoInput): Promise<CriarCategoriaProdutoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("criar_categoria_produto", {
      _nome: input.nome,
      _parent_id: input.parent_id ?? null,
      _descricao: input.descricao ?? null,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      categoria_id: String(d.categoria_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    let q = supabase
      .from("produtos")
      .select("*, categoria:categorias_produto(id, nome)")
      .order("nome");
    if (input?.status) q = q.eq("status", input.status);
    if (input?.categoria_id) q = q.eq("categoria_id", input.categoria_id);
    if (input?.busca) {
      const b = input.busca.trim();
      if (b) q = q.or(`nome.ilike.%${b}%,sku.ilike.%${b}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as ProdutoComCategoria[];
  },

  async get(produtoId) {
    const { data, error } = await supabase
      .from("produtos")
      .select("*, variacoes:produto_variacoes(*)")
      .eq("id", produtoId)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as import("../types").ProdutoComVariacoes | null) ?? null;
  },
};

// =====================================================================
// Vendas
// =====================================================================
const vendas: DataAdapter["vendas"] = {
  async finalizar(input: FinalizarVendaInput): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("finalizar_venda_pdv", {
      _cliente_id: input.cliente_id,
      _subtotal: input.subtotal,
      _desconto: input.desconto,
      _total: input.total,
      _forma: input.forma_pagamento,
      _status_pagamento: input.status_pagamento,
      _valor_recebido: input.valor_recebido,
      _troco: input.troco,
      _observacao: input.observacao,
      _itens: input.itens,
      _pagamentos: input.pagamentos && input.pagamentos.length > 0 ? input.pagamentos : null,
      _gerar_financeiro: input.gerar_financeiro ?? true,
      _operador_id: input.operador_id ?? null,
      _terminal_id: input.terminal_id ?? null,
      // Chave de idempotência (nullable: chamadas antigas seguem funcionando)
      _client_uuid: input.client_uuid ?? null,
      // Data de vencimento (obrigatória quando houver pagamento fiado)
      _data_vencimento: input.data_vencimento ?? null,
    });
    if (error) throw error;
    return data as string;
  },

  async cancelar(input: CancelarVendaInput): Promise<CancelarVendaResumo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("cancelar_venda", {
      _venda_id: input.venda_id,
      _motivo: input.motivo ?? null,
    });
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    return {
      venda_id: d.venda_id,
      numero: d.numero,
      total: Number(d.total) || 0,
      motivo: d.motivo ?? null,
      cancelado_em: d.cancelado_em,
      qtd_itens_estornados: Number(d.qtd_itens_estornados) || 0,
      qtd_total_estornada: Number(d.qtd_total_estornada) || 0,

      itens_estornados: (d.itens_estornados ?? []).map(
        (i: any): ItemEstornado => ({
          produto_id: i.produto_id,
          produto_nome: i.produto_nome,
          quantidade: Number(i.quantidade) || 0,
          saldo_anterior: Number(i.saldo_anterior) || 0,
          saldo_posterior: Number(i.saldo_posterior) || 0,
          valor_total: Number(i.valor_total) || 0,
        }),
      ),
      qtd_lancamentos_cancelados: Number(d.qtd_lancamentos_cancelados) || 0,
      total_lancamentos_cancelados: Number(d.total_lancamentos_cancelados) || 0,

      lancamentos_cancelados: (d.lancamentos_cancelados ?? []).map(
        (l: any): LancamentoCancelado => ({
          id: l.id,
          descricao: l.descricao,
          valor: Number(l.valor) || 0,
          valor_pago: Number(l.valor_pago) || 0,
          tipo: l.tipo,
          status_anterior: l.status_anterior,
        }),
      ),
    };
  },

  async excluirCancelada(vendaId: string): Promise<ExcluirVendaCanceladaResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_venda_cancelada", {
      _venda_id: vendaId,
    });
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    return {
      venda_id: d.venda_id,
      numero: d.numero,
      excluida_em: d.excluida_em,
    };
  },

  async alterarStatus(input: AlterarStatusVendaInput): Promise<AlterarStatusVendaResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("alterar_status_venda", {
      _venda_id: input.venda_id,
      _novo_status: input.novo_status,
      _motivo: input.motivo ?? null,
    });
    if (error) throw error;
    // RPC retorna jsonb livre — normalizamos os campos comuns e mantemos o
    // payload bruto em `raw` para auditoria/debug.
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      venda_id: (d.venda_id as string) ?? input.venda_id,
      novo_status: (d.novo_status as StatusVendaEditavelDomain) ?? input.novo_status,
      qtd_lancamentos_alterados: Number(d.qtd_lancamentos_alterados ?? d.qtd_alterados ?? 0) || 0,
      raw: d,
    };
  },

  // ---------------------------- Reads ----------------------------
  async list(input) {
    const { data, error } = await supabase
      .from("vendas")
      .select(
        "id, numero, cliente_id, data_emissao, data_finalizacao, total, status, status_pagamento, forma_pagamento, caixa_id, operador_id, terminal_id, cliente:clientes(nome)",
      )
      .order("created_at", { ascending: false })
      .limit(input?.limit ?? 500);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((v: any) => ({
      id: v.id,
      numero: v.numero,
      cliente_id: v.cliente_id,
      cliente_nome: v.cliente?.nome ?? null,
      data_emissao: v.data_emissao,
      data_finalizacao: v.data_finalizacao,
      total: Number(v.total) || 0,
      status: v.status,
      status_pagamento: v.status_pagamento,
      forma_pagamento: v.forma_pagamento,
      caixa_id: v.caixa_id ?? null,
      operador_id: v.operador_id ?? null,
      terminal_id: v.terminal_id ?? null,
    }));
  },

  async detalhe(vendaId) {
    const { data: v, error } = await supabase
      .from("vendas")
      .select(
        "id, numero, data_emissao, data_finalizacao, subtotal, desconto, total, valor_recebido, troco, status, status_pagamento, forma_pagamento, observacoes, cliente:clientes(nome)",
      )
      .eq("id", vendaId)
      .single();
    if (error) throw error;
    const { data: itens, error: e2 } = await supabase
      .from("venda_itens")
      .select(
        "id, produto_id, descricao, quantidade, preco_unitario, desconto, total, produto:produtos(nome, sku)",
      )
      .eq("venda_id", vendaId);
    if (e2) throw e2;
    const { data: pagamentos, error: e3 } = await supabase
      .from("venda_pagamentos")
      .select("id, forma_pagamento, valor, valor_recebido, troco, parcelas, observacao")
      .eq("venda_id", vendaId)
      .order("created_at", { ascending: true });
    if (e3) throw e3;
    const { data: lancs } = await supabase
      .from("financeiro_lancamentos")
      .select("valor_pago, status")
      .eq("venda_id", vendaId);
    const valor_pago_total = (lancs ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((l: any) => l.status !== "cancelado")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((s: number, l: any) => s + (Number(l.valor_pago) || 0), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vAny = v as any;
    const total = Number(vAny.total) || 0;
    return {
      id: vAny.id,
      numero: vAny.numero,
      cliente_nome: vAny.cliente?.nome ?? null,
      data_emissao: vAny.data_emissao,
      data_finalizacao: vAny.data_finalizacao,
      subtotal: Number(vAny.subtotal) || 0,
      desconto: Number(vAny.desconto) || 0,
      total,
      valor_recebido: vAny.valor_recebido,
      troco: vAny.troco,
      valor_pago_total,
      valor_restante: Math.max(0, total - valor_pago_total),
      status: vAny.status,
      status_pagamento: vAny.status_pagamento,
      forma_pagamento: vAny.forma_pagamento,
      observacoes: vAny.observacoes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      itens: (itens ?? []).map((i: any) => ({
        id: i.id,
        produto_id: i.produto_id,
        descricao: i.descricao,
        quantidade: Number(i.quantidade) || 0,
        preco_unitario: Number(i.preco_unitario) || 0,
        desconto: Number(i.desconto) || 0,
        total: Number(i.total) || 0,
        produto_nome: i.produto?.nome ?? null,
        sku: i.produto?.sku ?? null,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pagamentos: (pagamentos ?? []).map((p: any) => ({
        id: p.id,
        forma_pagamento: p.forma_pagamento,
        valor: Number(p.valor) || 0,
        valor_recebido: p.valor_recebido != null ? Number(p.valor_recebido) : null,
        troco: p.troco != null ? Number(p.troco) : null,
        parcelas: p.parcelas != null ? Number(p.parcelas) : null,
        observacao: p.observacao,
      })),
    };
  },

  async historico(vendaId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("vendas_status_historico")
      .select("id, status_anterior, status_novo, origem, alterado_por, motivo, created_at")
      .eq("venda_id", vendaId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as import("../extra-types").VendaStatusHistoricoDomain[];
  },

  async metricasPeriodo(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("venda_metricas_periodo", {
      _data_inicio: input.data_inicio,
      _data_fim: input.data_fim,
    });
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (data ?? {}) as any;
    return {
      qtd_vendas: Number(d.qtd_vendas) || 0,
      qtd_canceladas: Number(d.qtd_canceladas) || 0,
      total_vendido: Number(d.total_vendido) || 0,
      ticket_medio: Number(d.ticket_medio) || 0,
      qtd_pendentes: Number(d.qtd_pendentes) || 0,
      valor_pendente: Number(d.valor_pendente) || 0,
    };
  },
};
// =====================================================================
const caixa: DataAdapter["caixa"] = {
  async abrir(input: AbrirCaixaInput): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("abrir_caixa", {
      _valor_inicial: input.valor_inicial,
      _observacao: input.observacao ?? undefined,
      _operador_id: input.operador_id ?? undefined,
      _terminal_id: input.terminal_id ?? undefined,
    });
    if (error) throw error;
    return data as string;
  },

  async fechar(input: FecharCaixaInput): Promise<FecharCaixaResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("fechar_caixa", {
      _caixa_id: input.caixa_id,
      _valor_informado: input.valor_informado,
      _observacao: input.observacao ?? undefined,
    });
    if (error) throw error;
    return data as FecharCaixaResult;
  },

  async registrarMovimento(input: RegistrarMovimentoCaixaInput): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("caixa_registrar_movimento", {
      _caixa_id: input.caixa_id,
      _tipo: input.tipo,
      _valor: input.valor,
      _motivo: input.motivo ?? undefined,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    return data as string;
  },

  async excluir(caixaId: string): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_caixa", {
      _caixa_id: caixaId,
    });
    if (error) throw error;
    return data;
  },

  async reabrir(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("reabrir_caixa", {
      _caixa_id: input.caixa_id,
      _motivo: input.motivo ?? null,
    });
    if (error) throw error;
    return data;
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async aberto(filtro) {
    const { data: uid } = await supabase.auth.getUser();
    if (!uid.user) return null;
    let q = supabase
      .from("caixas")
      .select("*")
      .eq("owner_id", uid.user.id)
      .eq("status", "aberto");
    if (!filtro?.qualquer) {
      if (filtro?.operador_id) q = q.eq("operador_id", filtro.operador_id);
      else q = q.is("operador_id", null);
    }
    const { data, error } = await q
      .order("data_abertura", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as import("../types").CaixaDomain | null) ?? null;
  },

  async resumo(caixaId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("caixa_resumo", {
      _caixa_id: caixaId,
    });
    if (error) throw error;
    return (data as unknown as import("../types").CaixaResumoDomain | null) ?? null;
  },

  async historico(input) {
    const { data, error } = await supabase
      .from("caixas")
      .select("*")
      .order("data_abertura", { ascending: false })
      .limit(input?.limit ?? 50);
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").CaixaDomain[];
  },

  async movimentos(caixaId) {
    const { data, error } = await supabase
      .from("caixa_movimentos")
      .select("*")
      .eq("caixa_id", caixaId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").CaixaMovimentoDomain[];
  },
};

// =====================================================================
// Financeiro / Lançamentos
// =====================================================================
const financeiro: DataAdapter["financeiro"] = {
  async registrarPagamento(
    input: RegistrarPagamentoLancamentoInput,
  ): Promise<RegistrarPagamentoLancamentoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("registrar_pagamento_lancamento", {
      _lancamento_id: input.lancamento_id,
      _valor: input.valor,
      _data_pagamento: input.data_pagamento,
      _forma_pagamento: input.forma_pagamento ?? null,
      _observacao: input.observacao ?? null,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      pagamento_id: String(d.pagamento_id ?? ""),
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      idempotente: Boolean(d.idempotente),
    };
  },

  async removerPagamento(pagamentoId: string): Promise<RemoverPagamentoLancamentoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("remover_pagamento_lancamento", {
      _pagamento_id: pagamentoId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      removido: Boolean(d.removido),
      idempotente: d.idempotente as boolean | undefined,
      lancamento_id: d.lancamento_id as string | undefined,
    };
  },

  async cancelarLancamento(input: CancelarLancamentoInput): Promise<CancelarLancamentoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("cancelar_lancamento", {
      _lancamento_id: input.lancamento_id,
      _motivo: input.motivo ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      idempotente: Boolean(d.idempotente),
    };
  },

  async reabrirLancamento(lancamentoId: string): Promise<ReabrirLancamentoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("reabrir_lancamento", {
      _lancamento_id: lancamentoId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? lancamentoId),
      novo_status: (d.novo_status as ReabrirLancamentoResult["novo_status"]) ?? "pendente",
    };
  },

  async alterarVencimento(
    input: AlterarVencimentoLancamentoInput,
  ): Promise<AlterarVencimentoLancamentoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("alterar_vencimento_lancamento", {
      _lancamento_id: input.lancamento_id,
      _nova_data: input.nova_data,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      data_vencimento: String(d.data_vencimento ?? input.nova_data),
    };
  },

  async conciliarIfoodIndividual(input: ConciliarIfoodIndividualInput): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("conciliar_ifood_lancamento", {
      _lancamento_id: input.lancamento_id,
      _data_repasse: input.data_repasse,
      _valor_repasse: input.valor_repasse,
      _numero_repasse: input.numero_repasse ?? undefined,
      _observacao: input.observacao ?? undefined,
    });
    if (error) throw error;
    return data;
  },

  async conciliarIfoodLote(input: ConciliarIfoodLoteInput): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("conciliar_ifood_lote", {
      _lancamento_ids: input.lancamento_ids,
      _data_repasse: input.data_repasse,
      _valor_repasse_total: input.valor_repasse_total,
      _numero_repasse: input.numero_repasse ?? undefined,
      _observacao: input.observacao ?? undefined,
    });
    if (error) throw error;
    return data;
  },

  async criarLancamentoAvulso(
    input: CriarLancamentoAvulsoInput,
  ): Promise<CriarLancamentoAvulsoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("criar_lancamento_avulso", {
      _tipo: input.tipo,
      _descricao: input.descricao,
      _valor: input.valor,
      _data_vencimento: input.data_vencimento,
      _data_emissao: input.data_emissao ?? null,
      _categoria_id: input.categoria_id ?? null,
      _cliente_id: input.cliente_id ?? null,
      _fornecedor_id: input.fornecedor_id ?? null,
      _numero_documento: input.numero_documento ?? null,
      _forma_pagamento: input.forma_pagamento ?? null,
      _observacoes: input.observacoes ?? null,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editarLancamentoAvulso(
    input: EditarLancamentoAvulsoInput,
  ): Promise<EditarLancamentoAvulsoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("editar_lancamento_avulso", {
      _lancamento_id: input.lancamento_id,
      _descricao: input.descricao,
      _valor: input.valor,
      _data_vencimento: input.data_vencimento,
      _data_emissao: input.data_emissao ?? null,
      _categoria_id: input.categoria_id ?? null,
      _cliente_id: input.cliente_id ?? null,
      _fornecedor_id: input.fornecedor_id ?? null,
      _numero_documento: input.numero_documento ?? null,
      _forma_pagamento: input.forma_pagamento ?? null,
      _observacoes: input.observacoes ?? null,
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluirLancamentoAvulso(lancamentoId: string): Promise<ExcluirLancamentoAvulsoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_lancamento_avulso", {
      _lancamento_id: lancamentoId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? lancamentoId),
      excluido: Boolean(d.excluido),
    };
  },

  // ---------------------------- Indicadores / leituras agregadas ----------------------------
  async indicadoresMes() {
    const today = new Date();
    const inicio = new Date(today.getFullYear(), today.getMonth(), 1);
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const inicioStr = ymd(inicio);
    const fimStr = ymd(today);
    const periodo = {
      inicio: inicioStr,
      fim: fimStr,
      inicioTs: `${inicioStr}T00:00:00`,
      fimTs: `${fimStr}T23:59:59.999`,
      hoje: fimStr,
    };

    const { data: vendasData, error: errVendas } = await supabase
      .from("vendas")
      .select(
        "id, numero, data_finalizacao, total, forma_pagamento, status_pagamento, cliente:clientes(nome)",
      )
      .gte("data_finalizacao", periodo.inicioTs)
      .lte("data_finalizacao", periodo.fimTs)
      .neq("status", "cancelada")
      .limit(5000);
    if (errVendas) throw errVendas;

    const vendas = (vendasData ?? []) as Array<{
      id: string;
      numero: string;
      data_finalizacao: string;
      total: number;
      forma_pagamento: string | null;
      status_pagamento: string;
      cliente: { nome: string | null } | null;
    }>;

    const vendaIds = vendas.map((v) => v.id);
    let itens: import("../extra-types").FinanceiroVendaItemDetalheDomain[] = [];
    let custoTotal = 0;
    let qtdItens = 0;
    let qtdItensSemCusto = 0;

    if (vendaIds.length > 0) {
      const { data: itensData, error: errItens } = await supabase
        .from("venda_itens")
        .select(
          "venda_id, produto_id, quantidade, preco_unitario, total, produto:produtos(nome, preco_custo)",
        )
        .in("venda_id", vendaIds)
        .limit(20000);
      if (errItens) throw errItens;

      const vendaMap = new Map(vendas.map((v) => [v.id, v] as const));
      itens = (
        (itensData ?? []) as Array<{
          venda_id: string;
          produto_id: string;
          quantidade: number;
          preco_unitario: number;
          total: number;
          produto: { nome: string | null; preco_custo: number | null } | null;
        }>
      ).map((it) => {
        const v = vendaMap.get(it.venda_id);
        const qtd = Number(it.quantidade) || 0;
        const precoCusto = Number(it.produto?.preco_custo ?? 0) || 0;
        const totalVenda = Number(it.total) || 0;
        const totalCusto = precoCusto * qtd;
        const semCusto = precoCusto <= 0;
        qtdItens += 1;
        if (semCusto) qtdItensSemCusto += 1;
        custoTotal += totalCusto;
        return {
          venda_id: it.venda_id,
          venda_numero: v?.numero ?? "—",
          data: v?.data_finalizacao ?? "",
          produto_id: it.produto_id,
          produto_nome: it.produto?.nome ?? "Produto",
          quantidade: qtd,
          preco_unitario: Number(it.preco_unitario) || 0,
          preco_custo: precoCusto,
          total_venda: totalVenda,
          total_custo: totalCusto,
          lucro: totalVenda - totalCusto,
          sem_custo: semCusto,
        };
      });
    }

    const totalVendido = vendas.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const lucroBruto = totalVendido - custoTotal;
    const margemPct = totalVendido > 0 ? (lucroBruto / totalVendido) * 100 : 0;

    const { data: lancsAR } = await supabase
      .from("financeiro_lancamentos")
      .select("id, valor, valor_pago, forma_pagamento, status, conciliado_em")
      .eq("tipo", "receber")
      .in("status", ["pendente"])
      .limit(5000);

    let fiadoEmAberto = 0;
    let qtdFiado = 0;
    let ifoodAReceber = 0;
    let qtdIfood = 0;
    for (const l of (lancsAR ?? []) as Array<{
      valor: number;
      valor_pago: number | null;
      forma_pagamento: string | null;
      conciliado_em: string | null;
    }>) {
      if (l.conciliado_em) continue;
      const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
      if (aberto <= 0) continue;
      if (l.forma_pagamento === "fiado") {
        fiadoEmAberto += aberto;
        qtdFiado += 1;
      } else if (l.forma_pagamento === "ifood") {
        ifoodAReceber += aberto;
        qtdIfood += 1;
      }
    }

    const { data: pagosHoje } = await supabase
      .from("financeiro_lancamentos")
      .select("id, valor_pago, valor, tipo")
      .eq("data_pagamento", periodo.hoje)
      .in("status", ["pago", "recebido"])
      .eq("tipo", "receber")
      .limit(2000);

    const recebidoHoje = (pagosHoje ?? []).reduce(
      (s, l) => s + (Number(l.valor_pago ?? l.valor) || 0),
      0,
    );
    const qtdRecebimentosHoje = (pagosHoje ?? []).length;

    const { data: vencidos } = await supabase
      .from("financeiro_lancamentos")
      .select("id, valor, valor_pago, tipo")
      .in("status", ["pendente"])
      .lt("data_vencimento", periodo.hoje)
      .limit(5000);

    let vencidosTotal = 0;
    let qtdVencidos = 0;
    for (const l of (vencidos ?? []) as Array<{ valor: number; valor_pago: number | null }>) {
      const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
      if (aberto > 0) {
        vencidosTotal += aberto;
        qtdVencidos += 1;
      }
    }

    const vendasDetalhe = vendas.map((v) => ({
      id: v.id,
      numero: v.numero,
      data: v.data_finalizacao,
      cliente_nome: v.cliente?.nome ?? null,
      forma_pagamento: v.forma_pagamento,
      status_pagamento: v.status_pagamento,
      total: Number(v.total) || 0,
    }));

    return {
      periodo,
      totalVendido,
      custoTotal,
      lucroBruto,
      margemPct,
      qtdVendas: vendas.length,
      qtdItensSemCusto,
      qtdItens,
      fiadoEmAberto,
      qtdFiado,
      ifoodAReceber,
      qtdIfood,
      recebidoHoje,
      qtdRecebimentosHoje,
      vencidosTotal,
      qtdVencidos,
      itensDetalhe: itens,
      vendasDetalhe,
    };
  },

  async posicaoPeriodo(periodo) {
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select("id, tipo, valor, valor_pago, status, data_vencimento")
      .gte("data_vencimento", periodo.inicio)
      .lte("data_vencimento", periodo.fim)
      .neq("status", "cancelado")
      .limit(5000);
    if (error) throw error;

    let totalReceber = 0;
    let qtdReceber = 0;
    let totalPagar = 0;
    let qtdPagar = 0;
    for (const l of (data ?? []) as Array<{
      tipo: string;
      valor: number;
      valor_pago: number | null;
      status: string;
    }>) {
      if (l.status === "pago" || l.status === "recebido") continue;
      const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
      if (aberto <= 0) continue;
      if (l.tipo === "receber") {
        totalReceber += aberto;
        qtdReceber += 1;
      } else if (l.tipo === "pagar") {
        totalPagar += aberto;
        qtdPagar += 1;
      }
    }
    return {
      totalReceber,
      qtdReceber,
      totalPagar,
      qtdPagar,
      saldo: totalReceber - totalPagar,
    };
  },

  async performancePeriodo(periodo) {
    const { data: vendasData, error } = await supabase
      .from("vendas")
      .select("id, total")
      .gte("data_finalizacao", periodo.inicioTs)
      .lte("data_finalizacao", periodo.fimTs)
      .neq("status", "cancelada")
      .limit(5000);
    if (error) throw error;

    const vendas = (vendasData ?? []) as Array<{ id: string; total: number }>;
    const totalVendido = vendas.reduce((s, v) => s + (Number(v.total) || 0), 0);

    let custoTotal = 0;
    let qtdItens = 0;
    let qtdItensSemCusto = 0;
    const ids = vendas.map((v) => v.id);
    if (ids.length > 0) {
      const { data: itens } = await supabase
        .from("venda_itens")
        .select("quantidade, total, produto:produtos(preco_custo)")
        .in("venda_id", ids)
        .limit(20000);
      for (const it of (itens ?? []) as Array<{
        quantidade: number;
        total: number;
        produto: { preco_custo: number | null } | null;
      }>) {
        const qtd = Number(it.quantidade) || 0;
        const pc = Number(it.produto?.preco_custo ?? 0) || 0;
        qtdItens += 1;
        if (pc <= 0) qtdItensSemCusto += 1;
        custoTotal += pc * qtd;
      }
    }
    const lucroBruto = totalVendido - custoTotal;
    const margemPct = totalVendido > 0 ? (lucroBruto / totalVendido) * 100 : 0;
    return {
      totalVendido,
      qtdVendas: vendas.length,
      custoTotal,
      qtdItens,
      qtdItensSemCusto,
      lucroBruto,
      margemPct,
    };
  },

  async receberOrigem(input) {
    const { periodo, forma } = input;
    const matchForma = (lanc: string | null) =>
      forma === "todos" ? true : lanc === forma;

    const { data: abertos } = await supabase
      .from("financeiro_lancamentos")
      .select("valor, valor_pago, forma_pagamento, conciliado_em, status")
      .eq("tipo", "receber")
      .in("status", ["pendente"])
      .limit(5000);

    let fiadoEmAberto = 0;
    let qtdFiado = 0;
    let ifoodAReceber = 0;
    let qtdIfood = 0;
    for (const l of (abertos ?? []) as Array<{
      valor: number;
      valor_pago: number | null;
      forma_pagamento: string | null;
      conciliado_em: string | null;
    }>) {
      if (l.conciliado_em) continue;
      if (!matchForma(l.forma_pagamento)) continue;
      const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
      if (aberto <= 0) continue;
      if (l.forma_pagamento === "fiado") {
        fiadoEmAberto += aberto;
        qtdFiado += 1;
      } else if (l.forma_pagamento === "ifood") {
        ifoodAReceber += aberto;
        qtdIfood += 1;
      }
    }

    const { data: pagos } = await supabase
      .from("financeiro_lancamentos")
      .select("valor, valor_pago, forma_pagamento")
      .eq("tipo", "receber")
      .in("status", ["pago", "recebido"])
      .gte("data_pagamento", periodo.inicio)
      .lte("data_pagamento", periodo.fim)
      .limit(5000);

    let recebidoPeriodo = 0;
    let qtdRecebimentos = 0;
    for (const l of (pagos ?? []) as Array<{
      valor: number;
      valor_pago: number | null;
      forma_pagamento: string | null;
    }>) {
      if (!matchForma(l.forma_pagamento)) continue;
      recebidoPeriodo += Number(l.valor_pago ?? l.valor) || 0;
      qtdRecebimentos += 1;
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const { data: vencidos } = await supabase
      .from("financeiro_lancamentos")
      .select("valor, valor_pago, forma_pagamento")
      .eq("tipo", "receber")
      .in("status", ["pendente"])
      .gte("data_vencimento", periodo.inicio)
      .lte("data_vencimento", periodo.fim < hoje ? periodo.fim : hoje)
      .lt("data_vencimento", hoje)
      .limit(5000);

    let vencidosTotal = 0;
    let qtdVencidos = 0;
    for (const l of (vencidos ?? []) as Array<{
      valor: number;
      valor_pago: number | null;
      forma_pagamento: string | null;
    }>) {
      if (!matchForma(l.forma_pagamento)) continue;
      const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
      if (aberto > 0) {
        vencidosTotal += aberto;
        qtdVencidos += 1;
      }
    }

    return {
      fiadoEmAberto,
      qtdFiado,
      ifoodAReceber,
      qtdIfood,
      recebidoPeriodo,
      qtdRecebimentos,
      vencidosTotal,
      qtdVencidos,
    };
  },

  async cobrancaPendente() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("cobranca_pendente_atual");
    if (error) throw error;
    return (data ?? null) as import("../extra-types").CobrancaPendenteDomain | null;
  },
};

// =====================================================================
// Estoque
// =====================================================================
const estoque: DataAdapter["estoque"] = {
  async registrarMovimento(
    input: RegistrarMovimentoEstoqueInput,
  ): Promise<RegistrarMovimentoEstoqueResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("registrar_movimento_estoque", {
      _produto_id: input.produto_id,
      _variacao_id: input.variacao_id ?? null,
      _tipo: input.tipo,
      _quantidade: input.quantidade,
      _custo_unitario: input.custo_unitario ?? null,
      _observacoes: input.observacoes ?? null,
      _origem: input.origem ?? "ajuste_manual",
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      movimento_id: String(d.movimento_id ?? ""),
      idempotente: Boolean(d.idempotente),
      saldo_anterior: Number(d.saldo_anterior ?? 0) || 0,
      saldo_posterior: Number(d.saldo_posterior ?? 0) || 0,
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async saldosLinhas() {
    const { data, error } = await supabase
      .from("estoque_movimentacoes")
      .select("produto_id, variacao_id, tipo, quantidade");
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").EstoqueSaldoLinha[];
  },

  async movimentacoes(input) {
    let q = supabase
      .from("estoque_movimentacoes")
      .select("*, produto:produtos(id, sku, nome)")
      .order("data_movimentacao", { ascending: false })
      .limit(input?.limit ?? 200);
    if (input?.produto_id) q = q.eq("produto_id", input.produto_id);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").MovimentacaoEstoqueDomain[];
  },

  async saldosLote(produtoIds) {
    const map = new Map<string, number>();
    if (produtoIds.length === 0) return map;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("saldos_estoque_lote", {
      _produto_ids: produtoIds,
    });
    if (error) throw error;
    for (const row of (data ?? []) as { produto_id: string; saldo: number }[]) {
      map.set(row.produto_id, Number(row.saldo) || 0);
    }
    return map;
  },
};
// =====================================================================
const clientes: DataAdapter["clientes"] = {
  async criar(input: CriarClienteInput): Promise<CriarClienteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("criar_cliente", {
      _tipo: input.tipo,
      _nome: input.nome,
      _nome_fantasia: input.nome_fantasia ?? null,
      _documento: input.documento ?? null,
      _inscricao_estadual: input.inscricao_estadual ?? null,
      _email: input.email ?? null,
      _telefone: input.telefone ?? null,
      _celular: input.celular ?? null,
      _data_nascimento: input.data_nascimento ?? null,
      _cep: input.cep ?? null,
      _logradouro: input.logradouro ?? null,
      _numero: input.numero ?? null,
      _complemento: input.complemento ?? null,
      _bairro: input.bairro ?? null,
      _cidade: input.cidade ?? null,
      _estado: input.estado ?? null,
      _observacoes: input.observacoes ?? null,
      _status: input.status ?? "ativo",
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      cliente_id: String(d.cliente_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editar(input: EditarClienteInput): Promise<EditarClienteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("editar_cliente", {
      _cliente_id: input.cliente_id,
      _tipo: input.tipo,
      _nome: input.nome,
      _nome_fantasia: input.nome_fantasia ?? null,
      _documento: input.documento ?? null,
      _inscricao_estadual: input.inscricao_estadual ?? null,
      _email: input.email ?? null,
      _telefone: input.telefone ?? null,
      _celular: input.celular ?? null,
      _data_nascimento: input.data_nascimento ?? null,
      _cep: input.cep ?? null,
      _logradouro: input.logradouro ?? null,
      _numero: input.numero ?? null,
      _complemento: input.complemento ?? null,
      _bairro: input.bairro ?? null,
      _cidade: input.cidade ?? null,
      _estado: input.estado ?? null,
      _observacoes: input.observacoes ?? null,
      _status: input.status ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return { cliente_id: String(d.cliente_id ?? input.cliente_id) };
  },

  async alterarStatus(input: AlterarStatusClienteInput): Promise<AlterarStatusClienteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("alterar_status_cliente", {
      _cliente_id: input.cliente_id,
      _status: input.status,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      cliente_id: String(d.cliente_id ?? input.cliente_id),
      status: (d.status as AlterarStatusClienteResult["status"]) ?? input.status,
    };
  },

  async excluir(clienteId: string): Promise<ExcluirClienteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_cliente", {
      _cliente_id: clienteId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      cliente_id: String(d.cliente_id ?? clienteId),
      excluido: Boolean(d.excluido),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    let q = supabase.from("clientes").select("*").order("nome");
    if (input?.status) q = q.eq("status", input.status);
    if (input?.busca) {
      const b = input.busca.trim();
      if (b) q = q.or(`nome.ilike.%${b}%,nome_fantasia.ilike.%${b}%,documento.ilike.%${b}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").ClienteDomain[];
  },

  async listLite(input) {
    let q = supabase
      .from("clientes")
      .select("id, nome, nome_fantasia, documento")
      .order("nome");
    // Default: somente ativos. `null` explícito = todos.
    const status = input && "status" in input ? input.status : "ativo";
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").ClienteLiteDomain[];
  },

  async get(clienteId) {
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", clienteId)
      .single();
    if (error) throw error;
    return data as unknown as import("../types").ClienteDomain;
  },

  async metricas() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("cliente_metricas", {
      _cliente_id: null,
    });
    if (error) throw error;
    const map = new Map<string, import("../types").ClienteMetricasDomain>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (data ?? []) as any[]) {
      map.set(row.cliente_id, {
        cliente_id: row.cliente_id,
        total_vendas: Number(row.total_vendas) || 0,
        valor_total: Number(row.valor_total) || 0,
        ticket_medio: Number(row.ticket_medio) || 0,
        ultima_venda: row.ultima_venda ?? null,
      });
    }
    return map;
  },

  async historico(clienteId) {
    const { data, error } = await supabase
      .from("vendas")
      .select("id, numero, data_emissao, total, status, status_pagamento, forma_pagamento")
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((v) => ({
      id: v.id as string,
      numero: v.numero as string,
      data_emissao: v.data_emissao as string,
      total: Number(v.total) || 0,
      status: v.status as string,
      status_pagamento: v.status_pagamento as string,
      forma_pagamento: v.forma_pagamento as string | null,
    }));
  },

  async checkDocumentoDuplicado(documento, ignoreId) {
    const docDigits = documento.replace(/\D+/g, "");
    if (!docDigits) return null;
    let q = supabase.from("clientes").select("*").eq("documento", docDigits).limit(1);
    if (ignoreId) q = q.neq("id", ignoreId);
    const { data, error } = await q;
    if (error) throw error;
    const row = (data ?? [])[0];
    return (row ?? null) as unknown as import("../types").ClienteDomain | null;
  },
};
// =====================================================================
const fornecedores: DataAdapter["fornecedores"] = {
  async criar(input: CriarFornecedorInput): Promise<CriarFornecedorResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("criar_fornecedor", {
      _tipo: input.tipo,
      _razao_social: input.razao_social,
      _nome_fantasia: input.nome_fantasia ?? null,
      _documento: input.documento ?? null,
      _inscricao_estadual: input.inscricao_estadual ?? null,
      _email: input.email ?? null,
      _telefone: input.telefone ?? null,
      _contato_nome: input.contato_nome ?? null,
      _cep: input.cep ?? null,
      _logradouro: input.logradouro ?? null,
      _numero: input.numero ?? null,
      _complemento: input.complemento ?? null,
      _bairro: input.bairro ?? null,
      _cidade: input.cidade ?? null,
      _estado: input.estado ?? null,
      _observacoes: input.observacoes ?? null,
      _status: input.status ?? "ativo",
      _client_uuid: input.client_uuid ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      fornecedor_id: String(d.fornecedor_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editar(input: EditarFornecedorInput): Promise<EditarFornecedorResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("editar_fornecedor", {
      _fornecedor_id: input.fornecedor_id,
      _tipo: input.tipo,
      _razao_social: input.razao_social,
      _nome_fantasia: input.nome_fantasia ?? null,
      _documento: input.documento ?? null,
      _inscricao_estadual: input.inscricao_estadual ?? null,
      _email: input.email ?? null,
      _telefone: input.telefone ?? null,
      _contato_nome: input.contato_nome ?? null,
      _cep: input.cep ?? null,
      _logradouro: input.logradouro ?? null,
      _numero: input.numero ?? null,
      _complemento: input.complemento ?? null,
      _bairro: input.bairro ?? null,
      _cidade: input.cidade ?? null,
      _estado: input.estado ?? null,
      _observacoes: input.observacoes ?? null,
      _status: input.status ?? null,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return { fornecedor_id: String(d.fornecedor_id ?? input.fornecedor_id) };
  },

  async alterarStatus(input: AlterarStatusFornecedorInput): Promise<AlterarStatusFornecedorResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("alterar_status_fornecedor", {
      _fornecedor_id: input.fornecedor_id,
      _status: input.status,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      fornecedor_id: String(d.fornecedor_id ?? input.fornecedor_id),
      status: (d.status as AlterarStatusFornecedorResult["status"]) ?? input.status,
    };
  },

  async excluir(fornecedorId: string): Promise<ExcluirFornecedorResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("excluir_fornecedor", {
      _fornecedor_id: fornecedorId,
    });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      fornecedor_id: String(d.fornecedor_id ?? fornecedorId),
      excluido: Boolean(d.excluido),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    let q = supabase.from("fornecedores").select("*").order("razao_social");
    if (input?.status) q = q.eq("status", input.status);
    if (input?.busca) {
      const b = input.busca.trim();
      if (b)
        q = q.or(
          `razao_social.ilike.%${b}%,nome_fantasia.ilike.%${b}%,documento.ilike.%${b}%`,
        );
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").FornecedorDomain[];
  },

  async get(fornecedorId) {
    const { data, error } = await supabase
      .from("fornecedores")
      .select("*")
      .eq("id", fornecedorId)
      .single();
    if (error) throw error;
    return data as unknown as import("../types").FornecedorDomain;
  },
};

// ============================================================
// Funcionários (operadores PDV) — Bloco 10
// PIN é hasheado SOMENTE no banco (bcrypt). Nunca tocamos no hash aqui.
// ============================================================
const funcionarios: DataAdapter["funcionarios"] = {
  async criar(input) {
    const { data, error } = await supabase.rpc("funcionario_criar", {
      _nome: input.nome,
      _login: input.login,
      _pin: input.pin,
      _role: input.role,
      _client_uuid: input.client_uuid ?? null,
    } as never);
    if (error) throw error;
    // RPC retorna jsonb { funcionario_id, idempotente }.
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      funcionario_id: String(d.funcionario_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editar(input) {
    const { data, error } = await supabase.rpc("funcionario_editar", {
      _funcionario_id: input.funcionario_id,
      _nome: input.nome,
      _login: input.login,
      _role: input.role,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      funcionario_id: String(d.funcionario_id ?? input.funcionario_id),
    };
  },

  async alterarStatus(input) {
    const { data, error } = await supabase.rpc("funcionario_alterar_status", {
      _funcionario_id: input.funcionario_id,
      _ativo: input.ativo,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      funcionario_id: String(d.funcionario_id ?? input.funcionario_id),
      ativo: Boolean(d.ativo ?? input.ativo),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluir(funcionarioId) {
    const { data, error } = await supabase.rpc("funcionario_excluir", {
      _funcionario_id: funcionarioId,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      funcionario_id: String(d.funcionario_id ?? funcionarioId),
      excluido: Boolean(d.excluido),
    };
  },

  async resetarPin(input) {
    const { error } = await supabase.rpc("funcionario_resetar_pin", {
      _funcionario_id: input.funcionario_id,
      _novo_pin: input.pin,
    });
    if (error) throw error;
  },

  async validarPin(input) {
    // Bloco 11: passa contexto opcional de terminal/UA para auditoria.
    // A regra de lockout é por funcionário (server-side), não por terminal.
    const { data, error } = await supabase.rpc("funcionario_validar_pin", {
      _funcionario_id: input.funcionario_id,
      _pin: input.pin,
      _terminal_id: input.terminal_id ?? null,
      _ip_address: input.ip_address ?? null,
      _user_agent: input.user_agent ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      id: String(d.id ?? input.funcionario_id),
      nome: String(d.nome ?? ""),
      login: String(d.login ?? ""),
      role: (d.role as "gerente" | "caixa") ?? "caixa",
    };
  },

  async desbloquearPin(input) {
    const { data, error } = await supabase.rpc("funcionario_desbloquear_pin", {
      _funcionario_id: input.funcionario_id,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      funcionario_id: String(d.funcionario_id ?? input.funcionario_id),
      desbloqueado: Boolean(d.desbloqueado),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("funcionarios_listar");
    if (error) throw error;
    let rows = (data ?? []) as import("../types").FuncionarioDomain[];
    if (input?.somente_ativos) rows = rows.filter((f) => f.ativo);
    return rows;
  },
};

// ============================================================
// Categorias de produto — Bloco 12
// `criar` continua acessível via `produtos.criarCategoria` por compat.
// ============================================================
const categoriasProduto: DataAdapter["categoriasProduto"] = {
  async editar(input) {
    const { data, error } = await supabase.rpc("editar_categoria_produto", {
      _categoria_id: input.categoria_id,
      _nome: input.nome,
      _parent_id: input.parent_id ?? null,
      _descricao: input.descricao ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return { categoria_id: String(d.categoria_id ?? input.categoria_id) };
  },

  async alterarStatus(input) {
    const { data, error } = await supabase.rpc("alterar_status_categoria_produto", {
      _categoria_id: input.categoria_id,
      _ativo: input.ativo,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      categoria_id: String(d.categoria_id ?? input.categoria_id),
      ativo: Boolean(d.ativo ?? input.ativo),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluir(categoriaId) {
    const { data, error } = await supabase.rpc("excluir_categoria_produto", {
      _categoria_id: categoriaId,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      categoria_id: String(d.categoria_id ?? categoriaId),
      excluido: Boolean(d.excluido),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    let q = supabase
      .from("categorias_produto")
      .select("id, nome, parent_id, ativo, descricao")
      .order("nome");
    if (!input?.incluir_inativas) q = q.eq("ativo", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").CategoriaProdutoDomain[];
  },
};
// ============================================================
const categoriasFinanceiras: DataAdapter["categoriasFinanceiras"] = {
  async criar(input) {
    const { data, error } = await supabase.rpc("criar_categoria_financeira", {
      _nome: input.nome,
      _tipo: input.tipo,
      _parent_id: input.parent_id ?? null,
      _cor: input.cor ?? null,
      _client_uuid: input.client_uuid ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      categoria_id: String(d.categoria_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editar(input) {
    const { data, error } = await supabase.rpc("editar_categoria_financeira", {
      _categoria_id: input.categoria_id,
      _nome: input.nome,
      _parent_id: input.parent_id ?? null,
      _cor: input.cor ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return { categoria_id: String(d.categoria_id ?? input.categoria_id) };
  },

  async alterarStatus(input) {
    const { data, error } = await supabase.rpc("alterar_status_categoria_financeira", {
      _categoria_id: input.categoria_id,
      _ativo: input.ativo,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      categoria_id: String(d.categoria_id ?? input.categoria_id),
      ativo: Boolean(d.ativo ?? input.ativo),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluir(categoriaId) {
    const { data, error } = await supabase.rpc("excluir_categoria_financeira", {
      _categoria_id: categoriaId,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      categoria_id: String(d.categoria_id ?? categoriaId),
      excluido: Boolean(d.excluido),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    let q = supabase
      .from("categorias_financeiras")
      .select("id, nome, tipo, parent_id, cor, ativo")
      .order("nome");
    if (input?.tipo) q = q.eq("tipo", input.tipo);
    if (!input?.incluir_inativas) q = q.eq("ativo", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as import("../types").CategoriaFinanceiraDomain[];
  },
};
// ============================================================
const lotes: DataAdapter["lotes"] = {
  async criar(input) {
    const { data, error } = await supabase.rpc("criar_lote_produto", {
      _produto_id: input.produto_id,
      _numero_lote: input.numero_lote,
      _quantidade_inicial: input.quantidade_inicial ?? 0,
      _variacao_id: input.variacao_id ?? null,
      _data_fabricacao: input.data_fabricacao ?? null,
      _data_validade: input.data_validade ?? null,
      _custo_unitario: input.custo_unitario ?? null,
      _observacoes: input.observacoes ?? null,
      _registrar_entrada: input.registrar_entrada ?? false,
      _client_uuid: input.client_uuid ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lote_id: String(d.lote_id ?? ""),
      idempotente: Boolean(d.idempotente),
    };
  },

  async editar(input) {
    const { data, error } = await supabase.rpc("editar_lote_produto", {
      _lote_id: input.lote_id,
      _numero_lote: input.numero_lote,
      _data_fabricacao: input.data_fabricacao ?? null,
      _data_validade: input.data_validade ?? null,
      _custo_unitario: input.custo_unitario ?? null,
      _observacoes: input.observacoes ?? null,
      _variacao_id: input.variacao_id ?? null,
      _quantidade_inicial: input.quantidade_inicial ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return { lote_id: String(d.lote_id ?? input.lote_id) };
  },

  async ajustarQuantidade(input) {
    const { data, error } = await supabase.rpc("ajustar_quantidade_lote", {
      _lote_id: input.lote_id,
      _nova_quantidade: input.nova_quantidade,
      _motivo: input.motivo ?? null,
      _client_uuid: input.client_uuid ?? null,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lote_id: String(d.lote_id ?? input.lote_id),
      movimentacao_id: (d.movimentacao_id as string | null) ?? null,
      diferenca: d.diferenca !== undefined ? Number(d.diferenca) : undefined,
      idempotente: d.idempotente !== undefined ? Boolean(d.idempotente) : undefined,
      sem_diferenca: d.sem_diferenca !== undefined ? Boolean(d.sem_diferenca) : undefined,
    };
  },

  async excluir(loteId) {
    const { data, error } = await supabase.rpc("excluir_lote_produto", {
      _lote_id: loteId,
    } as never);
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lote_id: String(d.lote_id ?? loteId),
      excluido: Boolean(d.excluido),
    };
  },

  // ---------------------------- Reads (Bloco 15) ----------------------------
  async list(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("lotes_produto_com_saldo")
      .select("*")
      .order("data_validade", { ascending: true, nullsFirst: false });
    if (input?.produto_id) q = q.eq("produto_id", input.produto_id);
    if (input?.somente_com_saldo) q = q.gt("saldo_real", 0);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as import("../types").LoteComSaldoDomain[];
  },
};

// =====================================================================
// Compras
// =====================================================================
const compras: DataAdapter["compras"] = {
  async list(input) {
    const { data, error } = await supabase
      .from("compras")
      .select("*, fornecedor:fornecedores(id, razao_social, nome_fantasia)")
      .order("data_emissao", { ascending: false })
      .limit(input?.limit ?? 500);
    if (error) throw error;
    return (data ?? []) as unknown as import("../extra-types").CompraComFornecedorDomain[];
  },

  async get(compraId) {
    const { data, error } = await supabase
      .from("compras")
      .select(
        "*, fornecedor:fornecedores(id, razao_social, nome_fantasia), itens:compra_itens(*, produto:produtos(id, sku, nome))",
      )
      .eq("id", compraId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as unknown as import("../extra-types").CompraDetalheDomain | null;
  },

  async criar(input) {
    const { data: uid } = await supabase.auth.getUser();
    if (!uid.user) throw new Error("Não autenticado");
    if (input.itens.length === 0) throw new Error("Adicione pelo menos um item à compra.");
    const subtotal = input.itens.reduce(
      (a, it) => a + it.quantidade * it.preco_unitario - (it.desconto ?? 0),
      0,
    );
    const total = Math.max(
      0,
      subtotal - (input.desconto ?? 0) + (input.frete ?? 0) + (input.outros ?? 0),
    );
    const { data: compra, error } = await supabase
      .from("compras")
      .insert({
        owner_id: uid.user.id,
        numero: input.numero,
        fornecedor_id: input.fornecedor_id,
        data_emissao: input.data_emissao,
        data_prevista: input.data_prevista ?? null,
        data_vencimento: input.data_vencimento ?? null,
        numero_nf: input.numero_nf ?? null,
        serie_nf: input.serie_nf ?? null,
        desconto: input.desconto ?? 0,
        frete: input.frete ?? 0,
        outros: input.outros ?? 0,
        observacoes: input.observacoes ?? null,
        subtotal,
        total,
        status: "pendente",
      })
      .select("*, fornecedor:fornecedores(id, razao_social, nome_fantasia)")
      .single();
    if (error) throw error;
    const itensPayload = input.itens.map((it) => ({
      owner_id: uid.user!.id,
      compra_id: compra.id,
      produto_id: it.produto_id,
      variacao_id: it.variacao_id ?? null,
      descricao: it.descricao ?? null,
      quantidade: it.quantidade,
      preco_unitario: it.preco_unitario,
      desconto: it.desconto ?? 0,
      total: it.quantidade * it.preco_unitario - (it.desconto ?? 0),
    }));
    const { error: itensErr } = await supabase.from("compra_itens").insert(itensPayload);
    if (itensErr) {
      await supabase.from("compras").delete().eq("id", compra.id);
      throw itensErr;
    }
    return compra as unknown as import("../extra-types").CompraComFornecedorDomain;
  },

  async atualizarStatus(input) {
    const { error } = await supabase
      .from("compras")
      .update({ status: input.status })
      .eq("id", input.id);
    if (error) throw error;
  },

  async atualizarMetadados(input) {
    const args: Record<string, unknown> = { _compra_id: input.id };
    args._patch_data_vencimento = "data_vencimento" in input;
    if ("data_vencimento" in input) args._data_vencimento = input.data_vencimento ?? null;
    args._patch_data_prevista = "data_prevista" in input;
    if ("data_prevista" in input) args._data_prevista = input.data_prevista ?? null;
    args._patch_fornecedor_id = "fornecedor_id" in input;
    if ("fornecedor_id" in input) args._fornecedor_id = input.fornecedor_id ?? null;
    args._patch_numero_nf = "numero_nf" in input;
    if ("numero_nf" in input) args._numero_nf = input.numero_nf ?? null;
    args._patch_serie_nf = "serie_nf" in input;
    if ("serie_nf" in input) args._serie_nf = input.serie_nf ?? null;
    args._patch_observacoes = "observacoes" in input;
    if ("observacoes" in input) args._observacoes = input.observacoes ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("atualizar_compra_metadados", args);
    if (error) throw error;
  },

  async receber(input) {
    const args: Record<string, unknown> = {
      _compra_id: input.id,
      _data_recebimento: input.data_recebimento ?? new Date().toISOString().slice(0, 10),
      _gerar_financeiro: input.gerar_financeiro ?? true,
    };
    if (input.data_vencimento) args._data_vencimento = input.data_vencimento;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("receber_compra", args);
    if (error) throw error;
    return data;
  },

  async receberItens(input) {
    const itensValidos = input.itens.filter((i) => i.quantidade > 0);
    if (itensValidos.length === 0) {
      throw new Error("Informe ao menos uma quantidade para receber.");
    }
    const args: Record<string, unknown> = {
      _compra_id: input.compra_id,
      _itens: itensValidos,
      _data_recebimento: input.data_recebimento ?? new Date().toISOString().slice(0, 10),
      _gerar_financeiro: input.gerar_financeiro ?? true,
    };
    if (input.data_vencimento) args._data_vencimento = input.data_vencimento;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("receber_compra_itens", args);
    if (error) throw error;
    return data as import("../extra-types").ReceberCompraItensResult;
  },

  async excluir(compraId) {
    const { error } = await supabase.from("compras").delete().eq("id", compraId);
    if (error) throw error;
  },

  async fornecedorMetricas() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("fornecedor_metricas");
    if (error) throw error;
    const map = new Map<string, import("../extra-types").FornecedorMetricaDomain>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) {
      map.set(r.fornecedor_id, {
        fornecedor_id: r.fornecedor_id,
        total_compras: Number(r.total_compras ?? 0),
        valor_total: Number(r.valor_total ?? 0),
        ultima_compra: r.ultima_compra ?? null,
        compras_em_aberto: Number(r.compras_em_aberto ?? 0),
      });
    }
    return map;
  },
};

// =====================================================================
// Dashboard
// =====================================================================
const MESES_PT_DASH = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const dashboard: DataAdapter["dashboard"] = {
  async carregar() {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const inicioMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);

    const { data: vendas } = await supabase
      .from("vendas")
      .select("id, numero, total, status, data_emissao, cliente_id")
      .gte("data_emissao", inicio6Meses.toISOString().slice(0, 10))
      .neq("status", "cancelada")
      .order("data_emissao", { ascending: false });

    const { data: compras } = await supabase
      .from("compras")
      .select("id, numero, total, status, data_emissao, fornecedor_id")
      .gte("data_emissao", inicio6Meses.toISOString().slice(0, 10))
      .order("data_emissao", { ascending: false });

    const clienteIds = [...new Set((vendas ?? []).map((v) => v.cliente_id).filter(Boolean) as string[])];
    const fornecedorIds = [...new Set((compras ?? []).map((c) => c.fornecedor_id).filter(Boolean) as string[])];

    const [clientesRes, fornRes] = await Promise.all([
      clienteIds.length > 0
        ? supabase.from("clientes").select("id, nome").in("id", clienteIds)
        : Promise.resolve({ data: [] as Array<{ id: string; nome: string }> }),
      fornecedorIds.length > 0
        ? supabase.from("fornecedores").select("id, razao_social, nome_fantasia").in("id", fornecedorIds)
        : Promise.resolve({ data: [] as Array<{ id: string; razao_social: string; nome_fantasia: string | null }> }),
    ]);
    const clientesMap = new Map((clientesRes.data ?? []).map((c) => [c.id, c.nome]));
    const fornMap = new Map(
      (fornRes.data ?? []).map((f) => [f.id, f.nome_fantasia || f.razao_social]),
    );

    const sumIf = <T extends { data_emissao: string; total: number | string | null }>(
      arr: T[],
      from: Date,
      to?: Date,
    ) =>
      arr
        .filter((x) => {
          const d = new Date(x.data_emissao);
          return d >= from && (!to || d < to);
        })
        .reduce((s, x) => s + Number(x.total ?? 0), 0);

    const vendasMes = sumIf(vendas ?? [], inicioMes);
    const vendasMesAnterior = sumIf(vendas ?? [], inicioMesAnt, inicioMes);
    const comprasMes = sumIf(compras ?? [], inicioMes);
    const comprasMesAnterior = sumIf(compras ?? [], inicioMesAnt, inicioMes);
    const lucroMes = vendasMes - comprasMes;
    const margem = vendasMes > 0 ? (lucroMes / vendasMes) * 100 : 0;

    const seriesMap = new Map<string, { vendas: number; compras: number }>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
      seriesMap.set(`${d.getFullYear()}-${d.getMonth()}`, { vendas: 0, compras: 0 });
    }
    for (const v of vendas ?? []) {
      const d = new Date(v.data_emissao);
      const ref = seriesMap.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (ref) ref.vendas += Number(v.total ?? 0);
    }
    for (const c of compras ?? []) {
      const d = new Date(c.data_emissao);
      const ref = seriesMap.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (ref) ref.compras += Number(c.total ?? 0);
    }
    const vendasPorMes = Array.from(seriesMap.entries()).map(([key, val]) => {
      const [, m] = key.split("-").map(Number);
      return { month: MESES_PT_DASH[m], vendas: val.vendas, compras: val.compras };
    });

    const { data: lancamentos } = await supabase
      .from("financeiro_lancamentos")
      .select("id, tipo, valor, valor_pago, status, data_vencimento, data_pagamento");

    const contasPagarLancs = (lancamentos ?? []).filter(
      (l) => l.tipo === "despesa" && l.status !== "pago" && l.status !== "cancelado",
    );
    const contasReceberLancs = (lancamentos ?? []).filter(
      (l) => l.tipo === "receita" && l.status !== "pago" && l.status !== "cancelado",
    );
    const contasPagar = contasPagarLancs.reduce(
      (s, l) => s + (Number(l.valor) - Number(l.valor_pago ?? 0)),
      0,
    );
    const contasReceber = contasReceberLancs.reduce(
      (s, l) => s + (Number(l.valor) - Number(l.valor_pago ?? 0)),
      0,
    );

    const fluxoMap = new Map<number, { entrada: number; saida: number }>();
    const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= diasNoMes; d++) fluxoMap.set(d, { entrada: 0, saida: 0 });
    for (const l of lancamentos ?? []) {
      if (!l.data_pagamento) continue;
      const dp = new Date(l.data_pagamento);
      if (dp < inicioMes) continue;
      const ref = fluxoMap.get(dp.getDate());
      if (!ref) continue;
      if (l.tipo === "receita") ref.entrada += Number(l.valor_pago ?? 0);
      else if (l.tipo === "despesa") ref.saida += Number(l.valor_pago ?? 0);
    }
    const fluxoCaixa = Array.from(fluxoMap.entries()).map(([dia, val]) => ({
      day: String(dia).padStart(2, "0"),
      entrada: val.entrada,
      saida: val.saida,
    }));

    const { data: produtosBaixo } = await supabase
      .from("produtos")
      .select("id, estoque_minimo")
      .eq("status", "ativo")
      .gt("estoque_minimo", 0);
    let estoqueBaixo = 0;
    if (produtosBaixo && produtosBaixo.length > 0) {
      const { data: movs } = await supabase
        .from("estoque_movimentacoes")
        .select("produto_id, tipo, quantidade");
      const saldos = new Map<string, number>();
      for (const m of movs ?? []) {
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1;
        saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
      }
      for (const p of produtosBaixo) {
        const saldo = saldos.get(p.id) ?? 0;
        if (saldo <= Number(p.estoque_minimo)) estoqueBaixo++;
      }
    }

    const ultimasVendas = (vendas ?? []).slice(0, 5).map((v) => ({
      id: v.id,
      numero: v.numero,
      cliente: v.cliente_id ? (clientesMap.get(v.cliente_id) ?? "—") : "Consumidor",
      valor: Number(v.total ?? 0),
      status: v.status,
      data: v.data_emissao,
    }));
    const ultimasCompras = (compras ?? []).slice(0, 5).map((c) => ({
      id: c.id,
      numero: c.numero,
      fornecedor: c.fornecedor_id ? (fornMap.get(c.fornecedor_id) ?? "—") : "—",
      valor: Number(c.total ?? 0),
      status: c.status,
      data: c.data_emissao,
    }));

    return {
      vendasMes,
      vendasMesAnterior,
      comprasMes,
      comprasMesAnterior,
      lucroMes,
      margem,
      contasPagar,
      qtdContasPagar: contasPagarLancs.length,
      contasReceber,
      qtdContasReceber: contasReceberLancs.length,
      estoqueBaixo,
      vendasPorMes,
      fluxoCaixa,
      ultimasVendas,
      ultimasCompras,
    };
  },
};

// =====================================================================
// Onda 4 — Terminais, Notificações, Autorizações, Empresa, Configuração,
// Balança, Códigos de Produto.
// =====================================================================
const terminais: DataAdapter["terminais"] = {
  async list() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("terminais_listar");
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").TerminalDomain[];
  },
  async criar(input) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Não autenticado");
    const { data, error } = await supabase
      .from("terminais")
      .insert({
        owner_id: u.user.id,
        nome: input.nome,
        descricao: input.descricao ?? null,
        identificador_dispositivo: input.identificador_dispositivo ?? null,
        ativo: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  },
  async atualizar(input) {
    const patch: Record<string, unknown> = {};
    if (input.nome !== undefined) patch.nome = input.nome;
    if (input.descricao !== undefined) patch.descricao = input.descricao;
    if (input.identificador_dispositivo !== undefined)
      patch.identificador_dispositivo = input.identificador_dispositivo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("terminais").update(patch as any).eq("id", input.id);
    if (error) throw error;
  },
  async alterarStatus(input) {
    const { error } = await supabase
      .from("terminais")
      .update({ ativo: input.ativo })
      .eq("id", input.id);
    if (error) throw error;
  },
  async excluir(terminalId) {
    const { error } = await supabase.from("terminais").delete().eq("id", terminalId);
    if (error) throw error;
  },
  async gerarToken(terminalId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("terminal_gerar_token", {
      _terminal_id: terminalId,
    });
    if (error) throw error;
    return data as string;
  },
  async definirServidor(terminalId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("terminal_definir_servidor", {
      _terminal_id: terminalId,
    });
    if (error) throw error;
  },
};

const notificacoes: DataAdapter["notificacoes"] = {
  async vencidas() {
    const hoje = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select("id, descricao, valor, data_vencimento, tipo")
      .eq("status", "pendente")
      .lt("data_vencimento", hoje)
      .order("data_vencimento", { ascending: true })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").FinanceiroVencidoLite[];
  },
  async vencendoHoje() {
    const hoje = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("financeiro_lancamentos")
      .select("id, descricao, valor, data_vencimento, tipo")
      .eq("status", "pendente")
      .eq("data_vencimento", hoje)
      .limit(20);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").FinanceiroVencidoLite[];
  },
  async produtosEstoqueMinimo() {
    const { data, error } = await supabase
      .from("produtos")
      .select("id, nome, estoque_minimo")
      .eq("status", "ativo")
      .gt("estoque_minimo", 0);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").ProdutoEstoqueMinimoLite[];
  },
  async movimentosEstoqueResumo() {
    const { data, error } = await supabase
      .from("estoque_movimentacoes")
      .select("produto_id, tipo, quantidade");
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").MovimentacaoEstoqueLite[];
  },
  async estadosUsuario(userId) {
    const { data, error } = await supabase
      .from("notificacao_estados")
      .select("notificacao_key, read, read_at, deleted")
      .eq("user_id", userId);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").NotificacaoEstadoLite[];
  },
  async marcarLida(input) {
    const { error } = await supabase.from("notificacao_estados").upsert(
      {
        user_id: input.user_id,
        notificacao_key: input.notificacao_key,
        read: true,
        read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,notificacao_key" },
    );
    if (error) throw error;
  },
  async excluir(input) {
    const { error } = await supabase.from("notificacao_estados").upsert(
      {
        user_id: input.user_id,
        notificacao_key: input.notificacao_key,
        deleted: true,
        deleted_at: new Date().toISOString(),
      },
      { onConflict: "user_id,notificacao_key" },
    );
    if (error) throw error;
  },
  async marcarVariasLidas(input) {
    if (input.chaves.length === 0) return;
    const agora = new Date().toISOString();
    const linhas = input.chaves.map((k) => ({
      user_id: input.user_id,
      notificacao_key: k,
      read: true,
      read_at: agora,
    }));
    const { error } = await supabase
      .from("notificacao_estados")
      .upsert(linhas, { onConflict: "user_id,notificacao_key" });
    if (error) throw error;
  },
};

const autorizacoes: DataAdapter["autorizacoes"] = {
  async obterConfig() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("autorizacoes_config_obter");
    if (error) throw error;
    return data as import("../extra-adapters").AutorizacoesConfigDomain;
  },
  async salvarConfig(payload) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("autorizacoes_config_salvar", {
      _payload: payload,
    });
    if (error) throw error;
    return data as import("../extra-adapters").AutorizacoesConfigDomain;
  },
  async log(limit = 100) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("autorizacoes_log")
      .select(
        "id, acao, metodo, status, contexto, autorizador_nome, valor_envolvido, diferenca_caixa, motivo_negacao, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").AutorizacaoLogDomain[];
  },
  async validar(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("autorizacao_validar", {
      _acao: input.acao,
      _metodo: input.metodo,
      _payload: input.payload,
      _contexto: input.contexto,
      _contexto_dados: input.contexto_dados ?? {},
      _valor_envolvido: input.valor_envolvido ?? null,
      _diferenca_caixa: input.diferenca_caixa ?? null,
      _referencia_tipo: input.referencia_tipo ?? null,
      _referencia_id: input.referencia_id ?? null,
      _solicitante_funcionario_id: input.solicitante_funcionario_id ?? null,
      _terminal_id: input.terminal_id ?? null,
      _user_agent: input.user_agent ?? null,
    });
    if (error) throw error;
    return data as import("../extra-adapters").ValidarAutorizacaoResultDomain;
  },
};

const empresa: DataAdapter["empresa"] = {
  async acessiveis(userId) {
    const { data: proprias } = await supabase
      .from("empresas")
      .select("id, nome, owner_id")
      .eq("owner_id", userId);

    const { data: memberships } = await supabase
      .from("empresa_membros")
      .select("papel, empresa:empresas(id, nome, owner_id)")
      .eq("user_id", userId);

    const map = new Map<string, import("../extra-adapters").EmpresaAcessivelDomain>();
    for (const e of proprias ?? []) {
      map.set(e.id, { id: e.id, nome: e.nome, owner_id: e.owner_id, papel: "owner" });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of (memberships ?? []) as any[]) {
      if (!m.empresa) continue;
      if (!map.has(m.empresa.id)) {
        map.set(m.empresa.id, {
          id: m.empresa.id,
          nome: m.empresa.nome,
          owner_id: m.empresa.owner_id,
          papel: m.papel,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  },
};

const configEmpresa: DataAdapter["configEmpresa"] = {
  async obter() {
    const { data, error } = await supabase
      .from("configuracoes_empresa")
      .select(
        "id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, logradouro, numero, complemento, bairro, cidade, estado, cep, logo_url",
      )
      .maybeSingle();
    if (error) throw error;
    return (data as import("../extra-adapters").ConfigEmpresaDomain | null) ?? null;
  },
  async salvar(input) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Não autenticado");
    const payload = {
      owner_id: u.user.id,
      razao_social: input.razao_social ?? "Minha Empresa",
      nome_fantasia: input.nome_fantasia ?? null,
      cnpj: input.cnpj ?? null,
      inscricao_estadual: input.inscricao_estadual ?? null,
      inscricao_municipal: input.inscricao_municipal ?? null,
      telefone: input.telefone ?? null,
      email: input.email ?? null,
      logradouro: input.logradouro ?? null,
      numero: input.numero ?? null,
      complemento: input.complemento ?? null,
      bairro: input.bairro ?? null,
      cidade: input.cidade ?? null,
      estado: input.estado ?? null,
      cep: input.cep ?? null,
      logo_url: input.logo_url ?? null,
    };
    if (input.id) {
      const { data, error } = await supabase
        .from("configuracoes_empresa")
        .update(payload)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as import("../extra-adapters").ConfigEmpresaDomain;
    }
    const { data, error } = await supabase
      .from("configuracoes_empresa")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data as import("../extra-adapters").ConfigEmpresaDomain;
  },
  async uploadLogo({ file, userId }) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${userId}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("empresa-logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from("empresa-logos").getPublicUrl(path);
    return data.publicUrl;
  },
  async removerLogo(url) {
    if (!url) return;
    const marker = "/empresa-logos/";
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = url.substring(idx + marker.length);
    await supabase.storage.from("empresa-logos").remove([path]);
  },
};

const balanca: DataAdapter["balanca"] = {
  async obter(userId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("balanca_config")
      .select("*")
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data as import("../extra-adapters").BalancaConfigRowDomain | null) ?? null;
  },
  async salvar(input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("balanca_config")
      .upsert(input, { onConflict: "owner_id" })
      .select()
      .single();
    if (error) throw error;
    return data as import("../extra-adapters").BalancaConfigRowDomain;
  },
};

const produtoCodigos: DataAdapter["produtoCodigos"] = {
  async list(produtoId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("produto_codigos")
      .select("id, produto_id, variacao_id, tipo_codigo, valor_codigo, observacao, created_at")
      .eq("produto_id", produtoId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").ProdutoCodigoDomain[];
  },
};

// =============================================================================
// Onda 5: User roles
// =============================================================================
const userRoles: DataAdapter["userRoles"] = {
  async listar(userId) {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) return [];
    return (data ?? []).map((r) => r.role as import("../extra-adapters").AppRoleDomain);
  },
};

// =============================================================================
// Onda 5: Admin (super admin global)
// =============================================================================
const admin: DataAdapter["admin"] = {
  async isSuperAdmin(userId) {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle();
    if (error) return false;
    return !!data;
  },
  async stats() {
    const { data, error } = await supabase.rpc("admin_estatisticas_globais");
    if (error) throw error;
    return data as unknown as import("../extra-adapters").AdminStatsDomain;
  },
  async serieCrescimento(dias) {
    const { data, error } = await supabase.rpc("admin_serie_crescimento", { _dias: dias });
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").SerieCrescimentoDomain[];
  },
  async listarUsuarios() {
    const { data, error } = await supabase.rpc("admin_listar_usuarios");
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").AdminUserDomain[];
  },
  async setUserRole({ userId, role, grant }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("admin_set_user_role", {
      _user_id: userId,
      _role: role,
      _grant: grant,
    });
    if (error) throw error;
  },
  async deleteUser(userId) {
    const { error } = await supabase.rpc("admin_delete_user", { _user_id: userId });
    if (error) throw error;
  },
  async listarEmpresas() {
    const { data, error } = await supabase.rpc("admin_listar_empresas");
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").AdminEmpresaDomain[];
  },
  async upsertEmpresa(input) {
    const { error } = await supabase.rpc("admin_upsert_empresa", {
      _id: input.id,
      _nome: input.nome,
      _email: input.email ?? undefined,
      _telefone: input.telefone ?? undefined,
      _documento: input.documento ?? undefined,
      _plano: input.plano ?? "free",
      _observacoes: input.observacoes ?? undefined,
    });
    if (error) throw error;
  },
  async setEmpresaStatus(input) {
    const { error } = await supabase.rpc("admin_set_empresa_status", {
      _id: input.id,
      _status: input.status,
      _motivo: input.motivo ?? undefined,
    });
    if (error) throw error;
  },
  async deleteEmpresa(id) {
    const { error } = await supabase.rpc("admin_delete_empresa", { _id: id });
    if (error) throw error;
  },
  async auditLogs(limit) {
    const { data, error } = await supabase.rpc("admin_listar_audit_logs", { _limit: limit });
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").AuditLogDomain[];
  },
  async registrarAuditLog(input) {
    try {
      await supabase.rpc("registrar_audit_log", {
        _action: input.action,
        _target_type: input.target_type ?? undefined,
        _target_id: input.target_id ?? undefined,
        _metadata: (input.metadata ?? {}) as never,
      });
    } catch {
      /* silencioso */
    }
  },
};

// =============================================================================
// Onda 5: SaaS Admin (planos / módulos / assinaturas / pagamentos / modos)
// =============================================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

const saasAdmin: DataAdapter["saasAdmin"] = {
  async listarPlanos() {
    const { data, error } = await rpc("admin_listar_planos");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async upsertPlano(input) {
    const { error } = await rpc("admin_upsert_plano", input);
    if (error) throw error;
  },
  async deletePlano(id) {
    const { error } = await rpc("admin_delete_plano", { _id: id });
    if (error) throw error;
  },
  async listarModulos() {
    const { data, error } = await rpc("admin_listar_modulos");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async upsertModulo(input) {
    const { error } = await rpc("admin_upsert_modulo", input);
    if (error) throw error;
  },
  async deleteModulo(id) {
    const { error } = await rpc("admin_delete_modulo", { _id: id });
    if (error) throw error;
  },
  async listarAssinaturas() {
    const { data, error } = await rpc("admin_listar_assinaturas");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async setAssinatura(input) {
    const { error } = await rpc("admin_set_assinatura", input);
    if (error) throw error;
  },
  async listarEmpresaModulos(empresaId) {
    const { data, error } = await rpc("admin_listar_empresa_modulos", { _empresa_id: empresaId });
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async setEmpresaModulo(input) {
    const { error } = await rpc("admin_set_empresa_modulo", input);
    if (error) throw error;
  },
  async removerEmpresaModulo(id) {
    const { error } = await rpc("admin_remover_empresa_modulo", { _id: id });
    if (error) throw error;
  },
  async listarPagamentos(empresaId) {
    const { data, error } = await rpc("admin_listar_pagamentos", { _empresa_id: empresaId });
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async upsertPagamento(input) {
    const { error } = await rpc("admin_registrar_pagamento", input);
    if (error) throw error;
  },
  async deletePagamento(id) {
    const { error } = await rpc("admin_delete_pagamento", { _id: id });
    if (error) throw error;
  },
  async obterConfigComercial() {
    const { data, error } = await rpc("admin_get_config_comercial");
    if (error) throw error;
    return data as unknown;
  },
  async setConfigComercial(input) {
    const { error } = await rpc("admin_set_config_comercial", input);
    if (error) throw error;
  },
  async minhaAssinatura() {
    const { data, error } = await rpc("minha_assinatura_status");
    if (error) throw error;
    return data as unknown;
  },
  async meusModulos() {
    const { data, error } = await rpc("meus_modulos");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async listarModos() {
    const { data, error } = await rpc("admin_modos_listar");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async modosDisponiveis() {
    const { data, error } = await rpc("modos_disponiveis");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async upsertModo(input) {
    const { data, error } = await rpc("admin_modo_upsert", input);
    if (error) throw error;
    return data as string;
  },
  async deleteModo(id) {
    const { error } = await rpc("admin_modo_deletar", { _id: id });
    if (error) throw error;
  },
  async setModoModulos(input) {
    const { error } = await rpc("admin_modo_set_modulos", {
      _mode_id: input.mode_id,
      _module_ids: input.module_ids,
    });
    if (error) throw error;
  },
};

// =============================================================================
// Onda 5: SaaS Cliente
// =============================================================================
async function extrairErroEdgeImpl(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: { response?: Response } })?.context;
  const resp = ctx?.response;
  if (resp) {
    try {
      const body = await resp.clone().json();
      const msg =
        (body as { error?: string; message?: string })?.error ??
        (body as { error?: string; message?: string })?.message;
      if (msg) return String(msg);
    } catch {
      try {
        const txt = await resp.clone().text();
        if (txt) return txt;
      } catch {
        /* ignora */
      }
    }
  }
  const msg = (error as { message?: string })?.message;
  return msg && msg !== "Edge Function returned a non-2xx status code" ? msg : fallback;
}

async function criarCobrancaAsaasImpl(pagamento_id: string) {
  const { data: cfg } = await supabase
    .from("config_comercial")
    .select("asaas_enabled")
    .maybeSingle();
  if (!cfg?.asaas_enabled) return null;

  const { data, error } = await supabase.functions.invoke("asaas-criar-cobranca", {
    body: { pagamento_id, billing_type: "PIX" },
  });
  if (error) {
    const detalhe = await extrairErroEdgeImpl(
      error,
      "Não foi possível criar a cobrança Pix. Confira o CNPJ/CPF em Configurações → Empresa e tente novamente.",
    );
    throw new Error(detalhe);
  }
  return {
    ...(data as Omit<import("../extra-adapters").CobrancaCriadaDomain, "pagamento_id">),
    pagamento_id,
  };
}

const saasCliente: DataAdapter["saasCliente"] = {
  async planosDisponiveis() {
    const { data, error } = await rpc("planos_disponiveis");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async modulosDisponiveisCliente() {
    const { data, error } = await rpc("modulos_disponiveis_cliente");
    if (error) throw error;
    return (data ?? []) as unknown[];
  },
  async solicitarPlano(plano_id) {
    const { data: pagamentoId, error } = await rpc("solicitar_contratacao_plano", { _plano_id: plano_id });
    if (error) throw error;
    const cobranca = await criarCobrancaAsaasImpl(pagamentoId as string);
    return { pagamentoId: pagamentoId as string, cobranca };
  },
  async solicitarModulo(modulo_id) {
    const { data: pagamentoId, error } = await rpc("solicitar_contratacao_modulo", { _modulo_id: modulo_id });
    if (error) throw error;
    const cobranca = await criarCobrancaAsaasImpl(pagamentoId as string);
    return { pagamentoId: pagamentoId as string, cobranca };
  },
  async resetarDadosEmpresa() {
    const { error } = await rpc("resetar_dados_empresa");
    if (error) throw error;
  },
};

// =============================================================================
// Onda 5: QA
// =============================================================================
const qa: DataAdapter["qa"] = {
  async listarModulos() {
    const { data, error } = await supabase
      .from("qa_modulos")
      .select("*")
      .eq("ativo", true)
      .order("ordem");
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").QaModuloDomain[];
  },
  async listarItens() {
    const { data, error } = await supabase
      .from("qa_itens")
      .select("*")
      .eq("ativo", true)
      .order("ordem");
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").QaItemDomain[];
  },
  async listarValidacoes() {
    const { data, error } = await supabase
      .from("qa_validacoes")
      .select("*")
      .order("iniciada_em", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").QaValidacaoDomain[];
  },
  async validacaoAtiva() {
    const { data, error } = await supabase
      .from("qa_validacoes")
      .select("*")
      .eq("status", "em_andamento")
      .order("iniciada_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as import("../extra-adapters").QaValidacaoDomain | null) ?? null;
  },
  async listarAvaliacoes(validacaoId) {
    const { data, error } = await supabase
      .from("qa_avaliacoes")
      .select("*")
      .eq("validacao_id", validacaoId);
    if (error) throw error;
    return (data ?? []) as import("../extra-adapters").QaAvaliacaoDomain[];
  },
  async criarValidacao(input) {
    const { data, error } = await supabase
      .from("qa_validacoes")
      .insert({
        titulo: input.titulo,
        responsavel_id: input.responsavel_id,
        responsavel_nome: input.responsavel_nome,
        status: "em_andamento",
      })
      .select()
      .single();
    if (error) throw error;
    return data as import("../extra-adapters").QaValidacaoDomain;
  },
  async finalizarValidacao(input) {
    const { error } = await supabase
      .from("qa_validacoes")
      .update({
        status: "finalizada",
        finalizada_em: new Date().toISOString(),
        observacao_final: input.observacao_final,
        resumo: (input.resumo as never) ?? null,
      })
      .eq("id", input.id);
    if (error) throw error;
  },
  async salvarAvaliacao(input) {
    const payload = {
      validacao_id: input.validacao_id,
      item_id: input.item_id,
      status: input.status,
      observacao: input.observacao,
      evidencia_url: input.evidencia_url,
      testado_em: new Date().toISOString(),
      testado_por: input.testado_por,
      testado_por_nome: input.testado_por_nome,
    };
    const { error } = await supabase
      .from("qa_avaliacoes")
      .upsert(payload, { onConflict: "validacao_id,item_id" });
    if (error) throw error;
  },
  async uploadEvidencia({ file, validacao_id }) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${validacao_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("qa-evidencias")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return path;
  },
  async signedUrlEvidencia(path) {
    const { data, error } = await supabase.storage
      .from("qa-evidencias")
      .createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data?.signedUrl ?? null;
  },
};

// =============================================================================
// Onda 5: Terminal Runtime
// =============================================================================
const terminalRuntime: DataAdapter["terminalRuntime"] = {
  async heartbeat(input) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc("terminal_heartbeat", {
        _terminal_id: input.terminal_id,
        _operador_id: input.operador_id,
        _operador_nome: input.operador_nome,
        _user_agent: input.user_agent,
        _ip_local: input.ip_local,
      });
    } catch {
      /* silencioso */
    }
  },
  async limparOperador(terminalId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc("terminal_limpar_operador", { _terminal_id: terminalId });
    } catch {
      /* silencioso */
    }
  },
  async ping() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("terminal_ping");
    if (error) throw error;
  },
};

export const cloudAdapter: DataAdapter = {
  produtos,
  vendas,
  caixa,
  financeiro,
  estoque,
  clientes,
  fornecedores,
  funcionarios,
  categoriasProduto,
  categoriasFinanceiras,
  lotes,
  compras,
  dashboard,
  terminais,
  notificacoes,
  autorizacoes,
  empresa,
  configEmpresa,
  balanca,
  produtoCodigos,
  userRoles,
  admin,
  saasAdmin,
  saasCliente,
  qa,
  terminalRuntime,
};
