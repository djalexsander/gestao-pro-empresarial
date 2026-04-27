// Exportação do relatório final de QA (PDF e PNG via Canvas 2D nativo).
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  renderReportCanvas,
  downloadCanvasAsPng,
  type CanvasResumoCard,
} from "@/lib/export-png-canvas";
import { fetchEmpresaHeader } from "@/lib/export-empresa-header";
import type {
  QaItem,
  QaModulo,
  QaAvaliacao,
  QaResumoStatus,
  QaValidacao,
} from "@/hooks/useQa";

function tsFilename(prefix: string, ext: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `qa_${prefix}_${y}-${m}-${day}.${ext}`;
}

function statusLabel(s: QaResumoStatus["statusLancamento"]): string {
  switch (s) {
    case "pronto": return "Pronto para lançamento";
    case "ressalvas": return "Pronto com ressalvas";
    case "nao_recomendado": return "Não recomendado para lançamento";
    default: return "Indefinido";
  }
}

const STATUS_PT: Record<string, string> = {
  ok: "OK",
  leve: "Problema leve",
  medio: "Problema médio",
  critico: "Problema crítico",
  nao_testado: "Não testado",
};

export function exportarRelatorioQaPDF(opts: {
  validacao: QaValidacao;
  modulos: QaModulo[];
  itens: QaItem[];
  avaliacoes: QaAvaliacao[];
  resumo: QaResumoStatus;
}) {
  const { validacao, modulos, itens, avaliacoes, resumo } = opts;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Relatório de QA — Validação de Lançamento", 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(validacao.titulo, 14, 25);
  doc.text(
    `Responsável: ${validacao.responsavel_nome ?? "—"} · Início: ${new Date(validacao.iniciada_em).toLocaleString("pt-BR")}`,
    14,
    30,
  );
  doc.setTextColor(0);

  // Bloco de resumo
  autoTable(doc, {
    startY: 36,
    head: [["Indicador", "Valor"]],
    body: [
      ["Status final", statusLabel(resumo.statusLancamento)],
      ["Conclusão", `${resumo.pctConcluido}%`],
      ["Total de testes", String(resumo.total)],
      ["OK", String(resumo.ok)],
      ["Problemas leves", String(resumo.leve)],
      ["Problemas médios", String(resumo.medio)],
      ["Problemas críticos", String(resumo.critico)],
      ["Não testados", String(resumo.naoTestado)],
    ],
    theme: "grid",
    headStyles: { fillColor: [40, 40, 40] },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
  });

  // @ts-expect-error lastAutoTable injetado pelo autotable
  let cursor = doc.lastAutoTable.finalY + 8;

  const mapAv = new Map(avaliacoes.map((a) => [a.item_id, a]));

  // Tabela por módulo
  for (const mod of modulos) {
    const itensMod = itens.filter((i) => i.modulo_id === mod.id);
    if (itensMod.length === 0) continue;

    if (cursor > 250) {
      doc.addPage();
      cursor = 18;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(mod.nome, 14, cursor);
    cursor += 4;

    autoTable(doc, {
      startY: cursor,
      head: [["Item", "Crítico", "Status", "Observação"]],
      body: itensMod.map((it) => {
        const av = mapAv.get(it.id);
        return [
          it.titulo,
          it.critico ? "Sim" : "—",
          STATUS_PT[av?.status ?? "nao_testado"] ?? "—",
          av?.observacao ?? "",
        ];
      }),
      theme: "striped",
      headStyles: { fillColor: [30, 80, 160] },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 18, halign: "center" },
        2: { cellWidth: 32 },
        3: { cellWidth: "auto" },
      },
      margin: { left: 14, right: 14 },
    });
    // @ts-expect-error lastAutoTable
    cursor = doc.lastAutoTable.finalY + 6;
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    14,
    doc.internal.pageSize.getHeight() - 8,
  );

  doc.save(tsFilename(slug(validacao.titulo), "pdf"));
}

export async function exportarRelatorioQaPNG(element: HTMLElement, prefixo: string) {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>("[data-radix-scroll-area-viewport]").forEach((el) => {
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    el.style.height = "auto";
  });
  clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.style.maxHeight) el.style.maxHeight = "none";
  });
  clone.querySelectorAll<HTMLElement>("[data-radix-scroll-area-scrollbar]").forEach((el) => {
    el.style.display = "none";
  });

  const fullWidth = Math.max(element.scrollWidth, element.offsetWidth, 1024);
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "-99999px";
  wrapper.style.width = `${fullWidth}px`;
  wrapper.style.background = PRINT_THEME.bg;
  wrapper.style.padding = "24px";
  wrapper.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  clone.style.width = "100%";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  applyPrintTheme(wrapper);
  await waitForRenderReady();

  try {
    const dataUrl = await toPng(wrapper, {
      pixelRatio: 2,
      backgroundColor: PRINT_THEME.bg,
      cacheBust: true,
      width: wrapper.scrollWidth,
      height: wrapper.scrollHeight,
      style: { transform: "none" },
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = tsFilename(slug(prefixo), "png");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    document.body.removeChild(wrapper);
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
