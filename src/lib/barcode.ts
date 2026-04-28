/**
 * Utilitários para código de barras EAN-13.
 *
 * - `gerarEan13()` cria um EAN-13 aleatório com prefixo interno "200"
 *   (faixa 200-299 reservada para uso interno do varejo) e dígito verificador correto.
 * - `calcularDvEan13(base12)` retorna o dígito verificador para os 12 primeiros dígitos.
 * - `validarEan13(codigo)` confere comprimento, dígitos e DV.
 */

export function calcularDvEan13(base12: string): number {
  if (!/^\d{12}$/.test(base12)) throw new Error("Base deve ter 12 dígitos numéricos");
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(base12[i]);
    soma += i % 2 === 0 ? d : d * 3;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

export function validarEan13(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return false;
  return calcularDvEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

/** Gera um EAN-13 com prefixo "200" (uso interno) e DV correto. */
export function gerarEan13(prefixoInterno = "200"): string {
  if (!/^\d{1,11}$/.test(prefixoInterno)) prefixoInterno = "200";
  const restantes = 12 - prefixoInterno.length;
  let aleatorios = "";
  for (let i = 0; i < restantes; i++) {
    aleatorios += Math.floor(Math.random() * 10).toString();
  }
  const base = prefixoInterno + aleatorios;
  return base + calcularDvEan13(base).toString();
}
