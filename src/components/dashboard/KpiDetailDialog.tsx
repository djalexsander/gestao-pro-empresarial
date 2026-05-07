import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ExportFormatDialog } from "@/components/shared/ExportFormatDialog";
import {
  exportarRelatorioCard,
  type ExportFormato,
} from "@/lib/export-relatorio-card";
import type { CsvColumn } from "@/lib/export-csv";
import { dataClient } from "@/integrations/data";
import { useAuth } from "@/components/auth/AuthProvider";

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

export type KpiTipo =
  | "vendas"
  | "compras"
  | "lucro"
  | "contas-pagar"
  | "contas-receber"
  | "estoque-baixo";

interface KpiDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: KpiTipo | null;
  periodo: { inicio: string; fim: string; label: string };
}

interface ResumoItem {
  label: string;
  valor: string;
  tone?: "success" | "danger" | "warning" | "info" | "muted";
}

const TITULOS: Record<KpiTipo, string> = {
  vendas: "Vendas do mês",
  compras: "Compras do mês",
  lucro: "Lucro do mês",
  "contas-pagar": "Contas a pagar",
  "contas-receber": "Contas a receber",
  "estoque-baixo": "Estoque baixo",
};

const DESCRICOES: Record<KpiTipo, string> = {
  vendas: "Vendas finalizadas no período selecionado.",
  compras: "Compras registradas no período selecionado.",
  lucro: "Resumo de receitas, custos e margem do período.",
  "contas-pagar": "Lançamentos de despesa em aberto.",
  "contas-receber": "Lançamentos de receita em aberto.",
  "estoque-baixo": "Produtos com saldo abaixo do estoque mínimo.",
};

interface DetalheRow {
  identificador: string;
  data: string | null;
  descricao: string;
  valor: number;
  status: string;
}

export function KpiDetailDialog({
  open,
  onOpenChange,
  tipo,
  periodo,
}: KpiDetailDialogProps) {
  const { user } = useAuth();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: ["dashboard-kpi", tipo, user?.id, periodo.inicio, periodo.fim],
    enabled: !!user && !!tipo && open,
    queryFn: async (): Promise<{ rows: DetalheRow[]; resumo: ResumoItem[] }> => {
      if (!tipo) return { rows: [], resumo: [] };
      return await dataClient.dashboard.kpiDetalhe({
        tipo,
        inicio: periodo.inicio,
        fim: periodo.fim,
      });
    },
  });

  const { rows = [], resumo = [] } = query.data ?? {};

  const colunasTabela = useMemo(() => {
    if (!tipo) return null;
    if (tipo === "estoque-baixo") {
      return ["SKU", "Produto", "Saldo", "Status"] as const;
    }
    if (tipo === "lucro") {
      return ["Mês", "Detalhe", "Lucro", "Resultado"] as const;
    }
    if (tipo === "contas-pagar" || tipo === "contas-receber") {
      return ["Vencimento", "Descrição", "Contraparte", "Valor", "Status"] as const;
    }
    return ["Número", "Data", "Cliente / Fornecedor", "Valor", "Status"] as const;
  }, [tipo]);

  async function exportar(formato: ExportFormato) {
    if (!tipo) return;
    setExporting(true);
    toast.loading("Gerando exportação...", { id: "export-kpi" });
    try {
      const isEstoque = tipo === "estoque-baixo";
      const isFin = tipo === "contas-pagar" || tipo === "contas-receber";
      const isLucro = tipo === "lucro";

      const columns: CsvColumn<DetalheRow>[] = isEstoque
        ? [
            { header: "SKU", accessor: (r) => r.identificador, type: "text" },
            { header: "Produto", accessor: (r) => r.descricao, type: "text" },
            { header: "Saldo", accessor: (r) => r.valor, type: "number" },
            { header: "Status", accessor: (r) => r.status, type: "text" },
          ]
        : isLucro
          ? [
              { header: "Mês", accessor: (r) => r.identificador, type: "text" },
              { header: "Detalhe", accessor: (r) => r.descricao, type: "text" },
              { header: "Lucro", accessor: (r) => r.valor, type: "currency" },
              { header: "Resultado", accessor: (r) => r.status, type: "text" },
            ]
          : isFin
            ? [
                { header: "Vencimento", accessor: (r) => r.data ?? "", type: "date" },
                { header: "Descrição", accessor: (r) => r.descricao, type: "text" },
                { header: "Contraparte", accessor: (r) => r.identificador, type: "text" },
                { header: "Valor", accessor: (r) => r.valor, type: "currency" },
                { header: "Status", accessor: (r) => r.status, type: "text" },
              ]
            : [
                { header: "Número", accessor: (r) => r.identificador, type: "text" },
                { header: "Data", accessor: (r) => r.data ?? "", type: "datetime" },
                {
                  header: "Cliente / Fornecedor",
                  accessor: (r) => r.descricao,
                  type: "text",
                },
                { header: "Valor", accessor: (r) => r.valor, type: "currency" },
                { header: "Status", accessor: (r) => r.status, type: "text" },
              ];

      await exportarRelatorioCard(formato, {
        prefix: `dashboard_${tipo}`,
        titulo: `Dashboard — ${TITULOS[tipo]}`,
        periodo: periodo.label,
        resumo: resumo.map((r) => ({ label: r.label, valor: r.valor, tone: r.tone })),
        rows,
        columns,
      });
      toast.success("Exportação concluída.", { id: "export-kpi" });
      setExportOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.", {
        id: "export-kpi",
      });
    } finally {
      setExporting(false);
    }
  }

  const titulo = tipo ? TITULOS[tipo] : "";
  const descricao = tipo ? DESCRICOES[tipo] : "";

  function formatDataCelula(d: string | null) {
    if (!d) return "—";
    const date = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toLocaleDateString("pt-BR");
  }

  function formatValorCelula(tipo: KpiTipo, valor: number) {
    if (tipo === "estoque-baixo") return valor.toLocaleString("pt-BR");
    return formatBRL(valor);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>
              {descricao} {periodo.label ? `Período: ${periodo.label}` : null}
            </DialogDescription>
          </DialogHeader>

          {/* Resumo */}
          {resumo.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {resumo.map((r) => (
                <div
                  key={r.label}
                  className="rounded-lg border bg-card/40 p-3"
                >
                  <p className="text-xs text-muted-foreground">{r.label}</p>
                  <p
                    className={
                      r.tone === "danger"
                        ? "mt-1 text-base font-semibold text-destructive"
                        : r.tone === "success"
                          ? "mt-1 text-base font-semibold text-success"
                          : r.tone === "warning"
                            ? "mt-1 text-base font-semibold text-warning-foreground"
                            : "mt-1 text-base font-semibold text-foreground"
                    }
                  >
                    {r.valor}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Tabela */}
          <ScrollArea className="max-h-[50vh] rounded-md border">
            {query.isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando dados...
              </div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nenhum registro encontrado.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {colunasTabela?.map((c, i) => (
                      <TableHead
                        key={c}
                        className={
                          i === (colunasTabela?.length ?? 0) - 2 ? "text-right" : ""
                        }
                      >
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((r, idx) => {
                    if (tipo === "estoque-baixo") {
                      return (
                        <TableRow key={`${r.identificador}-${idx}`}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {r.identificador}
                          </TableCell>
                          <TableCell className="font-medium">{r.descricao}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatValorCelula(tipo, r.valor)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (tipo === "lucro") {
                      return (
                        <TableRow key={`${r.identificador}-${idx}`}>
                          <TableCell className="font-mono text-xs">{r.identificador}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.descricao}
                          </TableCell>
                          <TableCell
                            className={
                              r.valor >= 0
                                ? "text-right font-medium text-success tabular-nums"
                                : "text-right font-medium text-destructive tabular-nums"
                            }
                          >
                            {formatBRL(r.valor)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (tipo === "contas-pagar" || tipo === "contas-receber") {
                      return (
                        <TableRow key={`${r.identificador}-${idx}`}>
                          <TableCell className="text-xs">{formatDataCelula(r.data)}</TableCell>
                          <TableCell className="font-medium">{r.descricao}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.identificador}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatBRL(r.valor)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow key={`${r.identificador}-${idx}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.identificador}
                        </TableCell>
                        <TableCell className="text-xs">{formatDataCelula(r.data)}</TableCell>
                        <TableCell className="font-medium">{r.descricao}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatBRL(r.valor)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
          {rows.length > 100 && (
            <p className="text-xs text-muted-foreground">
              Exibindo os primeiros 100 registros. A exportação inclui todos os {rows.length} itens.
            </p>
          )}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              className="gap-1.5"
              disabled={exporting || query.isLoading || rows.length === 0}
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportFormatDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        titulo={`Dashboard — ${titulo}`}
        loading={exporting}
        onChoose={(f) => exportar(f)}
      />
    </>
  );
}
