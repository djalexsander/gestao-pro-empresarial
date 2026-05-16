import { useEffect, useMemo, useRef, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, Plus, Trash2, Power, PowerOff, Monitor, KeyRound, Copy,
  Server, Network, Wifi, WifiOff, UserCircle2, Crown, ShieldCheck,
  Cloud, CloudOff, Database, RadioTower, Search, PlugZap, QrCode,
  Activity, HardDrive, RefreshCw, AlertTriangle, CheckCircle2,
  Globe, Radio,
} from "lucide-react";
import { TerminalPermissoesDialog } from "./TerminalPermissoesDialog";
import { BackupSeguranca } from "./BackupSeguranca";
import { SincronizacaoCard } from "./SincronizacaoCard";
import { toast } from "sonner";
import {
  useTerminais, useCriarTerminal, useAtualizarTerminal,
  useToggleTerminalAtivo, useExcluirTerminal, useGerarTokenTerminal,
  useDefinirServidor, isTerminalOnline,
  type Terminal,
} from "@/hooks/useTerminais";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { useServerConnection } from "@/components/desktop/useServerConnection";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { DesktopSetupWizard } from "@/components/desktop/DesktopSetupWizard";
import {
  fetchDbInfo, fetchKnownTerminals, fetchOutboxStats,
  type DbInfoPayload, type PersistedTerminal, type OutboxStats,
} from "@/integrations/desktop/serverConnection";
import {
  descobrirServidoresLan, type ServidorEncontrado,
} from "@/integrations/desktop/lanDiscovery";
import QRCode from "qrcode";

export function TerminaisTab() {
  const { isDesktop, role, config, definirRole } = useDesktopRole();
  const { online: internet } = useNetworkStatus();
  const { conn, info, daemon, testando, reverificar } = useServerConnection();
  const { data: terminaisCloud = [], isLoading } = useTerminais();

  const [novoOpen, setNovoOpen] = useState(false);
  const [editar, setEditar] = useState<Terminal | null>(null);
  const [excluir, setExcluir] = useState<Terminal | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ nome: string; token: string } | null>(null);
  const [promover, setPromover] = useState<Terminal | null>(null);
  const [permissoesAlvo, setPermissoesAlvo] = useState<Terminal | null>(null);
  const [wizardAberto, setWizardAberto] = useState(false);

  // Backend local (desktop)
  const [dbInfo, setDbInfo] = useState<DbInfoPayload | null>(null);
  const [knownTerminals, setKnownTerminals] = useState<PersistedTerminal[]>([]);
  const [outbox, setOutbox] = useState<OutboxStats | null>(null);

  const localCfg = useMemo(() => {
    if (!isDesktop) return undefined;
    if (role === "terminal") return config.terminal;
    if (role === "server" && daemon?.running && daemon.port) {
      return {
        host: "127.0.0.1",
        porta: daemon.port,
        terminalId: "self",
        terminalNome: daemon.server_name ?? "Servidor",
      };
    }
    return undefined;
  }, [isDesktop, role, config.terminal, daemon]);

  // Polling leve do backend local
  useEffect(() => {
    if (!localCfg) {
      setDbInfo(null);
      setKnownTerminals([]);
      setOutbox(null);
      return;
    }
    let cancelled = false;
    const carregar = async () => {
      const [d, k, o] = await Promise.all([
        fetchDbInfo(localCfg),
        fetchKnownTerminals(localCfg),
        fetchOutboxStats(localCfg),
      ]);
      if (cancelled) return;
      setDbInfo(d);
      setKnownTerminals(k);
      setOutbox(o);
    };
    void carregar();
    const id = setInterval(() => void carregar(), 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [localCfg]);

  // re-render a cada 30s
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const toggleMut = useToggleTerminalAtivo();
  const excluirMut = useExcluirTerminal();
  const tokenMut = useGerarTokenTerminal();
  const servidorMut = useDefinirServidor();

  async function gerarToken(t: Terminal) {
    const token = await tokenMut.mutateAsync(t.id);
    setTokenInfo({ nome: t.nome, token });
  }

  const servidorPrincipal = terminaisCloud.find((t) => t.papel === "servidor");
  const onlineCount = terminaisCloud.filter((t) => isTerminalOnline(t)).length;

  // Endereço público do servidor (quando esta máquina é o server)
  const enderecoServidor =
    role === "server" && daemon?.running && daemon.port
      ? `${info?.host ?? daemon.hostname ?? "127.0.0.1"}:${daemon.port}`
      : info?.host && info?.port
        ? `${info.host}:${info.port}`
        : null;

  return (
    <div className="space-y-6">
      {/* ===================================================================
          1. RESUMO DA REDE
          =================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" /> Resumo da rede
          </CardTitle>
          <CardDescription>
            Visão geral da infraestrutura desta loja em tempo real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ResumoCard
              titulo="Servidor principal"
              valor={servidorPrincipal?.nome ?? "Não definido"}
              detalhe={enderecoServidor ?? "—"}
              icon={<Server className="h-5 w-5" />}
              cor={servidorPrincipal ? "primary" : "muted"}
            />
            <ResumoCard
              titulo="Terminais conectados"
              valor={`${onlineCount} online`}
              detalhe={`${terminaisCloud.length} cadastrados`}
              icon={<Monitor className="h-5 w-5" />}
              cor={onlineCount > 0 ? "success" : "muted"}
            />
            <ResumoCard
              titulo="Banco local"
              valor={dbInfo ? "Ativo" : isDesktop ? "Inativo" : "—"}
              detalhe={
                dbInfo
                  ? `${dbInfo.terminals_total} terminal(is) • v${dbInfo.schema_version}`
                  : isDesktop ? "Backend local não respondeu" : "Disponível só no desktop"
              }
              icon={<Database className="h-5 w-5" />}
              cor={dbInfo ? "success" : isDesktop ? "danger" : "muted"}
            />
            <ResumoCard
              titulo="Cloud sync"
              valor={internet ? "Online" : "Offline"}
              detalhe={
                outbox
                  ? `${outbox.pending} pendente(s)`
                  : internet ? "Conectado à nuvem" : "Trabalhando offline"
              }
              icon={internet ? <Cloud className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
              cor={internet ? "success" : "warn"}
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <StatusLinha
              ok={internet}
              label="Internet"
              detalhe={internet ? "Conectado" : "Sem saída para a nuvem"}
            />
            <StatusLinha
              ok={isDesktop ? !!localCfg && conn.status === "online" : true}
              label="Rede local"
              detalhe={
                !isDesktop
                  ? "Aplicação web — N/A"
                  : conn.status === "online"
                    ? `Funcionando • ${conn.latenciaMs ?? "?"} ms`
                    : conn.status === "offline"
                      ? "Servidor local não responde"
                      : conn.status === "invalid-server"
                        ? "Endereço respondeu, mas não é Gestão Pro"
                        : "Não configurado"
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ===================================================================
          2. MODO DESTE COMPUTADOR
          =================================================================== */}
      {isDesktop && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" /> Modo deste computador
            </CardTitle>
            <CardDescription>
              Defina o papel desta máquina na rede da loja. Apenas{" "}
              <strong>um computador</strong> pode ser servidor principal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <ModoCard
                titulo="Servidor principal"
                descricao="Guarda o banco local, controla estoque, centraliza vendas e recebe conexões dos caixas."
                icon={<Server className="h-8 w-8" />}
                ativo={role === "server"}
                onClick={() => setWizardAberto(true)}
              />
              <ModoCard
                titulo="Terminal / Caixa"
                descricao="Conecta no servidor principal para vender. Ideal para caixas, balcão e atendimento."
                icon={<Monitor className="h-8 w-8" />}
                ativo={role === "terminal"}
                onClick={() => setWizardAberto(true)}
              />
            </div>
            {role === "unset" && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Esta máquina ainda não foi configurada. Escolha um modo acima para começar.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===================================================================
          3. CONFIGURAÇÃO DO SERVIDOR (somente quando role=server)
          =================================================================== */}
      {isDesktop && role === "server" && (
        <ConfiguracaoServidorCard
          daemon={daemon}
          info={info}
          dbInfo={dbInfo}
          knownTerminals={knownTerminals}
          enderecoServidor={enderecoServidor}
        />
      )}

      {/* ===================================================================
          4. LISTA DE TERMINAIS
          =================================================================== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" /> Terminais cadastrados
            </CardTitle>
            <CardDescription>
              Cada caixa físico vira um terminal. O operador entra com PIN sobre
              o terminal selecionado.
            </CardDescription>
          </div>
          <Button onClick={() => setNovoOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Novo terminal
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : terminaisCloud.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhum terminal cadastrado. Crie o primeiro (ex.: "Caixa 1").
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Conexão</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Caixa</TableHead>
                    <TableHead>IP / Versão</TableHead>
                    <TableHead>Heartbeat</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terminaisCloud.map((t) => {
                    const online = isTerminalOnline(t);
                    const known = knownTerminals.find(
                      (k) => k.terminal_id === t.identificador_dispositivo,
                    );
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {t.papel === "servidor" && (
                              <Crown className="h-4 w-4 text-amber-500" />
                            )}
                            <div>
                              <div className="font-medium">{t.nome}</div>
                              {t.descricao && (
                                <div className="text-xs text-muted-foreground">
                                  {t.descricao}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {t.papel === "servidor" ? (
                            <Badge className="bg-amber-500 hover:bg-amber-500">
                              <Server className="mr-1 h-3 w-3" /> Servidor
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              <Monitor className="mr-1 h-3 w-3" /> Terminal
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!t.ativo ? (
                            <Badge variant="secondary">Inativo</Badge>
                          ) : online ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600">
                              <Wifi className="mr-1 h-3 w-3" /> Online
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              <WifiOff className="mr-1 h-3 w-3" /> Offline
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.operador_atual_nome && online ? (
                            <span className="flex items-center gap-1 text-sm">
                              <UserCircle2 className="h-3.5 w-3.5 text-primary" />
                              {t.operador_atual_nome}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.caixa_aberto_id ? (
                            <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                              Aberto
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {known?.host ? (
                            <div className="font-mono">{known.host}</div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {known?.app_version && (
                            <div className="text-muted-foreground">
                              v{known.app_version}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.heartbeat_at ? (
                            <span title={format(new Date(t.heartbeat_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}>
                              há {formatDistanceToNow(new Date(t.heartbeat_at), { locale: ptBR })}
                            </span>
                          ) : (
                            "Nunca"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {t.papel !== "servidor" && (
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => setPromover(t)}
                                title="Definir como servidor principal"
                              >
                                <Crown className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => setPermissoesAlvo(t)}
                              title="Permissões"
                            >
                              <ShieldCheck className="h-4 w-4 text-primary" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditar(t)} title="Editar">
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => gerarToken(t)}
                              title="Gerar token de pareamento"
                              disabled={tokenMut.isPending}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => toggleMut.mutate({ id: t.id, ativo: !t.ativo })}
                              title={t.ativo ? "Desativar" : "Ativar"}
                            >
                              {t.ativo ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setExcluir(t)} title="Excluir">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================================================================
          5. DESCOBERTA AUTOMÁTICA NA REDE
          =================================================================== */}
      {isDesktop && role !== "server" && (
        <DescobertaLanCard
          onConectar={(s) => {
            definirRole("terminal", {
              host: s.host,
              porta: s.porta,
              terminalId:
                config.terminal?.terminalId ??
                `term-${Math.random().toString(36).slice(2, 10)}`,
              terminalNome: config.terminal?.terminalNome ?? "Terminal",
            });
            toast.success(`Terminal apontado para ${s.host}:${s.porta}`);
            void reverificar();
          }}
        />
      )}

      {/* ===================================================================
          6. STATUS TÉCNICO DA REDE
          =================================================================== */}
      <StatusTecnicoCard
        internet={internet}
        conn={conn}
        info={info}
        dbInfo={dbInfo}
        outbox={outbox}
        isDesktop={isDesktop}
        role={role}
      />

      {/* ===================================================================
          7. TESTE DE CONEXÃO
          =================================================================== */}
      {isDesktop && role !== "unset" && (
        <TesteConexaoCard
          conn={conn}
          info={info}
          internet={internet}
          dbInfo={dbInfo}
          testando={testando}
          onTestar={() => void reverificar()}
        />
      )}

      {/* ===================================================================
          8. SINCRONIZAÇÃO E BACKUP
          =================================================================== */}
      {isDesktop && role === "server" && localCfg && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" /> Sincronização e backup
            </CardTitle>
            <CardDescription>
              Backup automático do banco local e fila de envio para a nuvem.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SincronizacaoCard cfg={localCfg} />
            <BackupSeguranca cfg={localCfg} />
          </CardContent>
        </Card>
      )}

      {/* ============ Diálogos ============ */}
      <TerminalDialog
        open={novoOpen || !!editar}
        terminal={editar}
        onOpenChange={(o) => { if (!o) { setNovoOpen(false); setEditar(null); } }}
      />

      <TerminalPermissoesDialog
        open={!!permissoesAlvo}
        terminal={permissoesAlvo}
        onOpenChange={(o) => !o && setPermissoesAlvo(null)}
      />

      <AlertDialog open={!!excluir} onOpenChange={(o) => !o && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluir?.nome} será removido. As vendas e caixas já vinculados são mantidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (excluir) { excluirMut.mutate(excluir.id); setExcluir(null); }
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!promover} onOpenChange={(o) => !o && setPromover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Definir como servidor principal?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{promover?.nome}</strong> passará a ser o servidor principal
              da rede. O servidor atual (se houver) será rebaixado para terminal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (promover) {
                  await servidorMut.mutateAsync(promover.id);
                  setPromover(null);
                }
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!tokenInfo} onOpenChange={(o) => !o && setTokenInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token de pareamento</DialogTitle>
            <DialogDescription>
              Use no app desktop para parear o terminal{" "}
              <strong>{tokenInfo?.nome}</strong>. Guarde em local seguro.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <code className="block break-all font-mono text-sm">{tokenInfo?.token}</code>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (tokenInfo) {
                  navigator.clipboard.writeText(tokenInfo.token);
                  toast.success("Token copiado.");
                }
              }}
            >
              <Copy className="mr-1 h-4 w-4" /> Copiar
            </Button>
            <Button onClick={() => setTokenInfo(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {wizardAberto && (
        <DesktopSetupWizard modoEdicao onClose={() => setWizardAberto(false)} />
      )}
    </div>
  );
}

// ============================================================================
// Subcomponentes
// ============================================================================

function ResumoCard({
  titulo, valor, detalhe, icon, cor,
}: {
  titulo: string; valor: string; detalhe: string;
  icon: React.ReactNode;
  cor: "primary" | "success" | "warn" | "danger" | "muted";
}) {
  const corClasses = {
    primary: "border-primary/40 bg-primary/5 text-primary",
    success: "border-emerald-500/40 bg-emerald-500/5 text-emerald-600",
    warn: "border-amber-500/40 bg-amber-500/5 text-amber-600",
    danger: "border-destructive/40 bg-destructive/5 text-destructive",
    muted: "border-border bg-muted/30 text-muted-foreground",
  }[cor];
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${corClasses}`}>
          {icon}
        </div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      </div>
      <p className="mt-2 text-lg font-semibold leading-tight text-foreground">{valor}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={detalhe}>
        {detalhe}
      </p>
    </div>
  );
}

function StatusLinha({ ok, label, detalhe }: { ok: boolean; label: string; detalhe: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-2.5 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-500" />
      )}
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{detalhe}</span>
    </div>
  );
}

function ModoCard({
  titulo, descricao, icon, ativo, onClick,
}: {
  titulo: string; descricao: string;
  icon: React.ReactNode; ativo: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all hover:border-primary hover:bg-accent/40 ${
        ativo ? "border-primary bg-accent/40" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2.5 text-primary">{icon}</div>
        <div>
          <h3 className="text-base font-semibold">{titulo}</h3>
          {ativo && (
            <Badge className="mt-1 bg-emerald-600 hover:bg-emerald-600">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Modo atual
            </Badge>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{descricao}</p>
    </button>
  );
}

function ConfiguracaoServidorCard({
  daemon, info, dbInfo, knownTerminals, enderecoServidor,
}: {
  daemon: ReturnType<typeof useServerConnection>["daemon"];
  info: ReturnType<typeof useServerConnection>["info"];
  dbInfo: DbInfoPayload | null;
  knownTerminals: PersistedTerminal[];
  enderecoServidor: string | null;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  async function gerarQR() {
    if (!enderecoServidor) {
      toast.error("Servidor local não está rodando.");
      return;
    }
    const payload = JSON.stringify({
      app: "Gestao Pro",
      host: info?.host ?? daemon?.hostname ?? "",
      porta: daemon?.port ?? info?.port ?? 0,
      server_id: daemon?.server_id ?? info?.server_id ?? null,
      server_name: daemon?.server_name ?? info?.server_name ?? null,
    });
    const url = await QRCode.toDataURL(payload, { width: 280, margin: 1 });
    setQrUrl(url);
    setQrOpen(true);
  }

  function copiarEndereco() {
    if (!enderecoServidor) return;
    navigator.clipboard.writeText(enderecoServidor);
    toast.success("Endereço copiado.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" /> Configuração do servidor
        </CardTitle>
        <CardDescription>
          Estes dados são usados pelos terminais para se conectar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoLinha label="Hostname" valor={info?.hostname ?? daemon?.hostname ?? "—"} />
          <InfoLinha label="IP local" valor={info?.host ?? "—"} mono />
          <InfoLinha label="Porta" valor={String(daemon?.port ?? info?.port ?? "—")} mono />
          <InfoLinha label="Server ID" valor={daemon?.server_id ?? info?.server_id ?? "—"} mono />
          <InfoLinha
            label="API local"
            valor={daemon?.running ? "Online" : "Parada"}
            cor={daemon?.running ? "success" : "danger"}
          />
          <InfoLinha
            label="Banco local"
            valor={dbInfo ? `Ativo (v${dbInfo.schema_version})` : "Inativo"}
            cor={dbInfo ? "success" : "danger"}
          />
          <InfoLinha
            label="Terminais conectados"
            valor={String(knownTerminals.length)}
          />
          <InfoLinha
            label="Iniciado em"
            valor={
              daemon?.started_at
                ? format(new Date(daemon.started_at), "dd/MM HH:mm", { locale: ptBR })
                : "—"
            }
          />
          <InfoLinha
            label="Versão"
            valor={`v${daemon?.version ?? info?.version ?? "?"}`}
            mono
          />
        </div>

        <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Endereço deste servidor
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-primary">
            {enderecoServidor ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use este endereço nos outros computadores ao escolher "Terminal".
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={copiarEndereco} disabled={!enderecoServidor}>
              <Copy className="mr-1 h-4 w-4" /> Copiar endereço
            </Button>
            <Button variant="outline" onClick={() => void gerarQR()} disabled={!enderecoServidor}>
              <QrCode className="mr-1 h-4 w-4" /> Gerar QR Code
            </Button>
          </div>
        </div>
      </CardContent>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR de conexão</DialogTitle>
            <DialogDescription>
              Escaneie no terminal cliente para parear automaticamente.
            </DialogDescription>
          </DialogHeader>
          {qrUrl && (
            <div className="flex flex-col items-center gap-3">
              <img src={qrUrl} alt="QR de conexão" className="rounded-lg border" />
              <p className="font-mono text-sm">{enderecoServidor}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InfoLinha({
  label, valor, mono, cor,
}: {
  label: string; valor: string;
  mono?: boolean;
  cor?: "success" | "danger";
}) {
  const corClasses = cor === "success"
    ? "text-emerald-600"
    : cor === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-medium ${corClasses} ${mono ? "font-mono" : ""}`}>
        {valor}
      </p>
    </div>
  );
}

function DescobertaLanCard({
  onConectar,
}: {
  onConectar: (s: ServidorEncontrado) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [encontrados, setEncontrados] = useState<ServidorEncontrado[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);

  async function iniciar() {
    setScanning(true);
    setEncontrados([]);
    setProgresso(0);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      await descobrirServidoresLan({
        signal: ctrl.signal,
        onProgresso: setProgresso,
        onEncontrado: (s) => setEncontrados((arr) => [...arr, s]),
      });
    } finally {
      setScanning(false);
      setProgresso(100);
    }
  }

  function cancelar() {
    ctrlRef.current?.abort();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RadioTower className="h-5 w-5" /> Descoberta automática na rede
        </CardTitle>
        <CardDescription>
          Procure servidores Gestão Pro ativos nas faixas de IP comuns desta rede.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {!scanning ? (
            <Button onClick={() => void iniciar()}>
              <Search className="mr-1 h-4 w-4" /> Procurar servidores na rede
            </Button>
          ) : (
            <Button variant="outline" onClick={cancelar}>
              Cancelar busca
            </Button>
          )}
          {scanning && (
            <span className="text-xs text-muted-foreground">
              Varrendo… {progresso}%
            </span>
          )}
        </div>
        {scanning && <Progress value={progresso} className="h-1.5" />}

        {encontrados.length > 0 ? (
          <div className="space-y-2">
            {encontrados.map((s) => (
              <div
                key={`${s.host}:${s.porta}`}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <Server className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold">
                      {s.serverName ?? s.hostname ?? "Servidor Gestão Pro"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {s.host}:{s.porta}
                      {s.serverVersion && ` • v${s.serverVersion}`}
                      {s.latenciaMs != null && ` • ${s.latenciaMs} ms`}
                    </p>
                  </div>
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">
                    <Wifi className="mr-1 h-3 w-3" /> Online
                  </Badge>
                </div>
                <Button size="sm" onClick={() => onConectar(s)}>
                  <PlugZap className="mr-1 h-4 w-4" /> Conectar
                </Button>
              </div>
            ))}
          </div>
        ) : !scanning ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Nenhum servidor encontrado ainda. Clique em "Procurar" para iniciar.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusTecnicoCard({
  internet, conn, info, dbInfo, outbox, isDesktop, role,
}: {
  internet: boolean;
  conn: ReturnType<typeof useServerConnection>["conn"];
  info: ReturnType<typeof useServerConnection>["info"];
  dbInfo: DbInfoPayload | null;
  outbox: OutboxStats | null;
  isDesktop: boolean;
  role: string;
}) {
  const items: Array<{ label: string; ok: boolean | "warn"; detalhe: string; icon: React.ReactNode }> = [
    {
      label: "Internet",
      ok: internet,
      detalhe: internet ? "Conectado à nuvem" : "Sem saída para a nuvem",
      icon: <Globe className="h-4 w-4" />,
    },
    {
      label: "API local",
      ok: !isDesktop ? "warn" : conn.status === "online",
      detalhe: !isDesktop
        ? "N/A no navegador"
        : conn.status === "online"
          ? `Online em ${conn.baseUrl}`
          : conn.mensagem ?? "Sem resposta",
      icon: <Activity className="h-4 w-4" />,
    },
    {
      label: "Porta",
      ok: !isDesktop ? "warn" : conn.status === "online",
      detalhe: info?.port ? `Aberta na ${info.port}` : "Não verificada",
      icon: <Radio className="h-4 w-4" />,
    },
    {
      label: "Banco SQLite",
      ok: !isDesktop ? "warn" : !!dbInfo,
      detalhe: dbInfo
        ? `${dbInfo.events_total} eventos • ${dbInfo.cache_entries} cache`
        : isDesktop ? "Inativo" : "N/A",
      icon: <Database className="h-4 w-4" />,
    },
    {
      label: "Sincronização",
      ok: outbox ? outbox.error === 0 : "warn",
      detalhe: outbox
        ? `${outbox.pending} pendente(s) • ${outbox.error} erro(s)`
        : "Sem dados",
      icon: <RefreshCw className="h-4 w-4" />,
    },
    {
      label: "Tempo de resposta",
      ok: conn.latenciaMs != null ? conn.latenciaMs < 500 : "warn",
      detalhe: conn.latenciaMs != null ? `${conn.latenciaMs} ms` : "—",
      icon: <Activity className="h-4 w-4" />,
    },
    {
      label: "Último ping LAN",
      ok: conn.ultimoSync ? true : "warn",
      detalhe: conn.ultimoSync
        ? `há ${formatDistanceToNow(conn.ultimoSync, { locale: ptBR })}`
        : "Nunca",
      icon: <Wifi className="h-4 w-4" />,
    },
    {
      label: "Último envio outbox",
      ok: outbox?.last_sent_at_ms ? true : "warn",
      detalhe: outbox?.last_sent_at_ms
        ? `há ${formatDistanceToNow(new Date(outbox.last_sent_at_ms), { locale: ptBR })}`
        : "Nunca",
      icon: <Cloud className="h-4 w-4" />,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" /> Status técnico da rede
        </CardTitle>
        <CardDescription>
          Painel de diagnóstico em tempo real{role !== "unset" ? ` • modo ${role}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.label}
              className="flex items-start gap-2 rounded-lg border border-border bg-card/50 p-3"
            >
              <div className={
                it.ok === true
                  ? "text-emerald-600"
                  : it.ok === "warn" ? "text-amber-500" : "text-destructive"
              }>
                {it.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs font-medium">
                  {it.label}
                  {it.ok === true ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  ) : it.ok === "warn" ? (
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={it.detalhe}>
                  {it.detalhe}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TesteConexaoCard({
  conn, info, internet, dbInfo, testando, onTestar,
}: {
  conn: ReturnType<typeof useServerConnection>["conn"];
  info: ReturnType<typeof useServerConnection>["info"];
  internet: boolean;
  dbInfo: DbInfoPayload | null;
  testando: boolean;
  onTestar: () => void;
}) {
  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: internet, label: "Saída para internet" },
    { ok: conn.status === "online", label: "Comunicação LAN com o servidor" },
    { ok: !!info, label: "Endpoint /server-info responde" },
    { ok: !!dbInfo, label: "Banco local pronto" },
    { ok: conn.latenciaMs != null && conn.latenciaMs < 1000, label: "Heartbeat dentro do esperado" },
  ];
  const passou = checks.filter((c) => c.ok).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="h-5 w-5" /> Teste de conexão
        </CardTitle>
        <CardDescription>
          Valide rapidamente toda a comunicação entre este computador, o servidor
          e a nuvem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Button onClick={onTestar} disabled={testando}>
            {testando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}
            Testar conexão
          </Button>
          <Badge variant={passou === checks.length ? "default" : "outline"}>
            {passou}/{checks.length} verificações OK
          </Badge>
        </div>
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              {c.ok
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Diálogo de cadastro de terminal (mantido)
// ============================================================================

function TerminalDialog({
  open, onOpenChange, terminal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  terminal: Terminal | null;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [identificador, setIdentificador] = useState("");
  const criar = useCriarTerminal();
  const atualizar = useAtualizarTerminal();
  const editing = !!terminal;

  useEffect(() => {
    if (open) {
      setNome(terminal?.nome ?? "");
      setDescricao(terminal?.descricao ?? "");
      setIdentificador(terminal?.identificador_dispositivo ?? "");
    }
  }, [open, terminal]);

  function reset() {
    setNome(""); setDescricao(""); setIdentificador("");
  }

  async function submit() {
    if (!nome.trim()) return;
    if (editing && terminal) {
      await atualizar.mutateAsync({
        id: terminal.id,
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        identificador_dispositivo: identificador.trim() || null,
      });
    } else {
      await criar.mutateAsync({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        identificador_dispositivo: identificador.trim() || null,
      });
    }
    reset();
    onOpenChange(false);
  }

  const pending = criar.isPending || atualizar.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar terminal" : "Novo terminal"}</DialogTitle>
          <DialogDescription>
            Identifique o ponto de venda físico (ex.: "Caixa 1", "Balcão").
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Caixa 1"
              onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) submit(); }}
            />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Caixa do balcão principal"
            />
          </div>
          <div>
            <Label>Identificador do dispositivo (opcional)</Label>
            <Input
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              placeholder="Ex.: hostname-pc-caixa-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Usado pelo desktop para casar este cadastro com o terminal real.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={pending || !nome.trim()}>
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {editing ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
