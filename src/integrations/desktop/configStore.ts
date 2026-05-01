/**
 * ============================================================================
 * desktopConfigStore — Persistência da configuração do desktop
 * ============================================================================
 *
 * API pública (síncrona) inalterada. Por baixo, dois adapters:
 *
 *  - localStorageAdapter  → web e fallback do desktop antes da hidratação
 *  - tauriStoreAdapter    → desktop (Tauri v2 + plugin-store, persistência
 *                            nativa em arquivo no diretório do app)
 *
 * Estratégia de compatibilidade:
 *  1. No boot do app, `hydrateDesktopConfig()` é chamado uma vez.
 *  2. Em desktop, lê o Tauri Store. Se vazio mas existe config no
 *     localStorage (instalação anterior à migração), migra para o store
 *     nativo e mantém o localStorage como espelho para leituras síncronas.
 *  3. Toda escrita atualiza o cache em memória + localStorage (espelho
 *     síncrono) + Tauri Store (assíncrono, fire-and-forget com toast em
 *     caso de erro).
 *  4. Leituras continuam síncronas via cache/localStorage — nenhum
 *     componente precisa virar async.
 */

import {
  DESKTOP_CONFIG_DEFAULT,
  criarDesktopConfigInicial,
  novoServerId,
  type DesktopConfig,
  type DesktopRole,
  type TerminalConexaoConfig,
} from "./types";
import { isDesktop } from "@/integrations/data/mode";

const STORAGE_KEY = "gp.desktop.config.v1";
const TAURI_STORE_FILE = "gp-desktop-config.json";
const TAURI_STORE_KEY = "config";

interface ConfigStorageAdapter {
  /** Leitura síncrona (a partir de cache em memória). */
  read(): DesktopConfig;
  /** Escrita: atualiza cache + persiste (sync no web, async no desktop). */
  write(cfg: DesktopConfig): void;
  /** Subscreve a mudanças. Retorna função de unsubscribe. */
  subscribe(listener: (cfg: DesktopConfig) => void): () => void;
  /** Limpa tudo. */
  clear(): void;
}

// ----------------------------------------------------------------------------
// Cache em memória — usado por TODOS os adapters para garantir leituras síncronas
// ----------------------------------------------------------------------------
let memoryCache: DesktopConfig = { ...DESKTOP_CONFIG_DEFAULT };
let cacheInitialized = false;

function notifyChange(cfg: DesktopConfig) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("gp:desktop-config-changed", { detail: cfg }),
    );
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------------------
// Adapter: localStorage (web + espelho síncrono no desktop)
// ----------------------------------------------------------------------------
function normalizar(parsed: Partial<DesktopConfig> | null | undefined): DesktopConfig {
  const base: DesktopConfig = {
    ...DESKTOP_CONFIG_DEFAULT,
    ...(parsed ?? {}),
    schemaVersion: 1,
  };
  // Garante machineId estável (gerado uma vez e nunca mais alterado).
  if (!base.machineId) {
    base.machineId = criarDesktopConfigInicial().machineId;
  }
  return base;
}

function readLocalStorage(): DesktopConfig {
  if (typeof window === "undefined") return normalizar(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizar(null);
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    return normalizar(parsed);
  } catch {
    return normalizar(null);
  }
}

function writeLocalStorage(cfg: DesktopConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* quota cheia / modo privado */
  }
}

const localStorageAdapter: ConfigStorageAdapter = {
  read() {
    return cacheInitialized ? memoryCache : readLocalStorage();
  },
  write(cfg) {
    memoryCache = cfg;
    writeLocalStorage(cfg);
    notifyChange(cfg);
  },
  subscribe(listener) {
    if (typeof window === "undefined") return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readLocalStorage();
      memoryCache = next;
      listener(next);
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
  clear() {
    memoryCache = { ...DESKTOP_CONFIG_DEFAULT };
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    notifyChange(memoryCache);
  },
};

// ----------------------------------------------------------------------------
// Adapter: Tauri Store (desktop)
//   - leituras: usa o cache em memória (já hidratado no boot)
//   - escritas: atualiza cache + localStorage (espelho) + Tauri Store async
// ----------------------------------------------------------------------------
type TauriStoreInstance = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
};

let tauriStorePromise: Promise<TauriStoreInstance | null> | null = null;

async function getTauriStore(): Promise<TauriStoreInstance | null> {
  if (!isDesktop()) return null;
  if (tauriStorePromise) return tauriStorePromise;
  tauriStorePromise = (async () => {
    try {
      const mod = (await import(
        /* @vite-ignore */ "@tauri-apps/plugin-store"
      )) as {
        load: (path: string) => Promise<TauriStoreInstance>;
      };
      return await mod.load(TAURI_STORE_FILE);
    } catch (err) {
      console.warn("[desktopConfigStore] Tauri Store indisponível:", err);
      return null;
    }
  })();
  return tauriStorePromise;
}

const tauriStoreAdapter: ConfigStorageAdapter = {
  read() {
    return memoryCache;
  },
  write(cfg) {
    memoryCache = cfg;
    // Espelho síncrono no localStorage (para reload rápido / fallback)
    writeLocalStorage(cfg);
    notifyChange(cfg);
    // Persistência nativa (assíncrona)
    void (async () => {
      const store = await getTauriStore();
      if (!store) return;
      try {
        await store.set(TAURI_STORE_KEY, cfg);
        await store.save();
      } catch (err) {
        console.warn("[desktopConfigStore] falha ao salvar Tauri Store:", err);
      }
    })();
  },
  subscribe(listener) {
    // Reusa o canal de eventos do localStorage adapter
    return localStorageAdapter.subscribe(listener);
  },
  clear() {
    memoryCache = { ...DESKTOP_CONFIG_DEFAULT };
    writeLocalStorage(memoryCache);
    notifyChange(memoryCache);
    void (async () => {
      const store = await getTauriStore();
      if (!store) return;
      try {
        await store.set(TAURI_STORE_KEY, memoryCache);
        await store.save();
      } catch {
        /* ignore */
      }
    })();
  },
};

// ----------------------------------------------------------------------------
// Resolução do adapter ativo
// ----------------------------------------------------------------------------
const adapter: ConfigStorageAdapter = isDesktop()
  ? tauriStoreAdapter
  : localStorageAdapter;

// ----------------------------------------------------------------------------
// Hidratação inicial (chamada no boot do app — ver router/__root)
// ----------------------------------------------------------------------------
let hydrationPromise: Promise<void> | null = null;

export function hydrateDesktopConfig(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    // 1. Sempre começa lendo o localStorage (espelho síncrono / web).
    const fromLocal = readLocalStorage();
    memoryCache = fromLocal;

    // 2. No desktop, tenta carregar do Tauri Store nativo.
    if (isDesktop()) {
      const store = await getTauriStore();
      if (store) {
        try {
          const fromNative = await store.get<DesktopConfig>(TAURI_STORE_KEY);
          if (fromNative && typeof fromNative === "object") {
            memoryCache = normalizar(fromNative);
            // Sincroniza espelho local
            writeLocalStorage(memoryCache);
          } else if (fromLocal.role !== "unset") {
            // Migração: tinha config no localStorage, ainda não no Tauri Store.
            try {
              await store.set(TAURI_STORE_KEY, fromLocal);
              await store.save();
              console.info(
                "[desktopConfigStore] migrado localStorage → Tauri Store",
              );
            } catch (err) {
              console.warn("[desktopConfigStore] migração falhou:", err);
            }
          }
        } catch (err) {
          console.warn("[desktopConfigStore] leitura nativa falhou:", err);
        }
      }
    }

    cacheInitialized = true;
    notifyChange(memoryCache);
  })();
  return hydrationPromise;
}

// Inicia hidratação imediatamente em ambiente browser/desktop. Componentes
// que precisam aguardar podem `await hydrateDesktopConfig()`.
if (typeof window !== "undefined") {
  void hydrateDesktopConfig();
}

// ----------------------------------------------------------------------------
// API pública (síncrona — inalterada)
// ----------------------------------------------------------------------------

export function getDesktopConfig(): DesktopConfig {
  return adapter.read();
}

export function setDesktopConfig(cfg: DesktopConfig): void {
  adapter.write({ ...cfg, atualizadoEm: Date.now(), schemaVersion: 1 });
}

export function setDesktopRole(
  role: DesktopRole,
  terminal?: TerminalConexaoConfig,
): void {
  const atual = getDesktopConfig();
  const novo: DesktopConfig = {
    ...atual,
    role,
    // Servidor: garante serverId estável e nome.
    serverId: role === "server" ? atual.serverId ?? novoServerId() : atual.serverId,
    serverNome:
      role === "server"
        ? atual.serverNome ?? "Servidor Gestão Pro"
        : atual.serverNome,
    terminal: role === "terminal" ? terminal ?? atual.terminal : undefined,
  };
  setDesktopConfig(novo);
}

export function clearDesktopConfig(): void {
  // Preserva o machineId mesmo após reset (identidade da máquina é estável).
  const atual = getDesktopConfig();
  const machineId = atual.machineId || criarDesktopConfigInicial().machineId;
  adapter.clear();
  setDesktopConfig({
    ...DESKTOP_CONFIG_DEFAULT,
    machineId,
  });
}

export function subscribeDesktopConfig(
  listener: (cfg: DesktopConfig) => void,
): () => void {
  return adapter.subscribe(listener);
}
