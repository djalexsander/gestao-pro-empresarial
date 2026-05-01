/**
 * ============================================================================
 * Conexão Terminal → Servidor Local (placeholder estrutural)
 * ============================================================================
 *
 * Esta camada NÃO se conecta a nada real ainda — o backend local não existe.
 * Ela existe para que a UI de status, healthcheck e reconexão já viva no
 * lugar certo. Quando o servidor local for implementado:
 *   - trocar `pingServidorLocal()` para um `fetch(${baseUrl}/health)` real;
 *   - trocar `getBaseUrl()` para montar a URL a partir da config;
 *   - manter a mesma interface — nenhum componente precisará mudar.
 *
 * Hoje, em modo `terminal`, o ping retorna sempre "modo cloud" (passthrough).
 */

import type { TerminalConexaoConfig } from "./types";

export type ServerConnStatus = "unknown" | "online" | "offline" | "cloud-fallback";

export interface ServerConnInfo {
  status: ServerConnStatus;
  latenciaMs: number | null;
  ultimoSync: Date | null;
  baseUrl: string | null;
}

export function getBaseUrl(cfg?: TerminalConexaoConfig): string | null {
  if (!cfg?.host || !cfg?.porta) return null;
  const host = cfg.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `http://${host}:${cfg.porta}`;
}

/**
 * Ping ao servidor local. Hoje retorna `cloud-fallback` porque o backend local
 * ainda não existe — o terminal continua usando a nuvem por baixo.
 *
 * Quando o backend local entrar, substituir o corpo por:
 *
 *   const t0 = performance.now();
 *   const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
 *   if (!res.ok) return { status: "offline", ... };
 *   return { status: "online", latenciaMs: Math.round(performance.now() - t0), ... };
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
    };
  }
  // Estrutura pronta — implementação real virá quando o servidor local existir.
  return {
    status: "cloud-fallback",
    latenciaMs: null,
    ultimoSync: new Date(),
    baseUrl,
  };
}
