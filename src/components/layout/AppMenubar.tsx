import { useEffect, useRef } from "react";
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
  const navRef = useRef<HTMLElement>(null);

  // No celular as abas rolam na horizontal: mantém a aba ativa visível.
  // Só age abaixo de lg (desktop/Tauri tem largura mínima de 1024px).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !window.matchMedia("(max-width: 1023px)").matches) return;
    const el = nav.querySelector<HTMLElement>("[data-active=true]");
    if (!el) return;
    const left = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [activeModule, modules.length]);

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
    <header className="sticky top-0 z-40 flex h-12 items-center gap-1 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground shadow-sm max-lg:h-11 max-lg:px-2">
      {/* Brand */}
      <Link
        to="/"
        className="flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sidebar-foreground max-lg:h-10 max-lg:min-w-10 max-lg:justify-center transition-colors hover:bg-sidebar-accent max-lg:px-1.5"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="hidden text-sm font-semibold sm:inline">Gestão Pro</span>
      </Link>

      <div className="mx-2 hidden h-6 w-px shrink-0 bg-sidebar-border sm:block max-lg:mx-1" />

      {/* Nova Venda — atalho de PDV */}
      <Link
        to="/pdv"
        className={cn(
          "ml-1 flex h-8 max-lg:h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors max-lg:ml-0 max-lg:px-2",
          location.pathname === "/pdv"
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-primary/12 text-primary hover:bg-primary/20",
        )}
        title="Abrir frente de caixa (PDV)"
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        Nova Venda
      </Link>

      <div className="mx-2 hidden h-6 w-px shrink-0 bg-sidebar-border sm:block max-lg:mx-1" />

      {/* Module tabs */}
      <nav
        ref={navRef}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden max-lg:overflow-x-auto max-lg:overflow-y-hidden max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden"
      >
        {modules.map((mod) => {
          const active = activeModule === mod.key;
          return (
            <button
              key={mod.key}
              data-active={active}
              onClick={() => handleModuleClick(mod.key)}
              onMouseEnter={() => handleModuleHover(mod.key)}
              onFocus={() => handleModuleHover(mod.key)}
              className={cn(
                "relative flex h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition-colors max-lg:h-10 max-lg:px-3",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              {mod.label}
              {active && (
                <span className="absolute -bottom-[5px] left-2 right-2 h-[2px] rounded-full bg-sidebar-primary max-lg:bottom-0" />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
