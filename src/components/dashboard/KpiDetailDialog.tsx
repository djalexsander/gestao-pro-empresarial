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
import { supabase } from "@/integrations/supabase/client";
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

      const inicioISO = periodo.inicio;
      const fimISO = periodo.fim;

      if (tipo === "vendas") {
        const { data: vendas } = await supabase
          .from("vendas")
          .select("id, numero, total, status, data_emissao, cliente_id")
          .gte("data_emissao", inicioISO)
          .lte("data_emissao", fimISO)
          .neq("status", "cancelada")
          .order("data_emissao", { ascending: false });
        const ids = [
          ...new Set((vendas ?? []).map((v) => v.cliente_id).filter(Boolean) as string[]),
        ];
        const { data: clientes } = ids.length
          ? await supabase.from("clientes").select("id, nome").in("id", ids)
          : { data: [] as { id: string; nome: string }[] };
        const map = new Map((clientes ?? []).map((c) => [c.id, c.nome]));
        const rows: DetalheRow[] = (vendas ?? []).map((v) => ({
          identificador: v.numero,
          data: v.data_emissao,
          descricao: v.cliente_id ? (map.get(v.cliente_id) ?? "—") : "Consumidor",
          valor: Number(v.total ?? 0),
          status: v.status,
        }));
        const total = rows.reduce((s, r) => s + r.valor, 0);
        return {
          rows,
          resumo: [
            { label: "Total vendido", valor: formatBRL(total), tone: "success" },
            { label: "Quantidade de vendas", valor: String(rows.length), tone: "info" },
            {
              label: "Ticket médio",
              valor: formatBRL(rows.length ? total / rows.length : 0),
              tone: "info",
            },
          ],
        };
      }

      if (tipo === "compras") {
        const { data: compras } = await supabase
          .from("compras")
          .select("id, numero, total, status, data_emissao, fornecedor_id")
          .gte("data_emissao", inicioISO)
          .lte("data_emissao", fimISO)
          .order("data_emissao", { ascending: false });
        const ids = [
          ...new Set(
            (compras ?? []).map((c) => c.fornecedor_id).filter(Boolean) as string[],
          ),
        ];
        const { data: forn } = ids.length
          ? await supabase
              .from("fornecedores")
              .select("id, razao_social, nome_fantasia")
              .in("id", ids)
          : { data: [] as { id: string; razao_social: string; nome_fantasia: string | null }[] };
        const map = new Map(
          (forn ?? []).map((f) => [f.id, f.nome_fantasia || f.razao_social]),
        );
        const rows: DetalheRow[] = (compras ?? []).map((c) => ({
          identificador: c.numero,
          data: c.data_emissao,
          descricao: c.fornecedor_id ? (map.get(c.fornecedor_id) ?? "—") : "—",
          valor: Number(c.total ?? 0),
          status: c.status,
        }));
        const total = rows.reduce((s, r) => s + r.valor, 0);
        return {
          rows,
          resumo: [
            { label: "Total comprado", valor: formatBRL(total), tone: "info" },
            { label: "Quantidade de compras", valor: String(rows.length), tone: "info" },
          ],
        };
      }

      if (tipo === "lucro") {
        const [vendasRes, comprasRes] = await Promise.all([
          supabase
            .from("vendas")
            .select("total, data_emissao")
            .gte("data_emissao", inicioISO)
            .lte("data_emissao", fimISO)
            .neq("status", "cancelada"),
          supabase
            .from("compras")
            .select("total, data_emissao")
            .gte("data_emissao", inicioISO)
            .lte("data_emissao", fimISO),
        ]);
        const totalVendas = (vendasRes.data ?? []).reduce(
          (s, v) => s + Number(v.total ?? 0),
          0,
        );
        const totalCompras = (comprasRes.data ?? []).reduce(
          (s, c) => s + Number(c.total ?? 0),
          0,
        );
        const lucro = totalVendas - totalCompras;
        const margem = totalVendas > 0 ? (lucro / totalVendas) * 100 : 0;
        // Linha por mês (até 6 meses do período)
        const porMes = new Map<string, { vendas: number; compras: number }>();
        for (const v of vendasRes.data ?? []) {
          const d = new Date(v.data_emissao);
          const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const ref = porMes.get(k) ?? { vendas: 0, compras: 0 };
          ref.vendas += Number(v.total ?? 0);
          porMes.set(k, ref);
        }
        for (const c of comprasRes.data ?? []) {
          const d = new Date(c.data_emissao);
          const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const ref = porMes.get(k) ?? { vendas: 0, compras: 0 };
          ref.compras += Number(c.total ?? 0);
          porMes.set(k, ref);
        }
        const rows: DetalheRow[] = Array.from(porMes.entries())
          .sort(([a], [b]) => (a < b ? 1 : -1))
          .map(([k, val]) => {
            const lucroMes = val.vendas - val.compras;
            return {
              identificador: k,
              data: `${k}-01`,
              descricao: `Vendas ${formatBRL(val.vendas)} · Compras ${formatBRL(val.compras)}`,
              valor: lucroMes,
              status: lucroMes >= 0 ? "lucro" : "prejuizo",
            };
          });
        return {
          rows,
          resumo: [
            { label: "Receita total", valor: formatBRL(totalVendas), tone: "success" },
            { label: "Custo total", valor: formatBRL(totalCompras), tone: "info" },
            {
              label: "Lucro do período",
              valor: formatBRL(lucro),
              tone: lucro >= 0 ? "success" : "danger",
            },
            {
              label: "Margem",
              valor: `${margem.toFixed(1)}%`,
              tone: lucro >= 0 ? "success" : "danger",
            },
          ],
        };
      }

      if (tipo === "contas-pagar" || tipo === "contas-receber") {
        const isPagar = tipo === "contas-pagar";
        // Use the same logic as usePosicaoFinanceira: filter by data_vencimento range,
        // exclude cancelled, compute aberto = valor - valor_pago and only include aberto>0.
        const { data: lancs, error } = await supabase
          .from("financeiro_lancamentos")
          .select(
            "id, descricao, valor, valor_pago, status, data_vencimento, tipo, fornecedor_id, cliente_id, forma_pagamento, conciliado_em",
          )
          .eq("tipo", isPagar ? "pagar" : "receber")
          .gte("data_vencimento", inicioISO)
          .lte("data_vencimento", fimISO)
          .neq("status", "cancelado")
          .order("data_vencimento", { ascending: true })
          .limit(5000);
        if (error) throw error;

        const fornIds = [
          ...new Set(
            (lancs ?? []).map((l) => (l as any).fornecedor_id).filter(Boolean) as string[],
          ),
        ];
        const cliIds = [
          ...new Set((lancs ?? []).map((l) => (l as any).cliente_id).filter(Boolean) as string[]),
        ];
        const [fornRes, cliRes] = await Promise.all([
          fornIds.length
            ? supabase
                .from("fornecedores")
                .select("id, razao_social, nome_fantasia")
                .in("id", fornIds)
            : Promise.resolve({ data: [] as { id: string; razao_social: string; nome_fantasia: string | null }[] }),
          cliIds.length
            ? supabase.from("clientes").select("id, nome").in("id", cliIds)
            : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
        ]);
        const fornMap = new Map(
          (fornRes.data ?? []).map((f) => [f.id, f.nome_fantasia || f.razao_social]),
        );
        const cliMap = new Map((cliRes.data ?? []).map((c) => [c.id, c.nome]));

        const hojeStr = new Date().toISOString().slice(0, 10);
        const rows: DetalheRow[] = (lancs ?? [])
          .map((l: any) => {
            const aberto = Number(l.valor) - Number(l.valor_pago ?? 0);
            return { raw: l, aberto };
          })
          .filter((r: any) => (r.aberto ?? 0) > 0)
          .map((r: any) => {
            const l = r.raw as any;
            const aberto = r.aberto as number;
            const contraparte = isPagar
              ? l.fornecedor_id
                ? (fornMap.get(l.fornecedor_id) ?? "—")
                : "—"
              : l.cliente_id
                ? (cliMap.get(l.cliente_id) ?? "—")
                : "—";
            const venc = l.data_vencimento ?? "";
            const status = venc && venc < hojeStr ? "vencido" : l.status ?? "aberto";
            return {
              identificador: contraparte,
              data: venc,
              descricao: l.descricao,
              valor: aberto,
              status,
            } as DetalheRow;
          });
        const total = rows.reduce((s, r) => s + (r.valor ?? 0), 0);
        const vencidos = rows.filter((r) => r.status === "vencido");
        return {
          rows,
          resumo: [
            {
              label: "Total em aberto",
              valor: formatBRL(total),
              tone: isPagar ? "warning" : "success",
            },
            { label: "Quantidade", valor: String(rows.length), tone: "info" },
            {
              label: "Vencidos",
              valor: `${vencidos.length} (${formatBRL(vencidos.reduce((s, r) => s + (r.valor ?? 0), 0))})`,
              tone: vencidos.length > 0 ? "danger" : "muted",
            },
          ],
        };
      }

      // estoque-baixo
      const { data: produtos } = await supabase
        .from("produtos")
        .select("id, nome, sku, estoque_minimo, unidade")
        .eq("status", "ativo")
        .gt("estoque_minimo", 0);
      const { data: movs } = await supabase
        .from("estoque_movimentacoes")
        .select("produto_id, tipo, quantidade");
      const saldos = new Map<string, number>();
      for (const m of movs ?? []) {
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1;
        saldos.set(
          m.produto_id,
          (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade),
        );
      }
      const rows: DetalheRow[] = (produtos ?? [])
        .map((p) => {
          const saldo = saldos.get(p.id) ?? 0;
          return {
            identificador: p.sku,
            data: null,
            descricao: `${p.nome} · mín. ${p.estoque_minimo} ${p.unidade ?? ""}`.trim(),
            valor: saldo,
            status: saldo <= 0 ? "zerado" : "baixo",
            _min: Number(p.estoque_minimo),
          };
        })
        .filter((r) => r.valor <= r._min)
        .map(({ _min: _ignored, ...rest }) => rest);
      return {
        rows,
        resumo: [
          {
            label: "Produtos críticos",
            valor: String(rows.length),
            tone: rows.length > 0 ? "danger" : "muted",
          },
          {
            label: "Zerados",
            valor: String(rows.filter((r) => r.status === "zerado").length),
            tone: "warning",
          },
        ],
      };
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
        <DialogContent className="flex sm:max-w-3xl flex-col">
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
          <div className="flex-1 min-h-0">
            <ScrollArea className="flex-1 min-h-0 max-h-[60vh] rounded-md border">
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
          </div>
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
