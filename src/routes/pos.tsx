import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ShoppingCart,
  LogOut,
  UserCog,
  PackageOpen,
  ArrowLeftRight,
  LayoutDashboard,
  Loader2,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { OperadorPinSelector } from "@/components/auth/OperadorPinDialog";
import { TerminalSelector, TerminalAtualBadge } from "@/components/auth/TerminalSelector";
import { useIsSuperAdmin } from "@/hooks/useAdmin";
import { useCaixaAberto, useCaixaResumo } from "@/hooks/useCaixa";
import { AbrirCaixaDialog } from "@/components/caixa/AbrirCaixaDialog";
import { FecharCaixaDialog } from "@/components/caixa/FecharCaixaDialog";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "Caixa / PDV — Gestão Pro" },
      { name: "description", content: "Ambiente operacional do operador de caixa." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <PosShell />
    </RequireAuth>
  ),
});

function PosShell() {
  const { operador } = useOperador();
  const { terminal } = useTerminal();

  if (!terminal) {
    return <PosTerminalScreen />;
  }
  if (!operador) {
    return <PosLoginScreen />;
  }
  return <PosHomeScreen />;
}

function PosTerminalScreen() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <span className="font-semibold">Gestão Pro · PDV</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/hub">
              <ArrowLeftRight className="mr-1 h-4 w-4" /> Voltar ao Hub
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-1 h-4 w-4" /> Sair
          </Button>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-2xl p-6 sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold">Identificar terminal</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha qual caixa físico este dispositivo representa.
            </p>
          </div>
          <TerminalSelector />
        </Card>
      </main>
    </div>
  );
}

function PosLoginScreen() {
  const { signOut } = useAuth();
  const { data: isSuperAdmin } = useIsSuperAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <span className="font-semibold">Gestão Pro · PDV</span>
          <TerminalAtualBadge />
        </div>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <LayoutDashboard className="mr-1 h-4 w-4" /> Voltar ao Admin
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-1 h-4 w-4" /> Sair
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-2xl p-6 sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold">Login do operador</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Identifique-se para abrir o caixa e iniciar as vendas.
            </p>
          </div>
          <OperadorPinSelector />
        </Card>
      </main>
    </div>
  );
}

function PosHomeScreen() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { operador, trocarOperador } = useOperador();
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const { data: caixaAberto, isLoading: loadingCaixa } = useCaixaAberto(operador?.id ?? null);
  const { data: resumoCaixa } = useCaixaResumo(caixaAberto?.id);
  const [abrirOpen, setAbrirOpen] = useState(false);
  const [fecharOpen, setFecharOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">Gestão Pro · PDV</p>
            <p className="text-xs text-muted-foreground leading-tight">
              Operador: <span className="font-medium">{operador?.nome}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TerminalAtualBadge />
          {caixaAberto ? (
            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">
              Caixa aberto
            </Badge>
          ) : (
            <Badge variant="secondary">Caixa fechado</Badge>
          )}
          {isSuperAdmin && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/hub">
                <LayoutDashboard className="mr-1 h-4 w-4" /> Hub
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={trocarOperador}>
            <UserCog className="mr-1 h-4 w-4" /> Trocar
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-1 h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
        {loadingCaixa ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
            <Card
              className={`group p-6 transition-all ${
                caixaAberto
                  ? "cursor-pointer hover:border-primary hover:shadow-lg"
                  : "opacity-60"
              }`}
              onClick={() => caixaAberto && navigate({ to: "/pdv" })}
            >
              <div className="flex flex-col items-center text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <ShoppingCart className="h-7 w-7" />
                </div>
                <h2 className="text-lg font-bold">Iniciar Vendas</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {caixaAberto
                    ? "Abrir o PDV para registrar vendas"
                    : "Abra o caixa antes de vender"}
                </p>
              </div>
            </Card>

            {caixaAberto ? (
              <Card
                className="group cursor-pointer p-6 transition-all hover:border-destructive hover:shadow-lg"
                onClick={() => setFecharOpen(true)}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive group-hover:bg-destructive group-hover:text-destructive-foreground">
                    <Receipt className="h-7 w-7" />
                  </div>
                  <h2 className="text-lg font-bold">Fechar Caixa</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Conferir e encerrar o caixa
                  </p>
                </div>
              </Card>
            ) : (
              <Card
                className="group cursor-pointer p-6 transition-all hover:border-primary hover:shadow-lg"
                onClick={() => setAbrirOpen(true)}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                    <PackageOpen className="h-7 w-7" />
                  </div>
                  <h2 className="text-lg font-bold">Abrir Caixa</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Informar o valor inicial (troco)
                  </p>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>

      <AbrirCaixaDialog
        open={abrirOpen}
        onOpenChange={setAbrirOpen}
        operadorId={operador?.id ?? null}
      />
      {caixaAberto && (
        <FecharCaixaDialog
          open={fecharOpen}
          onOpenChange={setFecharOpen}
          caixaId={caixaAberto.id}
          resumo={resumoCaixa ?? null}
        />
      )}
    </div>
  );
}
