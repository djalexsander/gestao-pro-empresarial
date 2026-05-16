import { useEffect, useRef, useState } from "react";
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
  Search,
  Database,
  HardDrive,
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
  fetchOfflineStatus,
  type ServerConnInfo,
  type ServerInfoPayload,
  type OfflineStatus,
} from "@/integrations/desktop/serverConnection";
import {
  descobrirServidoresLan,
  type ServidorEncontrado,
} from "@/integrations/desktop/lanDiscovery";
import {
  getLocalServerStatus,
  getLocalSqliteHealth,
  type LocalServerStatus,
  type SqliteHealthPayload,
} from "@/integrations/desktop/tauriBridge";

/**
 * Wizard de primeiro uso do desktop. Bloqueia o app inteiro até a máquina
 * ter um papel definido (`server` ou `terminal`). Reaparece em modo edição
 * quando chamado pela aba Configurações → Desktop.
 *
 * Etapa 14 — Implantação comercial:
 *   - Servidor: tela de confirmação exibindo IP/porta/serverId, status do
 *     banco SQLite e ponteiros para backup/sincronização.
 *   - Terminal: descoberta automática de servidores na LAN + entrada manual,
 *     com validação de /health, /server-info e /api/offline/status.
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
    "role" | "terminal-config" | "terminal-test" | "server-ready"
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
  const [salvando, setSalvando] = useState(false);

  // Diagnóstico
  const [testando, setTestando] = useState(false);
  const [conn, setConn] = useState<ServerConnInfo | null>(null);
  const [info, setInfo] = useState<ServerInfoPayload | null>(null);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);

  // Descoberta LAN
  const [descobrindo, setDescobrindo] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [encontrados, setEncontrados] = useState<ServidorEncontrado[]>([]);
  const abortDescobertaRef = useRef<AbortController | null>(null);

  // Estado do próprio servidor (para tela "server-ready")
  const [daemon, setDaemon] = useState<LocalServerStatus | null>(null);
  const [sqlite, setSqlite] = useState<SqliteHealthPayload | null>(null);
  const [carregandoServer, setCarregandoServer] = useState(false);

  useEffect(() => {
    return () => {
      abortDescobertaRef.current?.abort();
    };
  }, []);

  async function carregarServerReady() {
    setCarregandoServer(true);
    try {
      const [st, sq] = await Promise.all([
        getLocalServerStatus().catch(() => null),
        getLocalSqliteHealth().catch(() => null),
      ]);
      setDaemon(st);
      setSqlite(sq);
      console.log("[DESKTOP_SETUP] server-ready", {
        running: st?.running,
        port: st?.port,
        server_id: st?.server_id,
        sqlite_ok: sq?.integrity_ok,
      });
    } finally {
      setCarregandoServer(false);
    }
  }

  function handleEscolher(role: "server" | "terminal") {
    setEscolha(role);
    console.log("[DESKTOP_SETUP] role escolhida:", role);
    if (role === "server") {
      definirRole("server");
      toast.success("Esta máquina foi definida como Servidor Principal.");
      setStep("server-ready");
      void carregarServerReady();
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
    return {
      host: host.trim(),
      porta: portaNum,
      terminalId:
        config.terminal?.terminalId ??
        `term-${Math.random().toString(36).slice(2, 10)}`,
      terminalNome: terminalNome.trim(),
    };
  }

  async function handleDescobrir() {
    if (descobrindo) {
      abortDescobertaRef.current?.abort();
      setDescobrindo(false);
      return;
    }
    setEncontrados([]);
    setProgresso(0);
    setDescobrindo(true);
    const ctrl = new AbortController();
    abortDescobertaRef.current = ctrl;
    console.log("[SERVER_DISCOVERY] iniciando varredura LAN");
    try {
      const lista = await descobrirServidoresLan({
        signal: ctrl.signal,
        onProgresso: (p) => setProgresso(p),
        onEncontrado: (s) => {
          console.log("[SERVER_DISCOVERY] encontrado", {
            host: s.host,
            porta: s.porta,
            serverId: s.serverId,
          });
          setEncontrados((prev) => [...prev, s]);
        },
      });
      console.log("[SERVER_DISCOVERY] concluído", { total: lista.length });
      if (lista.length === 0) {
        toast.info(
          "Nenhum servidor encontrado na rede. Informe o IP manualmente.",
        );
      }
    } catch (e) {
      console.warn("[SERVER_DISCOVERY] erro", e);
    } finally {
      setDescobrindo(false);
    }
  }

  function aplicarServidorEncontrado(s: ServidorEncontrado) {
    setHost(s.host);
    setPorta(String(s.porta));
    console.log("[TERMINAL_CONNECT] aplicando servidor encontrado", {
      host: s.host,
      porta: s.porta,
      serverId: s.serverId,
    });
    toast.success(`Servidor selecionado: ${s.serverName ?? s.host}`);
  }

  async function handleTestar() {
    const cfg = validarFormulario();
    if (!cfg) return;
    setTestando(true);
    setConn(null);
    setInfo(null);
    setOffline(null);
    console.log("[TERMINAL_CONNECT] testando conexão", {
      host: cfg.host,
      porta: cfg.porta,
    });
    try {
      const c = await pingServidorLocal(cfg);
      setConn(c);
      console.log("[SERVER_VALIDATE] /health", {
        status: c.status,
        latenciaMs: c.latenciaMs,
        serverId: c.serverId,
      });
      if (c.status === "online") {
        const [i, off] = await Promise.all([
          fetchServerInfo(cfg),
          fetchOfflineStatus(cfg),
        ]);
        setInfo(i);
        setOffline(off);
        console.log("[SERVER_VALIDATE] /server-info", {
          server_id: i?.server_id,
          server_name: i?.server_name,
          hostname: i?.hostname,
        });
        console.log("[SERVER_VALIDATE] /api/offline/status", {
          ready: off?.ready,
        });
      }
      setStep("terminal-test");
    } finally {
      setTestando(false);
    }
  }

  function handleSalvar() {
    const cfg = validarFormulario();
    if (!cfg) return;
    if (conn?.status !== "online") {
      toast.error("Não é possível salvar sem confirmar a conexão.");
      return;
    }
    setSalvando(true);
    console.log("[TERMINAL_CONNECT] salvando configuração", {
      host: cfg.host,
      porta: cfg.porta,
      serverId: info?.server_id ?? conn?.serverId,
    });
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
            {step === "server-ready" &&
              "Servidor pronto. Anote estes dados para configurar os terminais."}
          </p>
        </div>

        {step === "role" && (
          <div className="grid gap-4 md:grid-cols-2">
            <RoleCard
              titulo="Servidor Principal"
              descricao="Computador onde os dados ficam salvos. Hospeda o banco local, recebe os terminais e roda o backup. Deve ficar ligado durante o expediente."
              icon={<Server className="h-10 w-10" />}
              ativo={escolha === "server"}
              onClick={() => handleEscolher("server")}
            />
            <RoleCard
              titulo="Terminal de Caixa"
              descricao="Computador que usa os dados do servidor pela rede local. Foco em PDV e consultas operacionais."
              icon={<Monitor className="h-10 w-10" />}
              ativo={escolha === "terminal"}
              onClick={() => handleEscolher("terminal")}
            />
          </div>
        )}

        {step === "terminal-config" && (
          <Card className="p-6 space-y-5">
            <PassosImplantacao etapa={1} />

            {/* Bloco de descoberta automática */}
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">
                    Procurar servidor na rede
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Localizamos automaticamente o Gestão Pro rodando como
                    servidor na sua rede local.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={descobrindo ? "outline" : "default"}
                  onClick={() => void handleDescobrir()}
                >
                  {descobrindo ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Parar ({progresso}%)
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Procurar
                    </>
                  )}
                </Button>
              </div>

              {encontrados.length > 0 && (
                <ul className="space-y-2">
                  {encontrados.map((s, i) => (
                    <li
                      key={`${s.host}:${s.porta}:${i}`}
                      className="flex items-center justify-between gap-3 rounded-md border bg-card p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {s.serverName ?? s.hostname ?? "Servidor Gestão Pro"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.host}:{s.porta}
                          {s.serverVersion ? ` • v${s.serverVersion}` : ""}
                          {s.latenciaMs != null ? ` • ${s.latenciaMs} ms` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => aplicarServidorEncontrado(s)}
                      >
                        Usar este
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
                máquina servidor (Configurações → Desktop → Servidor
                Principal). Servidor e terminal precisam estar na mesma rede
                e a porta liberada no firewall.
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

            <DiagnosticoConexao conn={conn} info={info} offline={offline} />

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

        {step === "server-ready" && (
          <Card className="p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                <Server className="mr-1 h-3 w-3" /> Servidor Principal ativo
              </Badge>
              {carregandoServer && (
                <span className="text-xs text-muted-foreground inline-flex items-center">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  atualizando…
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ServerFact
                label="Hostname"
                value={daemon?.hostname ?? "—"}
              />
              <ServerFact
                label="Porta"
                value={daemon?.port != null ? String(daemon.port) : "—"}
                mono
              />
              <ServerFact
                label="Server ID"
                value={daemon?.server_id ?? "—"}
                mono
              />
              <ServerFact
                label="Nome do servidor"
                value={daemon?.server_name ?? config.serverNome ?? "—"}
              />
              <ServerFact
                label="Versão"
                value={daemon?.version ?? "—"}
              />
              <ServerFact
                label="Terminais conectados"
                value={
                  typeof daemon?.terminals_conectados === "number"
                    ? String(daemon.terminals_conectados)
                    : "0"
                }
              />
            </div>

            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Database className="h-4 w-4" /> Banco de dados local (SQLite)
              </div>
              {sqlite ? (
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    {sqlite.integrity_ok ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                    )}
                    Integridade: {sqlite.integrity_ok ? "OK" : sqlite.integrity_detail}
                  </li>
                  <li className="flex items-center gap-2">
                    <HardDrive className="h-3.5 w-3.5" />
                    Tamanho: {(sqlite.db_size_bytes / 1024 / 1024).toFixed(2)} MB
                    {" • "}journal: {sqlite.journal_mode}
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Status indisponível neste momento.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Backup automático</strong> e{" "}
                <strong>sincronização com a nuvem</strong> aparecem nos cards
                da aba Desktop em Configurações.
              </p>
              <p>
                Para conectar um caixa, abra o Gestão Pro nele e escolha
                <em> Terminal de Caixa</em>, informando o IP{" "}
                <strong>{daemon?.hostname ?? "deste computador"}</strong> e a
                porta <strong>{daemon?.port ?? "—"}</strong>.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => void carregarServerReady()}
                disabled={carregandoServer}
              >
                <RotateCw className="mr-2 h-4 w-4" /> Atualizar
              </Button>
              <Button onClick={onClose}>
                <Check className="mr-2 h-4 w-4" /> Concluir
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

function ServerFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </div>
    </div>
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
  offline,
}: {
  conn: ServerConnInfo;
  info: ServerInfoPayload | null;
  offline: OfflineStatus | null;
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
    {
      ok: offline ? (offline.ready ? true : "warn") : "warn",
      label: "Banco offline pronto (/api/offline/status)",
      detail: offline
        ? offline.ready
          ? "Cache local pronto para operar sem internet."
          : "Cache local ainda não está completo — rode a sincronização inicial no servidor."
        : "Não foi possível consultar o status offline.",
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
