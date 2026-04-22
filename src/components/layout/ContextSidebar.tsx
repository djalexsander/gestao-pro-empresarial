import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { MODULES, type ModuleKey } from "./navigation";
import { ChevronRight } from "lucide-react";

interface ContextSidebarProps {
  activeModule: ModuleKey;
}

export function ContextSidebar({ activeModule }: ContextSidebarProps) {
  const location = useLocation();
  const mod = MODULES.find((m) => m.key === activeModule) ?? MODULES[0];

  return (
    <aside
      key={mod.key}
      className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex animate-in fade-in slide-in-from-left-2 duration-200"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Módulo
          </p>
          <p className="text-sm font-semibold text-foreground">{mod.label}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {mod.items.map((item) => {
            const base = item.to.split("?")[0];
            const active =
              base === "/"
                ? location.pathname === "/"
                : location.pathname === base || location.pathname.startsWith(base + "/");
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={base}
                  className={cn(
                    "group flex items-start gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-muted",
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
                      <span className={cn("truncate font-medium", active && "text-primary")}>
                        {item.label}
                      </span>
                      {active && <ChevronRight className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    {item.description && (
                      <p className="truncate text-[11px] text-muted-foreground">
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
    </aside>
  );
}
