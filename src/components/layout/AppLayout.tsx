import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireAdminLike } from "@/components/auth/RequireRole";
import { RequireErpUnlock } from "@/components/auth/RequireErpUnlock";
import { AppMenubar } from "./AppMenubar";
import { AppToolbar } from "./AppToolbar";
import { ContextSidebar } from "./ContextSidebar";
import { MobileNavSheet } from "./MobileNavSheet";
import { findModuleByPath, type ModuleKey } from "./navigation";
import { useIsSuperAdmin } from "@/hooks/useAdmin";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { AssinaturaBanner } from "./AssinaturaBanner";
import { useMode } from "@/components/modes/ModeProvider";
import { useAuth } from "@/components/auth/AuthProvider";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { modoAtual, isRouteAllowed, isLoading: modosLoading } = useMode();

  // Guard de modo: redireciona para a rota inicial do modo se rota atual não pertence ao modo.
  useEffect(() => {
    if (modosLoading) return;
    if (!user) return;
    if (location.pathname === "/auth" || location.pathname === "/hub") return;
    if (location.pathname.startsWith("/admin")) return;
    if (!modoAtual) {
      // Sem modo selecionado e tentando acessar rota de app -> manda pro hub
      navigate({ to: "/hub" });
      return;
    }
    if (!isRouteAllowed(location.pathname)) {
      navigate({ to: modoAtual.rota_inicial as "/" });
    }
  }, [location.pathname, modoAtual, modosLoading, user, isRouteAllowed, navigate]);

  if (location.pathname === "/auth") {
    return <Outlet />;
  }

  // /hub, /pos e /pdv usam layout próprio (sem sidebar/menubar do ERP).
  // O PDV é ambiente isolado de operação de caixa.
  if (
    location.pathname === "/hub" ||
    location.pathname === "/pos" ||
    location.pathname === "/pdv"
  ) {
    return <Outlet />;
  }

  // /admin também exige unlock prévio (acesso administrativo).
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) {
    return (
      <RequireAuth>
        <RequireErpUnlock>
          <Outlet />
        </RequireErpUnlock>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <RequireErpUnlock>
        <RequireAdminLike>
          <AppShell />
        </RequireAdminLike>
      </RequireErpUnlock>
    </RequireAuth>
  );
}

function AppShell() {
  const location = useLocation();
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const { modoAtual, clearModo } = useMode();
  const navigate = useNavigate();

  // Módulo ativo derivado da rota; também pode ser sobreposto pelo clique no menubar
  const [activeModule, setActiveModule] = useState<ModuleKey>(
    () => findModuleByPath(location.pathname).key,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sincroniza o módulo ativo quando a rota muda
  useEffect(() => {
    setActiveModule(findModuleByPath(location.pathname).key);
  }, [location.pathname]);

  const handleTrocarModo = () => {
    clearModo();
    navigate({ to: "/hub" });
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AssinaturaBanner />
      <div className="flex items-center">
        <div className="flex-1">
          <AppMenubar activeModule={activeModule} onModuleSelect={setActiveModule} />
        </div>
        {modoAtual && (
          <button
            type="button"
            onClick={handleTrocarModo}
            className="hidden h-11 items-center gap-1.5 border-b border-l border-sidebar-border bg-sidebar px-3 text-[13px] font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
            title="Trocar de modo"
          >
            <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
              {modoAtual.chave}
            </span>
            Trocar modo
          </button>
        )}
        {isSuperAdmin && (
          <Link
            to="/admin"
            className="hidden h-11 items-center gap-1.5 border-b border-l border-sidebar-border bg-sidebar px-3 text-[13px] font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
            title="Painel Master"
          >
            <ShieldCheck className="h-4 w-4" /> Master
          </Link>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ContextSidebar activeModule={activeModule} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppToolbar
            activeModule={activeModule}
            onMobileMenuClick={() => setMobileNavOpen(true)}
          />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>

      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        activeModule={activeModule}
        onModuleSelect={(k) => {
          setActiveModule(k);
        }}
      />
    </div>
  );
}
