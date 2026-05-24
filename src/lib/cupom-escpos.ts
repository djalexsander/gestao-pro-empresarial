/**
 * Gera bytes ESC/POS para impressora térmica 80mm (POS-80 e similares).
 * Largura padrão: 48 colunas (Font A). Encoding CP850 (acentos PT-BR).
 *
 * Aplica comandos de DENSIDADE/INTENSIDADE no cabeçalho do job (ESC 7 —
 * heating dots/time/interval, e ESC G — double-strike) para que textos
 * pequenos não saiam apagados e o cupom fique escuro e legível.
 */

import type { ConfigEmpresa } from "@/hooks/useConfigEmpresa";
import type { CupomData } from "@/lib/cupom";
import { formatBRL } from "@/lib/mock-data";
import {
  getPrintIntensity,
  type PrintIntensity,
} from "@/integrations/desktop/printers";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const COLS = 48;

const FORMA_LABEL: Record<string, string> = {
  dinheiro: "DINHEIRO",
  pix: "PIX",
  cartao_debito: "CARTAO DEBITO",
  cartao_credito: "CARTAO CREDITO",
  boleto: "BOLETO",
  ifood: "IFOOD",
  fiado: "FIADO",
  transferencia: "TRANSFERENCIA",
  cheque: "CHEQUE",
  outro: "OUTRO",
};

const STATUS_LABEL: Record<string, string> = {
  pago: "PAGO",
  pendente: "PENDENTE",
  parcial: "PARCIAL",
  cancelado: "CANCELADO",
};

class EscBuilder {
  private parts: number[] = [];

  raw(...bytes: number[]) {
    this.parts.push(...bytes);
    return this;
  }
  // Codifica string em CP850. Caracteres não suportados viram '?'.
  text(s: string) {
    const ascii = removeAccents(s);
    for (let i = 0; i < ascii.length; i++) {
      const c = ascii.charCodeAt(i);
      this.parts.push(c < 0x80 ? c : 0x3f);
    }
    return this;
  }
  line(s = "") {
    return this.text(s).raw(LF);
  }
  init() {
    return this.raw(ESC, 0x40); // ESC @
  }
  align(a: "left" | "center" | "right") {
    const v = a === "center" ? 1 : a === "right" ? 2 : 0;
    return this.raw(ESC, 0x61, v);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  // 0=normal,1=2x altura,16=2x largura,17=2x ambos
  size(mode: 0 | 1 | 16 | 17) {
    return this.raw(GS, 0x21, mode);
  }
  feed(n = 1) {
    for (let i = 0; i < n; i++) this.parts.push(LF);
    return this;
  }
  cut() {
    // GS V 66 0 — full cut com pequeno feed prévio
    return this.feed(3).raw(GS, 0x56, 66, 0);
  }
  sep() {
    return this.line("-".repeat(COLS));
  }
  build(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

function removeAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/–|—/g, "-");
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function row(left: string, right: string, width = COLS): string {
  const r = right.slice(0, width);
  const l = left.slice(0, Math.max(0, width - r.length - 1));
  const space = width - l.length - r.length;
  return l + " ".repeat(Math.max(1, space)) + r;
}

function fmtDate(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function gerarCupomEscPos(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
): Uint8Array {
  const b = new EscBuilder();
  b.init();

  // Cabeçalho
  b.align("center").bold(true).size(17);
  b.line(empresa?.nome_fantasia ?? empresa?.razao_social ?? "CUPOM DE VENDA");
  b.size(0).bold(false);
  if (empresa?.nome_fantasia && empresa.razao_social) b.line(empresa.razao_social);
  if (empresa?.cnpj) b.line(`CNPJ: ${empresa.cnpj}`);
  if (empresa?.inscricao_estadual) b.line(`IE: ${empresa.inscricao_estadual}`);
  const end1 = [empresa?.logradouro, empresa?.numero].filter(Boolean).join(", ");
  if (end1) b.line(end1);
  const end2 = [
    empresa?.bairro,
    [empresa?.cidade, empresa?.estado].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" - ");
  if (end2) b.line(end2);
  if (empresa?.telefone) b.line(`Tel: ${empresa.telefone}`);

  b.sep();
  b.bold(true).line("CUPOM NAO FISCAL");
  b.bold(false).line("SEM VALOR FISCAL");
  b.sep();

  b.align("left");
  b.line(row(`Cupom: ${cupom.numero ?? "-"}`, fmtDate(cupom.data)));
  if (cupom.operador) b.line(`Operador: ${cupom.operador}`);
  if (cupom.cliente) {
    b.line(`Cliente: ${cupom.cliente.nome}`);
    if (cupom.cliente.documento) b.line(`Doc: ${cupom.cliente.documento}`);
  } else {
    b.line("Cliente: CONSUMIDOR");
  }
  b.sep();

  // Itens
  b.bold(true).line(row("ITEM / DESCRICAO", "VALOR"));
  b.bold(false).sep();
  cupom.itens.forEach((it, i) => {
    const idx = String(i + 1).padStart(3, "0");
    const desc = `${idx} ${it.descricao}${it.sku ? ` (${it.sku})` : ""}`;
    // quebra em linhas
    for (let j = 0; j < desc.length; j += COLS) {
      b.line(desc.slice(j, j + COLS));
    }
    const qty = it.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    const detalhe = `   ${qty} ${it.unidade ?? "UN"} x ${formatBRL(
      it.preco_unitario,
    )}${it.desconto > 0 ? ` -${formatBRL(it.desconto)}` : ""}`;
    b.line(row(detalhe, formatBRL(it.total)));
  });
  b.sep();

  b.line(
    row(
      "Itens:",
      `${cupom.itens.length} (${cupom.totalItens.toLocaleString("pt-BR", {
        maximumFractionDigits: 3,
      })} un.)`,
    ),
  );
  b.line(row("Subtotal:", formatBRL(cupom.subtotal)));
  if (cupom.desconto > 0)
    b.line(row("Descontos:", `- ${formatBRL(cupom.desconto)}`));

  b.bold(true).size(1);
  b.line(row("TOTAL", formatBRL(cupom.total)));
  b.size(0).bold(false);
  b.sep();

  b.line(row("Pagamento:", FORMA_LABEL[cupom.forma] ?? cupom.forma));
  b.line(row("Status:", STATUS_LABEL[cupom.status] ?? cupom.status));
  if (cupom.troco > 0) {
    b.line(
      row(
        "Recebido:",
        formatBRL(cupom.valorRecebido ?? cupom.total + cupom.troco),
      ),
    );
    b.bold(true).line(row("TROCO:", formatBRL(cupom.troco))).bold(false);
  }
  if (cupom.observacao) {
    b.sep();
    b.line(`Obs.: ${cupom.observacao}`);
  }
  b.sep();
  b.align("center").line("Obrigado pela preferencia!").line("Volte sempre.");
  b.cut();
  return b.build();
}

/** Conteúdo de teste de impressão. */
export function gerarTesteEscPos(printerName: string): Uint8Array {
  const b = new EscBuilder();
  const now = new Date().toLocaleString("pt-BR");
  b.init()
    .align("center")
    .bold(true)
    .size(17)
    .line("TESTE DE IMPRESSAO")
    .size(0)
    .bold(false)
    .line("Gestao Pro")
    .feed(1)
    .align("left")
    .line(`Data/Hora: ${now}`)
    .line(`Impressora: ${printerName}`)
    .feed(1)
    .align("center")
    .line("Se voce esta lendo isso,")
    .line("a impressora esta funcionando!")
    .cut();
  return b.build();
}
