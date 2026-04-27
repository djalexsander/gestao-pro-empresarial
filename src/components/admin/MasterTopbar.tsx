import { Menu, ShieldCheck, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAdminStats } from "@/hooks/useAdmin";
import { useNavigate } from "@tanstack/react-router";
import { useMasterContext } from "./MasterContextProvider";

interface Props { onMobileMenuClick: () => void; }

export function MasterTopbar({ onMobileMenuClick }: Props) {
  const { data: stats } = useAdminStats();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-sm sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMobileMenuClick}>
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300">
          <ShieldCheck className="h-3.5 w-3.5" /> MASTER
        </span>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          Console administrativo da plataforma
        </span>
      </div>

      {/* KPIs globais */}
      <div className="ml-auto hidden items-center gap-1 md:flex">
        <KpiPill label="Empresas" value={stats?.total_empresas ?? 0} />
        <KpiPill label="Usuários" value={stats?.total_usuarios ?? 0} />
        <KpiPill label="Ativas" value={stats?.empresas_ativas ?? 0} tone="success" />
        <KpiPill label="Bloqueadas" value={stats?.empresas_bloqueadas ?? 0} tone="danger" />
      </div>

      <ThemeToggle />
      <UserMenu />
    </header>
  );
}

function KpiPill({
  label, value, tone = "default",
}: { label: string; value: number; tone?: "default" | "success" | "danger" }) {
  const toneClass =
    tone === "success" ? "text-success" :
    tone === "danger"  ? "text-destructive" :
                         "text-foreground";
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { exitMasterMode } = useMasterContext();
  const navigate = useNavigate();
  const initials = (user?.email ?? "?")
    .split("@")[0].split(/[._-]/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-700 ring-1 ring-amber-500/30 transition-colors hover:bg-amber-500/25 dark:text-amber-300">
          {initials || "MA"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">Master Admin</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            exitMasterMode();
            navigate({ to: "/hub", replace: true });
          }}
        >
          <Globe className="mr-2 h-4 w-4" />
          Ir para o app principal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()} className="text-destructive">
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
