import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  LogOut,
  Sparkles,
  ArrowRight,
  Lock,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { useCaixaExitGuard } from "@/components/caixa/CaixaExitGuardProvider";
import { AdminAuthDialog } from "@/components/auth/AdminAuthDialog";
import { useMode } from "@/components/modes/ModeProvider";
import type { ModoDisponivel } from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/hub")({
  head: () => ({
    meta: [
      { title: "Início — Gestão Pro" },
      { name: "description", content: "Escolha o ambiente de trabalho." },
    ],
  }),
  component: HubPage,
});

const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShoppingCart,
};

function iconePorChave(chave: string, fallback: string | null): LucideIcon {
  if (fallback && ICONES[fallback]) return ICONES[fallback];
  if (chave === "pdv") return ShoppingCart;
  return LayoutDashboard;
}

function HubPage() {
  const { user, loading, signOut } = useAuth();
  const { guardedSignOut } = useCaixaExitGuard();
  const navigate = useNavigate();
  const { modos, isLoading: modosLoading, setModo } = useMode();
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);
  const [modoPendente, setModoPendente] = useState<ModoDisponivel | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", search: { redirect: "/hub" } });
    }
  }, [loading, user, navigate]);

  // Quando admin valida senha, ativa o modo escolhido e navega
  const handleAfterAdminAuth = (open: boolean) => {
    setAdminAuthOpen(open);
    if (!open && modoPendente) {
      // Dialog fechou — se ainda há modo pendente, assume que foi confirmado pelo redirect interno
      // (AdminAuthDialog já redireciona pra "/" quando autentica). Aplicamos o modo aqui também.
      setModo(modoPendente.chave);
      setModoPendente(null);
    }
  };

  const entrarNoModo = (m: ModoDisponivel) => {
    if (m.tipo === "admin") {
      setModoPendente(m);
      setAdminAuthOpen(true);
      return;
    }
    setModo(m.chave);
    navigate({ to: m.rota_inicial as "/" });
  };

  if (loading || !user) return null;

  const nome =
    (user.user_metadata?.nome as string | undefined) ?? user.email?.split("@")[0] ?? "Usuário";

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
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">ERP Empresarial</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void guardedSignOut(signOut);
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
            Escolha o ambiente para continuar. Você pode alternar entre eles a qualquer momento.
          </p>
        </div>

        {modosLoading ? (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando modos…
          </div>
        ) : modos.length === 0 ? (
          <p className="text-sm text-white/60">Nenhum modo ativo. Contate o administrador.</p>
        ) : (
          <div
            className={
              "grid w-full gap-5 animate-in fade-in slide-in-from-bottom-6 duration-700 " +
              (modos.length === 1
                ? "max-w-md"
                : modos.length === 2
                ? "max-w-5xl sm:grid-cols-2"
                : "max-w-6xl sm:grid-cols-2 lg:grid-cols-3")
            }
          >
            {modos.map((m) => {
              const Icon = iconePorChave(m.chave, m.icone);
              const isAdmin = m.tipo === "admin";
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => entrarNoModo(m)}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-7 text-left backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.07] hover:shadow-2xl hover:shadow-[oklch(0.55_0.22_270)]/20 sm:p-8"
                >
                  <div
                    className={
                      "pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full blur-3xl transition-opacity group-hover:opacity-100 " +
                      (isAdmin
                        ? "bg-[oklch(0.65_0.22_275)]/25"
                        : "bg-emerald-500/25")
                    }
                  />
                  <div className="relative">
                    <div
                      className={
                        "mb-5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg " +
                        (isAdmin
                          ? "bg-gradient-to-br from-[oklch(0.7_0.2_275)] to-[oklch(0.55_0.22_245)] shadow-[oklch(0.55_0.22_270)]/40"
                          : "bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-emerald-500/40")
                      }
                    >
                      <Icon className="h-7 w-7 text-white" />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold tracking-tight">{m.nome}</h2>
                      {isAdmin && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70"
                          title="Requer autenticação administrativa"
                        >
                          <Lock className="h-3 w-3" /> Senha
                        </span>
                      )}
                    </div>
                    <p
                      className={
                        "mt-1 text-xs uppercase tracking-[0.18em] " +
                        (isAdmin ? "text-[oklch(0.78_0.16_280)]" : "text-emerald-300")
                      }
                    >
                      {isAdmin ? "Modo Administrativo" : "Modo Operacional"}
                    </p>
                    {m.descricao && (
                      <p className="mt-3 text-sm leading-relaxed text-white/60">{m.descricao}</p>
                    )}

                    <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white/80 transition-colors group-hover:text-white">
                      Entrar
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-xs text-white/40">
          Logado como <span className="font-medium text-white/60">{user.email}</span>
        </p>
      </main>

      <AdminAuthDialog open={adminAuthOpen} onOpenChange={handleAfterAdminAuth} />
    </div>
  );
}
