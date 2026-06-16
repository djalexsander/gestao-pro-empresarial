import { useState } from "react";
import { Building2, CheckCircle2, Loader2, Monitor, ShieldCheck, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { isTerminalOnline, useTerminaisAtivos, type Terminal } from "@/hooks/useTerminais";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { toast } from "sonner";

interface TerminalVinculoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AREAS: Array<{ key: keyof Terminal; label: string }> = [
  { key: "pode_pdv", label: "PDV" },
  { key: "pode_erp", label: "ERP" },
  { key: "pode_financeiro", label: "Financeiro" },
  { key: "pode_configuracoes", label: "Configurações" },
  { key: "pode_relatorios", label: "Relatórios" },
  { key: "pode_cadastros", label: "Cadastros" },
];

export function TerminalVinculoDialog({
  open,
  onOpenChange,
}: TerminalVinculoDialogProps) {
  const { terminal, setTerminal, limparTerminal } = useTerminal();
  const { data: terminais = [], isLoading } = useTerminaisAtivos();
  const { empresaAtual } = useEmpresaAtual();
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  const terminalAtual = terminal
    ? terminais.find((t) => t.id === terminal.id) ?? null
    : null;

  function handleSelecionar(t: Terminal) {
    setSalvandoId(t.id);
    setTerminal({ id: t.id, nome: t.nome });
    toast.success(`Terminal "${t.nome}" vinculado a este dispositivo.`);
    setTimeout(() => {
      setSalvandoId(null);
      onOpenChange(false);
    }, 250);
  }

  function handleDesvincular() {
    limparTerminal();
    toast.message("Terminal desvinculado deste dispositivo.");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            Terminal vinculado a este dispositivo
          </DialogTitle>
          <DialogDescription>
            Cada dispositivo representa um caixa físico. A escolha fica salva
            apenas neste navegador, isolada por empresa e por usuário.
          </DialogDescription>
        </DialogHeader>

        <Card className="p-3">
          <div className="flex items-start gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Empresa atual
              </p>
              <p className="truncate text-sm font-semibold">
                {empresaAtual?.nome ?? "-"}
              </p>
              {empresaAtual?.papel && (
                <Badge variant="secondary" className="mt-0.5 text-[10px]">
                  {empresaAtual.papel}
                </Badge>
              )}
            </div>
          </div>
        </Card>

        <Card className="border-primary/40 bg-primary/5 p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Vínculo atual deste dispositivo
              </p>
              {terminalAtual ? (
                <>
                  <p className="truncate text-sm font-semibold">
                    {terminalAtual.nome}
                    {isTerminalOnline(terminalAtual) ? (
                      <Badge className="ml-2 bg-emerald-600 text-[10px] hover:bg-emerald-600">
                        Online
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Inativo
                      </Badge>
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {AREAS.map((area) => (
                      <Badge
                        key={area.key}
                        variant={terminalAtual[area.key] ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {area.label}
                      </Badge>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum terminal vinculado.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Separator />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Terminais disponíveis</p>
            {terminalAtual && (
              <Button variant="ghost" size="sm" onClick={handleDesvincular}>
                Desvincular
              </Button>
            )}
          </div>
          <ScrollArea className="max-h-[320px] pr-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando terminais...
              </div>
            ) : terminais.length === 0 ? (
              <Card className="p-4 text-center text-sm text-muted-foreground">
                Nenhum terminal cadastrado.
              </Card>
            ) : (
              <div className="space-y-2">
                {terminais.map((t) => {
                  const selected = terminal?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelecionar(t)}
                      className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{t.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.id}
                          </p>
                        </div>
                        {salvandoId === t.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : selected ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : t.ativo ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
