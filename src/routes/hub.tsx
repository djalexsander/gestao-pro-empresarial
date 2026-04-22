import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, ShoppingCart, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/components/auth/AuthProvider";
import { useIsSuperAdmin } from "@/hooks/useAdmin";

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
  const { user, signOut } = useAuth();
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const navigate = useNavigate();

  if (!user) {
    navigate({ to: "/auth", search: { redirect: "/hub" } });
    return null;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="absolute right-4 top-4 flex gap-2">
        {isSuperAdmin && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ShieldCheck className="mr-1 h-4 w-4" /> Master
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="mr-1 h-4 w-4" /> Sair
        </Button>
      </div>

      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Como deseja trabalhar hoje?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Escolha o ambiente para continuar.
        </p>
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <Card
          asChild
          className="group cursor-pointer p-6 transition-all hover:border-primary hover:shadow-lg"
        >
          <Link to="/">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <LayoutDashboard className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold">ERP Completo</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Acesso a vendas, compras, estoque, financeiro, relatórios e
                configurações.
              </p>
              <p className="mt-3 text-xs uppercase tracking-wider text-primary">
                Administrador / Gerente
              </p>
            </div>
          </Link>
        </Card>

        <Card
          asChild
          className="group cursor-pointer p-6 transition-all hover:border-primary hover:shadow-lg"
        >
          <Link to="/pos">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <ShoppingCart className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold">Caixa / PDV</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ambiente operacional para abertura de caixa, vendas no balcão e
                fechamento.
              </p>
              <p className="mt-3 text-xs uppercase tracking-wider text-primary">
                Operador de caixa
              </p>
            </div>
          </Link>
        </Card>
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        Logado como <span className="font-medium">{user.email}</span>
      </p>
    </div>
  );
}
