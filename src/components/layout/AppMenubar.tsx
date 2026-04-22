import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Sparkles,
  FileText,
  FolderOpen,
  Save,
  FilePlus,
  Upload,
  Download,
  Printer,
  Settings2,
  SlidersHorizontal,
  History,
  LogOut,
  ChevronDown,
  ShoppingBag,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MODULES, findModuleByPath, type ModuleKey } from "./navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { toast } from "sonner";

interface AppMenubarProps {
  activeModule: ModuleKey;
  onModuleSelect: (key: ModuleKey) => void;
}

export function AppMenubar({ activeModule, onModuleSelect }: AppMenubarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();

  const handleModuleClick = (key: ModuleKey) => {
    const mod = MODULES.find((m) => m.key === key)!;
    onModuleSelect(key);
    if (mod.directRoute) {
      navigate({ to: mod.directRoute });
    } else {
      // Se rota atual não pertence ao módulo, abre o primeiro item
      const current = findModuleByPath(location.pathname);
      if (current.key !== key) {
        const first = mod.items[0];
        navigate({ to: first.to.split("?")[0] });
      }
    }
  };

  const stub = (label: string) => () => toast.info(`${label} — em breve`);

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

      {/* FILE menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors",
              "hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
            )}
          >
            File
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={stub("Novo")}>
            <FilePlus className="h-4 w-4" /> Novo
            <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Abrir")}>
            <FolderOpen className="h-4 w-4" /> Abrir
            <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Salvar")}>
            <Save className="h-4 w-4" /> Salvar
            <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Salvar como")}>
            <FileText className="h-4 w-4" /> Salvar como…
            <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={stub("Importar")}>
            <Upload className="h-4 w-4" /> Importar
            <DropdownMenuShortcut>Ctrl+I</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Exportar")}>
            <Download className="h-4 w-4" /> Exportar
            <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Imprimir")}>
            <Printer className="h-4 w-4" /> Imprimir
            <DropdownMenuShortcut>Ctrl+P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: "/configuracoes" })}>
            <Settings2 className="h-4 w-4" /> Configurações
            <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Preferências")}>
            <SlidersHorizontal className="h-4 w-4" /> Preferências
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={stub("Histórico")}>
            <History className="h-4 w-4" /> Histórico
            <DropdownMenuShortcut>Ctrl+H</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => signOut()}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" /> Sair
            <DropdownMenuShortcut>Ctrl+Q</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Module tabs */}
      <nav className="flex items-center gap-0.5">
        {MODULES.map((mod) => {
          const active = activeModule === mod.key;
          return (
            <button
              key={mod.key}
              onClick={() => handleModuleClick(mod.key)}
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
