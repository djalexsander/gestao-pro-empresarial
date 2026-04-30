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
};

// =====================================================================
// Caixa
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
};

// =====================================================================
// Clientes
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
};

// =====================================================================
// Fornecedores
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
};
