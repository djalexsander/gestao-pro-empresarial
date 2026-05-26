/**
 * ============================================================================
 * Modo de operação do app
 * ============================================================================
 *
 * Determina qual adapter de dados será usado em runtime.
 *
 *  - "cloud"          → arquitetura atual (Supabase remoto). Default.
 *  - "local-server"   → PC servidor da loja. Hoje delega ao cloud, com
 *                        instrumentação de origem (preparado para banco local).
 *  - "local-terminal" → caixa desktop conectado ao servidor da LAN via HTTP,
 *                        com fallback transparente para cloud.
 *  - "hybrid"         → futuro: local + sync opcional com a nuvem.
 *
 * Resolução em ordem:
 *  1. `VITE_DATA_MODE` (override de build/dev)
 *  2. Configuração do desktop (`role`) quando rodando como Tauri
 *  3. `cloud` como default seguro
 */

export type DataMode = "cloud" | "local-server" | "local-terminal" | "hybrid";

export type RuntimeShell = "web" | "desktop";

/**
 * Detecta se o app está rodando dentro de um shell desktop (Tauri).
 */
export function getRuntimeShell(): RuntimeShell {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.isTauri === true) return "desktop";
  if (w.__TAURI__ || w.__TAURI_INTERNALS__) return "desktop";
  const envShell = (import.meta.env.VITE_RUNTIME_SHELL ?? "").toString().trim();
  if (envShell === "desktop") return "desktop";
  return "web";
}

export function isDesktop(): boolean {
  return getRuntimeShell() === "desktop";
}

function readEnvMode(): DataMode | null {
  const fromEnv = (import.meta.env.VITE_DATA_MODE ?? "").toString().trim();
  if (
    fromEnv === "cloud" ||
    fromEnv === "local-server" ||
    fromEnv === "local-terminal" ||
    fromEnv === "hybrid"
  ) {
    return fromEnv;
  }
  return null;
}

function readDesktopMode(): DataMode | null {
  if (!isDesktop()) return null;
  if (typeof window === "undefined") return null;
  try {
    // Import lazy para evitar ciclo (configStore importa types puros).
    // Usamos a mesma chave do desktopConfigStore.
    const raw = window.localStorage.getItem("gp.desktop.config.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string };
    if (parsed.role === "server") return "local-server";
    if (parsed.role === "terminal") return "local-terminal";
    return null;
  } catch {
    return null;
  }
}

export function getDataMode(): DataMode {
  return readEnvMode() ?? readDesktopMode() ?? "cloud";
}
