import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  UserCog,
  BarChart3,
  ScrollText,
  ShieldCheck,
  ChevronLeft,
  ArrowLeftRight,
  Package2,
  Puzzle,
  CreditCard,
  Wallet,
  Settings2,
  Layers,
  ClipboardCheck,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMasterContext } from "./MasterContextProvider";

interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; }
interface NavGroup { label: string; items: NavItem[]; }

const groups: NavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { to: "/admin", label: "Visão geral", icon: LayoutDashboard },
      { to: "/admin/empresas", label: "Empresas", icon: Building2 },
      { to: "/admin/usuarios", label: "Usuários", icon: UserCog },
    ],
  },
  {
    label: "Comercial",
    items: [
      { to: "/admin/planos", label: "Planos", icon: Package2 },
      { to: "/admin/modulos", label: "Módulos", icon: Puzzle },
      { to: "/admin/assinaturas", label: "Assinaturas", icon: CreditCard },
      { to: "/admin/pagamentos", label: "Pagamentos", icon: Wallet },
      { to: "/admin/modos", label: "Modos do sistema", icon: Layers },
      { to: "/admin/config-comercial", label: "Configurações", icon: Settings2 },
    ],
  },
  {
    label: "Análise",
    items: [
      { to: "/admin/estatisticas", label: "Estatísticas de uso", icon: BarChart3 },
      { to: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
      { to: "/admin/qa", label: "QA do Sistema", icon: ClipboardCheck },
    ],
  },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function MasterSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { exitMasterMode } = useMasterContext();
  const currentPath = location.pathname;

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/10 bg-[oklch(0.18_0.04_265)] text-white/90 transition-[width,transform] duration-200 ease-out",
          collapsed ? "w-[72px]" : "w-64",
          "lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center justify-between gap-2 border-b border-white/10 px-4">
          <Link to="/admin" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-amber-950 shadow-md">
              <ShieldCheck className="h-5 w-5" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">Master Console</p>
                <p className="truncate text-[11px] text-amber-300/90">SaaS Admin</p>
              </div>
            )}
          </Link>
          <Button
            variant="ghost" size="icon"
            onClick={onToggle}
            className="hidden h-8 w-8 shrink-0 text-white/60 hover:bg-white/10 hover:text-white lg:inline-flex"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        </div>

        {/* Banner modo master */}
        {!collapsed && (
          <div className="mx-3 mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Modo Master
            </p>
            <p className="mt-0.5 text-[11px] leading-tight text-white/70">
              Acesso global. Sem visão do conteúdo das empresas.
            </p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.label} className="mb-5">
              {!collapsed && (
                <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.to === "/admin"
                      ? currentPath === "/admin"
                      : currentPath.startsWith(item.to);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={onMobileClose}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-amber-400/15 text-amber-200 shadow-sm ring-1 ring-amber-400/30"
                            : "text-white/70 hover:bg-white/10 hover:text-white",
                          collapsed && "justify-center"
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Voltar ao app */}
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => {
              exitMasterMode();
              navigate({ to: "/hub", replace: true });
              onMobileClose();
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white",
              collapsed && "justify-center"
            )}
            title={collapsed ? "Sair do modo master" : undefined}
          >
            <ArrowLeftRight className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>Sair do modo master</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

export function useMasterSidebarState() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return {
    collapsed, mobileOpen,
    toggle: () => setCollapsed((v) => !v),
    openMobile: () => setMobileOpen(true),
    closeMobile: () => setMobileOpen(false),
  };
}
