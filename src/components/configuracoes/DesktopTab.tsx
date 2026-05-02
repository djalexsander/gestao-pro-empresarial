import { useEffect, useState } from "react";
import {
  Server,
  Monitor,
  AlertTriangle,
  RotateCcw,
  Pencil,
  Wifi,
  WifiOff,
  Cloud,
  Loader2,
  CheckCircle2,
  XCircle,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { DesktopSetupWizard } from "@/components/desktop/DesktopSetupWizard";
import { useServerConnection } from "@/components/desktop/useServerConnection";
import {
  fetchDbInfo,
  fetchKnownTerminals,
  type DbInfoPayload,
  type PersistedTerminal,
  type ServerConnStatus,
} from "@/integrations/desktop/serverConnection";

/**
 * Aba "Desktop" em Configurações — só faz sentido quando a app está rodando
 * como desktop. Em web, mostra um aviso explicando.
 */
export function DesktopTab() {
  const { isDesktop, role, config, resetar } = useDesktopRole();
  const { conn, info, daemon, serverMatch, reverificar, testando } =
    useServerConnection();
  const [editando, setEditando] = useState(false);

  // ---- Banco local: polling leve do /db/info e /terminals/known ----
  const [dbInfo, setDbInfo] = useState<DbInfoPayload | null>(null);
  const [knownTerminals, setKnownTerminals] = useState<PersistedTerminal[]>([]);

  useEffect(() => {
    if (!isDesktop || role === "unset") return;
    const cfg =
      role === "terminal"
        ? config.terminal
        : daemon?.running && daemon.port
          ? {
              host: "127.0.0.1",
              porta: daemon.port,
              terminalId: "self",
              terminalNome: "self",
            }
          : undefined;
    if (!cfg) return;

    let alive = true;
    const carregar = async () => {
      const [info, terms] = await Promise.all([
        fetchDbInfo(cfg),
        fetchKnownTerminals(cfg),
      ]);
      if (!alive) return;
      setDbInfo(info);
      setKnownTerminals(terms);
    };
    void carregar();
    const t = setInterval(() => void carregar(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isDesktop, role, config.terminal, daemon?.running, daemon?.port]);

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
              <>
                <RoleSummary
                  icon={<Server className="h-6 w-6" />}
                  titulo={config.serverNome ?? "Servidor Local"}
                  cor="emerald"
                  descricao="Esta máquina é o ponto central da loja. Tem acesso completo ao ERP, financeiro, relatórios e PDV."
                />
                <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                  <Field label="Server ID" value={config.serverId ?? "—"} mono />
                  <Field label="Machine ID" value={config.machineId} mono />
                  {daemon?.hostname && (
                    <Field label="Hostname" value={daemon.hostname} />
                  )}
                  {typeof daemon?.terminals_conectados === "number" && (
                    <Field
                      label="Terminais conectados"
                      value={String(daemon.terminals_conectados)}
                    />
                  )}
                </div>
              </>
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
                    <Field label="Terminal ID" value={config.terminal.terminalId} mono />
                    <Field label="Machine ID" value={config.machineId} mono />
                    <Field label="Servidor (host)" value={config.terminal.host} />
                    <Field label="Porta" value={String(config.terminal.porta)} />
                    {info?.server_name && (
                      <Field label="Servidor remoto" value={info.server_name} />
                    )}
                    {info?.server_id && (
                      <Field label="Server ID remoto" value={info.server_id} mono />
                    )}
                    {serverMatch != null && (
                      <Field
                        label="Identidade do servidor"
                        value={serverMatch ? "✓ Confere" : "⚠ Diferente"}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Status de conexão real */}
        {role !== "unset" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Status de conexão</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void reverificar()}
                disabled={testando}
              >
                {testando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Testar agora
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <ConnStatusRow status={conn.status} mensagem={conn.mensagem} />

              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <Field
                  label="Latência"
                  value={conn.latenciaMs != null ? `${conn.latenciaMs} ms` : "—"}
                />
                <Field
                  label="Última verificação"
                  value={
                    conn.ultimoSync
                      ? conn.ultimoSync.toLocaleTimeString("pt-BR")
                      : "—"
                  }
                />
                <Field label="Endereço" value={conn.baseUrl ?? "—"} mono />
                {conn.serverVersion && (
                  <Field label="Versão do servidor" value={conn.serverVersion} />
                )}
              </div>

              {/* Estado do backend local — só em modo server */}
              {isServer && daemon && (
                <div className="rounded-lg border border-border bg-card p-4 text-sm">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    {daemon.running ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    Backend local{" "}
                    {daemon.running ? "ativo" : "parado"}
                  </div>
                  <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                    <Field label="Porta" value={daemon.port?.toString() ?? "—"} />
                    <Field label="Versão" value={daemon.version} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
              Mesmo com o backend local rodando, a leitura/escrita de dados
              ainda passa pela nuvem. A migração dos adapters para o backend
              local virá na próxima etapa, sem precisar reconfigurar nada aqui.
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

function ConnStatusRow({
  status,
  mensagem,
}: {
  status: ServerConnStatus;
  mensagem?: string | null;
}) {
  const map: Record<
    ServerConnStatus,
    { icon: React.ReactNode; label: string; cor: string }
  > = {
    online: {
      icon: <Wifi className="h-5 w-5" />,
      label: "Conectado ao servidor local",
      cor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    },
    offline: {
      icon: <WifiOff className="h-5 w-5" />,
      label: "Servidor local indisponível",
      cor: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    },
    "invalid-server": {
      icon: <AlertTriangle className="h-5 w-5" />,
      label: "Servidor encontrado, mas inválido",
      cor: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    },
    "cloud-fallback": {
      icon: <Cloud className="h-5 w-5" />,
      label: "Usando nuvem (Lovable Cloud)",
      cor: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
    },
    unknown: {
      icon: <Loader2 className="h-5 w-5 animate-spin" />,
      label: "Verificando…",
      cor: "bg-muted text-muted-foreground border-border",
    },
  };
  const item = map[status];
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${item.cor}`}>
      <div className="mt-0.5 shrink-0">{item.icon}</div>
      <div className="flex-1">
        <div className="font-semibold">{item.label}</div>
        {mensagem && <div className="mt-1 text-sm opacity-90">{mensagem}</div>}
      </div>
    </div>
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
