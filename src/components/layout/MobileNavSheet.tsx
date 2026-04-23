import { Link, useLocation } from "@tanstack/react-router";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { MODULES, type ModuleKey } from "./navigation";
import { cn } from "@/lib/utils";
import { useIsSuperAdmin } from "@/hooks/useAdmin";
import { ShieldCheck } from "lucide-react";

interface MobileNavSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeModule: ModuleKey;
  onModuleSelect: (key: ModuleKey) => void;
}

export function MobileNavSheet({
  open,
  onOpenChange,
  activeModule,
  onModuleSelect,
}: MobileNavSheetProps) {
  const location = useLocation();
  const { data: isSuperAdmin } = useIsSuperAdmin();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[300px] bg-sidebar p-0 text-sidebar-foreground">
        <div className="flex h-12 items-center border-b border-sidebar-border px-4">
          <p className="text-sm font-semibold">Navegação</p>
        </div>

        <div className="flex h-[calc(100%-3rem)] flex-col overflow-y-auto">
          {MODULES.map((mod) => {
            const isOpen = activeModule === mod.key;
            return (
              <div key={mod.key} className="border-b border-sidebar-border/60">
                <button
                  onClick={() => onModuleSelect(mod.key)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-semibold uppercase tracking-wider transition-colors",
                    isOpen
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60",
                  )}
                >
                  {mod.label}
                </button>
                {isOpen && (
                  <ul className="space-y-0.5 p-2">
                    {mod.items.map((item) => {
                      const [base, qs = ""] = item.to.split("?");
                      const search: Record<string, string> = {};
                      if (qs) {
                        for (const part of qs.split("&")) {
                          const [k, v = ""] = part.split("=");
                          if (k) search[decodeURIComponent(k)] = decodeURIComponent(v);
                        }
                      }
                      const hasSearch = Object.keys(search).length > 0;
                      const currentSearch = (location.search ?? {}) as Record<string, string | undefined>;
                      const pathMatches =
                        base === "/"
                          ? location.pathname === "/"
                          : location.pathname.startsWith(base);
                      const active = hasSearch
                        ? pathMatches &&
                          Object.entries(search).every(([k, v]) => currentSearch[k] === v)
                        : pathMatches &&
                          !mod.items.some((sib) => {
                            const sQs = sib.to.split("?")[1];
                            if (!sQs) return false;
                            const sBase = sib.to.split("?")[0];
                            if (sBase !== base) return false;
                            const sSearch: Record<string, string> = {};
                            for (const part of sQs.split("&")) {
                              const [k, v = ""] = part.split("=");
                              if (k) sSearch[decodeURIComponent(k)] = decodeURIComponent(v);
                            }
                            return Object.entries(sSearch).every(([k, v]) => currentSearch[k] === v);
                          });
                      const Icon = item.icon;
                      return (
                        <li key={item.to}>
                          <Link
                            to={base}
                            search={hasSearch ? (search as never) : (undefined as never)}
                            onClick={() => onOpenChange(false)}
                            className={cn(
                              "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                              active
                                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                : "text-sidebar-foreground/85 hover:bg-sidebar-accent",
                            )}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          {isSuperAdmin && (
            <Link
              to="/admin"
              onClick={() => onOpenChange(false)}
              className="mt-auto flex items-center gap-2 border-t border-sidebar-border px-4 py-3 text-sm font-medium text-sidebar-foreground/85 hover:bg-sidebar-accent"
            >
              <ShieldCheck className="h-4 w-4" /> Painel Master
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
