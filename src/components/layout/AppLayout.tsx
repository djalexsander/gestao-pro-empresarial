import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireAdminLike } from "@/components/auth/RequireRole";
import { RequireErpUnlock } from "@/components/auth/RequireErpUnlock";
import { RequireTerminalPermissao } from "@/components/auth/RequireTerminalPermissao";
import { RequireNotMaster } from "@/components/admin/RequireNotMaster";
import { areaTerminalDoPath } from "@/components/auth/areaTerminalDoPath";
import { AppMenubar } from "./AppMenubar";
import { AppToolbar } from "./AppToolbar";
import { ContextSidebar } from "./ContextSidebar";
import { MobileNavSheet } from "./MobileNavSheet";
import { findModuleByPath, type ModuleKey } from "./navigation";
import { useIsSuperAdmin } from "@/hooks/useAdmin";
import { ShieldCheck } from "lucide-react";
import { AssinaturaBanner } from "./AssinaturaBanner";
import { useMode } from "@/components/modes/ModeProvider";
import { useMasterContext } from "@/components/admin/MasterContextProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { DesktopSetupWizard } from "@/components/desktop/DesktopSetupWizard";
import { DesktopRoleBadge } from "@/components/desktop/DesktopRoleBadge";
import { useFlushConfigEmpresaPending } from "@/hooks/useConfigEmpresa";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useDesktopBootstrap } from "@/hooks/useDesktopBootstrap";
import { useGlobalLocalServerWatchdog } from "@/hooks/useGlobalLocalServerWatchdog";
import { SyncStatusPill } from "./SyncStatusPill";
import { RealtimeStatusDot } from "./RealtimeStatusDot";

// Rotas que usam layout próprio (sem o shell do ERP)
const STANDALONE_ROUTES = new Set(["/auth", "/hub", "/pos", "/pdv"]);

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { modoAtual, isRouteAllowed, isLoading: modosLoading } = useMode();
  const { isDesktop: rodandoDesktop, role: desktopRole, precisaConfigurar } = useDesktopRole();

  // Drena pendências de Configurações da Empresa quando a rede voltar.
  useFlushConfigEmpresaPending();

  // Sincronização automática em background (no-op em web/cloud puro).
  useAutoSync();

  // Wave 2 — bootstrap local-first do desktop (popula SQLite na 1ª vez).
  useDesktopBootstrap();

  // Onda 1 (final) — watchdog global: detecta queda do servidor local e
  // reinicia com backoff em qualquer tela. No-op em web e em terminais.
  useGlobalLocalServerWatchdog();



  const pathname = location.pathname;
  const isStandalone = STANDALONE_ROUTES.has(pathname);
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  // Guard de modo: só dispara navegação quando realmente necessário,
  // e nunca em rotas standalone/admin (que não dependem de modo).
  useEffect(() => {
    if (modosLoading || !user) return;
    if (isStandalone || isAdminRoute) return;
    if (!modoAtual) {
      navigate({ to: "/hub", replace: true });
      return;
    }
    if (!isRouteAllowed(pathname)) {
      navigate({ to: modoAtual.rota_inicial as "/", replace: true });
    }
  }, [pathname, modoAtual, modosLoading, user, isRouteAllowed, isStandalone, isAdminRoute, navigate]);

  // Papel desktop NÃO bloqueia mais o acesso ao ERP. A segurança fica
  // delegada para a cadeia RequireErpUnlock + RequireAdminLike +
  // RequireTerminalPermissao já existente abaixo. Caixa-only continua
  // restrito; admin/gerente em máquina terminal pode entrar no ERP.
  void rodandoDesktop;
  void desktopRole;

  // Wizard de primeiro uso: bloqueia o app inteiro até a máquina estar configurada.
  // Importante: NÃO mostrar antes de autenticar — o wizard fica acima do conteúdo
  // mas só faz sentido após o usuário entrar no app.
  if (precisaConfigurar && pathname !== "/auth") {
    return <DesktopSetupWizard />;
  }

  if (pathname === "/auth") {
    return <Outlet />;
  }

  // /hub, /pos e /pdv usam layout próprio (sem sidebar/menubar do ERP),
  // mas continuam sendo rotas de empresa — bloqueadas se modo master ativo.
  if (pathname === "/hub" || pathname === "/pos" || pathname === "/pdv") {
    return (
      <RequireNotMaster>
        <Outlet />
      </RequireNotMaster>
    );
  }

  // /admin também exige unlock prévio (acesso administrativo).
  if (isAdminRoute) {
    return (
      <RequireAuth>
        <RequireErpUnlock>
          <RequireTerminalPermissao area="erp">
            <Outlet />
          </RequireTerminalPermissao>
        </RequireErpUnlock>
      </RequireAuth>
    );
  }

  const area = areaTerminalDoPath(pathname);

  return (
    <RequireAuth>
      <RequireNotMaster>
        <RequireErpUnlock>
          <RequireAdminLike>
            {area ? (
              <RequireTerminalPermissao area={area}>
                <AppShell />
              </RequireTerminalPermissao>
            ) : (
              <AppShell />
            )}
          </RequireAdminLike>
        </RequireErpUnlock>
      </RequireNotMaster>
    </RequireAuth>
  );
}

function AppShell() {
  const location = useLocation();
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const { modoAtual, clearModo } = useMode();
  const { enterMasterMode } = useMasterContext();
  const navigate = useNavigate();

  // Módulo derivado do pathname (sem useEffect — evita render duplo).
  const derivedModule = useMemo<ModuleKey>(
    () => findModuleByPath(location.pathname).key,
    [location.pathname],
  );
  // Override opcional quando o usuário clica em um módulo no menubar
  // mas a rota ainda não mudou. Limpa quando a rota se alinha.
  const [overrideModule, setOverrideModule] = useState<ModuleKey | null>(null);
  const activeModule = overrideModule ?? derivedModule;

  useEffect(() => {
    if (overrideModule && overrideModule === derivedModule) {
      setOverrideModule(null);
    }
  }, [derivedModule, overrideModule]);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Trocar modo: navega ANTES de limpar o estado pra evitar flicker e
  // que o guard do AppLayout dispare uma segunda navegação.
  const handleTrocarModo = useCallback(() => {
    console.log("[MODE_SWITCH] alternando ERP/PDV");
    navigate({ to: "/hub", replace: true });
    // Limpa o modo no próximo tick, depois que a navegação foi enfileirada.
    queueMicrotask(() => clearModo());
  }, [navigate, clearModo]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Topo fixo: banner + menubar + toolbar */}
      <div className="sticky top-0 z-40 shrink-0">
        <AssinaturaBanner />
        <div className="flex items-center bg-sidebar">
          <div className="flex-1">
            <AppMenubar activeModule={activeModule} onModuleSelect={setOverrideModule} />
          </div>
          <SyncStatusPill />
          <div className="flex items-center px-2"><RealtimeStatusDot /></div>
          <DesktopRoleBadge />
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
            <button
              type="button"
              onClick={() => {
                enterMasterMode();
                navigate({ to: "/admin", replace: true });
              }}
              className="hidden h-11 items-center gap-1.5 border-b border-l border-sidebar-border bg-sidebar px-3 text-[13px] font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
              title="Entrar no painel Master"
            >
              <ShieldCheck className="h-4 w-4" /> Master
            </button>
          )}
        </div>
        <AppToolbar
          activeModule={activeModule}
          onMobileMenuClick={() => setMobileNavOpen(true)}
        />
      </div>

      {/* Área inferior: sidebar fixa + conteúdo rolável */}
      <div className="flex min-h-0 flex-1">
        <ContextSidebar activeModule={activeModule} />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        activeModule={activeModule}
        onModuleSelect={(k) => setOverrideModule(k)}
      />
    </div>
  );
}
