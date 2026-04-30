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
  CodigoTipo,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  RegistrarMovimentoCaixaInput,
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
};

export const cloudAdapter: DataAdapter = {
  produtos,
  vendas,
};
