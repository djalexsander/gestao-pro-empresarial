import { Bell, Menu, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useAuth } from "@/components/auth/AuthProvider";
import { NotificationsBell } from "./NotificationsBell";
import { MODULES, type ModuleKey } from "./navigation";

interface AppToolbarProps {
  activeModule: ModuleKey;
  onMobileMenuClick: () => void;
}

export function AppToolbar({ activeModule, onMobileMenuClick }: AppToolbarProps) {
  const mod = MODULES.find((m) => m.key === activeModule) ?? MODULES[0];

  return (
    <div className="flex h-12 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-sm sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 lg:hidden"
        onClick={onMobileMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {mod.label}
        </span>
      </div>

      <div className="relative ml-2 hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar produtos, clientes, pedidos..."
          className="h-9 border-transparent bg-muted/40 pl-9 focus-visible:bg-background"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="hidden h-9 gap-1.5 sm:inline-flex">
              <Plus className="h-4 w-4" />
              Novo
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Cadastrar</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Nova venda</DropdownMenuItem>
            <DropdownMenuItem>Nova compra</DropdownMenuItem>
            <DropdownMenuItem>Novo produto</DropdownMenuItem>
            <DropdownMenuItem>Novo cliente</DropdownMenuItem>
            <DropdownMenuItem>Novo fornecedor</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />

        <NotificationsBell size="sm" />

        <UserMenu />
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const displayName =
    (user?.user_metadata?.nome as string | undefined) ||
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.email ? user.email.split("@")[0] : "Usuário");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary transition-colors hover:bg-primary/15">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()} className="text-destructive">
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
