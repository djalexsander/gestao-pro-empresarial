/**
 * ============================================================================
 * desktopConfigStore — Persistência da configuração do desktop
 * ============================================================================
 *
 * Interface única usada pela aplicação. Hoje o backend é `localStorage`.
 * Quando o app desktop adotar `@tauri-apps/plugin-store`, basta criar um
 * adapter `tauriStoreAdapter` e trocar a constante `adapter` abaixo —
 * nenhum outro arquivo precisa mudar.
 *
 * Não usa hooks: pode ser chamado de qualquer lugar (incluindo módulos
 * de bootstrap, providers, scripts).
 */

import {
  DESKTOP_CONFIG_DEFAULT,
  type DesktopConfig,
  type DesktopRole,
  type TerminalConexaoConfig,
} from "./types";

const STORAGE_KEY = "gp.desktop.config.v1";

interface ConfigStorageAdapter {
  read(): DesktopConfig;
  write(cfg: DesktopConfig): void;
  /** Subscreve a mudanças (ex.: outra aba). Retorna função de unsubscribe. */
  subscribe(listener: (cfg: DesktopConfig) => void): () => void;
}

// ----------------------------------------------------------------------------
// Adapter atual: localStorage
// ----------------------------------------------------------------------------
const localStorageAdapter: ConfigStorageAdapter = {
  read() {
    if (typeof window === "undefined") return { ...DESKTOP_CONFIG_DEFAULT };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DESKTOP_CONFIG_DEFAULT };
      const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
      return {
        ...DESKTOP_CONFIG_DEFAULT,
        ...parsed,
        schemaVersion: 1,
      };
    } catch {
      return { ...DESKTOP_CONFIG_DEFAULT };
    }
  },
  write(cfg) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      // Dispara evento sintético para escuta na MESMA aba (storage só dispara em outras abas).
      window.dispatchEvent(
        new CustomEvent("gp:desktop-config-changed", { detail: cfg }),
      );
    } catch {
      /* ignore — quota cheia / modo privado */
    }
  },
  subscribe(listener) {
    if (typeof window === "undefined") return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      listener(this.read());
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<DesktopConfig>).detail;
      if (detail) listener(detail);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("gp:desktop-config-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("gp:desktop-config-changed", onCustom);
    };
  },
};

// Ponto único de troca futura → `tauriStoreAdapter`.
const adapter: ConfigStorageAdapter = localStorageAdapter;

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

export function getDesktopConfig(): DesktopConfig {
  return adapter.read();
}

export function setDesktopConfig(cfg: DesktopConfig): void {
  adapter.write({ ...cfg, atualizadoEm: Date.now(), schemaVersion: 1 });
}

export function setDesktopRole(role: DesktopRole, terminal?: TerminalConexaoConfig): void {
  const atual = getDesktopConfig();
  const novo: DesktopConfig = {
    ...atual,
    role,
    terminal: role === "terminal" ? terminal ?? atual.terminal : undefined,
  };
  setDesktopConfig(novo);
}

export function clearDesktopConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(
      new CustomEvent("gp:desktop-config-changed", {
        detail: { ...DESKTOP_CONFIG_DEFAULT },
      }),
    );
  } catch {
    /* ignore */
  }
}

export function subscribeDesktopConfig(
  listener: (cfg: DesktopConfig) => void,
): () => void {
  return adapter.subscribe(listener);
}
