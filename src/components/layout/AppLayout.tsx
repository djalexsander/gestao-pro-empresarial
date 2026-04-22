import { Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppMenubar } from "./AppMenubar";
import { AppToolbar } from "./AppToolbar";
import { ContextSidebar } from "./ContextSidebar";
import { MobileNavSheet } from "./MobileNavSheet";
import { findModuleByPath, type ModuleKey } from "./navigation";
import { useIsSuperAdmin } from "@/hooks/useAdmin";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

export function AppLayout() {
  const location = useLocation();

  if (location.pathname === "/auth") {
    return <Outlet />;
  }

  // /hub e /pos usam layout próprio (sem sidebar do ERP).
  if (location.pathname === "/hub" || location.pathname === "/pos") {
    return <Outlet />;
  }

  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) {
    return <Outlet />;
  }

  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}

function AppShell() {
  const location = useLocation();
  const { data: isSuperAdmin } = useIsSuperAdmin();

  // Módulo ativo derivado da rota; também pode ser sobreposto pelo clique no menubar
  const [activeModule, setActiveModule] = useState<ModuleKey>(
    () => findModuleByPath(location.pathname).key,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sincroniza o módulo ativo quando a rota muda
  useEffect(() => {
    setActiveModule(findModuleByPath(location.pathname).key);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <div className="flex items-center">
        <div className="flex-1">
          <AppMenubar activeModule={activeModule} onModuleSelect={setActiveModule} />
        </div>
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
