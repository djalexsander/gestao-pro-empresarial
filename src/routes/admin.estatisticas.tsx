import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAdminEmpresas } from "@/hooks/useAdmin";
import { EmpresaStatusBadge, PlanoBadge } from "@/components/admin/StatusBadges";

export const Route = createFileRoute("/admin/estatisticas")({
  head: () => ({ meta: [{ title: "Estatísticas de uso — Painel Master" }] }),
  component: AdminEstatisticasPage,
});

function AdminEstatisticasPage() {
  const { data: empresas = [], isLoading } = useAdminEmpresas();

  const rankingUsuarios = useMemo(
    () => [...empresas]
      .sort((a, b) => Number(b.total_usuarios) - Number(a.total_usuarios))
      .slice(0, 10)
      .map((e) => ({ nome: e.nome.slice(0, 20), valor: Number(e.total_usuarios) })),
    [empresas]
  );

  const rankingAtividade = useMemo(
    () => [...empresas]
      .sort((a, b) => Number(b.total_movimentacoes) - Number(a.total_movimentacoes))
      .slice(0, 10)
      .map((e) => ({ nome: e.nome.slice(0, 20), valor: Number(e.total_movimentacoes) })),
    [empresas]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estatísticas de uso"
        description="Métricas operacionais agregadas. Não exibimos conteúdo interno (vendas, valores, clientes, produtos)."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 10 — Usuários por empresa</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {rankingUsuarios.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankingUsuarios} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 255)" horizontal={false} />
                  <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="nome" fontSize={11} tickLine={false} axisLine={false} width={130} />
                  <Tooltip />
                  <Bar dataKey="valor" fill="oklch(0.55 0.18 256)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 10 — Atividade no sistema</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {rankingAtividade.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankingAtividade} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 255)" horizontal={false} />
                  <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="nome" fontSize={11} tickLine={false} axisLine={false} width={130} />
                  <Tooltip />
                  <Bar dataKey="valor" fill="oklch(0.65 0.15 175)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking por uso da plataforma</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Usuários</TableHead>
                <TableHead className="text-right">Atividade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              )}
              {!isLoading && empresas.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Sem empresas cadastradas.</TableCell></TableRow>
              )}
              {[...empresas]
                .sort((a, b) =>
                  (Number(b.total_usuarios) + Number(b.total_movimentacoes)) -
                  (Number(a.total_usuarios) + Number(a.total_movimentacoes))
                )
                .map((e, i) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{e.nome}</TableCell>
                    <TableCell><EmpresaStatusBadge status={e.status} /></TableCell>
                    <TableCell><PlanoBadge plano={e.plano} /></TableCell>
                    <TableCell className="text-right tabular-nums">{e.total_usuarios}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.total_movimentacoes}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados</div>;
}
