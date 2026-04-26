import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Monitor,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
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
import {
  isTerminalOnline,
  useTerminaisAtivos,
  type Terminal,
} from "@/hooks/useTerminais";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { useTerminalConexao } from "@/hooks/useTerminalConexao";
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

/**
 * Modal para o usuário selecionar/trocar explicitamente o terminal vinculado
 * a este dispositivo, mostrando empresa atual, status de conexão e o terminal
 * atualmente em uso (com permissões e estado online/offline).
 */
export function TerminalVinculoDialog({
  open,
  onOpenChange,
}: TerminalVinculoDialogProps) {
  const { terminal, setTerminal, limparTerminal } = useTerminal();
  const { data: terminais = [], isLoading } = useTerminaisAtivos();
  const { empresaAtual } = useEmpresaAtual();
  const conexao = useTerminalConexao();
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

        {/* Empresa atual + status de conexão */}
        <div className="grid gap-2 sm:grid-cols-2">
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
                  {empresaAtual?.nome ?? "—"}
                </p>
                {empresaAtual?.papel && (
                  <Badge variant="secondary" className="mt-0.5 text-[10px]">
                    {empresaAtual.papel}
                  </Badge>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="flex items-start gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-md ${
                  conexao.status === "online"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : conexao.status === "reconectando"
                      ? "bg-amber-500/10 text-amber-600"
                      : "bg-destructive/10 text-destructive"
                }`}
              >
                {conexao.status === "online" ? (
                  <Wifi className="h-4 w-4" />
                ) : (
                  <WifiOff className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Conexão com o servidor
                </p>
                <p className="text-sm font-semibold capitalize">
                  {conexao.status}
                  {conexao.latenciaMs !== null && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({conexao.latenciaMs} ms)
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {conexao.ultimoSync
                    ? `Último sync: ${conexao.ultimoSync.toLocaleTimeString()}`
                    : "Aguardando ping…"}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Terminal atualmente vinculado */}
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
                    {terminalAtual.papel === "servidor" && (
                      <Badge className="ml-2 bg-amber-600 text-[10px] hover:bg-amber-600">
                        Servidor principal
                      </Badge>
                    )}
                    {isTerminalOnline(terminalAtual) ? (
                      <Badge className="ml-2 bg-emerald-600 text-[10px] hover:bg-emerald-600">
                        Online
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Offline
                      </Badge>
                    )}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {AREAS.filter(
                      (a) => (terminalAtual as unknown as Record<string, boolean>)[a.key as string],
                    ).map((a) => (
                      <Badge
                        key={a.key as string}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {a.label}
                      </Badge>
                    ))}
                    {AREAS.every(
                      (a) => !(terminalAtual as unknown as Record<string, boolean>)[a.key as string],
                    ) && (
                      <span className="text-[11px] text-muted-foreground">
                        Sem permissões liberadas
                      </span>
                    )}
                  </div>
                </>
              ) : terminal ? (
                <>
                  <p className="text-sm font-semibold">
                    {terminal.nome}{" "}
                    <Badge variant="destructive" className="ml-1 text-[10px]">
                      Não encontrado
                    </Badge>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Este terminal não existe mais nesta empresa. Selecione
                    outro abaixo.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum terminal vinculado neste dispositivo.
                </p>
              )}
            </div>
            {terminal && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDesvincular}
                title="Remover vínculo deste dispositivo"
              >
                Desvincular
              </Button>
            )}
          </div>
        </Card>

        <Separator />

        <div>
          <p className="mb-2 text-sm font-medium">Trocar terminal</p>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : terminais.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum terminal cadastrado nesta empresa. Peça ao administrador
              para criar em <em>Configurações → Terminais</em>.
            </div>
          ) : (
            <ScrollArea className="max-h-[280px] pr-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {terminais.map((t) => {
                  const ativo = terminal?.id === t.id;
                  const online = isTerminalOnline(t);
                  return (
                    <Card
                      key={t.id}
                      className={`cursor-pointer p-3 transition-all ${
                        ativo
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/60 hover:shadow-sm"
                      }`}
                      onClick={() => !ativo && handleSelecionar(t)}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Monitor className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 truncate text-sm font-medium">
                            {t.nome}
                            {t.papel === "servidor" && (
                              <Badge className="bg-amber-600 text-[10px] hover:bg-amber-600">
                                Servidor
                              </Badge>
                            )}
                          </p>
                          {t.descricao && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {t.descricao}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                            {online ? (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Online
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                                Offline
                              </span>
                            )}
                            {t.caixa_aberto_id && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">
                                Caixa em uso
                              </span>
                            )}
                          </div>
                        </div>
                        {ativo ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                        ) : salvandoId === t.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            <XCircle className="mr-1 inline h-3 w-3" />
            Trocar de empresa também troca a lista de terminais disponíveis.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
