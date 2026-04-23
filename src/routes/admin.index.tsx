import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Users, Building2, TrendingUp, ShieldCheck, ArrowRight, ScrollText, UserCog,
  Activity, Lock, Ban,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminStats, useAdminSerieCrescimento } from "@/hooks/useAdmin";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Visão geral — Painel Master" }] }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data: stats, isLoading, error } = useAdminStats();
  const { data: serie = [] } = useAdminSerieCrescimento(30);

  const chartData = serie.map((s) => ({
    data: new Date(s.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    Usuários: Number(s.novos_usuarios),
    Empresas: Number(s.novas_empresas),
    AcumU: Number(s.total_usuarios_acum),
    AcumE: Number(s.total_empresas_acum),
  }));

  const statusData = [
    { name: "Ativas", value: Number(stats?.empresas_ativas ?? 0), color: "oklch(0.62 0.16 152)" },
    { name: "Inativas", value: Number(stats?.empresas_inativas ?? 0), color: "oklch(0.7 0.02 257)" },
    { name: "Bloqueadas", value: Number(stats?.empresas_bloqueadas ?? 0), color: "oklch(0.58 0.23 27)" },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral da plataforma"
        description="Métricas globais do SaaS. Você não acessa o conteúdo das empresas."
      />

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Falha ao carregar estatísticas: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* KPIs empresas */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Empresas na plataforma
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total de empresas"   value={isLoading ? "—" : String(stats?.total_empresas ?? 0)}      icon={Building2} iconTone="primary" />
          <StatCard label="Ativas"              value={isLoading ? "—" : String(stats?.empresas_ativas ?? 0)}     icon={ShieldCheck} iconTone="success" />
          <StatCard label="Inativas"            value={isLoading ? "—" : String(stats?.empresas_inativas ?? 0)}   icon={Lock} />
          <StatCard label="Bloqueadas"          value={isLoading ? "—" : String(stats?.empresas_bloqueadas ?? 0)} icon={Ban} iconTone="danger" />
        </div>
      </div>

      {/* KPIs usuários */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Usuários
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total de usuários"  value={isLoading ? "—" : String(stats?.total_usuarios ?? 0)}     icon={Users} iconTone="primary" />
          <StatCard label="Novos (30 dias)"    value={isLoading ? "—" : String(stats?.usuarios_30d ?? 0)}       icon={TrendingUp} iconTone="success" />
          <StatCard label="Ativos (30 dias)"   value={isLoading ? "—" : String(stats?.usuarios_ativos_30d ?? 0)} icon={Activity} iconTone="info" />
          <StatCard label="E-mails confirmados" value={isLoading ? "—" : String(stats?.usuarios_confirmados ?? 0)} icon={ShieldCheck} iconTone="success" />
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Crescimento da plataforma (últimos 30 dias)</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: -10, right: 8, top: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="gU" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.55 0.18 256)" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="oklch(0.55 0.18 256)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.65 0.15 175)" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="oklch(0.65 0.15 175)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 255)" />
                <XAxis dataKey="data" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="Usuários" stroke="oklch(0.55 0.18 256)" fill="url(#gU)" strokeWidth={2} />
                <Area type="monotone" dataKey="Empresas" stroke="oklch(0.65 0.15 175)" fill="url(#gE)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status das empresas</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {statusData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sem dados
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>
                    {statusData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>


      {/* Atalhos */}
      <div className="grid gap-4 md:grid-cols-3">
        <ShortcutCard to="/admin/empresas" icon={Building2} title="Gerenciar empresas" desc="Editar, ativar, bloquear ou excluir." />
        <ShortcutCard to="/admin/usuarios" icon={UserCog}    title="Gerenciar usuários" desc="Papéis, acesso e exclusão." />
        <ShortcutCard to="/admin/auditoria" icon={ScrollText} title="Logs de auditoria" desc="Histórico de ações sensíveis." />
      </div>
    </div>
  );
}

function ShortcutCard({
  to, icon: Icon, title, desc,
}: { to: string; icon: typeof Users; title: string; desc: string }) {
  return (
    <Link to={to} className="group">
      <Card className="transition-all hover:border-primary/50 hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-5 w-5 text-primary" /> {title}
          </CardTitle>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{desc}</CardContent>
      </Card>
    </Link>
  );
}
