/**
 * Botão reutilizável "Exportar" para blocos tabulares do Financeiro.
 * Suporta CSV/PDF/PNG via `exportarRelatorioCard` com cabeçalho institucional.
 */
import { useState } from "react";
import { Download, FileText, FileSpreadsheet, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportarRelatorioCard, type ExportFormato } from "@/lib/export-relatorio-card";
import type { CsvColumn } from "@/lib/export-csv";
import type { CanvasResumoCard } from "@/lib/export-png-canvas";

interface Props<T> {
  prefix: string;
  titulo: string;
  periodo?: string | null;
  rows: T[];
  columns: CsvColumn<T>[];
  resumo?: { label: string; valor: string; tone?: CanvasResumoCard["tone"] }[];
  disabled?: boolean;
  label?: string;
}

export function ExportTabelaButton<T>({
  prefix,
  titulo,
  periodo,
  rows,
  columns,
  resumo,
  disabled,
  label = "Exportar",
}: Props<T>) {
  const [busy, setBusy] = useState(false);

  async function handle(formato: ExportFormato) {
    if (rows.length === 0) {
      toast.info("Nada para exportar.");
      return;
    }
    setBusy(true);
    toast.loading("Gerando exportação...", { id: `export-${prefix}` });
    try {
      await exportarRelatorioCard(formato, {
        prefix,
        titulo,
        periodo: periodo ?? null,
        resumo,
        rows,
        columns,
      });
      toast.success("Exportação concluída.", { id: `export-${prefix}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.", {
        id: `export-${prefix}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2.5 text-xs"
          disabled={disabled || busy}
        >
          <Download className="h-3.5 w-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => handle("csv")}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Exportar CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handle("pdf")}>
          <FileText className="mr-2 h-4 w-4" />
          Exportar PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handle("png")}>
          <ImageIcon className="mr-2 h-4 w-4" />
          Exportar PNG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
