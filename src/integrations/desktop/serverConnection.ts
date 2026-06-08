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
import {
  clearLocalServerAuth as clearLocalServerAuthRegistry,
  fetchWithTimeout,
  getBaseUrl,
  getJson,
  getLocalJson,
  registerLocalServerAuth as registerLocalServerAuthRegistry,
  resolveTokenForUrl,
} from "./localHttpClient";

export { getBaseUrl } from "./localHttpClient";
export {
  enviarHeartbeatLocal,
  fetchDbInfo,
  fetchDomainStats,
  fetchKnownTerminals,
  fetchServerInfo,
  pingServidorLocal,
} from "./localServerDiagnostics";
export type {
  DbInfoPayload,
  DomainStat,
  HeartbeatPayload,
  HeartbeatResult,
  PersistedTerminal,
  ServerConnInfo,
  ServerConnStatus,
  ServerInfoPayload,
} from "./localServerDiagnostics";
import type {
  LancamentoLocalRow,
  OutboxFlushResult,
  OutboxItem,
  OutboxStats,
} from "./localOfflineCore";
export {
  abrirCaixaLocal,
  cancelarVendaLocal,
  fecharCaixaLocal,
  fetchCaixaLancamentosLocal,
  fetchCaixaLocalAberto,
  fetchCaixaResumoLocal,
  fetchOutboxCaixaList,
  fetchOutboxCaixaStats,
  fetchOutboxList,
  fetchOutboxStats,
  fetchOutboxVendasList,
  fetchOutboxVendasStats,
  flushOutbox,
  flushOutboxCaixa,
  flushOutboxVendas,
  regenerarLancamentosCaixaLocal,
  registrarMovCaixaLocal,
  registrarMovimentoLocal,
  registrarVendaLocal,
  retryOutboxCaixaErrors,
  retryOutboxErrors,
  retryOutboxVendasErrors,
} from "./localOfflineCore";
export type {
  AbrirCaixaLocalRequest,
  AbrirCaixaLocalResponse,
  CaixaLocalAbertoRow,
  CaixaResumoFormaRow,
  CaixaResumoLocal,
  CancelarVendaLocalRequest,
  CancelarVendaLocalResponse,
  FecharCaixaLocalRequest,
  FecharCaixaLocalResponse,
  LancamentoLocalRow,
  MovCaixaLocalRequest,
  MovCaixaLocalResponse,
  OutboxCaixaItem,
  OutboxCaixaStats,
  OutboxFlushResult,
  OutboxItem,
  OutboxStats,
  RegistrarMovLocalRequest,
  RegistrarMovLocalResponse,
  RegistrarVendaLocalRequest,
  RegistrarVendaLocalResponse,
} from "./localOfflineCore";

const TIMEOUT_MS = 3000;

// ----------------------------------------------------------------------------
// Interceptor global de fetch — injeta `X-Gestao-Token` automaticamente
// em qualquer chamada ao servidor local (cujo baseUrl tenha sido registrado).
//
// Isso evita ter que editar manualmente todos os call sites (`fetch(...)`)
// espalhados neste arquivo e em outros consumidores. Tanto o servidor
// (`useLocalServerBoot`) quanto o terminal (DesktopRoleProvider, via efeito
// abaixo) chamam `registerLocalServerAuth(baseUrl, token)` quando o token
// fica conhecido. A partir daí, todo `fetch(url)` cuja URL comece com esse
// baseUrl ganha o header `X-Gestao-Token` automaticamente.
// ----------------------------------------------------------------------------

const HEADER_NAME = "X-Gestao-Token";
let interceptorInstalled = false;

function installFetchInterceptor(): void {
  if (interceptorInstalled) return;
  if (typeof globalThis === "undefined" || typeof globalThis.fetch !== "function") {
    return;
  }
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const token = resolveTokenForUrl(url);
      if (token) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has(HEADER_NAME)) {
          headers.set(HEADER_NAME, token);
        }
        return originalFetch(input, { ...init, headers });
      }
    } catch {
      // Em caso de qualquer erro de inspeção, segue o fetch original.
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  interceptorInstalled = true;
}

/**
 * Registra o token de pareamento para um baseUrl do servidor local.
 * Pode ser chamado várias vezes — sobrescreve o token anterior daquele baseUrl.
 * Passar `token = null/undefined/""` remove o registro.
 */
export function registerLocalServerAuth(
  baseUrl: string | null | undefined,
  token: string | null | undefined,
): void {
  if (!baseUrl) return;
  installFetchInterceptor();
  registerLocalServerAuthRegistry(baseUrl, token);
}

/** Limpa todos os tokens registrados (útil em logout/troca de papel). */
export function clearLocalServerAuth(): void {
  clearLocalServerAuthRegistry();
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

// ----------------------------------------------------------------------------
// Outbox de estoque — writes locais com fila offline
// ----------------------------------------------------------------------------

export interface OutboxDomainStatus {
  domain: "clientes" | "vendas" | "estoque" | "caixa" | "cancelamentos" | "financeiro" | string;
  label: string;
  pending: number;
  sending: number;
  sent: number;
  error: number;
  due_now: number;
  next_attempt_at_ms: number | null;
  last_attempt_at_ms: number | null;
  last_sent_at_ms: number | null;
  last_error: string | null;
}

export async function flushOutboxClientes(
  cfg: TerminalConexaoConfig | undefined,
  accessToken?: string | null,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/clientes/flush`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { sent?: number };
    return json.sent ?? 0;
  } catch {
    return 0;
  }
}

export async function retryOutboxClientesErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/clientes/retry-errors`, {
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

export interface OutboxStatusResponse {
  generated_at_ms: number;
  total_pending: number;
  total_sending: number;
  total_sent: number;
  total_error: number;
  domains: OutboxDomainStatus[];
}

export async function fetchOutboxStatus(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStatusResponse | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/db/outbox/status`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxStatusResponse;
  } catch {
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

export async function fetchOutboxCancelamentosStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxCancelamentosStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/cancelamentos/stats`, {
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
    const res = await fetchWithTimeout(url.toString(), {
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
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/cancelamentos/retry-errors`, {
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
    const res = await fetchWithTimeout(`${baseUrl}/api/financeiro/manual`, {
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
    const res = await fetchWithTimeout(url.toString(), {
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
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/financeiro/stats`, {
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
    const res = await fetchWithTimeout(url.toString(), {
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
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/financeiro/retry-errors`, {
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

async function postJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetchWithTimeout(`${baseUrl}${path}`, {
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

export interface RestorePreflight {
  blocked: boolean;
  caixa_aberto: boolean;
  caixa_abertos_count: number;
  outbox_pending_total: number;
  outbox_error_total: number;
  reasons: string[];
}

export async function fetchRestorePreflight(
  cfg?: TerminalConexaoConfig,
): Promise<RestorePreflight | null> {
  return getJson<RestorePreflight>(cfg, "/backup/restore/preflight");
}

/**
 * Agenda a restauração. Diferente das outras chamadas de backup, esta
 * **propaga** a mensagem de erro do servidor (incluindo o motivo do
 * preflight quando bloqueado, 409 Conflict) em vez de devolver `null`
 * silenciosamente — o operador precisa ver exatamente por que falhou.
 */
export async function agendarRestauracao(
  cfg: TerminalConexaoConfig | undefined,
  source_path: string,
  options?: { force?: boolean },
): Promise<BackupLogEntry> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) {
    throw new Error("Servidor local indisponível.");
  }
  const res = await fetchWithTimeout(`${baseUrl}/backup/restore/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ source_path, force: options?.force ?? false }),
    cache: "no-store",
  });
  if (!res.ok) {
    const msg = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (await res.json()) as BackupLogEntry;
}

export async function cancelarRestauracao(cfg?: TerminalConexaoConfig) {
  const r = await postJson<{ cancelled: boolean }>(cfg, "/backup/restore/cancel");
  return r?.cancelled ?? false;
}
