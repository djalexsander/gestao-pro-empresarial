/**
 * ============================================================================
 * Local Terminal Status — heartbeat LAN/local-first
 * ============================================================================
 *
 * Mantém o monitoramento de terminais funcionando sem internet.
 *
 *  - Em uma máquina SERVIDOR (Tauri + Rust local server): conversa com
 *    `http://127.0.0.1:<porta>/heartbeat` e `/terminals`.
 *  - Em uma máquina TERMINAL: usa `TerminalConexaoConfig` (host/porta da LAN)
 *    para falar com o servidor remoto da rede.
 *  - Em qualquer outro ambiente (web puro, sem servidor local): vira no-op
 *    silencioso, sem quebrar nada.
 *
 * Não substitui o heartbeat na nuvem — complementa. Quando offline, a UI
 * usa o `last_seen_ms` local; quando online, a nuvem continua sendo a
 * fonte primária via `terminais_listar`.
 */

import { getLocalServerStatus } from "./tauriBridge";
import { getDesktopConfig } from "./configStore";
import { getBaseUrl } from "./serverConnection";

const HB_TIMEOUT_MS = 2500;

export interface LocalHeartbeatPayload {
  terminal_id: string;
  terminal_nome?: string | null;
  machine_id?: string | null;
  role?: string | null;
  app_version?: string | null;
}

export interface LocalTerminalRow {
  terminal_id: string;
  terminal_nome: string | null;
  machine_id: string | null;
  role: string | null;
  app_version: string | null;
  last_seen_ms: number;
  last_seen_iso: string;
}

/**
 * Descobre o base URL mais apropriado para falar com o servidor local:
 *  - Se este processo HOSPEDA o servidor (Tauri + Rust rodando), usa
 *    `127.0.0.1:<porta>` — não depende da rede.
 *  - Se este processo é um TERMINAL conectado a outro servidor da LAN,
 *    usa a config de `terminal.host:porta`.
 *  - Caso contrário (web puro), retorna `null`.
 */
async function resolveLocalServerBaseUrl(): Promise<string | null> {
  try {
    const st = await getLocalServerStatus();
    if (st.running && st.port) {
      return `http://127.0.0.1:${st.port}`;
    }
  } catch {
    /* sem Tauri / sem servidor — segue tentando config de terminal */
  }
  const cfg = getDesktopConfig().terminal;
  return getBaseUrl(cfg);
}

async function postLocal<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HB_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
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

async function getLocal<T>(baseUrl: string, path: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HB_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" },
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

/**
 * Envia um heartbeat ao servidor local (se disponível). Silencioso.
 * Retorna `true` quando o servidor local aceitou.
 */
export async function pingLocalHeartbeat(
  payload: LocalHeartbeatPayload,
): Promise<boolean> {
  const baseUrl = await resolveLocalServerBaseUrl();
  if (!baseUrl) {
    if (import.meta.env.DEV) {
      console.debug("[LOCAL_SERVER_STATUS] indisponível — heartbeat LAN ignorado");
    }
    return false;
  }
  const res = await postLocal<{ ok?: boolean }>(baseUrl, "/heartbeat", payload);
  const ok = !!res?.ok;
  if (import.meta.env.DEV) {
    console.info(
      `[TERMINAL_HEARTBEAT] LAN ${ok ? "ok" : "falhou"}`,
      { terminal_id: payload.terminal_id, baseUrl },
    );
  }
  return ok;
}

/**
 * Lê a tabela de heartbeats em memória do servidor local. Retorna um mapa
 * `terminal_id` → `last_seen_ms` para uso na UI de status.
 */
export async function fetchLocalTerminals(): Promise<Map<string, LocalTerminalRow>> {
  const baseUrl = await resolveLocalServerBaseUrl();
  if (!baseUrl) {
    if (import.meta.env.DEV) {
      console.debug("[LAN_STATUS] sem servidor local — lista vazia");
    }
    return new Map();
  }
  const res = await getLocal<{ terminals: LocalTerminalRow[] }>(
    baseUrl,
    "/terminals",
  );
  const map = new Map<string, LocalTerminalRow>();
  for (const t of res?.terminals ?? []) {
    if (t.terminal_id) map.set(t.terminal_id, t);
  }
  if (import.meta.env.DEV) {
    console.info(`[LAN_STATUS] ${map.size} terminal(is) ativo(s) na LAN`);
  }
  return map;
}

/** Reporta se o servidor local está respondendo agora (curto-circuito). */
export async function isLocalServerOnline(): Promise<boolean> {
  const baseUrl = await resolveLocalServerBaseUrl();
  if (!baseUrl) return false;
  const ok = !!(await getLocal<unknown>(baseUrl, "/health"));
  if (import.meta.env.DEV) {
    console.info(`[LOCAL_SERVER_STATUS] ${ok ? "ONLINE" : "OFFLINE"}`);
  }
  return ok;
}
