/**
 * ============================================================================
 * Conexão Terminal → Servidor Local — IMPLEMENTAÇÃO REAL
 * ============================================================================
 *
 * Substitui o placeholder anterior. Faz fetch real ao endpoint /health do
 * backend local Rust embutido no desktop server.
 *
 * Modelo de status (alinhado ao briefing):
 *  - "online"           → /health respondeu 200 com payload válido
 *  - "offline"          → host/porta configurados mas sem resposta (timeout / rede)
 *  - "invalid-server"   → respondeu, mas não é um Gestão Pro válido
 *  - "cloud-fallback"   → terminal sem config OU local indisponível →
 *                          aplicação continua usando Lovable Cloud (sem quebrar)
 *  - "unknown"          → ainda não testado neste ciclo
 */

import type { TerminalConexaoConfig } from "./types";

export type ServerConnStatus =
  | "unknown"
  | "online"
  | "offline"
  | "invalid-server"
  | "cloud-fallback";

export interface ServerConnInfo {
  status: ServerConnStatus;
  latenciaMs: number | null;
  ultimoSync: Date | null;
  baseUrl: string | null;
  /** Nome do servidor remoto, quando online. */
  serverName?: string | null;
  /** Versão do app no servidor remoto, quando online. */
  serverVersion?: string | null;
  /** Identificador estável do servidor remoto. */
  serverId?: string | null;
  /** Hostname da máquina servidora. */
  serverHostname?: string | null;
  /** Mensagem amigável para exibir na UI quando algo dá errado. */
  mensagem?: string | null;
}

const TIMEOUT_MS = 3000;
/** Marcador esperado no payload de /health para validar que é um Gestão Pro. */
const APP_MARKER = "Gestao Pro";

export function getBaseUrl(cfg?: TerminalConexaoConfig): string | null {
  if (!cfg?.host || !cfg?.porta) return null;
  const host = cfg.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `http://${host}:${cfg.porta}`;
}

interface HealthPayload {
  status?: string;
  app?: string;
  version?: string;
  role?: string;
  server_id?: string | null;
  server_name?: string | null;
  timestamp?: number;
  uptime_ms?: number;
}

/**
 * Healthcheck real. Quando não há config válida, marca `cloud-fallback`
 * (terminal continua funcionando via Lovable Cloud).
 */
export async function pingServidorLocal(
  cfg?: TerminalConexaoConfig,
): Promise<ServerConnInfo> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) {
    return {
      status: "cloud-fallback",
      latenciaMs: null,
      ultimoSync: new Date(),
      baseUrl: null,
      mensagem: "Sem servidor local configurado — usando nuvem.",
    };
  }

  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        status: "invalid-server",
        latenciaMs: Math.round(performance.now() - t0),
        ultimoSync: new Date(),
        baseUrl,
        mensagem: `Servidor respondeu HTTP ${res.status}.`,
      };
    }

    const payload = (await res.json()) as HealthPayload;
    if (payload?.status !== "ok" || payload?.app !== APP_MARKER) {
      return {
        status: "invalid-server",
        latenciaMs: Math.round(performance.now() - t0),
        ultimoSync: new Date(),
        baseUrl,
        mensagem:
          "Há um servidor neste endereço, mas não é um Gestão Pro válido.",
      };
    }

    return {
      status: "online",
      latenciaMs: Math.round(performance.now() - t0),
      ultimoSync: new Date(),
      baseUrl,
      serverVersion: payload.version ?? null,
      serverName: payload.server_name ?? null,
      serverId: payload.server_id ?? null,
      mensagem: null,
    };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = (err as Error)?.name === "AbortError";
    return {
      status: "offline",
      latenciaMs: null,
      ultimoSync: new Date(),
      baseUrl,
      mensagem: isAbort
        ? "Tempo de resposta esgotado (timeout)."
        : "Não foi possível alcançar o servidor local — usando nuvem como fallback.",
    };
  }
}

export interface ServerInfoPayload {
  app?: string;
  version?: string;
  protocol_version?: number;
  role?: string;
  server_id?: string | null;
  server_name?: string | null;
  hostname?: string | null;
  /** IP IPv4 detectado da rede local (preferir sobre hostname para terminais). */
  host?: string | null;
  started_at?: number | null;
  started_at_iso?: string | null;
  port?: number | null;
  upstream_configured?: boolean;
  terminals_conectados?: number;
  backend_running?: boolean;
  database_ready?: boolean;
}

/** Consulta opcional ao /server-info para enriquecer o status. */
export async function fetchServerInfo(
  cfg?: TerminalConexaoConfig,
): Promise<ServerInfoPayload | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/server-info`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as ServerInfoPayload;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Banco local — leitura via servidor (terminal e o próprio server)
// ----------------------------------------------------------------------------

export interface PersistedTerminal {
  terminal_id: string;
  machine_id: string | null;
  server_id: string | null;
  terminal_nome: string | null;
  role: string | null;
  app_version: string | null;
  host: string | null;
  first_seen_ms: number;
  last_seen_ms: number;
  status: string;
  heartbeats: number;
}

export interface DbInfoPayload {
  path: string;
  schema_version: number;
  terminals_total: number;
  terminals_online: number;
  events_total: number;
  cache_entries: number;
  created_at_ms: number | null;
}

export interface DomainStat {
  domain: string;
  row_count: number;
  last_synced_ms: number | null;
  last_source: string | null;
  /** "snapshot" | "incremental" | "append" — null se ainda nunca sincronizou. */
  last_strategy: string | null;
  /** Quantos registros vieram no último lote. */
  last_delta_count: number;
  /** Cursor de sync incremental (max(updated_at) já visto no upstream). */
  last_remote_cursor_ms: number | null;
  /** Última tentativa (mesmo se deu erro). */
  last_attempt_ms: number | null;
  /** Última tentativa foi bem-sucedida? */
  last_synced_ok: boolean;
  /** Mensagem do último erro, se houver. */
  last_error: string | null;
}

export interface SyncRunResult {
  ok: boolean;
  domain: string;
  strategy: string;
  delta: number;
  source: string;
}

/** Força uma rodada de sync incremental para o domínio (botão "Sincronizar agora"). */
export async function runDbSync(
  cfg: TerminalConexaoConfig | undefined,
  domain: "produtos" | "clientes_lite" | "estoque_movimentacoes" | "estoque_saldos",
): Promise<SyncRunResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  // Sync pode demorar mais que um GET normal — damos margem.
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(
      `${baseUrl}/db/sync?domain=${encodeURIComponent(domain)}`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
        cache: "no-store",
      },
    );
    clearTimeout(timer);
    if (!res.ok) return { ok: false, domain, strategy: "", delta: 0, source: "" };
    return (await res.json()) as SyncRunResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchKnownTerminals(
  cfg?: TerminalConexaoConfig,
): Promise<PersistedTerminal[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/terminals/known`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as { terminals?: PersistedTerminal[] };
    return json.terminals ?? [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

export async function fetchDbInfo(
  cfg?: TerminalConexaoConfig,
): Promise<DbInfoPayload | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/db/info`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as DbInfoPayload;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchDomainStats(
  cfg?: TerminalConexaoConfig,
): Promise<DomainStat[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/db/domains`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as { domains?: DomainStat[] };
    return json.domains ?? [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// ----------------------------------------------------------------------------
// Etapa 3 — Prontidão offline (sincronização inicial obrigatória)
// ----------------------------------------------------------------------------

export interface OfflineDomainStatus {
  domain: string;
  label: string;
  essential: boolean;
  ready: boolean;
  row_count: number;
  last_synced_ms: number | null;
  last_synced_ok: boolean;
  last_error: string | null;
}

export interface OfflineStatus {
  initial_sync_completed: boolean;
  initial_sync_at_ms: number | null;
  schema_version: number;
  upstream_configured: boolean;
  ready: boolean;
  warnings: string[];
  domains: OfflineDomainStatus[];
  pending_domains: string[];
}

export interface OfflineSyncDomainResult {
  domain: string;
  label: string;
  ok: boolean;
  delta: number;
  row_count: number;
  error: string | null;
  duration_ms: number;
}

export interface OfflineSyncResult {
  ok: boolean;
  completed_at_ms: number;
  upstream_configured: boolean;
  total_delta: number;
  results: OfflineSyncDomainResult[];
}

export async function fetchOfflineStatus(
  cfg?: TerminalConexaoConfig,
): Promise<OfflineStatus | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/offline/status`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OfflineStatus;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Dispara a sincronização inicial obrigatória. Pode demorar (vários domínios
 * em sequência), por isso o timeout é generoso. Idempotente.
 */
export async function runSyncInicial(
  cfg?: TerminalConexaoConfig,
): Promise<OfflineSyncResult | { ok: false; error: string }> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return { ok: false, error: "Servidor local não configurado." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${baseUrl}/api/offline/sync-inicial`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    }
    return (await res.json()) as OfflineSyncResult;
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: (err as Error)?.message ?? "Falha de rede." };
  }
}

// ============================================================================
// Sub-etapa 4.1 — PIN do operador validado pelo servidor local (LAN central)
// ============================================================================

export interface ValidarPinServidorResponse {
  autorizado: boolean;
  funcionario: {
    id: string;
    nome: string;
    login: string;
    role: "gerente" | "caixa";
  } | null;
  motivo: string | null;
  origem: "servidor-local";
}

/**
 * Resultado bruto retornado por `validarPinServidor`.
 *
 * - `notReady`: o servidor local respondeu 404 → operador ainda não foi
 *   "aquecido" (sem verificador local). Caller deve cair pra fallback.
 * - `unavailable`: servidor local não está rodando / inalcançável.
 *   Caller deve cair pra fallback.
 */
export type ValidarPinServidorResult =
  | { kind: "ok"; data: ValidarPinServidorResponse }
  | { kind: "notReady" }
  | { kind: "unavailable" };

export async function validarPinServidor(
  cfg: TerminalConexaoConfig | undefined,
  funcionarioId: string,
  pin: string,
  empresaId?: string | null,
): Promise<ValidarPinServidorResult> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return { kind: "unavailable" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${baseUrl}/api/auth/validar-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        funcionario_id: funcionarioId,
        empresa_id: empresaId ?? null,
        pin,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.status === 404) return { kind: "notReady" };
    if (!res.ok) return { kind: "unavailable" };
    const data = (await res.json()) as ValidarPinServidorResponse;
    return { kind: "ok", data };
  } catch {
    clearTimeout(timer);
    return { kind: "unavailable" };
  }
}

/**
 * Aquece o verificador local de PIN no servidor após uma validação ONLINE
 * bem-sucedida. Best-effort: nunca quebra o login do operador.
 */
export async function aquecerPinServidor(
  cfg: TerminalConexaoConfig | undefined,
  payload: {
    funcionario_id: string;
    empresa_id?: string | null;
    nome: string;
    login: string;
    role: "gerente" | "caixa";
    pin: string;
    ativo?: boolean;
  },
): Promise<boolean> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl}/api/auth/aquecer-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...payload, ativo: payload.ativo ?? true }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export interface OutboxStats {
  pending: number;
  sending: number;
  sent: number;
  error: number;
  last_sent_at_ms: number | null;
  last_error: string | null;
  /** Itens `pending` cujo backoff já venceu — elegíveis ao próximo tick. */
  due_now: number;
  /** Próximo `next_attempt_at_ms` agendado entre os pending (ms epoch). */
  next_attempt_at_ms: number | null;
  /** Última vez que o scheduler de background rodou. */
  last_auto_flush_ms: number | null;
  /** Última vez que o scheduler enviou algo (sent>0). */
  last_auto_flush_sent_ms: number | null;
  /** Telemetria da última rodada automática. */
  last_auto_attempted: number | null;
  last_auto_sent: number | null;
  last_auto_failed: number | null;
  /** Última vez que o operador clicou "Sincronizar agora". */
  last_manual_flush_ms: number | null;
}

export interface OutboxItem {
  local_uuid: string;
  client_uuid: string | null;
  payload: string;
  status: "pending" | "sending" | "sent" | "error";
  attempts: number;
  last_error: string | null;
  remote_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  sent_at_ms: number | null;
}

export interface RegistrarMovLocalRequest {
  produto_id: string;
  variacao_id?: string | null;
  tipo: string;
  quantidade: number;
  custo_unitario?: number | null;
  observacoes?: string | null;
  origem?: string | null;
  client_uuid?: string | null;
}

export interface RegistrarMovLocalResponse {
  movimento_id: string;
  idempotente: boolean;
  saldo_anterior: number;
  saldo_posterior: number;
  outbox_status: "pending" | "sent";
  remote_id: string | null;
}

export interface OutboxFlushResult {
  attempted: number;
  sent: number;
  failed: number;
  errors: string[];
}

export async function fetchOutboxStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/db/outbox/estoque/stats`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchOutboxList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/estoque`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutbox(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

export async function registrarMovimentoLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: RegistrarMovLocalRequest,
  authToken?: string | null,
): Promise<RegistrarMovLocalResponse | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/api/estoque/movimentacoes/registrar`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as RegistrarMovLocalResponse;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Outbox de vendas (PDV) — writes locais com fila offline
// ----------------------------------------------------------------------------
//
// O backend Rust expõe a mesma forma de telemetria/operação usada para
// estoque, então reaproveitamos `OutboxStats`, `OutboxItem`, `OutboxFlushResult`.

export interface RegistrarVendaLocalRequest {
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: string;
  status_pagamento: string;
  valor_recebido: number | null;
  troco: number | null;
  observacao: string | null;
  itens: unknown[];
  pagamentos?: unknown[];
  gerar_financeiro?: boolean;
  operador_id?: string | null;
  terminal_id?: string | null;
  client_uuid?: string | null;
}

export interface RegistrarVendaLocalResponse {
  venda_id: string;
  idempotente: boolean;
  qtd_itens: number;
  total: number;
  outbox_status: "pending" | "sent";
  remote_id: string | null;
}

export async function registrarVendaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: RegistrarVendaLocalRequest,
  authToken?: string | null,
): Promise<RegistrarVendaLocalResponse | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/api/vendas/registrar`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as RegistrarVendaLocalResponse;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchOutboxVendasStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/db/outbox/vendas/stats`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchOutboxVendasList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/vendas`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxVendas(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/vendas/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxVendasErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/vendas/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Outbox de caixa — abrir / movimento / fechar com fila offline
// ----------------------------------------------------------------------------

export interface OutboxCaixaStats extends OutboxStats {
  pending_abrir: number;
  pending_movimento: number;
  pending_fechar: number;
}

export interface OutboxCaixaItem extends OutboxItem {
  action: "abrir" | "movimento" | "fechar";
  caixa_local_uuid: string;
}

export interface CaixaLocalAbertoRow {
  local_uuid: string;
  remote_id: string | null;
  client_uuid: string | null;
  status: "aberto" | "fechado";
  valor_inicial: number;
  valor_informado: number | null;
  valor_esperado: number | null;
  diferenca: number | null;
  observacao_abertura: string | null;
  observacao_fechamento: string | null;
  operador_id: string | null;
  terminal_id: string | null;
  data_abertura_ms: number;
  data_fechamento_ms: number | null;
  qtd_movimentos: number;
  total_suprimentos: number;
  total_sangrias: number;
}

export interface AbrirCaixaLocalRequest {
  valor_inicial: number;
  observacao?: string | null;
  operador_id?: string | null;
  terminal_id?: string | null;
  client_uuid?: string | null;
}
export interface AbrirCaixaLocalResponse {
  caixa_id: string;
  idempotente: boolean;
  valor_inicial: number;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_id: string | null;
}

export interface MovCaixaLocalRequest {
  caixa_id: string;
  tipo: "sangria" | "suprimento";
  valor: number;
  motivo?: string | null;
  operador_id?: string | null;
  client_uuid?: string | null;
}
export interface MovCaixaLocalResponse {
  movimento_id: string;
  idempotente: boolean;
  caixa_local_uuid: string;
  tipo: string;
  valor: number;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_id: string | null;
}

export interface FecharCaixaLocalRequest {
  caixa_id: string;
  valor_informado: number;
  observacao?: string | null;
  client_uuid?: string | null;
}
export interface FecharCaixaLocalResponse {
  fechamento_id: string;
  idempotente: boolean;
  valor_informado: number;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_id: string | null;
}

async function postLocalJson<TReq, TRes>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  body: TReq,
  authToken?: string | null,
  timeoutMs = 12_000,
): Promise<TRes | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as TRes;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function abrirCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: AbrirCaixaLocalRequest,
  authToken?: string | null,
): Promise<AbrirCaixaLocalResponse | null> {
  return postLocalJson(cfg, "/api/caixa/abrir", payload, authToken);
}

export function registrarMovCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: MovCaixaLocalRequest,
  authToken?: string | null,
): Promise<MovCaixaLocalResponse | null> {
  return postLocalJson(cfg, "/api/caixa/movimento", payload, authToken);
}

export function fecharCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: FecharCaixaLocalRequest,
  authToken?: string | null,
): Promise<FecharCaixaLocalResponse | null> {
  return postLocalJson(cfg, "/api/caixa/fechar", payload, authToken);
}

export async function fetchCaixaLocalAberto(
  cfg: TerminalConexaoConfig | undefined,
  operadorId?: string | null,
): Promise<CaixaLocalAbertoRow | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const url = new URL(`${baseUrl}/api/caixa/aberto`);
  if (operadorId) url.searchParams.set("operador_id", operadorId);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CaixaLocalAbertoRow | null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resumo local do caixa + lançamentos derivados (v9)
// ---------------------------------------------------------------------------

export interface CaixaResumoFormaRow {
  forma_pagamento: string;
  total: number;
  qtd_vendas: number;
}

export interface CaixaResumoLocal {
  caixa_local_uuid: string;
  remote_id: string | null;
  status: "aberto" | "fechado";
  data_abertura_ms: number;
  data_fechamento_ms: number | null;
  operador_id: string | null;
  terminal_id: string | null;
  valor_inicial: number;
  valor_informado: number | null;
  valor_esperado_dinheiro: number;
  diferenca: number | null;
  total_vendido: number;
  qtd_vendas: number;
  total_suprimentos: number;
  total_sangrias: number;
  por_forma: CaixaResumoFormaRow[];
}

export interface LancamentoLocalRow {
  local_uuid: string;
  caixa_local_uuid: string;
  tipo: "entrada" | "saida";
  categoria: string;
  forma_pagamento: string | null;
  valor: number;
  descricao: string | null;
  origem: string;
  created_at_ms: number;
  // v11
  status?: string;
  venda_local_uuid?: string | null;
  cliente_id?: string | null;
  fornecedor_id?: string | null;
  data_competencia_ms?: number | null;
  data_vencimento_ms?: number | null;
  data_pagamento_ms?: number | null;
  operador_id?: string | null;
  cancelado_em_ms?: number | null;
  cancelado_motivo?: string | null;
  // v12 — sync com upstream
  remote_id?: string | null;
  sync_status?: "local_only" | "pending" | "synced" | "error";
}

async function getLocalJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  query?: Record<string, string | null | undefined>,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchCaixaResumoLocal(
  cfg: TerminalConexaoConfig | undefined,
  opts: { caixaId?: string | null; operadorId?: string | null } = {},
): Promise<CaixaResumoLocal | null> {
  return getLocalJson<CaixaResumoLocal | null>(cfg, "/api/caixa/resumo", {
    caixa_id: opts.caixaId ?? undefined,
    operador_id: opts.operadorId ?? undefined,
  }).then((v) => v ?? null);
}

export function fetchCaixaLancamentosLocal(
  cfg: TerminalConexaoConfig | undefined,
  opts: { caixaId?: string | null; operadorId?: string | null } = {},
): Promise<LancamentoLocalRow[]> {
  return getLocalJson<LancamentoLocalRow[]>(cfg, "/api/caixa/lancamentos", {
    caixa_id: opts.caixaId ?? undefined,
    operador_id: opts.operadorId ?? undefined,
  }).then((v) => v ?? []);
}

export async function regenerarLancamentosCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  caixaId: string,
): Promise<boolean> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return false;
  const url = new URL(`${baseUrl}/api/caixa/regenerar-lancamentos`);
  url.searchParams.set("caixa_id", caixaId);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchOutboxCaixaStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxCaixaStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/caixa/stats`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxCaixaStats;
  } catch {
    return null;
  }
}

export async function fetchOutboxCaixaList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxCaixaItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/caixa`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxCaixaItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxCaixa(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/caixa/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxCaixaErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/caixa/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

export interface HeartbeatPayload {
  terminal_id: string;
  terminal_nome?: string | null;
  machine_id?: string | null;
  role?: string | null;
  app_version?: string | null;
  expected_server_id?: string | null;
}

export interface HeartbeatResult {
  ok: boolean;
  serverId?: string | null;
  serverName?: string | null;
  serverVersion?: string | null;
  serverMatch?: boolean | null;
  acceptedAt?: number;
}

export async function enviarHeartbeatLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: HeartbeatPayload,
): Promise<HeartbeatResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/heartbeat`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as {
      ok: boolean;
      server_id?: string | null;
      server_name?: string | null;
      server_version?: string | null;
      server_match?: boolean | null;
      accepted_at?: number;
    };
    return {
      ok: !!data.ok,
      serverId: data.server_id ?? null,
      serverName: data.server_name ?? null,
      serverVersion: data.server_version ?? null,
      serverMatch: data.server_match ?? null,
      acceptedAt: data.accepted_at,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Outbox de cancelamentos de venda (v10) — local-first
// ----------------------------------------------------------------------------

export interface OutboxCancelamentosStats extends OutboxStats {
  /**
   * Cancelamentos enfileirados que ainda não podem ir ao upstream porque a
   * venda original ainda não foi sincronizada (ordem causal venda → cancelamento).
   */
  waiting_venda_sync: number;
}

export interface OutboxCancelamentoItem extends OutboxItem {
  venda_local_uuid: string;
  venda_remote_id: string | null;
  motivo: string | null;
}

export interface CancelarVendaLocalRequest {
  venda_local_uuid: string;
  motivo?: string | null;
  operador_id?: string | null;
  client_uuid?: string | null;
}

export interface CancelarVendaLocalResponse {
  venda_local_uuid: string;
  cancelamento_local_uuid: string;
  idempotente: boolean;
  qtd_itens_estornados: number;
  qtd_total_estornada: number;
  caixa_local_uuid: string | null;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_response: string | null;
}

export function cancelarVendaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: CancelarVendaLocalRequest,
  authToken?: string | null,
): Promise<CancelarVendaLocalResponse | null> {
  return postLocalJson(cfg, "/api/vendas/cancelar", payload, authToken, 15_000);
}

export async function fetchOutboxCancelamentosStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxCancelamentosStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/cancelamentos/stats`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxCancelamentosStats;
  } catch {
    return null;
  }
}

export async function fetchOutboxCancelamentosList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxCancelamentoItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/cancelamentos`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxCancelamentoItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxCancelamentos(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/cancelamentos/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxCancelamentosErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/cancelamentos/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

// =============================================================================
// v11 — Financeiro local (lançamentos manuais, listagem, resumo)
// =============================================================================

export interface FinanceiroFiltro {
  tipo?: "entrada" | "saida";
  categoria?: string;
  origem?: string;
  status?: string;
  caixa_local_uuid?: string;
  venda_local_uuid?: string;
  desde_ms?: number;
  ate_ms?: number;
  limit?: number;
}

export interface FinanceiroResumoCat {
  chave: string;
  tipo: string;
  valor: number;
  qtd: number;
}

export interface FinanceiroResumo {
  total_entradas: number;
  total_saidas: number;
  saldo: number;
  qtd_lancamentos: number;
  qtd_entradas: number;
  qtd_saidas: number;
  por_categoria: FinanceiroResumoCat[];
  por_origem: FinanceiroResumoCat[];
}

export interface LancamentoManualInput {
  tipo: "entrada" | "saida";
  categoria: string;
  valor: number;
  forma_pagamento?: string | null;
  descricao?: string | null;
  status?: string | null;
  caixa_local_uuid?: string | null;
  venda_local_uuid?: string | null;
  cliente_id?: string | null;
  fornecedor_id?: string | null;
  data_competencia_ms?: number | null;
  data_vencimento_ms?: number | null;
  data_pagamento_ms?: number | null;
  operador_id?: string | null;
  client_uuid?: string | null;
}

export interface LancamentoManualResult {
  local_uuid: string;
  idempotente: boolean;
}

function filtroToQuery(f: FinanceiroFiltro): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    q[k] = String(v);
  }
  return q;
}

export async function fetchFinanceiroLancamentos(
  cfg: TerminalConexaoConfig | undefined,
  filtro: FinanceiroFiltro = {},
): Promise<LancamentoLocalRow[]> {
  const rows = await getLocalJson<LancamentoLocalRow[]>(
    cfg,
    "/api/financeiro/lancamentos",
    filtroToQuery(filtro),
  );
  return rows ?? [];
}

export async function fetchFinanceiroResumo(
  cfg: TerminalConexaoConfig | undefined,
  filtro: FinanceiroFiltro = {},
): Promise<FinanceiroResumo | null> {
  return getLocalJson<FinanceiroResumo>(
    cfg,
    "/api/financeiro/resumo",
    filtroToQuery(filtro),
  );
}

// Nota: o enfileiramento na outbox_financeiro acontece de forma transacional
// dentro de `lancamento_manual_inserir` (Rust) e o scheduler local
// (`run_outbox_financeiro_scheduler`) já cuida do push periódico com backoff.
// Por isso NÃO disparamos um flush automático aqui — evitar duplicar a
// concorrência com o scheduler e manter consistência. Quem quiser forçar pode
// chamar `flushOutboxFinanceiro` explicitamente.
export async function inserirLancamentoManualLocal(
  cfg: TerminalConexaoConfig | undefined,
  input: LancamentoManualInput,
): Promise<LancamentoManualResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/financeiro/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as LancamentoManualResult;
  } catch {
    return null;
  }
}

export async function cancelarLancamentoLocal(
  cfg: TerminalConexaoConfig | undefined,
  localUuid: string,
  motivo?: string,
): Promise<boolean> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return false;
  const url = new URL(`${baseUrl}/api/financeiro/cancelar`);
  url.searchParams.set("local_uuid", localUuid);
  if (motivo) url.searchParams.set("motivo", motivo);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return !!json.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// v12 — Outbox financeira (lançamentos manuais → upstream)
// =============================================================================

export interface OutboxFinanceiroStats extends OutboxStats {}

export interface OutboxFinanceiroItem extends OutboxItem {
  lanc_local_uuid: string;
}

export async function fetchOutboxFinanceiroStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxFinanceiroStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/financeiro/stats`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxFinanceiroStats;
  } catch {
    return null;
  }
}

export async function fetchOutboxFinanceiroList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxFinanceiroItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/financeiro`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxFinanceiroItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxFinanceiro(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/financeiro/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxFinanceiroErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/financeiro/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

// =============================================================================
// v21 — Contas a Receber locais (Sub-etapa 8.1)
// =============================================================================
//
// Exposição offline-first do `contas_receber_local`:
//   GET  /api/financeiro/receber            → lista de títulos locais
//   POST /api/financeiro/receber/baixar     → baixa parcial/total atômica
//   POST /api/financeiro/receber/cancelar   → cancelamento atômico
//
// Estes endpoints já são gravados na MESMA transação SQLite do título +
// auditoria (`financeiro_audit_local`) e enfileirados na outbox para o
// scheduler local promover à cloud quando voltar.

export interface ContasReceberLocalFiltro {
  status?: string; // aberto|parcial|pago|cancelado|vencido|todos
  cliente_id?: string;
  desde_ms?: number;
  ate_ms?: number;
  limit?: number;
}

export interface ContaReceberLocalRow {
  local_uuid: string;
  venda_local_uuid: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_cpf: string | null;
  cliente_telefone: string | null;
  forma_pagamento: string | null;
  valor: number;
  valor_pago: number;
  valor_restante: number;
  vencimento_ms: number | null;
  status: string; // derivado: aberto|parcial|pago|cancelado|vencido
  status_base: string;
  sync_status: string; // synced|pending|error
  created_at_ms: number;
  updated_at_ms: number;
}

export interface BaixarReceberLocalInput {
  receber_id: string;
  valor: number;
  forma_pagamento?: string | null;
  data_pagamento_ms?: number | null;
  observacao?: string | null;
  operador_id?: string | null;
  terminal_id?: string | null;
  client_uuid?: string | null;
}

export interface BaixarReceberLocalResult {
  local_uuid: string;
  idempotente: boolean;
  receber_local_uuid: string;
  valor: number;
  valor_pago_total: number;
  valor_restante: number;
  status: string;
}

export interface CancelarReceberLocalInput {
  receber_id: string;
  motivo?: string | null;
  operador_id?: string | null;
  terminal_id?: string | null;
}

export interface CancelarReceberLocalResult {
  receber_local_uuid: string;
  idempotente: boolean;
  status: string;
}

export async function fetchContasReceberLocal(
  cfg: TerminalConexaoConfig | undefined,
  filtro: ContasReceberLocalFiltro = {},
): Promise<ContaReceberLocalRow[]> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(filtro)) {
    if (v === undefined || v === null || v === "") continue;
    query[k] = String(v);
  }
  const rows = await getLocalJson<ContaReceberLocalRow[]>(
    cfg,
    "/api/financeiro/receber",
    query,
  );
  return rows ?? [];
}

export async function baixarReceberLocal(
  cfg: TerminalConexaoConfig | undefined,
  input: BaixarReceberLocalInput,
): Promise<BaixarReceberLocalResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/financeiro/receber/baixar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as BaixarReceberLocalResult;
  } catch {
    return null;
  }
}

export async function cancelarReceberLocal(
  cfg: TerminalConexaoConfig | undefined,
  input: CancelarReceberLocalInput,
): Promise<CancelarReceberLocalResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/financeiro/receber/cancelar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CancelarReceberLocalResult;
  } catch {
    return null;
  }
}

// =============================================================================
// Backup / Restauração / Exportação (v13 — Bloco de segurança)
// =============================================================================

export interface BackupStatusPayload {
  backups_dir: string;
  db_path: string;
  last_backup_ms: number | null;
  last_auto_backup_ms: number | null;
  last_restore_ms: number | null;
  restore_pending: boolean;
  auto_retention: number;
  auto_interval_ms: number;
  total_backups: number;
  total_size_bytes: number;
}

export interface BackupFileItem {
  name: string;
  path: string;
  size_bytes: number;
  modified_ms: number;
  kind: string;
}

export interface BackupLogEntry {
  id: number;
  kind: string;
  path: string;
  status: string;
  size_bytes: number | null;
  message: string | null;
  created_at_ms: number;
}

async function getJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : "{}",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchBackupStatus(cfg?: TerminalConexaoConfig) {
  return getJson<BackupStatusPayload>(cfg, "/backup/status");
}

export async function fetchBackupList(cfg?: TerminalConexaoConfig) {
  const r = await getJson<{ files: BackupFileItem[] }>(cfg, "/backup/list");
  return r?.files ?? [];
}

export async function fetchBackupLog(
  cfg?: TerminalConexaoConfig,
  limit = 50,
) {
  const r = await getJson<{ entries: BackupLogEntry[] }>(
    cfg,
    `/backup/log?limit=${limit}`,
  );
  return r?.entries ?? [];
}

export async function criarBackupAgora(
  cfg: TerminalConexaoConfig | undefined,
  kind: "manual" | "auto" = "manual",
) {
  return postJson<BackupLogEntry>(cfg, "/backup/create", { kind });
}

export async function exportarBackup(
  cfg: TerminalConexaoConfig | undefined,
  source_path: string,
  dest_path: string,
) {
  return postJson<BackupLogEntry>(cfg, "/backup/export", {
    source_path,
    dest_path,
  });
}

export async function agendarRestauracao(
  cfg: TerminalConexaoConfig | undefined,
  source_path: string,
) {
  return postJson<BackupLogEntry>(cfg, "/backup/restore/schedule", {
    source_path,
  });
}

export async function cancelarRestauracao(cfg?: TerminalConexaoConfig) {
  const r = await postJson<{ cancelled: boolean }>(cfg, "/backup/restore/cancel");
  return r?.cancelled ?? false;
}

// ----------------------------------------------------------------------------
// Clientes (Fase 2) — writes locais com outbox
// ----------------------------------------------------------------------------

export interface ClienteCriarLocalResponse {
  cliente_id: string;
  cliente_local_uuid: string;
  cliente_remote_id: string | null;
  idempotente: boolean;
  outbox_status: "pending" | "sent" | "skipped";
  remote_response?: string | null;
}

export interface ClienteSimpleLocalResponse {
  cliente_id: string;
  cliente_local_uuid: string;
  cliente_remote_id: string | null;
  idempotente: boolean;
  outbox_status: "pending" | "sent" | "skipped";
}

async function postJsonAuth<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  body: unknown,
  authToken?: string | null,
  timeoutMs = 8_000,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function criarClienteLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: Record<string, unknown>,
  authToken?: string | null,
): Promise<ClienteCriarLocalResponse | null> {
  return postJsonAuth<ClienteCriarLocalResponse>(
    cfg,
    "/api/clientes/criar",
    payload,
    authToken,
  );
}

export async function editarClienteLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: Record<string, unknown> & { cliente_id: string },
  authToken?: string | null,
): Promise<ClienteSimpleLocalResponse | null> {
  return postJsonAuth<ClienteSimpleLocalResponse>(
    cfg,
    "/api/clientes/editar",
    payload,
    authToken,
  );
}

export async function alterarStatusClienteLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: { cliente_id: string; status: string },
  authToken?: string | null,
): Promise<ClienteSimpleLocalResponse | null> {
  return postJsonAuth<ClienteSimpleLocalResponse>(
    cfg,
    "/api/clientes/alterar-status",
    payload,
    authToken,
  );
}

export async function excluirClienteLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: { cliente_id: string },
  authToken?: string | null,
): Promise<ClienteSimpleLocalResponse | null> {
  return postJsonAuth<ClienteSimpleLocalResponse>(
    cfg,
    "/api/clientes/excluir",
    payload,
    authToken,
  );
}

// Outbox de clientes — telemetria/operação
export async function fetchOutboxClientesStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/clientes/stats`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch {
    return null;
  }
}

export async function fetchOutboxClientesList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/clientes`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxClientes(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/clientes/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxClientesErrors(
  cfg?: TerminalConexaoConfig,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/clientes/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// FORNECEDORES — offline-first (v18)
// ============================================================================

export interface FornecedorCriarLocalResponse {
  fornecedor_id: string;
  fornecedor_local_uuid: string;
  fornecedor_remote_id: string | null;
  idempotente: boolean;
  outbox_status: "pending" | "sent" | "skipped";
  remote_response?: string | null;
}

export interface FornecedorSimpleLocalResponse {
  fornecedor_id: string;
  fornecedor_local_uuid: string;
  fornecedor_remote_id: string | null;
  idempotente: boolean;
  outbox_status: "pending" | "sent" | "skipped";
}

export async function criarFornecedorLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: Record<string, unknown>,
  authToken?: string | null,
): Promise<FornecedorCriarLocalResponse | null> {
  return postJsonAuth<FornecedorCriarLocalResponse>(
    cfg,
    "/api/fornecedores/criar",
    payload,
    authToken,
  );
}

export async function editarFornecedorLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: Record<string, unknown> & { fornecedor_id: string },
  authToken?: string | null,
): Promise<FornecedorSimpleLocalResponse | null> {
  return postJsonAuth<FornecedorSimpleLocalResponse>(
    cfg,
    "/api/fornecedores/editar",
    payload,
    authToken,
  );
}

export async function alterarStatusFornecedorLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: { fornecedor_id: string; status: string },
  authToken?: string | null,
): Promise<FornecedorSimpleLocalResponse | null> {
  return postJsonAuth<FornecedorSimpleLocalResponse>(
    cfg,
    "/api/fornecedores/alterar-status",
    payload,
    authToken,
  );
}

export async function excluirFornecedorLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: { fornecedor_id: string },
  authToken?: string | null,
): Promise<FornecedorSimpleLocalResponse | null> {
  return postJsonAuth<FornecedorSimpleLocalResponse>(
    cfg,
    "/api/fornecedores/excluir",
    payload,
    authToken,
  );
}

export async function fetchOutboxFornecedoresStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/fornecedores/stats`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch {
    return null;
  }
}

export async function fetchOutboxFornecedoresList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/fornecedores`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxFornecedores(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/fornecedores/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxFornecedoresErrors(
  cfg?: TerminalConexaoConfig,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/fornecedores/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// COMPRAS — offline-first (v18 pt.5)
// ============================================================================

export interface CompraCriarLocalResponse {
  compra_id: string;
  compra_local_uuid: string;
  compra_remote_id: string | null;
  idempotente: boolean;
  outbox_status: "pending" | "sent" | "skipped" | "merged";
  remote_response?: string | null;
}

export interface CompraSimpleLocalResponse {
  compra_id: string;
  compra_local_uuid: string;
  compra_remote_id: string | null;
  idempotente: boolean;
  outbox_status: "pending" | "sent" | "skipped" | "merged";
}

export async function criarCompraLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: Record<string, unknown>,
  authToken?: string | null,
): Promise<CompraCriarLocalResponse | null> {
  return postJsonAuth<CompraCriarLocalResponse>(cfg, "/api/compras/criar", payload, authToken);
}

export async function editarCompraMetadadosLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: Record<string, unknown> & { compra_id: string },
  authToken?: string | null,
): Promise<CompraSimpleLocalResponse | null> {
  return postJsonAuth<CompraSimpleLocalResponse>(cfg, "/api/compras/editar-metadados", payload, authToken);
}

export async function alterarStatusCompraLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: { compra_id: string; status: string },
  authToken?: string | null,
): Promise<CompraSimpleLocalResponse | null> {
  return postJsonAuth<CompraSimpleLocalResponse>(cfg, "/api/compras/alterar-status", payload, authToken);
}

export async function excluirCompraLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: { compra_id: string },
  authToken?: string | null,
): Promise<CompraSimpleLocalResponse | null> {
  return postJsonAuth<CompraSimpleLocalResponse>(cfg, "/api/compras/excluir", payload, authToken);
}

export async function receberCompraLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: {
    compra_id: string;
    data_recebimento?: string;
    gerar_financeiro?: boolean;
    data_vencimento?: string;
  },
  authToken?: string | null,
): Promise<CompraSimpleLocalResponse | null> {
  return postJsonAuth<CompraSimpleLocalResponse>(cfg, "/api/compras/receber", payload, authToken);
}

export async function receberCompraItensLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: {
    compra_id: string;
    itens: Array<{ item_id: string; quantidade: number }>;
    data_recebimento?: string;
    gerar_financeiro?: boolean;
    data_vencimento?: string;
  },
  authToken?: string | null,
): Promise<CompraSimpleLocalResponse | null> {
  return postJsonAuth<CompraSimpleLocalResponse>(cfg, "/api/compras/receber-itens", payload, authToken);
}

export async function fetchOutboxComprasStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/compras/stats`, {
      headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch { return null; }
}

export async function fetchOutboxComprasList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/compras`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch { return []; }
}

export async function flushOutboxCompras(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/compras/flush`, {
      method: "POST", headers, signal: ctrl.signal, cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch { clearTimeout(timer); return null; }
}

export async function retryOutboxComprasErrors(
  cfg?: TerminalConexaoConfig,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetch(`${baseUrl}/db/outbox/compras/retry-errors`, {
      method: "POST", headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch { return 0; }
}

// ============================================================================
// Etapa 5 (continuação) — Saúde e rebuild do estoque local
// ============================================================================

export interface StockHealthReport {
  now_ms: number;
  total_saldos: number;
  total_movimentacoes: number;
  saldos_negativos: number;
  movimentacoes_orfas: number;
  saldos_orfaos: number;
  movimentacoes_duplicadas: number;
  outbox_pendentes: number;
  outbox_erros: number;
  auditoria_total: number;
  last_audit_ms: number | null;
  status: "ok" | "warning" | "error";
}

export interface RebuildStockResult {
  produtos_recalculados: number;
  saldos_corrigidos: number;
  now_ms: number;
}

export async function verificarSaudeEstoque(
  cfg?: TerminalConexaoConfig,
): Promise<StockHealthReport | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/estoque/saude`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as StockHealthReport;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function rebuildEstoqueLocal(
  cfg?: TerminalConexaoConfig,
): Promise<RebuildStockResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${baseUrl}/api/estoque/rebuild`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as RebuildStockResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
