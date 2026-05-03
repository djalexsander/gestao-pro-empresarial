// Exportação do relatório final de QA (PDF e PNG via Canvas 2D nativo).
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  renderReportCanvas,
  downloadCanvasAsPng,
  type CanvasResumoCard,
} from "@/lib/export-png-canvas";
import { saveBytes } from "@/lib/desktop-save";
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

  void saveBytes(
    new Uint8Array(doc.output("arraybuffer")),
    tsFilename(slug(validacao.titulo), "pdf"),
    "application/pdf",
  );
}

export async function exportarRelatorioQaPNG(opts: {
  validacao: QaValidacao;
  modulos: QaModulo[];
  itens: QaItem[];
  avaliacoes: QaAvaliacao[];
  resumo: QaResumoStatus;
}) {
  const { validacao, modulos, itens, avaliacoes, resumo } = opts;
  const empresa = await fetchEmpresaHeader();
  const exportadoEm = new Date();
  const mapAv = new Map(avaliacoes.map((a) => [a.item_id, a]));

  // Cards de resumo
  const cards: CanvasResumoCard[] = [
    { label: "Status final", valor: statusLabel(resumo.statusLancamento), tone:
        resumo.statusLancamento === "pronto" ? "success"
        : resumo.statusLancamento === "ressalvas" ? "warning"
        : resumo.statusLancamento === "nao_recomendado" ? "danger" : "muted" },
    { label: "Conclusão", valor: `${resumo.pctConcluido}%`, tone: "info" },
    { label: "Total", valor: String(resumo.total) },
    { label: "OK", valor: String(resumo.ok), tone: "success" },
    { label: "Críticos", valor: String(resumo.critico), tone: "danger" },
    { label: "Não testados", valor: String(resumo.naoTestado), tone: "muted" },
  ];

  // Tabela única com todos os itens, agrupados por módulo (prefixo na coluna)
  const rows: string[][] = [];
  for (const mod of modulos) {
    const itensMod = itens.filter((i) => i.modulo_id === mod.id);
    if (itensMod.length === 0) continue;
    for (const it of itensMod) {
      const av = mapAv.get(it.id);
      rows.push([
        mod.nome,
        it.titulo,
        it.critico ? "Sim" : "—",
        STATUS_PT[av?.status ?? "nao_testado"] ?? "—",
        av?.observacao ?? "",
      ]);
    }
  }

  const canvas = await renderReportCanvas({
    empresa,
    titulo: "Relatório de QA — Validação de Lançamento",
    subtitulo: validacao.titulo,
    origem: validacao.responsavel_nome
      ? `Responsável: ${validacao.responsavel_nome}`
      : null,
    periodo: `Iniciada em ${new Date(validacao.iniciada_em).toLocaleString("pt-BR")}`,
    exportadoEm,
    resumo: cards,
    tabela: {
      columns: [
        { header: "Módulo", weight: 1.2 },
        { header: "Item", weight: 2.4 },
        { header: "Crítico", align: "center", weight: 0.5 },
        { header: "Status", weight: 1 },
        { header: "Observação", weight: 2 },
      ],
      rows,
      emptyMessage: "Nenhum item avaliado.",
    },
  });

  downloadCanvasAsPng(canvas, tsFilename(slug(validacao.titulo), "png"));
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
