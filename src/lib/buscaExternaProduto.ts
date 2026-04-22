/**
 * Busca dados externos de produto a partir de um código de barras (EAN/UPC).
 *
 * Estratégia: usa a base pública Open Food Facts (alimentos, bebidas, higiene
 * e cosméticos). Não requer API key e tem CORS aberto. É apenas complementar:
 * sempre que falhar/não encontrar, retornamos `null` e o sistema segue para
 * o fluxo de cadastro manual.
 *
 * Para QR Codes que carregam JSON ou URLs, ainda retornamos `null` — esses
 * códigos costumam apontar para conteúdo proprietário e devem cair no
 * cadastro manual, com o código já preenchido.
 */

export interface ProdutoExterno {
  /** EAN/UPC ou código original que foi consultado. */
  codigo: string;
  /** Nome sugerido (em geral product_name ou marca + nome). */
  nome: string;
  /** Marca, quando disponível. */
  marca: string | null;
  /** Descrição curta (categorias resumidas). */
  descricao: string | null;
  /** Categoria principal sugerida (texto livre). */
  categoria_sugerida: string | null;
  /** Quantidade/embalagem (ex: "350 ml", "1 kg"). */
  quantidade: string | null;
  /** Imagem do produto, se houver. */
  imagem_url: string | null;
  /** Origem da informação para mostrar no UI. */
  fonte: "openfoodfacts";
}

/** Heurística simples: códigos numéricos com 8/12/13/14 dígitos são EAN/UPC. */
function pareceCodigoBarras(codigo: string): boolean {
  const c = codigo.trim();
  return /^\d{8,14}$/.test(c);
}

/**
 * Consulta Open Food Facts. Retorna null se não encontrado ou em qualquer
 * erro de rede/parse — a busca externa NUNCA deve quebrar o fluxo principal.
 */
export async function buscarProdutoExterno(
  codigo: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<ProdutoExterno | null> {
  const ean = codigo.trim();
  if (!pareceCodigoBarras(ean)) return null;

  const timeoutMs = opts?.timeoutMs ?? 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Encadeia abort externo
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_pt,brands,categories,categories_tags,quantity,image_front_small_url,image_url,generic_name`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      status?: number;
      product?: {
        product_name?: string;
        product_name_pt?: string;
        generic_name?: string;
        brands?: string;
        categories?: string;
        quantity?: string;
        image_front_small_url?: string;
        image_url?: string;
      };
    };
    if (json.status !== 1 || !json.product) return null;
    const p = json.product;
    const nome =
      (p.product_name_pt && p.product_name_pt.trim()) ||
      (p.product_name && p.product_name.trim()) ||
      (p.generic_name && p.generic_name.trim()) ||
      "";
    if (!nome) return null;

    const categoria = (p.categories ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .pop() ?? null;

    return {
      codigo: ean,
      nome: nome.length > 200 ? nome.slice(0, 200) : nome,
      marca: p.brands ? p.brands.split(",")[0].trim() : null,
      descricao: p.generic_name?.trim() || null,
      categoria_sugerida: categoria,
      quantidade: p.quantity?.trim() || null,
      imagem_url: p.image_front_small_url || p.image_url || null,
      fonte: "openfoodfacts",
    };
  } catch {
    // Timeout, CORS, rede — silenciosamente cai no fluxo manual.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
