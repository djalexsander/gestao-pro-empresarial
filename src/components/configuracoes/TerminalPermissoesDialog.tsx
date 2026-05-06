import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck } from "lucide-react";
import type { Terminal } from "@/hooks/useTerminais";

interface Permissoes {
  pode_pdv: boolean;
  pode_erp: boolean;
  pode_financeiro: boolean;
  pode_configuracoes: boolean;
  pode_relatorios: boolean;
  pode_cadastros: boolean;
}

const AREAS: Array<{ key: keyof Permissoes; label: string; help: string }> = [
  { key: "pode_pdv", label: "PDV / Caixa", help: "Operação de venda e fechamento de caixa." },
  { key: "pode_erp", label: "ERP", help: "Acesso ao ambiente administrativo." },
  { key: "pode_financeiro", label: "Financeiro", help: "Contas a pagar/receber, fluxo de caixa." },
  { key: "pode_configuracoes", label: "Configurações", help: "Empresa, planos, terminais, funcionários." },
  { key: "pode_relatorios", label: "Relatórios", help: "Vendas, estoque, DRE, fiscal." },
  { key: "pode_cadastros", label: "Cadastros", help: "Produtos, clientes, fornecedores." },
];

export function TerminalPermissoesDialog({
  open,
  onOpenChange,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  terminal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  terminal: (Terminal & Partial<Permissoes>) | null;
}) {
  const qc = useQueryClient();
  const [perms, setPerms] = useState<Permissoes>({
    pode_pdv: true,
    pode_erp: false,
    pode_financeiro: false,
    pode_configuracoes: false,
    pode_relatorios: false,
    pode_cadastros: false,
  });

  useEffect(() => {
    if (open && terminal) {
      setPerms({
        pode_pdv: terminal.pode_pdv ?? true,
        pode_erp: terminal.pode_erp ?? false,
        pode_financeiro: terminal.pode_financeiro ?? false,
        pode_configuracoes: terminal.pode_configuracoes ?? false,
        pode_relatorios: terminal.pode_relatorios ?? false,
        pode_cadastros: terminal.pode_cadastros ?? false,
      });
    }
  }, [open, terminal]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!terminal) throw new Error("Terminal inválido");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc(
        "terminal_atualizar_permissoes",
        {
          _terminal_id: terminal.id,
          _pode_pdv: perms.pode_pdv,
          _pode_erp: perms.pode_erp,
          _pode_financeiro: perms.pode_financeiro,
          _pode_configuracoes: perms.pode_configuracoes,
          _pode_relatorios: perms.pode_relatorios,
          _pode_cadastros: perms.pode_cadastros,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Permissões atualizadas.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function liberarTudo() {
    setPerms({
      pode_pdv: true,
      pode_erp: true,
      pode_financeiro: true,
      pode_configuracoes: true,
      pode_relatorios: true,
      pode_cadastros: true,
    });
  }

  function somentePdv() {
    setPerms({
      pode_pdv: true,
      pode_erp: false,
      pode_financeiro: false,
      pode_configuracoes: false,
      pode_relatorios: false,
      pode_cadastros: false,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Permissões — {terminal?.nome}
          </DialogTitle>
          <DialogDescription>
            Defina quais áreas este terminal pode acessar. Útil para deixar
            terminais como "somente caixa" ou liberar acesso administrativo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
          <Button size="sm" variant="outline" onClick={somentePdv}>
            Somente PDV
          </Button>
          <Button size="sm" variant="outline" onClick={liberarTudo}>
            Liberar tudo
          </Button>
        </div>

        <div className="space-y-3 py-2">
          {AREAS.map((a) => (
            <div
              key={a.key}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor={a.key} className="cursor-pointer font-medium">
                  {a.label}
                </Label>
                <p className="text-xs text-muted-foreground">{a.help}</p>
              </div>
              <Switch
                id={a.key}
                checked={perms[a.key]}
                onCheckedChange={(v) =>
                  setPerms((p) => ({ ...p, [a.key]: v }))
                }
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            Salvar permissões
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
