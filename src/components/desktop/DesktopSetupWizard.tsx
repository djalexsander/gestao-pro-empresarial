import { useState } from "react";
import { Server, Monitor, Loader2, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useDesktopRole } from "./DesktopRoleProvider";
import { toast } from "sonner";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

/**
 * Wizard de primeiro uso do desktop. Bloqueia o app inteiro até a máquina
 * ter um papel definido (`server` ou `terminal`). Reaparece em modo edição
 * quando chamado pela aba Configurações → Desktop.
 */
export function DesktopSetupWizard({
  onClose,
  modoEdicao = false,
}: {
  onClose?: () => void;
  modoEdicao?: boolean;
}) {
  const { config, definirRole } = useDesktopRole();
  const [step, setStep] = useState<"role" | "terminal-config">(
    config.role === "terminal" && modoEdicao ? "terminal-config" : "role",
  );
  const [escolha, setEscolha] = useState<"server" | "terminal" | null>(
    modoEdicao ? (config.role as "server" | "terminal") : null,
  );

  // Form do terminal
  const [host, setHost] = useState(config.terminal?.host ?? "");
  const [porta, setPorta] = useState(String(config.terminal?.porta ?? 7400));
  const [terminalNome, setTerminalNome] = useState(
    config.terminal?.terminalNome ?? "",
  );
  const [salvando, setSalvando] = useState(false);

  function handleEscolher(role: "server" | "terminal") {
    setEscolha(role);
    if (role === "server") {
      definirRole("server");
      toast.success("Esta máquina foi definida como Servidor Local.");
      onClose?.();
      return;
    }
    setStep("terminal-config");
  }

  function handleSalvarTerminal() {
    if (!terminalNome.trim()) {
      toast.error("Informe o nome do terminal (ex.: Caixa 01).");
      return;
    }
    const portaNum = Number(porta);
    if (!Number.isFinite(portaNum) || portaNum <= 0 || portaNum > 65535) {
      toast.error("Porta inválida.");
      return;
    }
    setSalvando(true);
    const cfg: TerminalConexaoConfig = {
      host: host.trim() || "localhost",
      porta: portaNum,
      terminalId:
        config.terminal?.terminalId ??
        `term-${Math.random().toString(36).slice(2, 10)}`,
      terminalNome: terminalNome.trim(),
    };
    definirRole("terminal", cfg);
    toast.success("Terminal configurado com sucesso.");
    setSalvando(false);
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-3xl my-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-foreground">
            {modoEdicao ? "Configuração do Desktop" : "Configuração inicial"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {step === "role"
              ? "Defina o papel desta máquina na sua rede local."
              : "Informe os dados de conexão deste terminal."}
          </p>
        </div>

        {step === "role" && (
          <div className="grid gap-4 md:grid-cols-2">
            <RoleCard
              titulo="Servidor Local"
              descricao="Máquina principal da loja. Acessa o ERP completo, financeiro, relatórios e PDV. No futuro, hospedará o backend e o banco de dados local da rede."
              icon={<Server className="h-10 w-10" />}
              ativo={escolha === "server"}
              onClick={() => handleEscolher("server")}
            />
            <RoleCard
              titulo="Terminal Cliente"
              descricao="Máquina de caixa conectada ao servidor da loja. Acesso focado em PDV e consultas operacionais (produtos, estoque, clientes)."
              icon={<Monitor className="h-10 w-10" />}
              ativo={escolha === "terminal"}
              onClick={() => handleEscolher("terminal")}
            />
          </div>
        )}

        {step === "terminal-config" && (
          <Card className="p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="terminal-nome">Nome deste terminal *</Label>
              <Input
                id="terminal-nome"
                placeholder="Ex.: Caixa 01, Balcão"
                value={terminalNome}
                onChange={(e) => setTerminalNome(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Como este caixa aparecerá em relatórios e na fila de heartbeat.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div className="space-y-2">
                <Label htmlFor="terminal-host">
                  Host / IP do servidor local
                </Label>
                <Input
                  id="terminal-host"
                  placeholder="192.168.0.10 ou servidor.local"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terminal-porta">Porta</Label>
                <Input
                  id="terminal-porta"
                  type="number"
                  inputMode="numeric"
                  placeholder="7400"
                  value={porta}
                  onChange={(e) => setPorta(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p>
                <strong>Nesta etapa</strong>, o terminal continua usando a
                nuvem como backend. Os dados de conexão acima ficam guardados
                para a próxima fase, quando o servidor local da loja for ativado
                — sem precisar reconfigurar nada aqui.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => setStep("role")}
                disabled={salvando}
              >
                Voltar
              </Button>
              <Button onClick={handleSalvarTerminal} disabled={salvando}>
                {salvando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Salvar e continuar
              </Button>
            </div>
          </Card>
        )}

        {modoEdicao && step === "role" && (
          <div className="mt-6 text-center">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleCard({
  titulo,
  descricao,
  icon,
  ativo,
  onClick,
}: {
  titulo: string;
  descricao: string;
  icon: React.ReactNode;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-start gap-4 rounded-xl border-2 p-6 text-left transition-all hover:border-primary hover:bg-accent/40 ${
        ativo ? "border-primary bg-accent/40" : "border-border bg-card"
      }`}
    >
      <div className="rounded-lg bg-primary/10 p-3 text-primary">{icon}</div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-foreground">{titulo}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{descricao}</p>
      </div>
      <div className="flex w-full items-center justify-end gap-1.5 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Selecionar <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}
