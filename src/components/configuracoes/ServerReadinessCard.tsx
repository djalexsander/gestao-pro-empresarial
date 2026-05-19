import {
  CheckCircle2,
  Copy,
  Loader2,
  Network,
  Play,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  DbInfoPayload,
  ServerInfoPayload,
} from "@/integrations/desktop/serverConnection";
import type { LocalServerStatus } from "@/integrations/desktop/tauriBridge";
import { useBootController } from "@/components/desktop/useLocalServerBoot";
import { useServerConnection } from "@/components/desktop/useServerConnection";

interface Props {
  daemon: LocalServerStatus | null;
  info: ServerInfoPayload | null;
  dbInfo: DbInfoPayload | null;
  serverNome?: string | null;
  serverId?: string | null;
}

/**
 * Card "Pronto para receber terminais" — visão de implantação do servidor.
 * Resume em 4 checagens objetivas se este servidor já está apto a parear
 * terminais na rede local. Mostra também um bloco copiável com IP e porta
 * para colar no wizard dos terminais.
 */
export function ServerReadinessCard({
  daemon,
  info,
  dbInfo,
  serverNome,
  serverId,
}: Props) {
  // Fonte única do status: além do daemon Tauri e do /server-info, também
  // consideramos o probe HTTP real (127.0.0.1:<porta>) usado pelo badge da
  // topbar. Se o probe está "online", o backend está respondendo — não pode
  // aparecer "Servidor parado" aqui ao mesmo tempo.
  const { conn } = useServerConnection();
  const probeOnline = conn.status === "online";
  const porta = daemon?.port ?? info?.port ?? null;
  const backendOk = !!daemon?.running || info?.backend_running === true || probeOnline;
  const dbOk = !!dbInfo || info?.database_ready === true;
  const portaOk = typeof porta === "number" && porta > 0 && porta < 65536;
  const identidadeOk = !!serverId;

  const checagens: Array<{ ok: boolean; label: string; detail?: string }> = [
    {
      ok: backendOk,
      label: "Backend local em execução",
      detail: backendOk
        ? `Porta ${porta ?? "?"}${probeOnline && !daemon?.running ? " (probe HTTP ativo)" : ""}`
        : "Servidor parado.",
    },
    {
      ok: portaOk,
      label: "Porta válida",
      detail: portaOk ? `${porta}` : "Sem porta configurada.",
    },
    {
      ok: dbOk,
      label: "Banco local pronto",
      detail: dbInfo
        ? `Schema v${dbInfo.schema_version}`
        : info?.database_ready
          ? "Banco SQLite inicializado."
          : "Banco ainda não inicializado.",
    },
    {
      ok: identidadeOk,
      label: "Identidade do servidor definida",
      detail: identidadeOk ? (serverId ?? "—") : "Sem Server ID.",
    },
  ];


  const pronto = checagens.every((c) => c.ok);
  const hostname = info?.host ?? daemon?.hostname ?? info?.hostname ?? null;

  function copiar(texto: string, label: string) {
    navigator.clipboard
      ?.writeText(texto)
      .then(() => toast.success(`${label} copiado.`))
      .catch(() => toast.error("Não foi possível copiar."));
  }

  const enderecoSugerido =
    hostname && porta ? `${hostname}:${porta}` : porta ? `<IP-do-servidor>:${porta}` : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Pronto para receber terminais
        </CardTitle>
        {pronto ? (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Pronto
          </Badge>
        ) : (
          <Badge variant="destructive">
            <ShieldAlert className="mr-1 h-3 w-3" /> Pendências
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="space-y-2">
          {checagens.map((c, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-md border bg-card/40 p-2"
            >
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div>
                <div className="font-medium">{c.label}</div>
                {c.detail && (
                  <div className="text-xs text-muted-foreground">{c.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
            Dados para configurar nos terminais
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CopyField
              label="Host / IP"
              value={hostname ?? "—"}
              onCopy={() => hostname && copiar(hostname, "Host")}
              hint="Use o IP da rede local (ex.: 192.168.0.10) se o hostname não resolver."
            />
            <CopyField
              label="Porta"
              value={porta != null ? String(porta) : "—"}
              onCopy={() => porta != null && copiar(String(porta), "Porta")}
            />
            {enderecoSugerido && (
              <CopyField
                label="Endereço completo"
                value={enderecoSugerido}
                onCopy={() => copiar(enderecoSugerido, "Endereço")}
                full
              />
            )}
            {serverNome && (
              <CopyField
                label="Nome do servidor"
                value={serverNome}
                onCopy={() => copiar(serverNome, "Nome")}
                full
              />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Se um terminal não conectar, confirme que ele está na{" "}
            <strong>mesma rede</strong> e que o firewall do Windows liberou a
            porta para a rede <strong>privada</strong>.
          </p>
        </div>

        {!backendOk && <StartServerAction />}
      </CardContent>
    </Card>
  );
}

function StartServerAction() {
  const boot = useBootController();
  const { reverificar } = useServerConnection();

  async function handleStart() {
    const st = await boot.start();
    if (st?.running) {
      // Atualiza /health, /server-info e daemon status na sequência.
      await reverificar();
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          O backend local ainda não está em execução. Os terminais não
          conseguirão se conectar até que ele seja iniciado.
        </span>
      </div>
      <Button
        size="sm"
        onClick={handleStart}
        disabled={boot.starting}
        className="w-full sm:w-auto"
      >
        {boot.starting ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Iniciando…
          </>
        ) : (
          <>
            <Play className="mr-2 h-3.5 w-3.5" /> Iniciar servidor local
          </>
        )}
      </Button>
      {boot.lastError && (
        <div className="text-[11px] text-destructive">
          Erro: {boot.lastError}
        </div>
      )}
    </div>
  );
}

function CopyField({
  label,
  value,
  onCopy,
  hint,
  full,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  hint?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
        <span className="flex-1 truncate font-mono text-sm">{value}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onCopy}
          disabled={value === "—"}
          title="Copiar"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
