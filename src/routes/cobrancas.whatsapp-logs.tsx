import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, Send, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { listarLogsWhatsApp } from "@/server/cobrancas.functions";
import { useEmpresaAtual } from "@/hooks/useEmpresa";

export const Route = createFileRoute("/cobrancas/whatsapp-logs")({
  head: () => ({
    meta: [{ title: "Histórico de envios WhatsApp" }],
  }),
  component: LogsPage,
});

const STATUS: Record<string, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  sent: { label: "Enviado", tone: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", Icon: CheckCircle2 },
  failed: { label: "Falhou", tone: "bg-rose-500/15 text-rose-700 border-rose-500/30", Icon: XCircle },
  pending: { label: "Pendente", tone: "bg-amber-500/15 text-amber-700 border-amber-500/30", Icon: Clock },
};

function LogsPage() {
  const empresa = useEmpresaAtual();
  const empresaId = empresa.data?.id;
  const qc = useQueryClient();
  const [disparando, setDisparando] = useState(false);

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["wa-logs", empresaId],
    enabled: !!empresaId,
    queryFn: () =>
      listarLogsWhatsApp({ data: { empresa_id: empresaId!, limit: 300 } }),
  });

  const dispararCronManual = useMutation({
    mutationFn: async () => {
      setDisparando(true);
      const url = `${window.location.origin}/api/public/hooks/cobrancas-wa-cron`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: "{}",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Falha");
      return j;
    },
    onSuccess: (j) => {
      toast.success(`${j.enviados} envio(s), ${j.erros} erro(s)`);
      qc.invalidateQueries({ queryKey: ["wa-logs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
    onSettled: () => setDisparando(false),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp · Histórico de envios"
        description="Mensagens automáticas e manuais enviadas para clientes."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
            </Button>
            <Button
              onClick={() => dispararCronManual.mutate()}
              disabled={disparando}
            >
              {disparando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Enviar agora
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4 sm:p-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : logs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum envio registrado ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l: any) => {
                    const meta = STATUS[l.status] ?? STATUS.pending;
                    const Icon = meta.Icon;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {new Date(l.created_at).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {l.telefone}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{l.tipo}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`gap-1 ${meta.tone}`}>
                            <Icon className="h-3.5 w-3.5" /> {meta.label}
                          </Badge>
                          {l.erro && (
                            <p className="mt-1 text-xs text-rose-600">{l.erro}</p>
                          )}
                        </TableCell>
                        <TableCell className="max-w-md">
                          <p className="line-clamp-2 text-xs">{l.mensagem}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
