/**
 * Parser flexível de etiquetas de balança etiquetadora (padrão EAN-13 brasileiro).
 *
 * Formato típico Toledo/Filizola:
 *   2X PPPPP NNNNN D
 *   |  |     |     `- dígito verificador EAN-13
 *   |  |     `------- 5 dígitos de peso (em gramas) OU valor (em centavos)
 *   |  `------------- 5 dígitos do código do produto (PLU)
 *   `---------------- prefixo (20-29)
 *
 * Mas o parser é configurável (posições, dígitos, comprimento) para suportar
 * variações de balanças.
 */

export interface BalancaConfig {
  ativo: boolean;
  prefixos: string[];
  comprimento_total: number;
  inicio_codigo_produto: number;
  digitos_codigo_produto: number;
  inicio_peso_valor: number;
  digitos_peso_valor: number;
  tipo_codigo: "peso" | "valor";
  casas_decimais_peso: number;
  casas_decimais_valor: number;
  validar_dv: boolean;
}

export const DEFAULT_BALANCA_CONFIG: BalancaConfig = {
  ativo: false,
  prefixos: ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"],
  comprimento_total: 13,
  inicio_codigo_produto: 2,
  digitos_codigo_produto: 5,
  inicio_peso_valor: 7,
  digitos_peso_valor: 5,
  tipo_codigo: "peso",
  casas_decimais_peso: 3,
  casas_decimais_valor: 2,
  validar_dv: true,
};

export interface EtiquetaParsed {
  ok: true;
  codigo_completo: string;
  prefixo: string;
  plu: string;
  /** Peso em KG (se tipo_codigo === 'peso') */
  peso_kg: number | null;
  /** Valor total em R$ (se tipo_codigo === 'valor') */
  valor_total: number | null;
  tipo: "peso" | "valor";
}

export interface EtiquetaErro {
  ok: false;
  motivo: string;
}

export type EtiquetaResultado = EtiquetaParsed | EtiquetaErro;

/** Soma ponderada para EAN-13: dígitos ímpares ×1, pares ×3 (1-indexed). */
function calcEan13Dv(digitos12: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digitos12[i]);
    soma += d * (i % 2 === 0 ? 1 : 3);
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/**
 * Tenta interpretar `codigo` como etiqueta de balança usando `cfg`.
 * Retorna o resultado tipado para o chamador decidir o que fazer.
 */
export function parseEtiquetaBalanca(
  codigo: string,
  cfg: BalancaConfig,
): EtiquetaResultado {
  const c = (codigo ?? "").trim();
  if (!c) return { ok: false, motivo: "Código vazio." };
  if (!/^\d+$/.test(c))
    return { ok: false, motivo: "Código contém caracteres não numéricos." };
  if (c.length !== cfg.comprimento_total)
    return {
      ok: false,
      motivo: `Comprimento ${c.length} diferente do esperado (${cfg.comprimento_total}).`,
    };

  // Identifica prefixo: pega os 2 (ou N) primeiros caracteres conforme o maior prefixo configurado
  const tamanhoPrefixo = Math.max(...cfg.prefixos.map((p) => p.length), 2);
  const prefixo = c.slice(0, tamanhoPrefixo);
  if (!cfg.prefixos.includes(prefixo))
    return {
      ok: false,
      motivo: `Prefixo "${prefixo}" não está cadastrado como prefixo de balança.`,
    };

  const plu = c.slice(
    cfg.inicio_codigo_produto,
    cfg.inicio_codigo_produto + cfg.digitos_codigo_produto,
  );
  if (plu.length !== cfg.digitos_codigo_produto)
    return { ok: false, motivo: "PLU fora dos limites do código." };

  const bruto = c.slice(
    cfg.inicio_peso_valor,
    cfg.inicio_peso_valor + cfg.digitos_peso_valor,
  );
  if (bruto.length !== cfg.digitos_peso_valor)
    return { ok: false, motivo: "Peso/valor fora dos limites do código." };

  if (cfg.validar_dv && cfg.comprimento_total === 13) {
    const dvLido = Number(c[12]);
    const dvCalc = calcEan13Dv(c.slice(0, 12));
    if (dvLido !== dvCalc)
      return {
        ok: false,
        motivo: `Dígito verificador inválido (lido ${dvLido}, esperado ${dvCalc}).`,
      };
  }

  const numero = Number(bruto);
  if (Number.isNaN(numero))
    return { ok: false, motivo: "Peso/valor não é um número válido." };

  if (cfg.tipo_codigo === "peso") {
    const peso = numero / Math.pow(10, cfg.casas_decimais_peso);
    return {
      ok: true,
      codigo_completo: c,
      prefixo,
      plu,
      peso_kg: peso,
      valor_total: null,
      tipo: "peso",
    };
  }

  const valor = numero / Math.pow(10, cfg.casas_decimais_valor);
  return {
    ok: true,
    codigo_completo: c,
    prefixo,
    plu,
    peso_kg: null,
    valor_total: valor,
    tipo: "valor",
  };
}

/** Helper: deriva quantidade (KG) e valor total a partir do parse + preço/KG. */
export function calcularPesoEValor(
  parsed: EtiquetaParsed,
  precoPorKg: number,
): { quantidade: number; valor_total: number } | { erro: string } {
  if (precoPorKg <= 0) return { erro: "Preço por KG zerado." };

  if (parsed.tipo === "peso") {
    if (!parsed.peso_kg || parsed.peso_kg <= 0)
      return { erro: "Peso zerado na etiqueta." };
    return {
      quantidade: parsed.peso_kg,
      valor_total: round2(parsed.peso_kg * precoPorKg),
    };
  }

  if (!parsed.valor_total || parsed.valor_total <= 0)
    return { erro: "Valor zerado na etiqueta." };
  // Inverso: deriva o peso a partir do valor
  const quantidade = parsed.valor_total / precoPorKg;
  return {
    quantidade: round3(quantidade),
    valor_total: round2(parsed.valor_total),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
