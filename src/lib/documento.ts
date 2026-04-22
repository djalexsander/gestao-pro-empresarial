/**
 * Utilitários de validação e formatação de CPF/CNPJ.
 * Não fazem chamadas de rede — apenas verificação algorítmica.
 */

export type DocumentoTipo = "CPF" | "CNPJ";

export function somenteDigitos(v: string): string {
  return (v ?? "").replace(/\D+/g, "");
}

export function classificarDocumento(v: string): DocumentoTipo | null {
  const d = somenteDigitos(v);
  if (d.length === 11) return "CPF";
  if (d.length === 14) return "CNPJ";
  return null;
}

export function formatarDocumento(v: string): string {
  const d = somenteDigitos(v);
  if (d.length === 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  if (d.length === 14) {
    return d
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return v;
}

/** Valida CPF pelos dígitos verificadores. */
export function validarCPF(v: string): boolean {
  const cpf = somenteDigitos(v);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (base: string, factorStart: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += parseInt(base[i]!, 10) * (factorStart - i);
    }
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  return d1 === parseInt(cpf[9]!, 10) && d2 === parseInt(cpf[10]!, 10);
}

/** Valida CNPJ pelos dígitos verificadores. */
export function validarCNPJ(v: string): boolean {
  const cnpj = somenteDigitos(v);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string) => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += parseInt(base[i]!, 10) * weights[i]!;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(cnpj.slice(0, 12));
  const d2 = calc(cnpj.slice(0, 13));
  return d1 === parseInt(cnpj[12]!, 10) && d2 === parseInt(cnpj[13]!, 10);
}

/** Retorna { valido, tipo } — útil para exibir feedback uniforme. */
export function validarDocumento(v: string): {
  valido: boolean;
  tipo: DocumentoTipo | null;
} {
  const tipo = classificarDocumento(v);
  if (!tipo) return { valido: false, tipo: null };
  const valido = tipo === "CPF" ? validarCPF(v) : validarCNPJ(v);
  return { valido, tipo };
}

/** Aplica máscara progressiva enquanto o usuário digita. */
export function maskDocumentoProgressivo(v: string): string {
  const d = somenteDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    // Máscara de CPF
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  // CNPJ
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
