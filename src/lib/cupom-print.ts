/**
 * Impressão e exportação PDF do cupom — funciona em web e desktop/Tauri.
 *
 * - Impressão: usa iframe oculto + window.print() do iframe. Não depende
 *   de popup, então não é bloqueado em navegadores nem no Tauri.
 * - PDF: gera via jsPDF (formato 80mm térmico). No desktop, abre o diálogo
 *   nativo de salvar arquivo (plugin-dialog + plugin-fs). No web, faz
 *   download via blob.
 */

import { jsPDF } from "jspdf";
import { isDesktop } from "@/integrations/data/mode";
import type { ConfigEmpresa } from "@/hooks/useConfigEmpresa";
import { gerarCupomHtml, type CupomData } from "@/lib/cupom";
import { formatBRL } from "@/lib/mock-data";
import {
  getDefaultPrinter,
  printPdfBytes,
} from "@/integrations/desktop/printers";

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

/** Imprime o cupom usando um iframe oculto. Não usa window.open. */
export function imprimirCupomIframe(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
): boolean {
  try {
    const html = gerarCupomHtml(empresa, cupom, { autoPrint: false });
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();

    const trigger = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) return;
        win.focus();
        win.print();
      } catch (e) {
        console.error("[cupom-print] erro ao imprimir iframe", e);
      } finally {
        // Remove o iframe depois de um tempo — alguns navegadores precisam
        // mantê-lo vivo enquanto o diálogo de impressão está aberto.
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }, 60_000);
      }
    };

    if (iframe.contentWindow?.document.readyState === "complete") {
      setTimeout(trigger, 100);
    } else {
      iframe.addEventListener("load", () => setTimeout(trigger, 100), {
        once: true,
      });
      // Fallback caso o evento load não dispare a tempo.
      setTimeout(trigger, 600);
    }
    return true;
  } catch (e) {
    console.error("[cupom-print] falha ao montar iframe de impressão", e);
    return false;
  }
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

/** Gera o PDF (jsPDF) do cupom em formato 80mm. Retorna o documento. */
function gerarPdfCupom(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
): jsPDF {
  // 80mm de largura; altura cresce conforme o conteúdo.
  const pageWidth = 80;
  const margin = 4;
  const innerWidth = pageWidth - margin * 2;

  // Estimativa de altura: cabeçalho + itens + totais + rodapé.
  const estLines =
    14 + cupom.itens.length * 2 + (cupom.cliente ? 2 : 1) + (cupom.observacao ? 2 : 0);
  const pageHeight = Math.max(120, 30 + estLines * 4);

  const doc = new jsPDF({
    unit: "mm",
    format: [pageWidth, pageHeight],
    orientation: "portrait",
  });

  doc.setFont("courier", "normal");
  let y = margin + 4;

  const writeCenter = (text: string, size = 9, bold = false) => {
    doc.setFontSize(size);
    doc.setFont("courier", bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, innerWidth);
    for (const ln of lines) {
      doc.text(ln, pageWidth / 2, y, { align: "center" });
      y += size * 0.45;
    }
  };

  const writeLine = (text: string, size = 8, bold = false) => {
    doc.setFontSize(size);
    doc.setFont("courier", bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, innerWidth);
    for (const ln of lines) {
      doc.text(ln, margin, y);
      y += size * 0.45;
    }
  };

  const writeRow = (left: string, right: string, size = 8, bold = false) => {
    doc.setFontSize(size);
    doc.setFont("courier", bold ? "bold" : "normal");
    doc.text(left, margin, y);
    doc.text(right, pageWidth - margin, y, { align: "right" });
    y += size * 0.45;
  };

  const sep = () => {
    doc.setLineDashPattern([0.4, 0.6], 0);
    doc.setLineWidth(0.1);
    doc.line(margin, y, pageWidth - margin, y);
    y += 2;
  };

  // Cabeçalho da empresa
  if (empresa) {
    writeCenter(empresa.nome_fantasia ?? empresa.razao_social, 11, true);
    if (empresa.nome_fantasia) writeCenter(empresa.razao_social, 7);
    if (empresa.cnpj) writeCenter(`CNPJ: ${empresa.cnpj}`, 7);
    if (empresa.inscricao_estadual)
      writeCenter(`IE: ${empresa.inscricao_estadual}`, 7);
    const endLinha1 = [empresa.logradouro, empresa.numero].filter(Boolean).join(", ");
    if (endLinha1) writeCenter(endLinha1, 7);
    const endLinha2 = [
      empresa.bairro,
      [empresa.cidade, empresa.estado].filter(Boolean).join("/"),
    ]
      .filter(Boolean)
      .join(" - ");
    if (endLinha2) writeCenter(endLinha2, 7);
    if (empresa.telefone) writeCenter(`Tel: ${empresa.telefone}`, 7);
  } else {
    writeCenter("CUPOM DE VENDA", 11, true);
  }
  y += 1;
  sep();

  writeCenter("CUPOM NAO FISCAL", 9, true);
  writeCenter("SEM VALOR FISCAL", 7);
  sep();

  writeRow("Cupom:", cupom.numero ?? "—", 8, true);
  writeRow("Data:", fmtDate(cupom.data));
  if (cupom.operador) writeRow("Operador:", cupom.operador);
  if (cupom.cliente) {
    writeRow("Cliente:", cupom.cliente.nome);
    if (cupom.cliente.documento) writeRow("Doc:", cupom.cliente.documento);
  } else {
    writeRow("Cliente:", "CONSUMIDOR");
  }
  sep();

  writeRow("ITEM / DESCRICAO", "VALOR", 7, true);
  sep();

  cupom.itens.forEach((it, i) => {
    const idx = String(i + 1).padStart(3, "0");
    writeLine(`${idx} ${it.descricao}${it.sku ? ` (${it.sku})` : ""}`, 8);
    const detalhe = `   ${it.quantidade.toLocaleString("pt-BR", {
      maximumFractionDigits: 3,
    })} ${it.unidade ?? "UN"} x ${formatBRL(it.preco_unitario)}${
      it.desconto > 0 ? ` -${formatBRL(it.desconto)}` : ""
    }`;
    writeRow(detalhe, formatBRL(it.total), 8);
  });

  sep();
  writeRow(
    "Itens:",
    `${cupom.itens.length} (${cupom.totalItens.toLocaleString("pt-BR", {
      maximumFractionDigits: 3,
    })} un.)`,
  );
  writeRow("Subtotal:", formatBRL(cupom.subtotal));
  if (cupom.desconto > 0) writeRow("Descontos:", `- ${formatBRL(cupom.desconto)}`);
  y += 1;
  writeRow("TOTAL", formatBRL(cupom.total), 11, true);
  sep();

  writeRow("Pagamento:", FORMA_LABEL[cupom.forma] ?? cupom.forma, 8, true);
  writeRow("Status:", STATUS_LABEL[cupom.status] ?? cupom.status, 8, true);
  if (cupom.troco > 0) {
    writeRow(
      "Recebido:",
      formatBRL(cupom.valorRecebido ?? cupom.total + cupom.troco),
    );
    writeRow("TROCO:", formatBRL(cupom.troco), 9, true);
  }
  if (cupom.observacao) {
    sep();
    writeLine(`Obs.: ${cupom.observacao}`, 7);
  }
  sep();
  writeCenter("Obrigado pela preferencia!", 8);
  writeCenter("Volte sempre.", 8);

  return doc;
}

function safeFileName(numero: string | null): string {
  const base = (numero ?? "cupom").toString().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `cupom_${base}.pdf`;
}

const LAST_DIR_KEY = "gp.cupomPdf.lastDir.v1";

function getLastDir(): string | null {
  try {
    return localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

function setLastDir(fullPath: string) {
  try {
    // Extrai diretório do path completo (suporta / e \).
    const idx = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
    if (idx > 0) localStorage.setItem(LAST_DIR_KEY, fullPath.slice(0, idx));
  } catch {}
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${file}` : `${dir}${sep}${file}`;
}

/**
 * Salva PDF do cupom.
 * - Desktop/Tauri: abre diálogo nativo de salvar e grava com fs.
 *   Lembra a última pasta usada (localStorage) e sugere para a próxima venda.
 * - Web: download via blob + <a download>.
 */
export async function salvarCupomPdf(
  empresa: ConfigEmpresa | null,
  cupom: CupomData,
): Promise<{ ok: boolean; cancelled?: boolean; error?: string; path?: string }> {
  const doc = gerarPdfCupom(empresa, cupom);
  const fileName = safeFileName(cupom.numero);

  if (isDesktop()) {
    try {
      const dialogMod = (await import(
        /* @vite-ignore */ "@tauri-apps/plugin-dialog"
      )) as typeof import("@tauri-apps/plugin-dialog");
      const fsMod = (await import(
        /* @vite-ignore */ "@tauri-apps/plugin-fs"
      )) as typeof import("@tauri-apps/plugin-fs");

      const lastDir = getLastDir();
      const defaultPath = lastDir ? joinPath(lastDir, fileName) : fileName;

      const path = await dialogMod.save({
        title: "Salvar PDF do cupom",
        defaultPath,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return { ok: false, cancelled: true };

      const arrayBuffer = doc.output("arraybuffer");
      await fsMod.writeFile(path as string, new Uint8Array(arrayBuffer));
      setLastDir(path as string);
      return { ok: true, path: path as string };
    } catch (e) {
      console.error("[cupom-pdf] erro ao salvar PDF nativo", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Web fallback: download direto.
  try {
    doc.save(fileName);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
