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
import { useFecharCaixa, type CaixaResumo } from "@/hooks/useCaixa";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useAutorizacoesConfig } from "@/hooks/useAutorizacoes";
import {
  AutorizacaoGerencialDialog,
  type AutorizacaoRequest,
} from "@/components/autorizacoes/AutorizacaoGerencialDialog";

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
  const fechar = useFecharCaixa();
  const valorRef = useRef<HTMLInputElement | null>(null);
  const { data: cfgAuth } = useAutorizacoesConfig();
  const [authReq, setAuthReq] = useState<AutorizacaoRequest | null>(null);

  useEffect(() => {
    if (open) {
      setValorInformado("");
      setObservacao("");
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
  }, [open]);

  const valorEsperado = resumo?.valor_esperado ?? 0;
  const informadoNum = Number(valorInformado.replace(",", "."));
  const diferenca = useMemo(() => {
    if (Number.isNaN(informadoNum) || valorInformado === "") return null;
    return informadoNum - valorEsperado;
  }, [informadoNum, valorEsperado, valorInformado]);

  const temDiferenca = diferenca !== null && Math.abs(diferenca) > 0.009;
  // Limite acima do qual a justificativa passa a ser obrigatória.
  // Diferenças pequenas (centavos de troco) não bloqueiam o fechamento.
  const LIMITE_JUSTIFICATIVA = 5;
  const tipoDiferenca: "sobra" | "falta" | null =
    diferenca === null || Math.abs(diferenca) < 0.009
      ? null
      : diferenca > 0
        ? "sobra"
        : "falta";
  const exigeJustificativa =
    diferenca !== null &&
    Math.abs(diferenca) >= LIMITE_JUSTIFICATIVA &&
    observacao.trim().length === 0;

  async function executarFechamento(obsExtra?: string) {
    const obsFinal = [observacao.trim(), obsExtra].filter(Boolean).join(" — ");
    await fechar.mutateAsync({
      caixa_id: caixaId,
      valor_informado: informadoNum,
      observacao: obsFinal || null,
    });
    onOpenChange(false);
  }

  async function confirmar() {
    if (Number.isNaN(informadoNum) || informadoNum < 0) return;
    if (valorInformado === "") return;
    if (exigeJustificativa) return;
    if (fechar.isPending) return;

    // Se há divergência relevante e a empresa exige autorização gerencial,
    // abre modal de autorização antes de fechar.
    const exigeAutorizacao =
      temDiferenca &&
      (cfgAuth?.exigir_fechar_caixa_divergencia ?? true);

    if (exigeAutorizacao && diferenca !== null) {
      setAuthReq({
        acao: "fechar_caixa_divergencia",
        contexto: `Fechamento de caixa com ${tipoDiferenca === "sobra" ? "sobra" : "falta"} de ${formatBRL(Math.abs(diferenca))}`,
        diferenca_caixa: diferenca,
        valor_envolvido: informadoNum,
        referencia_tipo: "caixa",
        referencia_id: caixaId,
        contexto_dados: {
          valor_esperado: valorEsperado,
          valor_informado: informadoNum,
          tipo: tipoDiferenca,
        },
      });
      return;
    }

    await executarFechamento();
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
          {/* Resumo do caixa */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Movimentação do turno
            </p>
            <div className="space-y-1.5">
              <Row label="Valor inicial (fundo de troco)" value={formatBRL(resumo?.valor_inicial ?? 0)} tone="muted" />
              <Row label={`Vendas (${resumo?.qtd_vendas ?? 0})`} value={formatBRL(resumo?.total_vendas ?? 0)} />
              <Row label="Suprimento de caixa (entrou)" value={`+ ${formatBRL(resumo?.total_suprimentos ?? 0)}`} tone="success" />
              <Row label="Sangria de caixa (saiu)" value={`- ${formatBRL(resumo?.total_sangrias ?? 0)}`} tone="danger" />
            </div>

            <div className="my-3 h-px bg-border" />

            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recebido por forma de pagamento
            </p>
            <div className="space-y-1.5">
              <Row label="Dinheiro" value={formatBRL(resumo?.total_dinheiro ?? 0)} />
              <Row label="PIX" value={formatBRL(resumo?.total_pix ?? 0)} tone="muted" />
              <Row label="Cartão débito" value={formatBRL(resumo?.total_debito ?? 0)} tone="muted" />
              <Row label="Cartão crédito" value={formatBRL(resumo?.total_credito ?? 0)} tone="muted" />
              <Row label="Boleto" value={formatBRL(resumo?.total_boleto ?? 0)} tone="muted" />
              {(resumo?.total_ifood ?? 0) > 0 && (
                <Row label="iFood (a receber)" value={formatBRL(resumo?.total_ifood ?? 0)} tone="muted" />
              )}
              {(resumo?.total_fiado ?? 0) > 0 && (
                <Row label="Fiado (a receber)" value={formatBRL(resumo?.total_fiado ?? 0)} tone="muted" />
              )}
              {(resumo?.total_outros ?? 0) > 0 && (
                <Row label="Outros" value={formatBRL(resumo?.total_outros ?? 0)} tone="muted" />
              )}
            </div>
            {((resumo?.total_ifood ?? 0) > 0 || (resumo?.total_fiado ?? 0) > 0) && (
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
              {formatBRL(valorEsperado)}
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
          {diferenca !== null && (
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
                <span className="font-medium">
                  Diferença
                  {tipoDiferenca && (
                    <span className="ml-2 rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                      {tipoDiferenca}
                    </span>
                  )}
                </span>
                <span className="font-mono text-base font-bold tabular-nums">
                  {diferenca > 0 ? "+" : ""}
                  {formatBRL(diferenca)}
                </span>
              </div>
              {tipoDiferenca && (
                <p className="mt-1 text-xs">
                  {tipoDiferenca === "sobra" ? "Sobra de caixa" : "Falta de caixa"}
                  {Math.abs(diferenca) >= LIMITE_JUSTIFICATIVA
                    ? " — justifique o motivo abaixo."
                    : " — justificativa opcional para diferenças pequenas."}
                </p>
              )}
            </div>
          )}

          {/* Justificativa */}
          <div className="space-y-2">
            <Label htmlFor="fech-obs" className="flex items-center gap-2">
              Observação
              {exigeJustificativa && <Badge variant="destructive" className="text-[10px]">obrigatória</Badge>}
              {temDiferenca && !exigeJustificativa && (
                <Badge variant="secondary" className="text-[10px]">recomendada</Badge>
              )}
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
                <AlertTriangle className="h-3 w-3" /> Justificativa obrigatória para diferenças acima de {formatBRL(LIMITE_JUSTIFICATIVA)}.
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
              disabled={fechar.isPending || exigeJustificativa || valorInformado === ""}
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
