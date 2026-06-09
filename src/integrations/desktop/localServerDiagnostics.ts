import type { TerminalConexaoConfig } from "./types";
import { getBaseUrl, fetchWithTimeout } from "./localHttpClient";

// Use a more generous timeout for desktop local checks (8-12s recommended).
const TIMEOUT_MS = 10_000;
const APP_MARKER = "Gestao Pro";

function logPingResult(result: ServerConnInfo): ServerConnInfo {
  return result;
}

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
  /** Último endpoint testado (ex: /health, /server-info) */
  lastEndpoint?: string | null;
  /** Tempo de resposta do último probe (ms) */
  lastLatencyMs?: number | null;
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
  /** Detalhe técnico do último erro (body ou mensagem de timeout). */
  lastErrorDetail?: string | null;
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
    return logPingResult({
      status: "cloud-fallback",
      latenciaMs: null,
      ultimoSync: new Date(),
      baseUrl: null,
      mensagem: "Sem servidor local configurado — usando nuvem.",
    });
  }
  // Sequential probes with individual timeouts and logging.
  const probes: Array<{
    endpoint: string;
    start: number;
    durationMs?: number;
    ok?: boolean;
    statusCode?: number | null;
    error?: string | null;
  }> = [];

  // Helper to run a GET with timeout.
  async function probe(path: string) {
    const start = performance.now();
    const entry = { endpoint: path, start };
    probes.push(entry as any);
    try {
      const res = await fetchWithTimeout(`${baseUrl}${path}`, { headers: { Accept: "application/json" } }, TIMEOUT_MS);
      const duration = Math.round(performance.now() - start);
      (entry as any).durationMs = duration;
      (entry as any).statusCode = res.status;
      (entry as any).ok = res.ok;
      if (!res.ok) {
        (entry as any).error = `HTTP ${res.status}`;
        return { ok: false, status: res.status, body: await res.text().catch(() => "") };
      }
      const body = await res.text().catch(() => "");
      return { ok: true, status: res.status, body };
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      (entry as any).durationMs = duration;
      const name = (err as Error)?.name ?? String(err);
      (entry as any).error = String(err ?? "error");
      return { ok: false, status: null, body: null, error: String(err) };
    }
  }

  // 1) /health
  const healthRes = await probe("/health");
  if (!healthRes.ok) {
    const isTimeout = healthRes.error?.includes("AbortError") || healthRes.error?.toLowerCase().includes("timeout");
    return logPingResult({
      status: isTimeout ? "offline" : "offline",
      latenciaMs: null,
      ultimoSync: new Date(),
      baseUrl,
      mensagem: isTimeout ? `Timeout em /health ao ${baseUrl}/health` : `Falha ao consultar /health em ${baseUrl}. ${healthRes.error ?? ""}`,
    });
  }

  // Parse health payload safely
  let healthPayload: HealthPayload | null = null;
  try {
    healthPayload = JSON.parse(healthRes.body ?? "") as HealthPayload;
  } catch {
    // try to continue — body may be empty/non-json
  }

  if (!healthPayload || healthPayload?.status !== "ok" || healthPayload?.app !== APP_MARKER) {
    return logPingResult({
      status: "invalid-server",
      latenciaMs: null,
      ultimoSync: new Date(),
      baseUrl,
      mensagem: "Há um servidor neste endereço, mas não é um Gestão Pro válido.",
    });
  }

  // Health OK — record latency from payload if available or zero.
  const healthLatency = healthPayload && typeof healthPayload.uptime_ms === "number" ? 0 : 0;

  // 2) /server-info (best-effort): if it fails, report but keep status=online
  const serverInfoRes = await probe("/server-info");
  if (!serverInfoRes.ok) {
    return logPingResult({
      status: "online",
      latenciaMs: healthLatency ?? null,
      ultimoSync: new Date(),
      baseUrl,
      lastEndpoint: "/server-info",
      lastLatencyMs: null,
      mensagem: `Servidor local ativo. Aguardando resposta de /server-info`,
      lastErrorDetail: serverInfoRes.error ?? null,
    });
  }

  // Parse server-info and expose server metadata if available
  let serverInfoPayload: any = null;
  try {
    serverInfoPayload = JSON.parse(serverInfoRes.body ?? "");
  } catch {
    serverInfoPayload = null;
  }

  // 3) /db/info — if it fails, report DB-specific warning but keep server active
  const dbRes = await probe("/db/info");
  if (!dbRes.ok) {
    return logPingResult({
      status: "online",
      latenciaMs: healthLatency ?? null,
      ultimoSync: new Date(),
      baseUrl,
      lastEndpoint: "/db/info",
      lastLatencyMs: null,
      mensagem: `Servidor local ativo. Banco local não respondeu.`,
      lastErrorDetail: dbRes.error ?? null,
    });
  }

  // All probes succeeded
  // successful probes — pick last probe info
  const last = probes[probes.length - 1];
  return logPingResult({
    status: "online",
    latenciaMs: healthLatency ?? null,
    ultimoSync: new Date(),
    baseUrl,
    lastEndpoint: last?.endpoint ?? null,
    lastLatencyMs: last?.durationMs ?? null,
    serverName: serverInfoPayload?.server_name ?? null,
    serverVersion: serverInfoPayload?.version ?? null,
    serverId: serverInfoPayload?.server_id ?? null,
    serverHostname: serverInfoPayload?.host ?? null,
    mensagem: null,
    lastErrorDetail: null,
  });
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
