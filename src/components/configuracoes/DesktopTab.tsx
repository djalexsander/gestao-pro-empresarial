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
  fetchCaixaLancamentosLocal,
  fetchCaixaLocalAberto,
  fetchCaixaResumoLocal,
  fetchFinanceiroLancamentos,
  fetchFinanceiroResumo,
  fetchDbInfo,
  fetchDomainStats,
  fetchKnownTerminals,
  fetchOutboxCaixaStats,
  fetchOutboxCancelamentosStats,
  fetchOutboxStats,
  fetchOutboxVendasStats,
  flushOutbox,
  flushOutboxCaixa,
  flushOutboxCancelamentos,
  flushOutboxVendas,
  regenerarLancamentosCaixaLocal,
  retryOutboxCaixaErrors,
  retryOutboxCancelamentosErrors,
  retryOutboxErrors,
  retryOutboxVendasErrors,
  runDbSync,
  type CaixaLocalAbertoRow,
  type CaixaResumoLocal,
  type DbInfoPayload,
  type DomainStat,
  type LancamentoLocalRow,
  type OutboxCaixaStats,
  type OutboxCancelamentosStats,
  type OutboxStats,
  type PersistedTerminal,
  type ServerConnStatus,
} from "@/integrations/desktop/serverConnection";
import { supabase } from "@/integrations/supabase/client";

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
  const [domainStats, setDomainStats] = useState<DomainStat[]>([]);
  const [syncingDomain, setSyncingDomain] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxStats | null>(null);
  const [flushing, setFlushing] = useState(false);
  const [outboxVendas, setOutboxVendas] = useState<OutboxStats | null>(null);
  const [flushingVendas, setFlushingVendas] = useState(false);
  const [outboxCaixa, setOutboxCaixa] = useState<OutboxCaixaStats | null>(null);
  const [flushingCaixa, setFlushingCaixa] = useState(false);
  const [outboxCancel, setOutboxCancel] =
    useState<OutboxCancelamentosStats | null>(null);
  const [flushingCancel, setFlushingCancel] = useState(false);
  const [caixaAberto, setCaixaAberto] = useState<CaixaLocalAbertoRow | null>(null);
  const [caixaResumo, setCaixaResumo] = useState<CaixaResumoLocal | null>(null);
  const [caixaLancamentos, setCaixaLancamentos] = useState<LancamentoLocalRow[]>([]);
  const [regenerandoLanc, setRegenerandoLanc] = useState(false);
  const [finResumo, setFinResumo] = useState<{
    total_entradas: number;
    total_saidas: number;
    saldo: number;
    qtd_lancamentos: number;
    qtd_entradas: number;
    qtd_saidas: number;
  } | null>(null);
  const [finRecentes, setFinRecentes] = useState<LancamentoLocalRow[]>([]);

  // cfg derivado para chamadas ao backend local (terminal usa o config; servidor
  // bate em si mesmo via 127.0.0.1).
  const localCfg =
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

  const recarregarDomainStats = async () => {
    if (!localCfg) return;
    const stats = await fetchDomainStats(localCfg);
    setDomainStats(stats);
  };

  const handleSync = async (
    domain: "produtos" | "clientes_lite" | "estoque_movimentacoes" | "estoque_saldos",
  ) => {
    if (!localCfg) return;
    setSyncingDomain(domain);
    try {
      await runDbSync(localCfg, domain);
      await recarregarDomainStats();
    } finally {
      setSyncingDomain(null);
    }
  };

  const handleFlush = async () => {
    if (!localCfg) return;
    setFlushing(true);
    try {
      const { data } = await supabase.auth.getSession();
      await flushOutbox(localCfg, data.session?.access_token ?? null);
      setOutbox(await fetchOutboxStats(localCfg));
    } finally {
      setFlushing(false);
    }
  };

  const handleRetryErrors = async () => {
    if (!localCfg) return;
    await retryOutboxErrors(localCfg);
    setOutbox(await fetchOutboxStats(localCfg));
  };

  const handleFlushVendas = async () => {
    if (!localCfg) return;
    setFlushingVendas(true);
    try {
      const { data } = await supabase.auth.getSession();
      await flushOutboxVendas(localCfg, data.session?.access_token ?? null);
      setOutboxVendas(await fetchOutboxVendasStats(localCfg));
    } finally {
      setFlushingVendas(false);
    }
  };

  const handleRetryErrorsVendas = async () => {
    if (!localCfg) return;
    await retryOutboxVendasErrors(localCfg);
    setOutboxVendas(await fetchOutboxVendasStats(localCfg));
  };

  const handleFlushCaixa = async () => {
    if (!localCfg) return;
    setFlushingCaixa(true);
    try {
      const { data } = await supabase.auth.getSession();
      await flushOutboxCaixa(localCfg, data.session?.access_token ?? null);
      setOutboxCaixa(await fetchOutboxCaixaStats(localCfg));
    } finally {
      setFlushingCaixa(false);
    }
  };

  const handleRetryErrorsCaixa = async () => {
    if (!localCfg) return;
    await retryOutboxCaixaErrors(localCfg);
    setOutboxCaixa(await fetchOutboxCaixaStats(localCfg));
  };

  const handleFlushCancel = async () => {
    if (!localCfg) return;
    setFlushingCancel(true);
    try {
      const { data } = await supabase.auth.getSession();
      await flushOutboxCancelamentos(localCfg, data.session?.access_token ?? null);
      setOutboxCancel(await fetchOutboxCancelamentosStats(localCfg));
    } finally {
      setFlushingCancel(false);
    }
  };

  const handleRetryErrorsCancel = async () => {
    if (!localCfg) return;
    await retryOutboxCancelamentosErrors(localCfg);
    setOutboxCancel(await fetchOutboxCancelamentosStats(localCfg));
  };

  const handleRegenerarLancamentos = async () => {
    if (!localCfg || !caixaAberto?.local_uuid) return;
    setRegenerandoLanc(true);
    try {
      await regenerarLancamentosCaixaLocal(localCfg, caixaAberto.local_uuid);
      const [resumo, lancs] = await Promise.all([
        fetchCaixaResumoLocal(localCfg, { caixaId: caixaAberto.local_uuid }),
        fetchCaixaLancamentosLocal(localCfg, { caixaId: caixaAberto.local_uuid }),
      ]);
      setCaixaResumo(resumo);
      setCaixaLancamentos(lancs);
    } finally {
      setRegenerandoLanc(false);
    }
  };

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
      const [info, terms, stats, ob, obv, obc, occ, ca] = await Promise.all([
        fetchDbInfo(cfg),
        fetchKnownTerminals(cfg),
        fetchDomainStats(cfg),
        fetchOutboxStats(cfg),
        fetchOutboxVendasStats(cfg),
        fetchOutboxCaixaStats(cfg),
        fetchOutboxCancelamentosStats(cfg),
        fetchCaixaLocalAberto(cfg),
      ]);
      if (!alive) return;
      setDbInfo(info);
      setKnownTerminals(terms);
      setDomainStats(stats);
      setOutbox(ob);
      setOutboxVendas(obv);
      setOutboxCaixa(obc);
      setOutboxCancel(occ);
      setCaixaAberto(ca);

      // Resumo + lançamentos: prioriza caixa aberto, senão omite (último
      // fechado pode ser carregado on-demand pelo operador via UI).
      if (ca?.local_uuid) {
        const [resumo, lancs] = await Promise.all([
          fetchCaixaResumoLocal(cfg, { caixaId: ca.local_uuid }),
          fetchCaixaLancamentosLocal(cfg, { caixaId: ca.local_uuid }),
        ]);
        if (!alive) return;
        setCaixaResumo(resumo);
        setCaixaLancamentos(lancs);
      } else {
        setCaixaResumo(null);
        setCaixaLancamentos([]);
      }

      // v11 — financeiro local geral (independe de caixa aberto).
      const [resumoFin, recentes] = await Promise.all([
        fetchFinanceiroResumo(cfg, { limit: 1000 }),
        fetchFinanceiroLancamentos(cfg, { limit: 10 }),
      ]);
      if (!alive) return;
      setFinResumo(resumoFin);
      setFinRecentes(recentes);
    };
    void carregar();
    const tFull = setInterval(() => void carregar(), 30_000);
    const tOutbox = setInterval(async () => {
      const [ob, obv, obc, occ] = await Promise.all([
        fetchOutboxStats(cfg),
        fetchOutboxVendasStats(cfg),
        fetchOutboxCaixaStats(cfg),
        fetchOutboxCancelamentosStats(cfg),
      ]);
      if (!alive) return;
      setOutbox(ob);
      setOutboxVendas(obv);
      setOutboxCaixa(obc);
      setOutboxCancel(occ);
    }, 5_000);
    return () => {
      alive = false;
      clearInterval(tFull);
      clearInterval(tOutbox);
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

        {role !== "unset" && dbInfo && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Banco local
              </CardTitle>
              <Badge variant="outline">SQLite v{dbInfo.schema_version}</Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
                <Field
                  label="Terminais conhecidos"
                  value={String(dbInfo.terminals_total)}
                />
                <Field
                  label="Terminais online (2 min)"
                  value={String(dbInfo.terminals_online)}
                />
                <Field
                  label="Eventos de auditoria"
                  value={String(dbInfo.events_total)}
                />
                <Field
                  label="Entradas em cache"
                  value={String(dbInfo.cache_entries)}
                />
                <Field label="Arquivo" value={dbInfo.path} mono />
              </div>

              {knownTerminals.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Últimos terminais vistos
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Terminal</th>
                          <th className="px-3 py-2 text-left font-medium">Host</th>
                          <th className="px-3 py-2 text-left font-medium">Último heartbeat</th>
                          <th className="px-3 py-2 text-right font-medium">HBs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {knownTerminals.slice(0, 8).map((t) => (
                          <tr key={t.terminal_id} className="border-t border-border">
                            <td className="px-3 py-2">
                              <div className="font-medium text-foreground">
                                {t.terminal_nome ?? t.terminal_id}
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {t.terminal_id}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                              {t.host ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {new Date(t.last_seen_ms).toLocaleString("pt-BR")}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                              {t.heartbeats}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {role !== "unset" && domainStats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Domínios locais (tabelas tipadas)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Domínio</th>
                      <th className="px-3 py-2 text-right font-medium">Registros</th>
                      <th className="px-3 py-2 text-left font-medium">Estratégia</th>
                      <th className="px-3 py-2 text-right font-medium">Δ último</th>
                      <th className="px-3 py-2 text-left font-medium">Cursor remoto</th>
                      <th className="px-3 py-2 text-left font-medium">Último refresh</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domainStats.map((d) => {
                      const canForce =
                        d.domain === "produtos" ||
                        d.domain === "clientes_lite" ||
                        d.domain === "estoque_movimentacoes" ||
                        d.domain === "estoque_saldos";
                      const isSyncing = syncingDomain === d.domain;
                      return (
                        <tr key={d.domain} className="border-t border-border">
                          <td className="px-3 py-2 font-mono text-foreground">{d.domain}</td>
                          <td className="px-3 py-2 text-right text-foreground">{d.row_count}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {d.last_strategy ? (
                              <Badge
                                variant={
                                  d.last_strategy === "incremental"
                                    ? "default"
                                    : "secondary"
                                }
                                className="font-mono text-[10px]"
                              >
                                {d.last_strategy}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-foreground">
                            {d.last_delta_count}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {d.last_remote_cursor_ms
                              ? new Date(d.last_remote_cursor_ms)
                                  .toISOString()
                                  .replace("T", " ")
                                  .slice(0, 19)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {d.last_synced_ms
                              ? new Date(d.last_synced_ms).toLocaleString("pt-BR")
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {d.last_synced_ok ? (
                              <span
                                className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                                title={d.last_source ?? ""}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> ok
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-destructive"
                                title={d.last_error ?? "erro"}
                              >
                                <XCircle className="h-3.5 w-3.5" /> erro
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canForce && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSyncing}
                                onClick={() =>
                                  void handleSync(
                                    d.domain as
                                      | "produtos"
                                      | "clientes_lite"
                                      | "estoque_movimentacoes"
                                      | "estoque_saldos",
                                  )
                                }
                              >
                                {isSyncing ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                    Sincronizar
                                  </>
                                )}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Sync incremental por <code>updated_at</code> (produtos,
                clientes) e <code>data_movimentacao</code>{" "}
                (<code>estoque_movimentacoes</code>, append-only). Saldos
                (<code>estoque_saldos</code>) são <strong>derivados</strong>{" "}
                — materializados localmente a partir das movimentações
                ingeridas. Tombstones automáticos para registros marcados
                como inativos no upstream e fallback resiliente
                (<code>local-table-stale</code>) quando a nuvem cai.
              </p>
            </CardContent>
          </Card>
        )}

        {role !== "unset" && outbox && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Fila offline — estoque
              </CardTitle>
              <div className="flex gap-2">
                {outbox.error > 0 && (
                  <Button size="sm" variant="outline" onClick={() => void handleRetryErrors()}>
                    Reenfileirar erros
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flushing || outbox.pending === 0}
                  onClick={() => void handleFlush()}
                >
                  {flushing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar agora
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-4">
                <Field label="Pendentes" value={String(outbox.pending)} />
                <Field
                  label="Prontos agora"
                  value={`${outbox.due_now} / ${outbox.pending}`}
                />
                <Field label="Enviadas" value={String(outbox.sent)} />
                <Field label="Com erro" value={String(outbox.error)} />
                <Field
                  label="Último envio"
                  value={
                    outbox.last_sent_at_ms
                      ? new Date(outbox.last_sent_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                <Field
                  label="Próx. tentativa auto"
                  value={
                    outbox.next_attempt_at_ms
                      ? new Date(outbox.next_attempt_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                <Field
                  label="Último auto-flush"
                  value={
                    outbox.last_auto_flush_ms
                      ? `${new Date(outbox.last_auto_flush_ms).toLocaleTimeString("pt-BR")}` +
                        (outbox.last_auto_attempted != null
                          ? ` · ${outbox.last_auto_sent ?? 0}/${outbox.last_auto_attempted} ok`
                          : "")
                      : "—"
                  }
                />
                <Field
                  label="Último flush manual"
                  value={
                    outbox.last_manual_flush_ms
                      ? new Date(outbox.last_manual_flush_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                {outbox.last_error && (
                  <div className="sm:col-span-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Último erro
                    </div>
                    <div className="mt-0.5 break-all text-xs text-destructive">
                      {outbox.last_error}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Movimentações de estoque são gravadas localmente no servidor
                (saldo refletido na hora) e enviadas à nuvem em background a
                cada 10s. Falhas entram em backoff exponencial (5s → 15s → 1m →
                5m → 15m). Após 8 tentativas o item vai para{" "}
                <strong>erro</strong> e exige <em>Reenfileirar erros</em>.
                Idempotência garantida por <code>local_uuid</code> — retries
                nunca duplicam.
              </p>
            </CardContent>
          </Card>
        )}

        {role !== "unset" && outboxVendas && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Fila offline — vendas (PDV)
              </CardTitle>
              <div className="flex gap-2">
                {outboxVendas.error > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRetryErrorsVendas()}
                  >
                    Reenfileirar erros
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flushingVendas || outboxVendas.pending === 0}
                  onClick={() => void handleFlushVendas()}
                >
                  {flushingVendas ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar agora
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-4">
                <Field label="Pendentes" value={String(outboxVendas.pending)} />
                <Field label="Enviando" value={String(outboxVendas.sending)} />
                <Field
                  label="Prontos agora"
                  value={`${outboxVendas.due_now} / ${outboxVendas.pending}`}
                />
                <Field label="Enviadas" value={String(outboxVendas.sent)} />
                <Field label="Com erro" value={String(outboxVendas.error)} />
                <Field
                  label="Último envio"
                  value={
                    outboxVendas.last_sent_at_ms
                      ? new Date(outboxVendas.last_sent_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                <Field
                  label="Próx. tentativa auto"
                  value={
                    outboxVendas.next_attempt_at_ms
                      ? new Date(outboxVendas.next_attempt_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                <Field
                  label="Último auto-flush"
                  value={
                    outboxVendas.last_auto_flush_ms
                      ? `${new Date(outboxVendas.last_auto_flush_ms).toLocaleTimeString("pt-BR")}` +
                        (outboxVendas.last_auto_attempted != null
                          ? ` · ${outboxVendas.last_auto_sent ?? 0}/${outboxVendas.last_auto_attempted} ok`
                          : "")
                      : "—"
                  }
                />
                <Field
                  label="Último flush manual"
                  value={
                    outboxVendas.last_manual_flush_ms
                      ? new Date(outboxVendas.last_manual_flush_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                {outboxVendas.last_error && (
                  <div className="sm:col-span-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Último erro
                    </div>
                    <div className="mt-0.5 break-all text-xs text-destructive">
                      {outboxVendas.last_error}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Vendas finalizadas no PDV são gravadas localmente (com baixa
                imediata de estoque na mesma transação) e enviadas à RPC{" "}
                <code>finalizar_venda_pdv</code> em background. Mesmo backoff
                exponencial das movimentações de estoque (5s → 15s → 1m → 5m
                → 15m). Idempotência ponta-a-ponta via <code>local_uuid</code>{" "}
                — reenvios nunca duplicam venda, itens, financeiro ou caixa.
              </p>
            </CardContent>
          </Card>
        )}

        {role !== "unset" && outboxCaixa && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Fila offline — caixa
              </CardTitle>
              <div className="flex gap-2">
                {outboxCaixa.error > 0 && (
                  <Button size="sm" variant="outline" onClick={() => void handleRetryErrorsCaixa()}>
                    Reenfileirar erros
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flushingCaixa || outboxCaixa.pending === 0}
                  onClick={() => void handleFlushCaixa()}
                >
                  {flushingCaixa ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar agora
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-4">
                <Field label="Pendentes" value={String(outboxCaixa.pending)} />
                <Field label="Aberturas" value={String(outboxCaixa.pending_abrir)} />
                <Field label="Movimentos" value={String(outboxCaixa.pending_movimento)} />
                <Field label="Fechamentos" value={String(outboxCaixa.pending_fechar)} />
                <Field label="Enviadas" value={String(outboxCaixa.sent)} />
                <Field label="Com erro" value={String(outboxCaixa.error)} />
                <Field
                  label="Próx. tentativa auto"
                  value={
                    outboxCaixa.next_attempt_at_ms
                      ? new Date(outboxCaixa.next_attempt_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                <Field
                  label="Último auto-flush"
                  value={
                    outboxCaixa.last_auto_flush_ms
                      ? `${new Date(outboxCaixa.last_auto_flush_ms).toLocaleTimeString("pt-BR")}` +
                        (outboxCaixa.last_auto_attempted != null
                          ? ` · ${outboxCaixa.last_auto_sent ?? 0}/${outboxCaixa.last_auto_attempted} ok`
                          : "")
                      : "—"
                  }
                />
                {outboxCaixa.last_error && (
                  <div className="sm:col-span-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Último erro
                    </div>
                    <div className="mt-0.5 break-all text-xs text-destructive">
                      {outboxCaixa.last_error}
                    </div>
                  </div>
                )}
              </div>

              {caixaAberto && (
                <div className="mt-4 grid gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm sm:grid-cols-4">
                  <Field label="Caixa local" value={caixaAberto.status} />
                  <Field label="Terminal" value={caixaAberto.terminal_id ?? "—"} mono />
                  <Field label="Operador" value={caixaAberto.operador_id ?? "—"} mono />
                  <Field
                    label="Valor inicial"
                    value={caixaAberto.valor_inicial.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  />
                </div>
              )}

              <p className="mt-3 text-xs text-muted-foreground">
                Aberturas, sangrias/suprimentos e fechamentos são gravados
                localmente e despachados em ordem causal (abrir → movimento →
                fechar) por <code>local_uuid</code>. Mesmo backoff exponencial
                de estoque/vendas. Idempotência ponta-a-ponta.
              </p>
            </CardContent>
          </Card>
        )}

        {role !== "unset" && outboxCancel && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Fila offline — cancelamentos de venda
              </CardTitle>
              <div className="flex gap-2">
                {outboxCancel.error > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRetryErrorsCancel()}
                  >
                    Reenfileirar erros
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flushingCancel || outboxCancel.pending === 0}
                  onClick={() => void handleFlushCancel()}
                >
                  {flushingCancel ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar agora
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-4">
                <Field label="Pendentes" value={String(outboxCancel.pending)} />
                <Field label="Enviando" value={String(outboxCancel.sending)} />
                <Field label="Enviadas" value={String(outboxCancel.sent)} />
                <Field label="Com erro" value={String(outboxCancel.error)} />
                <Field
                  label="Aguardando venda sync"
                  value={String(outboxCancel.waiting_venda_sync)}
                />
                <Field
                  label="Próx. tentativa auto"
                  value={
                    outboxCancel.next_attempt_at_ms
                      ? new Date(outboxCancel.next_attempt_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                <Field
                  label="Último auto-flush"
                  value={
                    outboxCancel.last_auto_flush_ms
                      ? `${new Date(outboxCancel.last_auto_flush_ms).toLocaleTimeString("pt-BR")}` +
                        (outboxCancel.last_auto_attempted != null
                          ? ` · ${outboxCancel.last_auto_sent ?? 0}/${outboxCancel.last_auto_attempted} ok`
                          : "")
                      : "—"
                  }
                />
                <Field
                  label="Último envio"
                  value={
                    outboxCancel.last_sent_at_ms
                      ? new Date(outboxCancel.last_sent_at_ms).toLocaleString("pt-BR")
                      : "—"
                  }
                />
                {outboxCancel.last_error && (
                  <div className="sm:col-span-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Último erro
                    </div>
                    <div className="mt-0.5 break-all text-xs text-destructive">
                      {outboxCancel.last_error}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Cancelamentos estornam estoque local, regeneram os lançamentos
                derivados do caixa e respeitam ordem causal: só vão ao upstream
                depois que a venda original estiver sincronizada. Idempotência
                garantida pelo <code>local_uuid</code>.
              </p>
            </CardContent>
          </Card>
        )}

        {role !== "unset" && caixaResumo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Resumo local — caixa
                <Badge
                  variant={caixaResumo.status === "aberto" ? "default" : "secondary"}
                >
                  {caixaResumo.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field
                  label="Total vendido"
                  value={caixaResumo.total_vendido.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                />
                <Field label="Qtd vendas" value={String(caixaResumo.qtd_vendas)} />
                <Field
                  label="Valor inicial"
                  value={caixaResumo.valor_inicial.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                />
                <Field
                  label="Esperado em dinheiro"
                  value={caixaResumo.valor_esperado_dinheiro.toLocaleString(
                    "pt-BR",
                    { style: "currency", currency: "BRL" },
                  )}
                />
                <Field
                  label="Suprimentos"
                  value={caixaResumo.total_suprimentos.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                />
                <Field
                  label="Sangrias"
                  value={caixaResumo.total_sangrias.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                />
                {caixaResumo.valor_informado != null && (
                  <Field
                    label="Informado no fechamento"
                    value={caixaResumo.valor_informado.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  />
                )}
                {caixaResumo.diferenca != null && (
                  <Field
                    label="Diferença"
                    value={caixaResumo.diferenca.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  />
                )}
              </div>

              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Totais por forma de pagamento
                </div>
                {caixaResumo.por_forma.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Nenhuma venda local vinculada a este caixa ainda.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Forma</th>
                          <th className="px-3 py-2 text-right font-medium">Vendas</th>
                          <th className="px-3 py-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caixaResumo.por_forma.map((f) => (
                          <tr key={f.forma_pagamento} className="border-t">
                            <td className="px-3 py-2 font-mono text-xs">
                              {f.forma_pagamento}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {f.qtd_vendas}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {f.total.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Lançamentos financeiros derivados
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRegenerarLancamentos}
                    disabled={regenerandoLanc || !caixaAberto?.local_uuid}
                  >
                    {regenerandoLanc ? "Regenerando…" : "Regenerar"}
                  </Button>
                </div>
                {caixaLancamentos.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Os lançamentos derivados são gerados ao fechar o caixa.
                    Use o botão acima para forçar uma prévia.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Tipo</th>
                          <th className="px-3 py-2 text-left font-medium">Categoria</th>
                          <th className="px-3 py-2 text-left font-medium">Descrição</th>
                          <th className="px-3 py-2 text-right font-medium">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caixaLancamentos.map((l) => (
                          <tr key={l.local_uuid} className="border-t">
                            <td className="px-3 py-2">
                              <Badge
                                variant={l.tipo === "entrada" ? "default" : "secondary"}
                              >
                                {l.tipo}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {l.categoria}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {l.descricao ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {l.valor.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Resumo derivado em tempo real das vendas locais e movimentos
                de caixa associados ao <code>caixa_local_uuid</code>. Os
                lançamentos financeiros locais são <strong>idempotentes</strong>:
                regerados a cada fechamento (ou via botão acima) sem alterar a
                fonte da verdade. O financeiro real continua sendo gerado pelo
                upstream ao processar <code>fechar_caixa</code>.
              </p>
            </CardContent>
          </Card>
        )}

        {role !== "unset" && (
          <Card>
            <CardHeader>
              <CardTitle>Financeiro local</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {finResumo ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Entradas</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {finResumo.total_entradas.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </div>
                    <div className="text-xs text-muted-foreground">{finResumo.qtd_entradas} lanç.</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Saídas</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {finResumo.total_saidas.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </div>
                    <div className="text-xs text-muted-foreground">{finResumo.qtd_saidas} lanç.</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Saldo</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {finResumo.saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </div>
                    <div className="text-xs text-muted-foreground">{finResumo.qtd_lancamentos} no total</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Sem dados financeiros locais ainda.
                </div>
              )}

              {finRecentes.length > 0 && (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Tipo</th>
                        <th className="px-3 py-2 text-left font-medium">Categoria</th>
                        <th className="px-3 py-2 text-left font-medium">Origem</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finRecentes.map((l) => (
                        <tr key={l.local_uuid} className="border-t">
                          <td className="px-3 py-2">
                            <Badge variant={l.tipo === "entrada" ? "default" : "secondary"}>{l.tipo}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{l.categoria}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{l.origem}</td>
                          <td className="px-3 py-2 text-xs">{l.status ?? "confirmado"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Visão consolidada local (<code>lancamentos_financeiros_local</code>):
                inclui derivados de fechamento de caixa e lançamentos manuais.
                Endpoints: <code>/api/financeiro/lancamentos</code>,{" "}
                <code>/api/financeiro/resumo</code>, <code>/api/financeiro/manual</code>,{" "}
                <code>/api/financeiro/cancelar</code>.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Backend de dados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Lovable Cloud + SQLite local</Badge>
              <span className="text-muted-foreground">
                Híbrido com cache local de leitura.
              </span>
            </div>
            <p className="text-muted-foreground">
              Os domínios <strong>produtos.list</strong>,{" "}
              <strong>estoque.saldosLinhas</strong> e{" "}
              <strong>clientes.listLite</strong> são servidos pelo banco local
              do servidor: cache read-through (TTL 60s) com ingestão paralela
              em <strong>tabelas tipadas</strong> (produtos_local, clientes_local,
              estoque_saldos_local). Se a nuvem falhar e existirem dados
              locais, o servidor responde a partir das tabelas tipadas
              (origem <code>local-table-stale</code>). Demais domínios
              continuam proxy direto para o Lovable Cloud nesta etapa.
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
