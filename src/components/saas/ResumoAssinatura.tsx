import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertTriangle, XCircle, QrCode, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMinhaAssinatura, useMeusModulos } from "@/hooks/useSaasAdmin";
import { useCobrancaPendente } from "@/hooks/useCobrancaPendente";
import { getEffectivePlanStatus } from "@/lib/planStatus";
import { CobrancaPixDialog, type CobrancaResult } from "@/components/saas/CobrancaPixDialog";
import { supabase } from "@/integrations/supabase/client";

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

const STATUS_META: Record<
  string,
  { label: string; tone: string; icon: typeof CheckCircle2 }
> = {
  trial:           { label: "Em teste",       tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30", icon: Clock },
  active:          { label: "Ativa",          tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
  pending_payment: { label: "Aguardando pgto",tone: "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30", icon: Clock },
  overdue:         { label: "Em atraso",      tone: "bg-orange-500/15 text-orange-800 dark:text-orange-200 border-orange-500/30", icon: AlertTriangle },
  expired:         { label: "Vencida",        tone: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  canceled:        { label: "Cancelada",      tone: "bg-muted text-muted-foreground border-border", icon: XCircle },
  none:            { label: "Sem assinatura", tone: "bg-muted text-muted-foreground border-border", icon: XCircle },
};

/**
 * Painel central de resumo da assinatura: plano atual, módulos ativos,
 * total mensal recorrente, status, vencimento e CTA de cobrança pendente.
 */
export function ResumoAssinatura({
  onAbrirCobranca,
}: {
  /** Callback opcional. Se omitido, o componente abre o CobrancaPixDialog internamente. */
  onAbrirCobranca?: (pagamentoId: string) => void;
}) {
  const { data: assinatura, isLoading: loadingAss } = useMinhaAssinatura();
  const { data: modulos = [], isLoading: loadingMod } = useMeusModulos();
  const status = getEffectivePlanStatus(assinatura);
  const meta = STATUS_META[status] ?? STATUS_META.none;
  const Icon = meta.icon;

  const showPendente = status === "pending_payment" || status === "overdue" || status === "expired";
  const { data: pendente } = useCobrancaPendente(showPendente);

  const [pixOpen, setPixOpen] = useState(false);
  const [pixCobranca, setPixCobranca] = useState<CobrancaResult | null>(null);
  const qc = useQueryClient();

  // Realtime: quando a assinatura/módulos da empresa mudam (ativação via webhook),
  // recarregamos o status para refletir "Ativa" sem precisar de refresh manual.
  useEffect(() => {
    const ch = supabase
      .channel("resumo-assinatura-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "empresa_assinaturas" },
        () => {
          qc.invalidateQueries({ queryKey: ["minha-assinatura"] });
          qc.invalidateQueries({ queryKey: ["cobranca-pendente"] });
          qc.invalidateQueries({ queryKey: ["meus-pagamentos"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "empresa_modulos" },
        () => {
          qc.invalidateQueries({ queryKey: ["meus-modulos"] });
          qc.invalidateQueries({ queryKey: ["modulos-disponiveis-cliente"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const handlePagarAgora = () => {
    if (!pendente) return;
    if (onAbrirCobranca) {
      onAbrirCobranca(pendente.pagamento_id);
      return;
    }
    setPixCobranca({
      pagamento_id: pendente.pagamento_id,
      asaas_payment_id: pendente.asaas_payment_id ?? "",
      invoice_url: pendente.invoice_url,
      pix_qrcode: pendente.pix_qrcode,
      pix_copia_cola: pendente.pix_copia_cola,
      due_date: pendente.data_vencimento,
    });
    setPixOpen(true);
  };

  const modulosAtivos = modulos.filter((m) => m.liberado && m.origem !== "trial");
  const totalRecorrente =
    (assinatura?.sem_empresa ? 0 : 0) +
    modulosAtivos.reduce((s, m) => s + Number(m.valor || 0), 0);

  if (loadingAss || loadingMod) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Sua assinatura</CardTitle>
          <Badge variant="outline" className={`gap-1 ${meta.tone}`}>
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Plano</p>
            <p className="font-medium">
              {status === "trial" ? "Período de teste" : status === "none" ? "—" : assinatura?.plano_id ? "Contratado" : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Módulos ativos</p>
            <p className="font-medium">{modulosAtivos.length}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {status === "overdue" || status === "expired" ? "Venceu em" : "Vence em"}
            </p>
            <p className="font-medium">{fmtDate(assinatura?.data_expiracao)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Recorrência módulos</p>
            <p className="font-medium">{fmtBRL(totalRecorrente)}</p>
          </div>
        </div>

        {status === "trial" && (assinatura?.dias_restantes ?? 0) >= 0 && (
          <p className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-800 dark:text-blue-200">
            Seu teste termina em <strong>{assinatura?.dias_restantes} dia(s)</strong>. Contrate um plano para continuar sem interrupção.
          </p>
        )}

        {status === "overdue" && (
          <p className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-800 dark:text-orange-200">
            Sua assinatura venceu. Você está com <strong>acesso limitado</strong>. Pague para liberar tudo.
          </p>
        )}

        {status === "expired" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Acesso bloqueado. Regularize o pagamento para voltar a operar.
          </p>
        )}

        {pendente && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
            <div className="text-sm">
              <p className="font-medium">Cobrança pendente: {fmtBRL(pendente.valor)}</p>
              <p className="text-xs text-muted-foreground">
                Vencimento {fmtDate(pendente.data_vencimento)} · {pendente.itens.length} item(ns)
              </p>
            </div>
            <Button size="sm" onClick={handlePagarAgora}>
              <QrCode className="mr-2 h-4 w-4" /> Pagar agora
            </Button>
          </div>
        )}

        {modulosAtivos.length > 0 && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Módulos ativos
            </p>
            <div className="flex flex-wrap gap-1.5">
              {modulosAtivos.map((m) => (
                <Badge key={m.modulo_id} variant="secondary">
                  {m.nome} · {fmtBRL(m.valor)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <CobrancaPixDialog
        open={pixOpen}
        onOpenChange={setPixOpen}
        cobranca={pixCobranca}
      />
    </Card>
  );
}
