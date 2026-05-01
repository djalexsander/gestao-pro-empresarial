import { useState } from "react";
import { Server, Monitor, AlertTriangle, RotateCcw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { DesktopSetupWizard } from "@/components/desktop/DesktopSetupWizard";

/**
 * Aba "Desktop" em Configurações — só faz sentido quando a app está rodando
 * como desktop. Em web, mostra um aviso explicando.
 */
export function DesktopTab() {
  const { isDesktop, role, config, resetar } = useDesktopRole();
  const [editando, setEditando] = useState(false);

  if (!isDesktop) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Modo Desktop</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Esta tela só fica disponível quando o Gestão Pro estiver rodando
            no aplicativo desktop (Tauri).
          </p>
          <p>
            No desktop, aqui você define se a máquina é{" "}
            <strong>Servidor Local</strong> ou <strong>Terminal Cliente</strong>,
            além dos dados de conexão com o servidor da loja.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isServer = role === "server";
  const isTerminal = role === "terminal";

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>Papel desta máquina</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditando(true)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Reconfigurar
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {role === "unset" && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="text-sm">
                  Esta máquina ainda não foi configurada. Clique em{" "}
                  <strong>Reconfigurar</strong> para definir o papel.
                </div>
              </div>
            )}

            {isServer && (
              <RoleSummary
                icon={<Server className="h-6 w-6" />}
                titulo="Servidor Local"
                cor="emerald"
                descricao="Esta máquina é o ponto central da loja. Tem acesso completo ao ERP, financeiro, relatórios e PDV."
              />
            )}

            {isTerminal && (
              <>
                <RoleSummary
                  icon={<Monitor className="h-6 w-6" />}
                  titulo="Terminal Cliente"
                  cor="blue"
                  descricao="Esta máquina opera como caixa/terminal. Acesso focado em PDV e consultas operacionais (produtos, estoque, clientes)."
                />
                {config.terminal && (
                  <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                    <Field label="Nome do terminal" value={config.terminal.terminalNome} />
                    <Field label="ID interno" value={config.terminal.terminalId} mono />
                    <Field label="Servidor (host)" value={config.terminal.host} />
                    <Field label="Porta" value={String(config.terminal.porta)} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backend de dados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Lovable Cloud</Badge>
              <span className="text-muted-foreground">
                Fonte de dados ativa nesta etapa.
              </span>
            </div>
            <p className="text-muted-foreground">
              O papel desta máquina (Servidor / Terminal) já está separado do
              backend de dados. Quando o servidor local da loja for ativado, o
              terminal passará a consumir o backend local automaticamente, sem
              precisar reconfigurar nada aqui.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manutenção</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={resetar}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Limpar configuração e refazer
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Apaga apenas a configuração local desta máquina. Não afeta dados
              da empresa.
            </p>
          </CardContent>
        </Card>
      </div>

      {editando && (
        <DesktopSetupWizard
          modoEdicao
          onClose={() => setEditando(false)}
        />
      )}
    </>
  );
}

function RoleSummary({
  icon,
  titulo,
  descricao,
  cor,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  cor: "emerald" | "blue";
}) {
  const corClasses =
    cor === "emerald"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  return (
    <div className="flex items-start gap-4 rounded-lg border border-border p-4">
      <div className={`rounded-lg p-2.5 ${corClasses}`}>{icon}</div>
      <div className="flex-1">
        <div className="font-semibold text-foreground">{titulo}</div>
        <div className="mt-1 text-sm text-muted-foreground">{descricao}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 ${mono ? "font-mono text-xs" : "text-sm"} text-foreground`}>
        {value}
      </div>
    </div>
  );
}
