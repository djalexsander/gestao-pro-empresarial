/**
 * Predicado de busca livre de produto, compartilhado pelas telas que filtram
 * a lista já carregada em memória (`useProdutos()`):
 *
 *  - Operacional -> Produtos
 *  - Operacional -> Estoque (posição)
 *  - PDV -> busca manual de produto (F9)
 *
 * Motivo de existir: essas telas divergiam. A busca manual do PDV já cobria
 * `codigo_barras` e `codigo_interno`, enquanto Produtos/Estoque pesquisavam
 * só `nome` e `sku` — então um EAN válido, gravado em `produtos.codigo_barras`
 * e encontrado normalmente ao bipar no PDV, retornava "nenhum produto
 * encontrado" nas telas do ERP. Uma única definição evita a divergência.
 *
 * Cobre os mesmos identificadores DIRETOS da linha `produtos` que a RPC
 * `buscar_produto_por_codigo` (scanner/PDV) resolve: nome, SKU, código
 * interno e código de barras. Códigos alternativos em `produto_codigos` e
 * códigos de variação continuam exclusivos do fluxo de leitura por código
 * (scanner), que consulta o banco — a lista em memória não os carrega.
 *
 * Correspondência por substring, sem distinção de maiúsculas/minúsculas —
 * exatamente como a busca manual do PDV. Não altera o comportamento da
 * busca por nome/SKU; apenas soma os demais identificadores ao mesmo teste.
 */

/** Subconjunto de campos de produto que a busca livre inspeciona. */
export interface ProdutoBuscavel {
  nome: string;
  sku: string;
  codigo_barras?: string | null;
  codigo_interno?: string | null;
}

/** Normaliza o termo digitado: sem espaços nas pontas, minúsculo. */
export function normalizarTermoBusca(termo: string): string {
  return termo.trim().toLowerCase();
}

/**
 * `true` se o produto casa com o termo de busca livre.
 *
 * Termo vazio casa com qualquer produto (mesma semântica de "sem filtro"
 * usada pelas telas). O chamador continua responsável pelos demais filtros
 * (categoria, status, etc.).
 */
export function produtoCorrespondeBusca(produto: ProdutoBuscavel, termo: string): boolean {
  const q = normalizarTermoBusca(termo);
  if (!q) return true;

  const campos = [produto.nome, produto.sku, produto.codigo_barras, produto.codigo_interno];

  return campos.some((campo) => !!campo && campo.toLowerCase().includes(q));
}
