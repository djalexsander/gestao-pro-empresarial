/**
 * ============================================================================
 * dataClient — Ponto único de acesso a dados do app
 * ============================================================================
 *
 * Resolve o adapter por modo (cloud / local-server / local-terminal / hybrid).
 * O modo é determinado em `mode.ts` a partir de:
 *   - env (`VITE_DATA_MODE`)
 *   - papel da máquina desktop (configStore)
 *   - fallback `cloud`
 *
 * IMPORTANTE: a resolução é dinâmica via Proxy. Isso permite trocar de modo
 * em runtime (ex.: o usuário muda o papel da máquina no wizard) sem
 * precisar recarregar a aplicação.
 */

import type { DataAdapter } from "./adapter";
import { cloudAdapter } from "./adapters/cloud";
import { localServerAdapter } from "./adapters/local-server";
import { localTerminalAdapter } from "./adapters/local-terminal";
import { getDataMode, type DataMode } from "./mode";

let lastLoggedMode: DataMode | null = null;
function logModeOnce(mode: DataMode) {
  if (lastLoggedMode === mode) return;
  lastLoggedMode = mode;
  const label =
    mode === "local-server"
      ? "🖥️  SERVIDOR LOCAL (SQLite/Tauri)"
      : mode === "local-terminal"
        ? "💻 TERMINAL LOCAL (HTTP LAN + fallback cloud)"
        : mode === "hybrid"
          ? "🔀 HÍBRIDO (local + cloud)"
          : "☁️  CLOUD (Supabase)";
  // eslint-disable-next-line no-console
  console.info(`[dataClient] modo ativo → ${label}`);
}

function resolveAdapter(): DataAdapter {
  const mode = getDataMode();
  logModeOnce(mode);
  switch (mode) {
    case "local-server":
      return localServerAdapter;
    case "local-terminal":
      return localTerminalAdapter;
    case "hybrid":
      // Por ora cai no cloud; será preenchido em fase futura.
      return cloudAdapter;
    case "cloud":
    default:
      return cloudAdapter;
  }
}

/**
 * Proxy dinâmico: cada acesso a `dataClient.<dominio>` re-resolve o adapter,
 * garantindo que mudanças no papel da máquina (configStore) entrem em vigor
 * imediatamente.
 */
export const dataClient: DataAdapter = new Proxy({} as DataAdapter, {
  get(_target, prop, receiver) {
    const adapter = resolveAdapter();
    return Reflect.get(adapter, prop, receiver);
  },
}) as DataAdapter;
