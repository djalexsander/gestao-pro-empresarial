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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useRegistrarMovimentoCaixa } from "@/hooks/useCaixa";
import { useAutorizacoesConfig } from "@/hooks/useAutorizacoes";
import { AutorizacaoGerencialDialog, type AutorizacaoRequest } from "@/components/autorizacoes/AutorizacaoGerencialDialog";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caixaId: string;
  tipo: "sangria" | "suprimento";
}

const META = {
  sangria: {
    title: "Sangria de caixa",
    description:
      "Retirada de dinheiro físico da gaveta (ex.: envio ao cofre, troca de notas). Não é despesa nem prejuízo.",
    icon: ArrowUpFromLine,
    tone: "text-destructive bg-destructive/10",
    button: "Confirmar sangria",
    placeholder: "Ex.: envio ao cofre, troca de notas grandes",
    hint: "Reduz o dinheiro físico esperado na gaveta no fechamento.",
  },
  suprimento: {
    title: "Suprimento de caixa",
    description:
      "Entrada de dinheiro físico na gaveta (ex.: reforço de troco). Não é venda nem receita.",
    icon: ArrowDownToLine,
    tone: "text-success bg-success/15",
    button: "Confirmar suprimento",
    placeholder: "Ex.: reforço de troco em notas pequenas",
    hint: "Aumenta o dinheiro físico esperado na gaveta no fechamento.",
  },
} as const;

export function MovimentoCaixaDialog({ open, onOpenChange, caixaId, tipo }: Props) {
  const meta = META[tipo];
  const Icon = meta.icon;

  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [autReq, setAutReq] = useState<AutorizacaoRequest | null>(null);
  const [autorizadorNome, setAutorizadorNome] = useState<string | null>(null);
  // UUID estável por abertura do modal — cobre duplo clique, Enter repetido,
  // retry de rede e qualquer reenvio da mesma operação. Reset a cada abertura.
  const [clientUuid, setClientUuid] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const registrar = useRegistrarMovimentoCaixa();
  const { data: cfgAut } = useAutorizacoesConfig();

  const exigeAutorizacao =
    tipo === "sangria"
      ? !!cfgAut?.exigir_sangria_caixa
      : !!cfgAut?.exigir_suprimento_caixa;

  useEffect(() => {
    if (open) {
      setValor("");
      setMotivo("");
      setAutorizadorNome(null);
      setClientUuid(
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    }
  }, [open]);

  async function persistir(autorizadoPor: string | null) {
    const v = Number(valor.replace(",", "."));
    await registrar.mutateAsync({
      caixa_id: caixaId,
      tipo,
      valor: v,
      motivo:
        (motivo.trim() ||
          (autorizadoPor ? `Autorizado por ${autorizadoPor}` : null)) ?? null,
      client_uuid: clientUuid,
    });
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor.replace(",", "."));
    if (Number.isNaN(v) || v <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (exigeAutorizacao && !autorizadorNome) {
      const acao = tipo === "sangria" ? "sangria_caixa" : "suprimento_caixa";
      const verbo = tipo === "sangria" ? "Sangria" : "Suplemento";
      setAutReq({
        acao,
        contexto: `${verbo} de caixa no valor de ${formatBRL(v)}`,
        contexto_dados: { caixa_id: caixaId, valor: v, tipo },
        valor_envolvido: v,
        referencia_tipo: "caixa",
        referencia_id: caixaId,
      });
      return;
    }
    await persistir(autorizadorNome);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className={cn("mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full", meta.tone)}>
            <Icon className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">{meta.title}</DialogTitle>
          <DialogDescription className="text-center">{meta.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mov-valor">Valor</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                R$
              </span>
              <Input
                id="mov-valor"
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="pl-10 font-mono text-lg tabular-nums"
                autoFocus
                placeholder="0,00"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mov-motivo">Motivo</Label>
            <Textarea
              id="mov-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={meta.placeholder}
              rows={2}
            />
          </div>

          <div
            className={cn(
              "rounded-md border p-3 text-xs",
              tipo === "suprimento"
                ? "border-success/30 bg-success/10 text-success"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {meta.hint}
          </div>

          {exigeAutorizacao && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-400">Requer autorização gerencial</p>
                <p className="text-amber-700/80 dark:text-amber-400/80">
                  {autorizadorNome
                    ? `Autorizado por ${autorizadorNome}.`
                    : "Após confirmar o valor, um gerente/admin precisa autorizar com cartão, PIN ou senha."}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={registrar.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Registrando...</>
              ) : exigeAutorizacao && !autorizadorNome ? (
                <><ShieldAlert className="mr-1 h-4 w-4" /> Solicitar autorização</>
              ) : (
                meta.button
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AutorizacaoGerencialDialog
        open={!!autReq}
        onOpenChange={(v) => { if (!v) setAutReq(null); }}
        request={autReq}
        onAutorizado={async (info) => {
          setAutorizadorNome(info.autorizador_nome);
          setAutReq(null);
          try {
            await persistir(info.autorizador_nome);
          } catch (e) {
            toast.error((e as Error).message ?? "Erro ao registrar movimento.");
          }
        }}
      />
    </Dialog>
  );
}
