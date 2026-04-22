import { formatBRL } from "@/lib/mock-data";
import type { ConfigEmpresa } from "@/hooks/useConfigEmpresa";
import type { FormaPagamento, StatusPagamento } from "@/hooks/useVendas";

const FORMA_LABEL: Record<FormaPagamento, string> = {
  dinheiro: "DINHEIRO",
  pix: "PIX",
  cartao_debito: "CARTAO DEBITO",
  cartao_credito: "CARTAO CREDITO",
  boleto: "BOLETO",
  transferencia: "TRANSFERENCIA",
  cheque: "CHEQUE",
  outro: "OUTRO / FIADO",
};

const STATUS_LABEL: Record<StatusPagamento, string> = {
  pago: "PAGO",
  pendente: "PENDENTE",
  parcial: "PARCIAL",
  cancelado: "CANCELADO",
};

export interface CupomItem {
  descricao: string;
  sku?: string | null;
  quantidade: number;
  unidade?: string | null;
  preco_unitario: number;
  desconto: number;
  total: number;
}

export interface CupomData {
  numero: string | null;
  data: Date;
  operador?: string | null;
  cliente?: { nome: string; documento?: string | null } | null;
  itens: CupomItem[];
  subtotal: number;
  desconto: number;
  total: number;
  totalItens: number;
  forma: FormaPagamento;
  status: StatusPagamento;
  valorRecebido?: number | null;
  troco: number;
  observacao?: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtAddr(e: ConfigEmpresa): string {
  const linha1 = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const compl = e.complemento ? ` - ${e.complemento}` : "";
  const linha2 = [e.bairro, [e.cidade, e.estado].filter(Boolean).join("/")]
    .filter(Boolean)
    .join(" - ");
  const cep = e.cep ? `CEP ${e.cep}` : "";
  return [linha1 + compl, linha2, cep].filter((s) => s.trim()).join("<br/>");
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

/** Gera HTML de um cupom não fiscal (térmico ~80mm). */
export function gerarCupomHtml(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
  options: { autoPrint?: boolean } = {},
): string {
  const autoPrint = options.autoPrint ?? false;
  const itensHtml = cupom.itens
    .map((it, i) => {
      const linhaTopo = `${String(i + 1).padStart(3, "0")} ${escapeHtml(it.descricao)}`;
      const sku = it.sku ? ` <span class="muted">(${escapeHtml(it.sku)})</span>` : "";
      const detalhe = `${it.quantidade.toLocaleString("pt-BR", {
        maximumFractionDigits: 3,
      })} ${escapeHtml(it.unidade ?? "UN")} x ${formatBRL(it.preco_unitario)}${
        it.desconto > 0 ? ` <span class="muted">- desc ${formatBRL(it.desconto)}</span>` : ""
      }`;
      return `
        <div class="item">
          <div class="item-top">${linhaTopo}${sku}</div>
          <div class="item-bottom">
            <span>${detalhe}</span>
            <span class="bold">${formatBRL(it.total)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  const empresaHtml = empresa
    ? `
      <div class="header center">
        <div class="bold lg">${escapeHtml(empresa.nome_fantasia ?? empresa.razao_social)}</div>
        ${empresa.nome_fantasia ? `<div class="muted">${escapeHtml(empresa.razao_social)}</div>` : ""}
        ${empresa.cnpj ? `<div>CNPJ: ${escapeHtml(empresa.cnpj)}</div>` : ""}
        ${empresa.inscricao_estadual ? `<div>IE: ${escapeHtml(empresa.inscricao_estadual)}</div>` : ""}
        <div class="muted small">${fmtAddr(empresa)}</div>
        ${empresa.telefone ? `<div class="muted small">Tel: ${escapeHtml(empresa.telefone)}</div>` : ""}
      </div>
    `
    : `<div class="header center"><div class="bold lg">CUPOM DE VENDA</div></div>`;

  const clienteHtml = cupom.cliente
    ? `
      <div class="row">
        <span>Cliente:</span>
        <span class="bold">${escapeHtml(cupom.cliente.nome)}</span>
      </div>
      ${cupom.cliente.documento ? `<div class="row"><span>Doc:</span><span>${escapeHtml(cupom.cliente.documento)}</span></div>` : ""}
    `
    : `<div class="row"><span>Cliente:</span><span>CONSUMIDOR</span></div>`;

  const trocoHtml =
    cupom.troco > 0
      ? `
        <div class="row">
          <span>Recebido:</span>
          <span>${formatBRL(cupom.valorRecebido ?? cupom.total + cupom.troco)}</span>
        </div>
        <div class="row bold">
          <span>TROCO:</span>
          <span>${formatBRL(cupom.troco)}</span>
        </div>
      `
      : "";

  const obsHtml = cupom.observacao
    ? `<div class="block muted small">Obs.: ${escapeHtml(cupom.observacao)}</div>`
    : "";

  const titulo = `Cupom ${cupom.numero ?? "—"}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(titulo)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.35;
    padding: 6mm 4mm;
    width: 80mm;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .muted { color: #444; }
  .small { font-size: 10.5px; }
  .lg { font-size: 14px; }
  .sep {
    border: 0;
    border-top: 1px dashed #000;
    margin: 6px 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  .block { margin: 4px 0; }
  .header { margin-bottom: 4px; }
  .item { margin: 2px 0 4px 0; }
  .item-top { word-break: break-word; }
  .item-bottom {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    padding-left: 14px;
  }
  .total {
    font-size: 16px;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
  }
  .footer {
    margin-top: 10px;
    text-align: center;
    font-size: 10.5px;
    color: #444;
  }
  @media print {
    @page { size: 80mm auto; margin: 0; }
    body { padding: 4mm; width: 80mm; }
  }
</style>
</head>
<body>
  ${empresaHtml}
  <hr class="sep" />

  <div class="center bold">CUPOM NAO FISCAL</div>
  <div class="center muted small">SEM VALOR FISCAL</div>
  <hr class="sep" />

  <div class="row"><span>Cupom:</span><span class="bold">${escapeHtml(cupom.numero ?? "—")}</span></div>
  <div class="row"><span>Data:</span><span>${fmtDate(cupom.data)}</span></div>
  ${cupom.operador ? `<div class="row"><span>Operador:</span><span>${escapeHtml(cupom.operador)}</span></div>` : ""}
  ${clienteHtml}

  <hr class="sep" />
  <div class="row muted small bold">
    <span>ITEM / DESCRICAO</span>
    <span>VALOR</span>
  </div>
  <hr class="sep" />

  ${itensHtml}

  <hr class="sep" />
  <div class="row"><span>Itens:</span><span>${cupom.itens.length} (${cupom.totalItens.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} un.)</span></div>
  <div class="row"><span>Subtotal:</span><span>${formatBRL(cupom.subtotal)}</span></div>
  ${cupom.desconto > 0 ? `<div class="row"><span>Descontos:</span><span>- ${formatBRL(cupom.desconto)}</span></div>` : ""}

  <div class="total">
    <span>TOTAL</span>
    <span>${formatBRL(cupom.total)}</span>
  </div>

  <hr class="sep" />
  <div class="row"><span>Pagamento:</span><span class="bold">${FORMA_LABEL[cupom.forma]}</span></div>
  <div class="row"><span>Status:</span><span class="bold">${STATUS_LABEL[cupom.status]}</span></div>
  ${trocoHtml}
  ${obsHtml}

  <hr class="sep" />
  <div class="footer">
    Obrigado pela preferencia!<br/>
    Volte sempre.
  </div>

  <script>
    var AUTO_PRINT = ${autoPrint ? "true" : "false"};
    window.addEventListener('load', function () {
      if (!AUTO_PRINT) return;
      setTimeout(function () {
        try { window.focus(); window.print(); } catch (e) {}
      }, 150);
    });
    window.addEventListener('afterprint', function () {
      setTimeout(function () { window.close(); }, 200);
    });
  </script>
</body>
</html>`;
}

/** Abre uma nova janela e dispara a impressão do cupom (chama window.print()). */
export function imprimirCupom(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
): boolean {
  const html = gerarCupomHtml(empresa, cupom, { autoPrint: true });
  const win = window.open("", "_blank", "width=420,height=720");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

/**
 * Baixa o cupom como um arquivo HTML autônomo.
 * O usuário pode abrir e usar "Salvar como PDF" do navegador, ou imprimir depois.
 */
export function baixarCupomHtml(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
): boolean {
  try {
    const html = gerarCupomHtml(empresa, cupom, { autoPrint: false });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeNumero = (cupom.numero ?? "cupom")
      .toString()
      .replace(/[^a-zA-Z0-9_-]+/g, "_");
    a.href = url;
    a.download = `cupom_${safeNumero}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
