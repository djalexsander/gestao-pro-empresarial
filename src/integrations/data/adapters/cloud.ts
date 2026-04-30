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
import type { CodigoTipo, ProdutoBuscaResult } from "../types";

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
};

export const cloudAdapter: DataAdapter = {
  produtos,
};
