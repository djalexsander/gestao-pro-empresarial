import { useState } from "react";
import { Bug, ClipboardCopy, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { DesktopConfig } from "@/integrations/desktop/types";
import type {
  DbInfoPayload,
  OutboxStats,
  ServerConnInfo,
  ServerInfoPayload,
} from "@/integrations/desktop/serverConnection";
import type { LocalServerStatus } from "@/integrations/desktop/tauriBridge";
import { APP_VERSION } from "@/lib/version";

interface Props {
  config: DesktopConfig;
  conn: ServerConnInfo | null;
  info: ServerInfoPayload | null;
  daemon: LocalServerStatus | null;
  dbInfo: DbInfoPayload | null;
  outboxes?: Record<string, OutboxStats | null> | null;
}

/**
 * Card de Diagnóstico de Suporte.
 *
 * Reúne em um único bloco copiável tudo que ajuda o suporte a entender o
 * estado da máquina sem precisar pedir prints da pessoa em campo: versão,
 * papel, IDs estáveis, info de conexão e fila de cada outbox.
 */
export function SuporteDiagnosticoCard({
  config,
  conn,
  info,
  daemon,
  dbInfo,
  outboxes,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const serverPort = config.serverPort ?? config.terminal?.porta ?? 3333;
  const localBaseUrl = config.localBaseUrl ?? `http://127.0.0.1:${serverPort}`;
  const safeConn: ServerConnInfo =
    conn ?? {
      status: "unknown",
      latenciaMs: null,
      ultimoSync: null,
      baseUrl: null,
    };
  const effectiveBaseUrl =
    config.role === "server"
      ? safeConn.baseUrl ?? localBaseUrl
      : safeConn.baseUrl ?? localBaseUrl;
  const effectiveDaemon =
    daemon ??
    (config.role === "server"
      ? {
          running: false,
          port: serverPort,
          started_at: null,
          server_name: config.serverNome ?? "Servidor Gestão Pro",
          server_id: config.serverId ?? null,
          hostname: null,
          app: "Gestao Pro",
          version: APP_VERSION,
          upstream_configured: false,
          terminals_conectados: 0,
          auth_token: null,
        }
      : null);

  const snapshot = {
    gerado_em: new Date().toISOString(),
    app_version: APP_VERSION,
    desktop: {
      role: config.role,
      machine_id: config.machineId,
      server_id: config.serverId ?? null,
      server_nome: config.serverNome ?? null,
      server_port: config.serverPort ?? null,
      local_base_url: config.localBaseUrl ?? null,
      network_host: config.networkHost ?? null,
      network_base_url: config.networkBaseUrl ?? null,
      terminal: config.terminal
        ? {
            terminal_id: config.terminal.terminalId,
            terminal_nome: config.terminal.terminalNome,
            host: config.terminal.host,
            porta: config.terminal.porta,
          }
        : null,
    },
    conexao: {
      status: safeConn.status ?? "unknown",
      latencia_ms: safeConn.latenciaMs ?? null,
      base_url: effectiveBaseUrl,
      server_name: safeConn.serverName ?? null,
      server_id_remoto: safeConn.serverId ?? null,
      server_version: safeConn.serverVersion ?? null,
      mensagem: safeConn.mensagem ?? null,
      last_endpoint: (safeConn as any).lastEndpoint ?? null,
      last_latency_ms: (safeConn as any).lastLatencyMs ?? null,
      last_error_detail: (safeConn as any).lastErrorDetail ?? null,
    },
    server_info: info
      ? {
          hostname: info.hostname ?? null,
          port: info.port ?? null,
          role: info.role ?? null,
          terminals_conectados: info.terminals_conectados ?? null,
          upstream_configured: info.upstream_configured ?? null,
          started_at_iso: info.started_at_iso ?? null,
        }
      : null,
    daemon: effectiveDaemon
      ? {
          running: effectiveDaemon.running,
          port: effectiveDaemon.port,
          version: effectiveDaemon.version,
          hostname: effectiveDaemon.hostname ?? null,
        }
      : null,
    banco: dbInfo
      ? {
          schema_version: dbInfo.schema_version,
          path: dbInfo.path,
        }
      : null,
    filas: Object.fromEntries(
      Object.entries(outboxes ?? {}).map(([k, v]) => [
        k,
        v
          ? {
              pending: v.pending,
              sending: v.sending,
              sent: v.sent,
              error: v.error,
              due_now: v.due_now,
              last_sent_at_ms: v.last_sent_at_ms,
              last_auto_flush_ms: v.last_auto_flush_ms,
              last_error: v.last_error,
            }
          : null,
      ]),
    ),
  };

  const json = JSON.stringify(snapshot, null, 2);

  const ok = safeConn.status === "online";

  function copiar() {
    navigator.clipboard
      ?.writeText(json)
      .then(() => toast.success("Diagnóstico copiado."))
      .catch(() => toast.error("Não foi possível copiar."));
  }

  function baixar() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `gestao-pro-diagnostico-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          Diagnóstico de suporte
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={ok ? "outline" : "destructive"}>
            {ok ? "Estado coletado" : "Coletado (com falhas)"}
          </Badge>
          <Button size="sm" variant="outline" onClick={copiar}>
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> Copiar
          </Button>
          <Button size="sm" variant="outline" onClick={baixar}>
            <Download className="mr-1 h-3.5 w-3.5" /> Baixar JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAberto((a) => !a)}
          >
            {aberto ? "Ocultar" : "Ver"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Reúne versão, papel, IDs estáveis, status de conexão, info do
          servidor e estado das filas offline. Use o botão{" "}
          <strong>Copiar</strong> ou <strong>Baixar JSON</strong> para enviar
          ao suporte. Não contém dados de clientes/vendas.
        </p>
        {aberto && (
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
            {json}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
