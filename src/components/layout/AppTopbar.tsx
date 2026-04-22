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

interface AppTopbarProps {
  onMobileMenuClick: () => void;
}

export function AppTopbar({ onMobileMenuClick }: AppTopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-sm sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMobileMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="relative flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar produtos, clientes, pedidos..."
          className="h-10 pl-9 bg-muted/40 border-transparent focus-visible:bg-background"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="hidden sm:inline-flex h-10 gap-1.5">
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

        <Button variant="ghost" size="icon" className="relative h-10 w-10">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
        </Button>

        <UserMenu />
      </div>
    </header>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const initials = (user?.user_metadata?.nome ?? user?.email ?? "?")
    .split(" ").map((s: string) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary transition-colors hover:bg-primary/15">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <p className="text-sm font-medium truncate">{user?.user_metadata?.nome ?? "Usuário"}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()} className="text-destructive">Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
