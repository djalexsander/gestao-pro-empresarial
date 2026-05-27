import { useState } from "react";
import {
  Server,
  Monitor,
  Loader2,
  ArrowRight,
  Check,
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldAlert,
  PlugZap,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDesktopRole } from "./DesktopRoleProvider";
import { toast } from "sonner";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import {
  pingServidorLocal,
  fetchServerInfo,
  type ServerConnInfo,
  type ServerInfoPayload,
} from "@/integrations/desktop/serverConnection";

/**
 * Wizard de primeiro uso do desktop. Bloqueia o app inteiro até a máquina
 * ter um papel definido (`server` ou `terminal`). Reaparece em modo edição
 * quando chamado pela aba Configurações → Desktop.
 *
 * Nesta versão (bloco de implantação comercial) o passo do terminal ganha:
 *   1. validação de host/porta
 *   2. teste de conexão real (`/health`)
 *   3. diagnóstico via `/server-info` (identidade do servidor)
 *   4. confirmação visual de pareamento antes de salvar
 */
export function DesktopSetupWizard({
  onClose,
  modoEdicao = false,
}: {
  onClose?: () => void;
  modoEdicao?: boolean;
}) {
  const { config, definirRole } = useDesktopRole();
  const [step, setStep] = useState<
    "role" | "terminal-config" | "terminal-test"
  >(config.role === "terminal" && modoEdicao ? "terminal-config" : "role");
  const [escolha, setEscolha] = useState<"server" | "terminal" | null>(
    modoEdicao ? (config.role as "server" | "terminal") : null,
  );

  // Form do terminal
  const [host, setHost] = useState(config.terminal?.host ?? "");
  const [porta, setPorta] = useState(String(config.terminal?.porta ?? 7400));
  const [terminalNome, setTerminalNome] = useState(
    config.terminal?.terminalNome ?? "",
  );
  const [serverToken, setServerToken] = useState(
    config.terminal?.serverToken ?? "",
  );
  const [salvando, setSalvando] = useState(false);

  // Diagnóstico
  const [testando, setTestando] = useState(false);
  const [conn, setConn] = useState<ServerConnInfo | null>(null);
  const [info, setInfo] = useState<ServerInfoPayload | null>(null);

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

  function validarFormulario(): TerminalConexaoConfig | null {
    if (!terminalNome.trim()) {
      toast.error("Informe o nome do terminal (ex.: Caixa 01).");
      return null;
    }
    const portaNum = Number(porta);
    if (!Number.isFinite(portaNum) || portaNum <= 0 || portaNum > 65535) {
      toast.error("Porta inválida. Use um número entre 1 e 65535.");
      return null;
    }
    if (!host.trim()) {
      toast.error("Informe o host ou IP do servidor local.");
      return null;
    }
    if (!serverToken.trim()) {
      toast.error("Informe o token de pareamento exibido no servidor.");
      return null;
    }
    return {
      host: host.trim(),
      porta: portaNum,
      terminalId:
        config.terminal?.terminalId ??
        `term-${Math.random().toString(36).slice(2, 10)}`,
      terminalNome: terminalNome.trim(),
      serverToken: serverToken.trim(),
    };
  }

  async function handleTestar() {
    const cfg = validarFormulario();
    if (!cfg) return;
    setTestando(true);
    setConn(null);
    setInfo(null);
    try {
      const c = await pingServidorLocal(cfg);
      setConn(c);
      if (c.status === "online") {
        const i = await fetchServerInfo(cfg);
        setInfo(i);
      }
      setStep("terminal-test");
    } finally {
      setTestando(false);
    }
  }

  function handleSalvar() {
    const cfg = validarFormulario();
    if (!cfg) return;
    setSalvando(true);
    definirRole("terminal", cfg);
    toast.success(`Terminal "${cfg.terminalNome}" configurado.`);
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
            {step === "role" &&
              "Defina o papel desta máquina na sua rede local."}
            {step === "terminal-config" &&
              "Informe os dados de conexão deste terminal."}
            {step === "terminal-test" &&
              "Verifique se este terminal está enxergando o servidor."}
          </p>
        </div>

        {step === "role" && (
          <div className="grid gap-4 md:grid-cols-2">
            <RoleCard
              titulo="Servidor Local"
              descricao="Máquina principal da loja. Hospeda o banco local, recebe os terminais e é onde o backup roda. Precisa ficar ligada durante o expediente."
              icon={<Server className="h-10 w-10" />}
              ativo={escolha === "server"}
              onClick={() => handleEscolher("server")}
            />
            <RoleCard
              titulo="Terminal Cliente"
              descricao="Caixa/balcão conectado ao servidor da loja na rede local. Acesso focado em PDV e consultas operacionais."
              icon={<Monitor className="h-10 w-10" />}
              ativo={escolha === "terminal"}
              onClick={() => handleEscolher("terminal")}
            />
          </div>
        )}

        {step === "terminal-config" && (
          <Card className="p-6 space-y-5">
            <PassosImplantacao etapa={1} />

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
                Como este caixa aparecerá em relatórios e na lista de terminais.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div className="space-y-2">
                <Label htmlFor="terminal-host">
                  Host / IP do servidor local *
                </Label>
                <Input
                  id="terminal-host"
                  placeholder="192.168.0.10 ou servidor.local"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terminal-porta">Porta *</Label>
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
                Pegue o <strong>IP</strong> e a <strong>porta</strong> na
                máquina servidor (Configurações → Desktop → Servidor local).
                Servidor e terminal precisam estar na mesma rede e a porta
                liberada no firewall.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => setStep("role")}
                disabled={salvando || testando}
              >
                Voltar
              </Button>
              <Button onClick={() => void handleTestar()} disabled={testando}>
                {testando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="mr-2 h-4 w-4" />
                )}
                Testar conexão
              </Button>
            </div>
          </Card>
        )}

        {step === "terminal-test" && conn && (
          <Card className="p-6 space-y-5">
            <PassosImplantacao etapa={2} />

            <DiagnosticoConexao conn={conn} info={info} />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep("terminal-config")}
                  disabled={salvando || testando}
                >
                  Voltar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleTestar()}
                  disabled={testando}
                >
                  {testando ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="mr-2 h-4 w-4" />
                  )}
                  Testar de novo
                </Button>
              </div>
              <Button
                onClick={handleSalvar}
                disabled={salvando || conn.status !== "online"}
                title={
                  conn.status !== "online"
                    ? "Resolva a conexão antes de salvar."
                    : undefined
                }
              >
                {salvando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Confirmar pareamento
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

function PassosImplantacao({ etapa }: { etapa: 1 | 2 }) {
  const passos = [
    { n: 1, label: "Dados de conexão" },
    { n: 2, label: "Teste e pareamento" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {passos.map((p, i) => {
        const ativo = etapa === p.n;
        const concluido = etapa > p.n;
        return (
          <li key={p.n} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                concluido
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : ativo
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
              }`}
            >
              {concluido ? <Check className="h-3 w-3" /> : p.n}
            </span>
            <span
              className={
                ativo
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }
            >
              {p.label}
            </span>
            {i < passos.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DiagnosticoConexao({
  conn,
  info,
}: {
  conn: ServerConnInfo;
  info: ServerInfoPayload | null;
}) {
  const ok = conn.status === "online";
  const items: Array<{
    ok: boolean | "warn";
    label: string;
    detail?: string | null;
  }> = [
    {
      ok: !!conn.baseUrl,
      label: "Endereço válido",
      detail: conn.baseUrl ?? "—",
    },
    {
      ok: conn.status !== "offline",
      label: "Servidor respondeu (/health)",
      detail:
        conn.status === "offline"
          ? conn.mensagem ?? "Sem resposta da rede."
          : conn.latenciaMs != null
            ? `${conn.latenciaMs} ms`
            : null,
    },
    {
      ok:
        conn.status === "online"
          ? true
          : conn.status === "invalid-server"
            ? false
            : "warn",
      label: "Identidade Gestão Pro confere",
      detail:
        conn.status === "invalid-server"
          ? conn.mensagem ?? "App diferente respondendo nessa porta."
          : conn.serverName
            ? `${conn.serverName}${conn.serverVersion ? ` • v${conn.serverVersion}` : ""}`
            : null,
    },
    {
      ok: info ? true : "warn",
      label: "Backend local pronto (/server-info)",
      detail: info
        ? `${info.hostname ?? "host?"} • porta ${info.port ?? "?"}${
            typeof info.terminals_conectados === "number"
              ? ` • ${info.terminals_conectados} terminal(is)`
              : ""
          }`
        : "Sem detalhes adicionais.",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {ok ? (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
            <Wifi className="mr-1 h-3 w-3" /> Pronto para parear
          </Badge>
        ) : (
          <Badge variant="destructive">
            <WifiOff className="mr-1 h-3 w-3" />{" "}
            {conn.status === "invalid-server"
              ? "Servidor inválido"
              : "Sem conexão"}
          </Badge>
        )}
        {conn.latenciaMs != null && (
          <span className="text-xs text-muted-foreground">
            Latência: {conn.latenciaMs} ms
          </span>
        )}
      </div>

      <ul className="space-y-2 text-sm">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-md border bg-card/40 p-2"
          >
            {it.ok === true ? (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : it.ok === "warn" ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <div className="flex-1">
              <div className="font-medium">{it.label}</div>
              {it.detail && (
                <div className="text-xs text-muted-foreground">{it.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!ok && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          <strong>Não conseguimos falar com o servidor.</strong> Verifique:
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            <li>O Gestão Pro está aberto na máquina servidora?</li>
            <li>O IP/porta acima estão corretos?</li>
            <li>
              Servidor e terminal estão na <strong>mesma rede</strong> (Wi-Fi
              ou cabo)?
            </li>
            <li>
              Firewall do Windows liberou a porta para a rede{" "}
              <strong>privada</strong>?
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
