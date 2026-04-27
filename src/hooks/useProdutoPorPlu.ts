import { supabase } from "@/integrations/supabase/client";

export interface ProdutoPluResult {
  produto_id: string;
  sku: string;
  nome: string;
  unidade: string;
  preco_venda: number;
  vendido_por_peso: boolean;
  aceita_etiqueta_balanca: boolean;
  plu: string | null;
  status: "ativo" | "inativo" | "descontinuado";
}

/**
 * Busca um produto pelo PLU (código base usado pela balança) dentro do owner do
 * usuário autenticado. Tenta primeiro a coluna `plu`, depois cai para `sku` e
 * `codigo_interno` para casos em que o admin ainda não preencheu PLU.
 */
export async function buscarProdutoPorPlu(
  plu: string,
): Promise<ProdutoPluResult | null> {
  const valor = plu.trim();
  if (!valor) return null;

  // RLS já restringe ao owner; basta filtrar por valor.
  // Tenta exata em plu/sku/codigo_interno.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("produtos")
    .select(
      "id, sku, nome, unidade, preco_venda, vendido_por_peso, aceita_etiqueta_balanca, plu, codigo_interno, status",
    )
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
        .select(
          "id, sku, nome, unidade, preco_venda, vendido_por_peso, aceita_etiqueta_balanca, plu, codigo_interno, status",
        )
        .or(
          `plu.eq.${stripped},sku.eq.${stripped},codigo_interno.eq.${stripped}`,
        )
        .limit(1)
        .maybeSingle();
      if (r2.error) throw r2.error;
      if (!r2.data) return null;
      return mapRow(r2.data);
    }
    return null;
  }
  return mapRow(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): ProdutoPluResult {
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
