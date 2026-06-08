import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, PowerOff, AlertTriangle } from "lucide-react";
import { useCaixaResumo, useFecharCaixa, type CaixaResumo } from "@/hooks/useCaixa";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { useHotkeys } from "@/hooks/useHotkeys";
import { OutboxPendenciasAlert } from "@/components/shared/OutboxPendenciasAlert";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caixaId: string;
  resumo: CaixaResumo | null;
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "muted";
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          tone === "success" && "text-success font-semibold",
          tone === "danger" && "text-destructive font-semibold",
          tone === "muted" && "text-muted-foreground",
          !tone && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function FecharCaixaDialog({ open, onOpenChange, caixaId, resumo }: Props) {
  const [valorInformado, setValorInformado] = useState("");
  const [observacao, setObservacao] = useState("");
  const [resumoAtual, setResumoAtual] = useState<CaixaResumo | null>(null);
  const [resumoErro, setResumoErro] = useState<string | null>(null);
  const fechar = useFecharCaixa();
  const {
    refetch: refetchResumo,
  } = useCaixaResumo(open ? caixaId : null);
  const valorRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValorInformado("");
      setObservacao("");
      setResumoAtual(null);
      setResumoErro(null);
      void refetchResumo()
        .then((result) => {
          setResumoAtual(result.data ?? null);
          if (!result.data) setResumoErro("Resumo atual do caixa não disponível.");
        })
        .catch((error) => {
          setResumoErro(error instanceof Error ? error.message : String(error));
        });
      // Foca + seleciona após o Dialog terminar a animação de abertura,
      // sempre que reabrir (não só na 1ª montagem). Dois rAFs garantem que
      // o conteúdo já esteja no DOM e o portal do Radix tenha se estabilizado.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = valorRef.current;
          if (!el) return;
          el.focus();
          el.select();
        });
      });
    }
  }, [caixaId, open, refetchResumo]);

  const resumoVisivel = open ? resumoAtual : resumo;
  const resumoCarregando = open && !resumoAtual && !resumoErro;
  const valorEsperado = resumoVisivel?.valor_esperado ?? 0;
  const informadoNum = Number(valorInformado.replace(",", "."));
  const diferenca = useMemo(() => {
    if (Number.isNaN(informadoNum) || valorInformado === "") return null;
    return informadoNum - valorEsperado;
  }, [informadoNum, valorEsperado, valorInformado]);

  const temDiferenca = diferenca !== null && Math.abs(diferenca) > 0.009;
  const exigeJustificativa = temDiferenca && observacao.trim().length === 0;

  async function confirmar() {
    if (Number.isNaN(informadoNum) || informadoNum < 0) return;
    if (valorInformado === "") return;
    if (exigeJustificativa) return;
    if (fechar.isPending) return;
    if (open && !resumoAtual) return;
    await fechar.mutateAsync({
      caixa_id: caixaId,
      valor_informado: informadoNum,
      observacao: observacao.trim() || null,
    });
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await confirmar();
  }

  // Ctrl+Enter confirma o fechamento mesmo com foco no Textarea de
  // observação (onde Enter sozinho insere quebra de linha). Escopo "modal"
  // garante prioridade sobre os atalhos do PDV subjacente.
  useHotkeys(
    [
      {
        key: "Enter",
        ctrl: true,
        allowInInputs: true,
        handler: () => {
          void confirmar();
        },
      },
    ],
    { enabled: open, scope: "modal" },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <PowerOff className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Fechar caixa</DialogTitle>
          <DialogDescription className="text-center">
            Confira os totais e informe o valor contado em dinheiro.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Alerta de pendências/erros nas filas offline (não bloqueia o fechamento) */}
          <OutboxPendenciasAlert
            contexto="Confira antes de encerrar o turno — vendas, caixa, estoque e financeiro do dia podem estar aguardando envio para a nuvem."
          />
          {/* Resumo do caixa */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Movimentação do turno
            </p>
            {resumoCarregando && (
              <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Atualizando resumo do caixa...
              </p>
            )}
            {resumoErro && (
              <p className="mb-3 flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" /> {resumoErro}
              </p>
            )}
            <div className={cn("space-y-1.5", !resumoVisivel && "hidden")}>
              <Row label="Valor inicial (fundo de troco)" value={formatBRL(resumoVisivel?.valor_inicial ?? 0)} tone="muted" />
              <Row label={`Vendas (${resumoVisivel?.qtd_vendas ?? 0})`} value={formatBRL(resumoVisivel?.total_vendas ?? 0)} />
              <Row label="Suprimento de caixa (entrou)" value={`+ ${formatBRL(resumoVisivel?.total_suprimentos ?? 0)}`} tone="success" />
              <Row label="Sangria de caixa (saiu)" value={`- ${formatBRL(resumoVisivel?.total_sangrias ?? 0)}`} tone="danger" />
            </div>

            <div className={cn("my-3 h-px bg-border", !resumoVisivel && "hidden")} />

            <p className={cn("mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground", !resumoVisivel && "hidden")}>
              Recebido por forma de pagamento
            </p>
            <div className={cn("space-y-1.5", !resumoVisivel && "hidden")}>
              <Row label="Dinheiro" value={formatBRL(resumoVisivel?.total_dinheiro ?? 0)} />
              <Row label="PIX" value={formatBRL(resumoVisivel?.total_pix ?? 0)} tone="muted" />
              <Row label="Cartão débito" value={formatBRL(resumoVisivel?.total_debito ?? 0)} tone="muted" />
              <Row label="Cartão crédito" value={formatBRL(resumoVisivel?.total_credito ?? 0)} tone="muted" />
              <Row label="Boleto" value={formatBRL(resumoVisivel?.total_boleto ?? 0)} tone="muted" />
              {(resumoVisivel?.total_ifood ?? 0) > 0 && (
                <Row label="iFood (a receber)" value={formatBRL(resumoVisivel?.total_ifood ?? 0)} tone="muted" />
              )}
              {(resumoVisivel?.total_fiado ?? 0) > 0 && (
                <Row label="Fiado (a receber)" value={formatBRL(resumoVisivel?.total_fiado ?? 0)} tone="muted" />
              )}
              {(resumoVisivel?.total_outros ?? 0) > 0 && (
                <Row label="Outros" value={formatBRL(resumoVisivel?.total_outros ?? 0)} tone="muted" />
              )}
            </div>
            {((resumoVisivel?.total_ifood ?? 0) > 0 || (resumoVisivel?.total_fiado ?? 0) > 0) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                iFood e Fiado não somam no dinheiro físico esperado — viram contas a receber no Financeiro.
              </p>
            )}
          </div>

          {/* Esperado em dinheiro */}
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Esperado em dinheiro na gaveta
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums text-primary">
              {resumoVisivel ? formatBRL(valorEsperado) : "Atualizando..."}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              inicial + dinheiro recebido + suprimentos − sangrias
            </p>
          </div>

          {/* Valor contado */}
          <div className="space-y-2">
            <Label htmlFor="valor-informado">Valor contado (dinheiro físico)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                R$
              </span>
              <Input
                id="valor-informado"
                ref={valorRef}
                type="text"
                inputMode="decimal"
                value={valorInformado}
                onChange={(e) => setValorInformado(e.target.value)}
                className="pl-10 font-mono text-lg tabular-nums"
                autoFocus
                placeholder="0,00"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>

          {/* Diferença */}
          {diferenca !== null && resumoVisivel && (
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                Math.abs(diferenca) < 0.009
                  ? "border-success/40 bg-success/10 text-success"
                  : diferenca > 0
                    ? "border-info/40 bg-info/10 text-info"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Diferença</span>
                <span className="font-mono text-base font-bold tabular-nums">
                  {diferenca > 0 ? "+" : ""}
                  {formatBRL(diferenca)}
                </span>
              </div>
              {Math.abs(diferenca) >= 0.009 && (
                <p className="mt-1 text-xs">
                  {diferenca > 0 ? "Sobra de caixa" : "Falta de caixa"} — informe uma justificativa.
                </p>
              )}
            </div>
          )}

          {/* Justificativa */}
          <div className="space-y-2">
            <Label htmlFor="fech-obs" className="flex items-center gap-2">
              Observação {temDiferenca && <Badge variant="destructive" className="text-[10px]">obrigatória</Badge>}
            </Label>
            <Textarea
              id="fech-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder={temDiferenca ? "Explique a diferença..." : "Opcional"}
              rows={2}
            />
            {exigeJustificativa && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" /> Justificativa obrigatória quando há diferença.
              </p>
            )}
          </div>

          </div>

          <DialogFooter className="shrink-0 border-t border-border bg-background px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={fechar.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={fechar.isPending || resumoCarregando || !resumoAtual || exigeJustificativa || valorInformado === ""}
            >
              {fechar.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Fechando...</>
              ) : (
                <><PowerOff className="h-4 w-4" /> Fechar caixa</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
