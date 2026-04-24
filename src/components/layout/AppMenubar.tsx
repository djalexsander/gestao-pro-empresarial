import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
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
import { useFilteredModules } from "./useFilteredModules";
import { useAuth } from "@/components/auth/AuthProvider";
import { toast } from "sonner";
import { useEffect } from "react";

interface AppMenubarProps {
  activeModule: ModuleKey;
  onModuleSelect: (key: ModuleKey) => void;
}

export function AppMenubar({ activeModule, onModuleSelect }: AppMenubarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const router = useRouter();
  const { signOut } = useAuth();
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

  // === Ações reais do menu File ===
  const novo = () => {
    navigate({ to: "/pdv" });
    toast.success("Nova venda iniciada no PDV");
  };
  const abrir = () => navigate({ to: "/vendas" });
  const salvar = () => toast.success("Alterações salvas automaticamente");
  const salvarComo = () => navigate({ to: "/relatorios" });
  const importar = () => navigate({ to: "/produtos" });
  const exportar = () => navigate({ to: "/relatorios" });
  const imprimir = () => {
    if (typeof window !== "undefined") window.print();
  };
  const configuracoes = () => navigate({ to: "/configuracoes" });
  const preferencias = () => navigate({ to: "/configuracoes" });
  const historico = () => navigate({ to: "/relatorios/caixa" });
  const sair = () => signOut();

  // === Atalhos de teclado globais ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      const map: Record<string, () => void> = {
        n: novo,
        o: abrir,
        s: shift ? salvarComo : salvar,
        i: importar,
        e: exportar,
        p: imprimir,
        ",": configuracoes,
        h: historico,
        q: sair,
      };

      const action = map[key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <DropdownMenuItem onSelect={novo}>
            <FilePlus className="h-4 w-4" /> Novo
            <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={abrir}>
            <FolderOpen className="h-4 w-4" /> Abrir
            <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={salvar}>
            <Save className="h-4 w-4" /> Salvar
            <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={salvarComo}>
            <FileText className="h-4 w-4" /> Salvar como…
            <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={importar}>
            <Upload className="h-4 w-4" /> Importar
            <DropdownMenuShortcut>Ctrl+I</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportar}>
            <Download className="h-4 w-4" /> Exportar
            <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={imprimir}>
            <Printer className="h-4 w-4" /> Imprimir
            <DropdownMenuShortcut>Ctrl+P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={configuracoes}>
            <Settings2 className="h-4 w-4" /> Configurações
            <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={preferencias}>
            <SlidersHorizontal className="h-4 w-4" /> Preferências
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={historico}>
            <History className="h-4 w-4" /> Histórico
            <DropdownMenuShortcut>Ctrl+H</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={sair}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" /> Sair
            <DropdownMenuShortcut>Ctrl+Q</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
