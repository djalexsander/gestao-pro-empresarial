import { useState } from "react";
import { Crown, Menu, Monitor, Plus, Search, ShoppingCart } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
import { EmpresaSwitcher } from "./EmpresaSwitcher";
import { TerminalVinculoDialog } from "@/components/auth/TerminalVinculoDialog";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { Badge } from "@/components/ui/badge";

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
        <EmpresaSwitcher />

        <TerminalVinculoButton />

        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden md:inline-flex h-10 gap-1.5 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
        >
          <Link to="/planos">
            <Crown className="h-4 w-4" />
            Meu plano
          </Link>
        </Button>

        <Button
          asChild
          variant="outline"
          className="hidden sm:inline-flex h-10 gap-1.5 border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
        >
          <Link to="/pos">
            <ShoppingCart className="h-4 w-4" />
            Abrir PDV
          </Link>
        </Button>

        <Button asChild variant="outline" size="icon" className="sm:hidden h-10 w-10 border-primary/40 text-primary">
          <Link to="/pos" aria-label="Abrir PDV">
            <ShoppingCart className="h-5 w-5" />
          </Link>
        </Button>

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

        <NotificationsBell size="md" />

        <UserMenu />
      </div>
    </header>
  );
}

function TerminalVinculoButton() {
  const [open, setOpen] = useState(false);
  const { terminal } = useTerminal();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden md:inline-flex h-10 gap-1.5"
        onClick={() => setOpen(true)}
        title="Terminal vinculado a este dispositivo"
      >
        <Monitor className="h-4 w-4" />
        <span className="max-w-[120px] truncate">
          {terminal?.nome ?? "Sem terminal"}
        </span>
        {!terminal && (
          <Badge variant="secondary" className="h-5 px-1 text-[10px]">
            !
          </Badge>
        )}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="md:hidden h-10 w-10"
        onClick={() => setOpen(true)}
        aria-label="Terminal vinculado"
      >
        <Monitor className="h-4 w-4" />
      </Button>
      <TerminalVinculoDialog open={open} onOpenChange={setOpen} />
    </>
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
        <DropdownMenuItem asChild>
          <Link to="/planos">Meu plano</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/modulos">Módulos</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()} className="text-destructive">Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
