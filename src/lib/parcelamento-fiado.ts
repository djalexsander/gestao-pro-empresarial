export interface ParcelaFiado {
  numeroParcela: number;
  totalParcelas: number;
  valorCentavos: number;
  valor: number;
  dataVencimento: string;
}

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dataFinanceiraValida(data: string): boolean {
  const match = DATA_RE.exec(data);
  if (!match) return false;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= new Date(ano, mes, 0).getDate();
}

export function adicionarMesesFinanceiros(dataInicial: string, meses: number): string {
  if (!dataFinanceiraValida(dataInicial) || !Number.isInteger(meses) || meses < 0) {
    throw new Error("Data financeira ou intervalo inválido.");
  }
  const match = DATA_RE.exec(dataInicial)!;
  const anoInicial = Number(match[1]);
  const mesInicial = Number(match[2]);
  const diaOriginal = Number(match[3]);
  const indiceMes = mesInicial - 1 + meses;
  const ano = anoInicial + Math.floor(indiceMes / 12);
  const mes = (indiceMes % 12) + 1;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const dia = Math.min(diaOriginal, ultimoDia);
  return `${ano.toString().padStart(4, "0")}-${mes.toString().padStart(2, "0")}-${dia.toString().padStart(2, "0")}`;
}

export function gerarParcelasFiado(
  valorFiado: number,
  quantidade: number,
  primeiroVencimento: string,
): ParcelaFiado[] {
  if (!Number.isFinite(valorFiado) || valorFiado <= 0) {
    throw new Error("O valor fiado deve ser maior que zero.");
  }
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 60) {
    throw new Error("Informe uma quantidade válida de parcelas.");
  }
  if (!dataFinanceiraValida(primeiroVencimento)) {
    throw new Error("Informe a data do primeiro vencimento.");
  }

  const totalCentavos = Math.round(valorFiado * 100);
  const valorBase = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos % quantidade;

  return Array.from({ length: quantidade }, (_, indice) => {
    const ultima = indice === quantidade - 1;
    const valorCentavos = valorBase + (ultima ? resto : 0);
    return {
      numeroParcela: indice + 1,
      totalParcelas: quantidade,
      valorCentavos,
      valor: valorCentavos / 100,
      dataVencimento: adicionarMesesFinanceiros(primeiroVencimento, indice),
    };
  });
}

export function somaParcelasCentavos(parcelas: ParcelaFiado[]): number {
  return parcelas.reduce((total, parcela) => total + parcela.valorCentavos, 0);
}
