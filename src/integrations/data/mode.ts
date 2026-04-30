/**
 * ============================================================================
 * Modo de operação do app
 * ============================================================================
 *
 * Determina qual adapter de dados será usado em runtime.
 *
 *  - "cloud"          → arquitetura atual (Supabase remoto). Default.
 *  - "local-server"   → futuro: PC servidor da loja com Postgres local.
 *  - "local-terminal" → futuro: caixa Electron conectado ao servidor da LAN.
 *  - "hybrid"         → futuro: local + sync opcional com a nuvem.
 *
 * A detecção hoje é trivial (sempre "cloud"). Pontos de extensão futuros:
 *  - variável de ambiente `VITE_DATA_MODE`
 *  - flag persistida pelo instalador Electron
 *  - configuração escolhida no primeiro boot do PC servidor
 */

export type DataMode = "cloud" | "local-server" | "local-terminal" | "hybrid";

export type RuntimeShell = "web" | "desktop";

/**
 * Detecta se o app está rodando dentro de um shell desktop (Tauri).
 * Tauri injeta `window.__TAURI__` / `window.__TAURI_INTERNALS__` no runtime.
 */
export function getRuntimeShell(): RuntimeShell {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI__ || w.__TAURI_INTERNALS__) return "desktop";
  // Override opcional por env (útil para testar sem o shell real).
  const envShell = (import.meta.env.VITE_RUNTIME_SHELL ?? "").toString().trim();
  if (envShell === "desktop") return "desktop";
  return "web";
}

export function isDesktop(): boolean {
  return getRuntimeShell() === "desktop";
}

export function getDataMode(): DataMode {
  // Permite override por env (útil para futuras builds desktop).
  const fromEnv = (import.meta.env.VITE_DATA_MODE ?? "").toString().trim();
  if (
    fromEnv === "cloud" ||
    fromEnv === "local-server" ||
    fromEnv === "local-terminal" ||
    fromEnv === "hybrid"
  ) {
    return fromEnv;
  }
  // No desktop ainda mantemos cloud nesta etapa. O ponto de troca já existe:
  // basta no futuro retornar "local-server" / "local-terminal" aqui quando
  // `isDesktop()` e o instalador escrever a flag correspondente.
  return "cloud";
}
