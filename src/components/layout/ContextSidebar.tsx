import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { type ModuleKey } from "./navigation";
import { useFilteredModules } from "./useFilteredModules";
import { ChevronRight, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useCaixaExitGuard } from "@/components/caixa/CaixaExitGuardProvider";
import { APP_VERSION } from "@/lib/version";

interface ContextSidebarProps {
  activeModule: ModuleKey;
}

/** Quebra "/financeiro?tab=pagar" em { path, search } */
function splitTo(to: string): { path: string; search: Record<string, string> } {
  const [path, qs = ""] = to.split("?");
  const search: Record<string, string> = {};
  if (qs) {
    for (const part of qs.split("&")) {
      const [k, v = ""] = part.split("=");
      if (k) search[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { path, search };
}

export function ContextSidebar({ activeModule }: ContextSidebarProps) {
  const location = useLocation();
  const modules = useFilteredModules();
  const { signOut } = useAuth();
  const { guardedSignOut } = useCaixaExitGuard();
  const mod = modules.find((m) => m.key === activeModule) ?? modules[0];

  // Parse current search params
  const currentSearch = (location.search ?? {}) as Record<string, string | undefined>;

  // Itens do módulo que possuem search params (ex.: ?tab=pagar)
  const itemsWithSearch = mod.items
    .map((it) => splitTo(it.to))
    .filter((s) => Object.keys(s.search).length > 0 && s.path === location.pathname);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/80 bg-card lg:flex">
      <div className="flex h-14 items-center justify-between border-b border-border/70 px-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Módulo
          </p>
          <p className="text-sm font-semibold text-foreground">{mod.label}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {mod.items.map((item) => {
            const { path, search } = splitTo(item.to);
            const Icon = item.icon;

            // Match de pathname
            const pathMatches =
              path === "/"
                ? location.pathname === "/"
                : location.pathname === path || location.pathname.startsWith(path + "/");

            const itemHasSearch = Object.keys(search).length > 0;

            // Active rule:
            // - Item COM search params: marca ativo apenas se TODOS os params batem com a URL atual
            // - Item SEM search params: marca ativo se pathname bate E nenhum outro item do mesmo
            //   path com search params está ativo (para evitar "Financeiro" + "Contas a pagar" juntos)
            let active = false;
            if (itemHasSearch) {
              active =
                pathMatches &&
                Object.entries(search).every(([k, v]) => currentSearch[k] === v);
            } else {
              const someSiblingActive = itemsWithSearch.some((sib) =>
                Object.entries(sib.search).every(([k, v]) => currentSearch[k] === v),
              );
              active = pathMatches && !someSiblingActive;
            }

            return (
              <li key={item.to}>
                <Link
                  to={path}
                  search={itemHasSearch ? (search as never) : (undefined as never)}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                      : "text-foreground/75 hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-[18px] w-[18px] shrink-0",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate font-semibold", active && "text-primary")}>
                        {item.label}
                      </span>
                      {active && <ChevronRight className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    {item.description && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Rodapé fixo: Sair + versão do app */}
      <div className="shrink-0 border-t border-border/70 p-3">
        <button
          onClick={() => {
            void guardedSignOut(signOut);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Sair
        </button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Versão {APP_VERSION}
        </p>
      </div>
    </aside>
  );
}
