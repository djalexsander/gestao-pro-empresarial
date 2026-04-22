import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Loader2,
  X,
  CheckCircle2,
  Package,
  Wallet,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useCancelarVenda, type CancelarVendaResumo } from "@/hooks/useVendas";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface CancelarVendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venda: { id: string; numero: string; total: number } | null;
  onCancelled?: () => void;
}

export function CancelarVendaDialog({
  open,
  onOpenChange,
  venda,
  onCancelled,
}: CancelarVendaDialogProps) {
  const [motivo, setMotivo] = useState("");
  const [resumo, setResumo] = useState<CancelarVendaResumo | null>(null);
  const cancelar = useCancelarVenda();

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      // Aguarda animação do dialog antes de limpar
      const t = setTimeout(() => {
        setMotivo("");
        setResumo(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  function handleConfirmar() {
    if (!venda) return;
    cancelar.mutate(
      { venda_id: venda.id, motivo: motivo || null },
      {
        onSuccess: (resultado) => {
          setResumo(resultado);
          toast.success(
            `Venda ${resultado.numero} cancelada — ${resultado.qtd_itens_estornados} ${
              resultado.qtd_itens_estornados === 1 ? "item estornado" : "itens estornados"
            }.`,
          );
        },
      },
    );
  }

  function handleClose() {
    onOpenChange(false);
    if (resumo) onCancelled?.();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !cancelar.isPending && onOpenChange(o)}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        {!resumo ? (
          // ========== ETAPA 1: Confirmação ==========
          <>
            <DialogHeader className="px-6 pt-6">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <DialogTitle className="text-center">
                Cancelar venda {venda?.numero ?? ""}?
              </DialogTitle>
              <DialogDescription className="text-center">
                Esta ação irá reverter automaticamente:
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-6 py-4">
              <ul className="mx-auto max-w-sm space-y-2 text-sm">
                <ReversaoItem icon={Package}>
                  Estoque dos itens vendidos (lançado como devolução)
                </ReversaoItem>
                <ReversaoItem icon={Wallet}>
                  Lançamentos financeiros vinculados à venda
                </ReversaoItem>
                <ReversaoItem icon={X}>
                  Marca a venda como <strong className="text-foreground">cancelada</strong>
                </ReversaoItem>
                <ReversaoItem icon={ShieldCheck}>
                  Registra a operação em auditoria
                </ReversaoItem>
              </ul>

              {venda && (
                <div className="mx-auto rounded-md border border-border bg-muted/30 px-4 py-2 text-center">
                  <p className="text-xs uppercase text-muted-foreground">
                    Total da venda
                  </p>
                  <p className="font-mono text-lg font-bold tabular-nums">
                    {formatBRL(venda.total)}
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="motivo" className="mb-1.5 text-xs">
                  Motivo do cancelamento (opcional)
                </Label>
                <Textarea
                  id="motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="Ex.: Cliente desistiu, erro de operação..."
                  className="resize-none text-sm"
                  disabled={cancelar.isPending}
                />
              </div>
            </div>

            <DialogFooter className="gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={cancelar.isPending}
              >
                Voltar
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmar}
                disabled={cancelar.isPending}
              >
                {cancelar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                {cancelar.isPending ? "Estornando..." : "Confirmar cancelamento"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          // ========== ETAPA 2: Resumo do estorno ==========
          <>
            <DialogHeader className="border-b border-border bg-success/10 px-6 py-5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/20 text-success">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <DialogTitle className="text-center">
                Venda {resumo.numero} cancelada
              </DialogTitle>
              <DialogDescription className="text-center">
                Tudo foi estornado com sucesso.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
              {/* Métricas resumidas */}
              <div className="grid grid-cols-3 gap-2">
                <Metric
                  label="Itens estornados"
                  value={resumo.qtd_itens_estornados}
                  sub={`${resumo.qtd_total_estornada.toLocaleString("pt-BR")} un.`}
                  icon={Package}
                  tone="success"
                />
                <Metric
                  label="Lanç. cancelados"
                  value={resumo.qtd_lancamentos_cancelados}
                  sub={formatBRL(resumo.total_lancamentos_cancelados)}
                  icon={Wallet}
                  tone="warning"
                />
                <Metric
                  label="Total da venda"
                  value={formatBRL(resumo.total)}
                  sub="estornado"
                  icon={X}
                  tone="muted"
                />
              </div>

              {/* Itens devolvidos ao estoque */}
              {resumo.itens_estornados.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Package className="h-3.5 w-3.5" /> Itens devolvidos ao
                    estoque
                  </h4>
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Produto</th>
                          <th className="px-3 py-2 text-center">Qtd</th>
                          <th className="px-3 py-2 text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumo.itens_estornados.map((it) => (
                          <tr
                            key={it.produto_id}
                            className="border-t border-border/60"
                          >
                            <td className="px-3 py-2 font-medium">
                              {it.produto_nome}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Badge
                                variant="outline"
                                className="border-success/40 bg-success/10 text-success tabular-nums"
                              >
                                + {it.quantidade}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                              {it.saldo_anterior.toLocaleString("pt-BR")}{" "}
                              <ArrowRight className="inline h-3 w-3" />{" "}
                              <span className="font-medium text-foreground">
                                {it.saldo_posterior.toLocaleString("pt-BR")}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Lançamentos financeiros */}
              {resumo.lancamentos_cancelados.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Wallet className="h-3.5 w-3.5" /> Lançamentos financeiros
                    cancelados
                  </h4>
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Descrição</th>
                          <th className="px-3 py-2 text-center">Status ant.</th>
                          <th className="px-3 py-2 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumo.lancamentos_cancelados.map((l) => (
                          <tr key={l.id} className="border-t border-border/60">
                            <td className="px-3 py-2 font-medium">
                              {l.descricao}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Badge
                                variant="outline"
                                className="capitalize text-xs"
                              >
                                {l.status_anterior}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {formatBRL(l.valor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {resumo.itens_estornados.length === 0 &&
                resumo.lancamentos_cancelados.length === 0 && (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    Nenhum item ou lançamento vinculado para estornar.
                  </p>
                )}

              {resumo.motivo && (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Motivo registrado
                  </p>
                  <p className="mt-1 text-sm">{resumo.motivo}</p>
                </div>
              )}

              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Operação registrada em
                auditoria ·{" "}
                {new Date(resumo.cancelado_em).toLocaleString("pt-BR")}
              </p>
            </div>

            <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
              <Button onClick={handleClose} className="w-full sm:w-auto">
                <CheckCircle2 className="h-4 w-4" /> Concluir
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReversaoItem({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
      <span>{children}</span>
    </li>
  );
}

function Metric({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "success" | "warning" | "muted";
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/30 bg-warning/5 text-warning",
    muted: "border-border bg-muted/30 text-muted-foreground",
  };
  return (
    <div className={cn("rounded-md border p-2.5 text-center", toneClasses[tone])}>
      <Icon className="mx-auto h-4 w-4" />
      <p className="mt-1 font-mono text-base font-bold tabular-nums text-foreground">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}
