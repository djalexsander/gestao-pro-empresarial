/**
 * ============================================================================
 * Bridge JS → Comandos Tauri do backend local
 * ============================================================================
 *
 * Em web (sem Tauri), retorna no-op com `running: false`. No desktop, chama
 * os comandos Rust expostos em `src-tauri/src/lib.rs`.
 *
 * Importação dinâmica de `@tauri-apps/api/core` evita quebrar o build web —
 * o pacote pode nem estar instalado fora do ambiente desktop.
 */

import { isDesktop } from "@/integrations/data/mode";

export interface LocalServerStatus {
  running: boolean;
  port: number | null;
  started_at: number | null;
  server_name: string | null;
  server_id: string | null;
  hostname: string | null;
  app: string;
  version: string;
  upstream_configured?: boolean;
  terminals_conectados?: number;
  /** Token de pareamento que o backend local exige (X-Gestao-Token). */
  auth_token?: string | null;
}

const STATUS_OFF: LocalServerStatus = {
  running: false,
  port: null,
  started_at: null,
  server_name: null,
  server_id: null,
  hostname: null,
  app: "Gestao Pro",
  version: "0",
  upstream_configured: false,
  terminals_conectados: 0,
  auth_token: null,
};

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: TauriInvoke | null = null;

async function getInvoke(): Promise<TauriInvoke | null> {
  if (!isDesktop()) return null;
  if (cachedInvoke) return cachedInvoke;
  try {
    // Import dinâmico — só existe no bundle desktop.
    const mod = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as {
      invoke: TauriInvoke;
    };
    cachedInvoke = mod.invoke;
    return cachedInvoke;
  } catch {
    return null;
  }
}

export interface StartLocalServerOptions {
  port: number;
  serverName: string | null;
  serverId?: string | null;
  upstreamUrl?: string | null;
  upstreamAnonKey?: string | null;
  /**
   * Token previamente persistido. Quando informado, o backend reusa esse
   * mesmo token (não gera um novo). Mantém terminais pareados funcionando
   * entre reinícios do servidor.
   */
  authToken?: string | null;
}

export async function startLocalServer(
  opts: StartLocalServerOptions,
): Promise<LocalServerStatus> {
  const invoke = await getInvoke();
  if (!invoke) return STATUS_OFF;
  return invoke<LocalServerStatus>("start_local_server", {
    port: opts.port,
    serverName: opts.serverName,
    serverId: opts.serverId ?? null,
    upstreamUrl: opts.upstreamUrl ?? null,
    upstreamAnonKey: opts.upstreamAnonKey ?? null,
    authToken: opts.authToken ?? null,
  });
}

export async function stopLocalServer(): Promise<LocalServerStatus> {
  const invoke = await getInvoke();
  if (!invoke) return STATUS_OFF;
  return invoke<LocalServerStatus>("stop_local_server");
}

export async function getLocalServerStatus(): Promise<LocalServerStatus> {
  const invoke = await getInvoke();
  if (!invoke) return STATUS_OFF;
  try {
    return await invoke<LocalServerStatus>("local_server_status");
  } catch {
    return STATUS_OFF;
  }
}
