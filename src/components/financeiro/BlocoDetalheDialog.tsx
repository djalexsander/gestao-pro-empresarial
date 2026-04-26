import { useRef } from "react";
import { Download, FileImage, FileText, Sheet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import {
  exportarBlocoCSV,
  exportarBlocoPDF,
  exportarBlocoPNG,
} from "@/lib/export-bloco";
import type { CsvColumn } from "@/lib/export-csv";

export interface DetalheRow {
  [key: string]: string | number | null | undefined;
}

export interface DetalheColumn {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  format?: "currency" | "date" | "datetime" | "text" | "number";
  width?: string;
}

export interface BlocoDetalheProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  subtitulo?: string;
  origem: string; // ex: "Vendas finalizadas no mês"
  resumo: { label: string; valor: string; tone?: "success" | "danger" | "info" | "muted" }[];
  colunas: DetalheColumn[];
  rows: DetalheRow[];
  emptyMessage?: string;
  alertaSemCusto?: { qtd: number; total: number } | null;
}

function formatDateBR(d: string | null | undefined): string {
  if (!d) return "—";
  if (d.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.slice(0, 10).split("-");
    return `${day}/${m}/${y}`;
  }
  return d;
}

function formatDateTimeBR(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function formatCell(value: unknown, fmt?: DetalheColumn["format"]): string {
  if (value == null || value === "") return "—";
  switch (fmt) {
    case "currency":
      return formatBRL(Number(value) || 0);
    case "date":
      return formatDateBR(String(value));
    case "datetime":
      return formatDateTimeBR(String(value));
    case "number":
      return String(value);
    default:
      return String(value);
  }
}

const toneClass: Record<string, string> = {
  success: "text-success",
  danger: "text-destructive",
  info: "text-info",
  muted: "text-muted-foreground",
};

export function BlocoDetalheDialog({
  open,
  onOpenChange,
  titulo,
  subtitulo,
  origem,
  resumo,
  colunas,
  rows,
  emptyMessage = "Sem dados para exibir.",
  alertaSemCusto,
}: BlocoDetalheProps) {
  const conteudoRef = useRef<HTMLDivElement>(null);

  const csvCols: CsvColumn<DetalheRow>[] = colunas.map((c) => ({
    header: c.header,
    accessor: (r) => (r[c.key] ?? "") as string | number,
    type:
      c.format === "currency"
        ? "currency"
        : c.format === "date"
          ? "date"
          : c.format === "datetime"
            ? "datetime"
            : c.format === "number"
              ? "number"
              : "text",
  }));

  const handleCSV = () => exportarBlocoCSV(titulo, rows, csvCols);

  const handlePDF = () =>
    exportarBlocoPDF({
      titulo,
      subtitulo: subtitulo ?? origem,
      resumo: resumo.map((r) => ({ label: r.label, valor: r.valor })),
      tabela:
        rows.length > 0
          ? {
              header: colunas.map((c) => c.header),
              rows,
              formatRow: (r) =>
                colunas.map((c) => formatCell(r[c.key], c.format)),
            }
          : undefined,
    });

  const handlePNG = async () => {
    if (conteudoRef.current) {
      await exportarBlocoPNG(conteudoRef.current, titulo);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {subtitulo && <DialogDescription>{subtitulo}</DialogDescription>}
        </DialogHeader>

        <div ref={conteudoRef} className="space-y-4 bg-background p-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-normal">
              Origem: {origem}
            </Badge>
            <span>· {rows.length} item(ns)</span>
          </div>

          {resumo.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {resumo.map((r) => (
                <div
                  key={r.label}
                  className="rounded-md border border-border bg-card/40 p-3"
                >
                  <p className="text-xs text-muted-foreground">{r.label}</p>
                  <p
                    className={cn(
                      "mt-1 font-mono text-base font-semibold tabular-nums",
                      r.tone && toneClass[r.tone],
                    )}
                  >
                    {r.valor}
                  </p>
                </div>
              ))}
            </div>
          )}

          {alertaSemCusto && alertaSemCusto.qtd > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium text-warning-foreground">
                ⚠ {alertaSemCusto.qtd} item(ns) sem custo cadastrado
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Esses itens entram com custo R$ 0,00. O lucro pode estar superestimado em
                até {formatBRL(alertaSemCusto.total)}.
              </p>
            </div>
          )}

          <ScrollArea className="max-h-[50vh] rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {colunas.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                      )}
                      style={c.width ? { width: c.width } : undefined}
                    >
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={colunas.length}
                      className="py-6 text-center text-muted-foreground"
                    >
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, idx) => (
                    <TableRow key={String(row.id ?? idx)}>
                      {colunas.map((c) => (
                        <TableCell
                          key={c.key}
                          className={cn(
                            c.align === "right" && "text-right tabular-nums",
                            c.align === "center" && "text-center",
                            c.format === "currency" && "font-medium",
                          )}
                        >
                          {formatCell(row[c.key], c.format)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>

        <DialogFooter className="flex flex-row justify-between gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Download className="h-4 w-4" />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCSV} className="gap-2">
                <Sheet className="h-4 w-4" />
                CSV (Excel)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePDF} className="gap-2">
                <FileText className="h-4 w-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePNG} className="gap-2">
                <FileImage className="h-4 w-4" />
                PNG (imagem)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
