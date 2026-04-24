import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { Sparkles, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULES, findModuleByPath, type ModuleKey } from "./navigation";
import { useFilteredModules } from "./useFilteredModules";

interface AppMenubarProps {
  activeModule: ModuleKey;
  onModuleSelect: (key: ModuleKey) => void;
}

export function AppMenubar({ activeModule, onModuleSelect }: AppMenubarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const router = useRouter();
  const modules = useFilteredModules();

  /** Resolve a rota destino de um módulo (sem efeito colateral) */
  const resolveModuleTarget = (key: ModuleKey): string | null => {
    const mod = modules.find((m) => m.key === key) ?? MODULES.find((m) => m.key === key);
    if (!mod) return null;
    if (mod.directRoute) return mod.directRoute;
    const first = mod.items[0];
    return first ? first.to.split("?")[0] : null;
  };

  const handleModuleClick = (key: ModuleKey) => {
    onModuleSelect(key);
    const target = resolveModuleTarget(key);
    if (!target) return;
    const current = findModuleByPath(location.pathname);
    if (current.key !== key || target !== location.pathname) {
      navigate({ to: target });
    }
  };

  /** Pré-carrega chunk + loader ao hover/focus para tornar o clique instantâneo */
  const handleModuleHover = (key: ModuleKey) => {
    const target = resolveModuleTarget(key);
    if (!target) return;
    void router.preloadRoute({ to: target }).catch(() => {
      // silenciar — preload é melhor-esforço
    });
  };

  return (
    <header className="sticky top-0 z-40 flex h-11 items-center gap-1 border-b border-sidebar-border bg-sidebar px-2 text-sidebar-foreground shadow-sm">
      {/* Brand */}
      <Link
        to="/"
        className="flex h-8 items-center gap-2 rounded-md px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-sidebar-primary text-sidebar-primary-foreground">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="hidden text-sm font-semibold sm:inline">Gestão Pro</span>
      </Link>

      <div className="mx-1 hidden h-5 w-px bg-sidebar-border sm:block" />

      {/* Nova Venda — atalho de PDV */}
      <Link
        to="/pdv"
        className={cn(
          "ml-1 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
          location.pathname === "/pdv"
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-primary/15 text-primary hover:bg-primary/25",
        )}
        title="Abrir frente de caixa (PDV)"
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        Nova Venda
      </Link>

      <div className="mx-1 hidden h-5 w-px bg-sidebar-border sm:block" />

      {/* Module tabs */}
      <nav className="flex items-center gap-0.5">
        {modules.map((mod) => {
          const active = activeModule === mod.key;
          return (
            <button
              key={mod.key}
              onClick={() => handleModuleClick(mod.key)}
              onMouseEnter={() => handleModuleHover(mod.key)}
              onFocus={() => handleModuleHover(mod.key)}
              className={cn(
                "relative flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              {mod.label}
              {active && (
                <span className="absolute -bottom-[5px] left-2 right-2 h-[2px] rounded-full bg-sidebar-primary" />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
