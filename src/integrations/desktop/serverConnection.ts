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
  started_at?: number | null;
  started_at_iso?: string | null;
  port?: number | null;
  upstream_configured?: boolean;
  terminals_conectados?: number;
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
// Heartbeat — terminal informa identidade ao servidor local
// ----------------------------------------------------------------------------

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
