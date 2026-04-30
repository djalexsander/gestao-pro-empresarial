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
  return "cloud";
}
