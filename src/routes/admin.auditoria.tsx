import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAdminAuditLogs } from "@/hooks/useAdmin";

export const Route = createFileRoute("/admin/auditoria")({
  head: () => ({
    meta: [{ title: "Auditoria — Painel Master" }],
  }),
  component: AdminAuditPage,
});

function actionTone(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("delete")) return "destructive";
  if (action.includes("grant")) return "default";
  if (action.includes("revoke")) return "outline";
  return "secondary";
}

function AdminAuditPage() {
  const { data: logs = [], isLoading } = useAdminAuditLogs(500);
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actor_email?.toLowerCase().includes(q) ||
        l.target_id?.toLowerCase().includes(q)
    );
  }, [logs, busca]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs de auditoria"
        description="Histórico de ações sensíveis registradas no sistema."
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por ação, e-mail ou ID..."
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Quando</TableHead>
                <TableHead>Quem</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Alvo</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    <ScrollText className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    Nenhum registro de auditoria encontrado.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(l.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-sm">{l.actor_email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={actionTone(l.action)} className="font-mono text-xs">
                      {l.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {l.target_type && l.target_id
                      ? `${l.target_type}:${l.target_id.slice(0, 8)}…`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    {l.metadata && Object.keys(l.metadata).length > 0
                      ? JSON.stringify(l.metadata)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
