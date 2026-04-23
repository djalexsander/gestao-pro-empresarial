import { Building2, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEmpresaAtual, type EmpresaPapel } from "@/hooks/useEmpresa";

const PAPEL_LABEL: Record<EmpresaPapel, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  gerente_operacional: "Gerente operacional",
};

export function EmpresaSwitcher() {
  const { empresaAtual, empresas, setEmpresaId, isLoading } = useEmpresaAtual();

  if (isLoading || !empresaAtual) return null;
  if (empresas.length === 0) return null;

  // Quando só há 1 empresa, mostra apenas o nome (sem dropdown)
  if (empresas.length === 1) {
    return (
      <div className="hidden md:flex items-center gap-1.5 h-10 px-3 rounded-md border border-border/60 bg-muted/30 text-sm">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium truncate max-w-[160px]">{empresaAtual.nome}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex h-10 gap-1.5 max-w-[220px]"
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{empresaAtual.nome}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Trocar empresa</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {empresas.map((emp) => (
          <DropdownMenuItem
            key={emp.id}
            onSelect={() => emp.id !== empresaAtual.id && setEmpresaId(emp.id)}
            className="flex items-start gap-2 py-2"
          >
            <Check
              className={`h-4 w-4 mt-0.5 shrink-0 ${
                emp.id === empresaAtual.id ? "opacity-100" : "opacity-0"
              }`}
            />
            <div className="flex flex-col min-w-0">
              <span className="font-medium truncate">{emp.nome}</span>
              <span className="text-xs text-muted-foreground">{PAPEL_LABEL[emp.papel]}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
