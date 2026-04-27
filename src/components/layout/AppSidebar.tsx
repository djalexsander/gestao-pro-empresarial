import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Receipt,
  Wallet,
  Truck,
  Users,
  BarChart3,
  Settings,
  Sparkles,
  ChevronLeft,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIsSuperAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMasterContext } from "@/components/admin/MasterContextProvider";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    label: "Principal",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operacional",
    items: [
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/estoque", label: "Estoque", icon: Boxes },
      { to: "/compras", label: "Compras", icon: ShoppingCart },
      { to: "/vendas", label: "Vendas", icon: Receipt },
    ],
  },
  {
    label: "Financeiro",
    items: [{ to: "/financeiro", label: "Financeiro", icon: Wallet }],
  },
  {
    label: "Cadastros",
    items: [
      { to: "/fornecedores", label: "Fornecedores", icon: Truck },
      { to: "/clientes", label: "Clientes", icon: Users },
    ],
  },
  {
    label: "Análise",
    items: [
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const { user } = useAuth();
  const { enterMasterMode } = useMasterContext();

  const displayName =
    (user?.user_metadata?.nome as string | undefined) ||
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.email ? user.email.split("@")[0] : "Usuário");
  const displayEmail = user?.email ?? "";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("") || "U";

  const allGroups: NavGroup[] = isSuperAdmin
    ? [
        ...groups,
        {
          label: "Plataforma",
          items: [{ to: "/admin", label: "Painel Master", icon: ShieldCheck }],
        },
      ]
    : groups;

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 ease-out",
          collapsed ? "w-[72px]" : "w-64",
          "lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center justify-between gap-2 border-b border-sidebar-border px-4">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">Gestão Pro</p>
                <p className="truncate text-[11px] text-sidebar-foreground/60">ERP Empresarial</p>
              </div>
            )}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="hidden h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:inline-flex"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {allGroups.map((group) => (
            <div key={group.label} className="mb-5">
              {!collapsed && (
                <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = currentPath === item.to;
                  const isMasterEntry = item.to === "/admin";
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={(e) => {
                          if (isMasterEntry) {
                            e.preventDefault();
                            enterMasterMode();
                            navigate({ to: "/admin", replace: true });
                          }
                          onMobileClose();
                        }}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
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

        {/* User */}
        <div className="border-t border-sidebar-border p-3">
          <div
            className={cn(
              "flex items-center gap-3 rounded-md p-2",
              collapsed && "justify-center"
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-xs text-sidebar-foreground/60">{displayEmail}</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// Hook leve para gerenciar estado da sidebar
export function useSidebarState() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return {
    collapsed,
    mobileOpen,
    toggle: () => setCollapsed((v) => !v),
    openMobile: () => setMobileOpen(true),
    closeMobile: () => setMobileOpen(false),
  };
}
