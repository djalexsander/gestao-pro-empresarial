import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  LogOut,
  Sparkles,
  ArrowRight,
  Building2,
  BarChart3,
  PackageOpen,
  Receipt,
  Users,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { AdminAuthDialog } from "@/components/auth/AdminAuthDialog";

export const Route = createFileRoute("/hub")({
  head: () => ({
    meta: [
      { title: "Início — Gestão Pro" },
      { name: "description", content: "Escolha entre o ERP completo ou o caixa." },
    ],
  }),
  component: HubPage,
});

function HubPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", search: { redirect: "/hub" } });
    }
  }, [loading, user, navigate]);

  if (loading || !user) return null;

  const nome =
    (user.user_metadata?.nome as string | undefined) ??
    user.email?.split("@")[0] ??
    "Usuário";

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[oklch(0.14_0.04_265)] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 h-[480px] w-[480px] rounded-full bg-[oklch(0.55_0.22_280)] opacity-30 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[520px] w-[520px] rounded-full bg-[oklch(0.55_0.22_240)] opacity-30 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-[oklch(0.5_0.2_300)] opacity-20 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
      </div>

      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.7_0.2_275)] to-[oklch(0.55_0.22_245)] shadow-lg shadow-[oklch(0.55_0.22_270)]/40">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight">Gestão Pro</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
              ERP Empresarial
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              signOut();
            }}
            className="text-white/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="mr-1 h-4 w-4" /> Sair
          </Button>
        </div>
      </header>

      {/* Conteúdo central */}
      <main className="flex flex-col items-center justify-center px-6 pb-16 pt-6 sm:pt-10">
        <div className="mb-10 max-w-2xl text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
          <p className="text-sm text-white/55">Olá, {nome}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Como deseja{" "}
            <span className="bg-gradient-to-r from-[oklch(0.78_0.18_290)] via-[oklch(0.7_0.2_270)] to-[oklch(0.7_0.18_240)] bg-clip-text text-transparent">
              trabalhar hoje?
            </span>
          </h1>
          <p className="mt-3 text-sm text-white/55 sm:text-base">
            Escolha o ambiente para continuar. Você pode alternar entre eles a
            qualquer momento.
          </p>
        </div>

        <div className="grid w-full max-w-5xl gap-5 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-6 duration-700">
          {/* Card ERP — exige reautenticação por dialog */}
          <button
            type="button"
            onClick={() => setAdminAuthOpen(true)}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-7 text-left backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.07] hover:shadow-2xl hover:shadow-[oklch(0.55_0.22_270)]/20 sm:p-8"
          >
            <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-[oklch(0.65_0.22_275)]/25 blur-3xl transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[oklch(0.7_0.2_275)] to-[oklch(0.55_0.22_245)] shadow-lg shadow-[oklch(0.55_0.22_270)]/40">
                <LayoutDashboard className="h-7 w-7 text-white" />
              </div>

              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">
                  Entrar no Sistema
                </h2>
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70"
                  title="Requer autenticação administrativa"
                >
                  <Lock className="h-3 w-3" /> Senha
                </span>
              </div>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[oklch(0.78_0.16_280)]">
                ERP Completo
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                Acesso ao painel administrativo: vendas, compras, estoque,
                financeiro, relatórios e configurações.
              </p>

              <ul className="mt-5 grid grid-cols-2 gap-2 text-xs text-white/55">
                <li className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-white/40" /> Cadastros
                </li>
                <li className="flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5 text-white/40" /> Relatórios
                </li>
                <li className="flex items-center gap-1.5">
                  <PackageOpen className="h-3.5 w-3.5 text-white/40" /> Estoque
                </li>
                <li className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-white/40" /> Equipe
                </li>
              </ul>

              <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white/80 transition-colors group-hover:text-white">
                Confirmar credenciais
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </button>

          {/* Card PDV */}
          <Link
            to="/pos"
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.07] hover:shadow-2xl hover:shadow-emerald-500/20 sm:p-8"
          >
            <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-emerald-500/25 blur-3xl transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-500/40">
                <ShoppingCart className="h-7 w-7 text-white" />
              </div>

              <h2 className="text-2xl font-bold tracking-tight">
                Abrir Caixa / PDV
              </h2>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-emerald-300">
                Frente de Caixa
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                Ambiente operacional para o operador: identificação por PIN,
                abertura de caixa, vendas no balcão e fechamento.
              </p>

              <ul className="mt-5 grid grid-cols-2 gap-2 text-xs text-white/55">
                <li className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-white/40" /> Operador + PIN
                </li>
                <li className="flex items-center gap-1.5">
                  <PackageOpen className="h-3.5 w-3.5 text-white/40" /> Abrir
                  caixa
                </li>
                <li className="flex items-center gap-1.5">
                  <ShoppingCart className="h-3.5 w-3.5 text-white/40" /> Vender
                </li>
                <li className="flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-white/40" /> Fechar caixa
                </li>
              </ul>

              <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white/80 transition-colors group-hover:text-white">
                Iniciar operação
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        </div>

        <p className="mt-10 text-xs text-white/40">
          Logado como <span className="font-medium text-white/60">{user.email}</span>
        </p>
      </main>

      <AdminAuthDialog open={adminAuthOpen} onOpenChange={setAdminAuthOpen} />
    </div>
  );
}
