import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Users,
  Building2,
  Package,
  ShoppingCart,
  Receipt,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ArrowRight,
  ScrollText,
  UserCog,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminStats } from "@/hooks/useAdmin";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Painel Master — Visão geral" }],
  }),
  component: AdminDashboard,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function AdminDashboard() {
  const { data: stats, isLoading, error } = useAdminStats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel Master"
        description="Visão administrativa global do sistema. Você não tem acesso ao conteúdo das empresas."
      />

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Falha ao carregar estatísticas: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Usuários da plataforma
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total de usuários"
            value={isLoading ? "—" : String(stats?.total_usuarios ?? 0)}
            icon={Users}
            iconTone="primary"
          />
          <StatCard
            label="Novos (30 dias)"
            value={isLoading ? "—" : String(stats?.usuarios_30d ?? 0)}
            icon={TrendingUp}
            iconTone="success"
          />
          <StatCard
            label="Novos (7 dias)"
            value={isLoading ? "—" : String(stats?.usuarios_7d ?? 0)}
            icon={TrendingUp}
            iconTone="info"
          />
          <StatCard
            label="E-mails confirmados"
            value={isLoading ? "—" : String(stats?.usuarios_confirmados ?? 0)}
            icon={ShieldCheck}
            iconTone="success"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Uso agregado
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Empresas ativas"
            value={isLoading ? "—" : String(stats?.total_empresas ?? 0)}
            icon={Building2}
            iconTone="primary"
            hint="com produtos cadastrados"
          />
          <StatCard
            label="Produtos cadastrados"
            value={isLoading ? "—" : String(stats?.total_produtos ?? 0)}
            icon={Package}
          />
          <StatCard
            label="Vendas registradas"
            value={isLoading ? "—" : String(stats?.total_vendas ?? 0)}
            icon={Receipt}
            iconTone="success"
          />
          <StatCard
            label="Compras registradas"
            value={isLoading ? "—" : String(stats?.total_compras ?? 0)}
            icon={ShoppingCart}
            iconTone="info"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Volume financeiro (todas as empresas)
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Volume total de vendas</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">
                    {isLoading ? "—" : fmtBRL(Number(stats?.volume_vendas_total ?? 0))}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success/10 text-success">
                  <TrendingUp className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Volume total de compras</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">
                    {isLoading ? "—" : fmtBRL(Number(stats?.volume_compras_total ?? 0))}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-info/10 text-info">
                  <TrendingDown className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/admin/usuarios" className="group">
          <Card className="transition-all hover:border-primary/50 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCog className="h-5 w-5 text-primary" />
                Gerenciar usuários
              </CardTitle>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Listar contas, atribuir papéis, ativar/desativar e remover usuários.
            </CardContent>
          </Card>
        </Link>
        <Link to="/admin/auditoria" className="group">
          <Card className="transition-all hover:border-primary/50 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="h-5 w-5 text-primary" />
                Logs de auditoria
              </CardTitle>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Histórico de ações sensíveis: alterações de papéis, exclusões e acessos.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
