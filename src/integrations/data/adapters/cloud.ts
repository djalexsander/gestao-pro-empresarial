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
  AlterarStatusClienteInput,
  AlterarStatusClienteResult,
  AlterarStatusFornecedorInput,
  AlterarStatusFornecedorResult,
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
  CriarClienteInput,
  CriarClienteResult,
  CriarFornecedorInput,
  CriarFornecedorResult,
  CriarLancamentoAvulsoInput,
  CriarLancamentoAvulsoResult,
  EditarClienteInput,
  EditarClienteResult,
  EditarFornecedorInput,
  EditarFornecedorResult,
  EditarLancamentoAvulsoInput,
  EditarLancamentoAvulsoResult,
  ExcluirClienteResult,
  ExcluirFornecedorResult,
  ExcluirLancamentoAvulsoResult,
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
    const { data, error } = await (supabase as any).rpc(
      "buscar_produto_por_codigo",
      { _codigo: valor },
    );
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
      .or(
        `plu.eq.${valor},sku.eq.${valor},codigo_interno.eq.${valor}`,
      )
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
          .or(
            `plu.eq.${stripped},sku.eq.${stripped},codigo_interno.eq.${stripped}`,
          )
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
      _pagamentos:
        input.pagamentos && input.pagamentos.length > 0 ? input.pagamentos : null,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      itens_estornados: (d.itens_estornados ?? []).map((i: any): ItemEstornado => ({
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        quantidade: Number(i.quantidade) || 0,
        saldo_anterior: Number(i.saldo_anterior) || 0,
        saldo_posterior: Number(i.saldo_posterior) || 0,
        valor_total: Number(i.valor_total) || 0,
      })),
      qtd_lancamentos_cancelados: Number(d.qtd_lancamentos_cancelados) || 0,
      total_lancamentos_cancelados: Number(d.total_lancamentos_cancelados) || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const { data, error } = await (supabase as any).rpc(
      "excluir_venda_cancelada",
      { _venda_id: vendaId },
    );
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    return {
      venda_id: d.venda_id,
      numero: d.numero,
      excluida_em: d.excluida_em,
    };
  },

  async alterarStatus(
    input: AlterarStatusVendaInput,
  ): Promise<AlterarStatusVendaResult> {
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
      novo_status:
        (d.novo_status as StatusVendaEditavelDomain) ?? input.novo_status,
      qtd_lancamentos_alterados:
        Number(d.qtd_lancamentos_alterados ?? d.qtd_alterados ?? 0) || 0,
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
    const { data, error } = await (supabase as any).rpc(
      "caixa_registrar_movimento",
      {
        _caixa_id: input.caixa_id,
        _tipo: input.tipo,
        _valor: input.valor,
        _motivo: input.motivo ?? undefined,
        _client_uuid: input.client_uuid ?? null,
      },
    );
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
    const { data, error } = await (supabase as any).rpc(
      "registrar_pagamento_lancamento",
      {
        _lancamento_id: input.lancamento_id,
        _valor: input.valor,
        _data_pagamento: input.data_pagamento,
        _forma_pagamento: input.forma_pagamento ?? null,
        _observacao: input.observacao ?? null,
        _client_uuid: input.client_uuid ?? null,
      },
    );
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      pagamento_id: String(d.pagamento_id ?? ""),
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      idempotente: Boolean(d.idempotente),
    };
  },

  async removerPagamento(
    pagamentoId: string,
  ): Promise<RemoverPagamentoLancamentoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "remover_pagamento_lancamento",
      { _pagamento_id: pagamentoId },
    );
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      removido: Boolean(d.removido),
      idempotente: d.idempotente as boolean | undefined,
      lancamento_id: d.lancamento_id as string | undefined,
    };
  },

  async cancelarLancamento(
    input: CancelarLancamentoInput,
  ): Promise<CancelarLancamentoResult> {
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
    const { data, error } = await (supabase as any).rpc(
      "alterar_vencimento_lancamento",
      { _lancamento_id: input.lancamento_id, _nova_data: input.nova_data },
    );
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      data_vencimento: String(d.data_vencimento ?? input.nova_data),
    };
  },

  async conciliarIfoodIndividual(
    input: ConciliarIfoodIndividualInput,
  ): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "conciliar_ifood_lancamento",
      {
        _lancamento_id: input.lancamento_id,
        _data_repasse: input.data_repasse,
        _valor_repasse: input.valor_repasse,
        _numero_repasse: input.numero_repasse ?? undefined,
        _observacao: input.observacao ?? undefined,
      },
    );
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
    const { data, error } = await (supabase as any).rpc(
      "criar_lancamento_avulso",
      {
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
      },
    );
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
    const { data, error } = await (supabase as any).rpc(
      "editar_lancamento_avulso",
      {
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
      },
    );
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      lancamento_id: String(d.lancamento_id ?? input.lancamento_id),
      idempotente: Boolean(d.idempotente),
    };
  },

  async excluirLancamentoAvulso(
    lancamentoId: string,
  ): Promise<ExcluirLancamentoAvulsoResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "excluir_lancamento_avulso",
      { _lancamento_id: lancamentoId },
    );
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
    const { data, error } = await (supabase as any).rpc(
      "registrar_movimento_estoque",
      {
        _produto_id: input.produto_id,
        _variacao_id: input.variacao_id ?? null,
        _tipo: input.tipo,
        _quantidade: input.quantidade,
        _custo_unitario: input.custo_unitario ?? null,
        _observacoes: input.observacoes ?? null,
        _origem: input.origem ?? "ajuste_manual",
        _client_uuid: input.client_uuid ?? null,
      },
    );
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

export const cloudAdapter: DataAdapter = {
  produtos,
  vendas,
  caixa,
  financeiro,
  estoque,
};
