/**
 * Geracao de SKU legivel a partir do nome do produto.
 *
 * - `normalizarBaseSku(nome)` converte o nome em uma base curta, maiuscula,
 *   sem acentos e sem caracteres invalidos
 *   (ex.: "Impressora termica 80mm" -> "IMP-TER-80M").
 * - `proximoSufixoNumerico(base, existentes)` calcula o proximo numero de
 *   sequencia livre a partir dos SKUs ja cadastrados com a mesma base.
 * - `montarSku(base, sequencia)` formata o SKU final "BASE-000".
 * - `gerarProximoSku(nome, existentes)` combina os tres acima.
 */

const MAX_TOKENS = 4;
const TOKEN_LEN_MULTI = 3;
const TOKEN_LEN_UNICO = 10;
const SUFIXO_DIGITOS = 3;

function removerAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function escapeRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deriva uma base curta, legivel e deterministica a partir do nome do produto. */
export function normalizarBaseSku(nome: string | null | undefined): string {
  const limpo = removerAcentos(nome ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const palavras = limpo.split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return "PROD";

  // Nome com uma unica palavra (sem espacos): aproveita mais caracteres
  // dela ja que nao precisa dividir espaco com outros tokens.
  const tamanhoToken = palavras.length === 1 ? TOKEN_LEN_UNICO : TOKEN_LEN_MULTI;

  return palavras
    .slice(0, MAX_TOKENS)
    .map((p) => p.slice(0, tamanhoToken))
    .join("-");
}

/** Monta o SKU final "BASE-NNN". Sequencia sem limite artificial de digitos. */
export function montarSku(base: string, sequencia: number): string {
  return `${base}-${String(sequencia).padStart(SUFIXO_DIGITOS, "0")}`;
}

/**
 * A partir dos SKUs existentes, encontra o maior sufixo numerico ja usado
 * para a base informada (padrao "BASE-<numero>") e retorna o proximo
 * (maior + 1). Sempre avanca - nao reaproveita numeros de SKUs excluidos -
 * e nao tem limite artificial: funciona igual com 1 ou com dezenas de
 * milhares de produtos cadastrados.
 */
export function proximoSufixoNumerico(base: string, skusExistentes: string[]): number {
  const re = new RegExp(`^${escapeRegExp(base)}-(\\d+)$`, "i");
  let maior = 0;
  for (const sku of skusExistentes) {
    const m = re.exec(sku.trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return maior + 1;
}

/** Gera o proximo SKU disponivel para o nome informado, dado o conjunto de SKUs ja existentes com o mesmo prefixo (mesma empresa). */
export function gerarProximoSku(
  nome: string | null | undefined,
  skusExistentesComPrefixo: string[],
): string {
  const base = normalizarBaseSku(nome);
  const seq = proximoSufixoNumerico(base, skusExistentesComPrefixo);
  return montarSku(base, seq);
}
