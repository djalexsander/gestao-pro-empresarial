/**
 * local-purge — limpa todo o estado client-side persistido.
 *
 * Usado quando:
 *   1) O `user.id` autenticado mudou (troca de conta na mesma máquina).
 *   2) O usuário aciona "Limpar cache local" em Configurações > Sincronização.
 *   3) Após `admin_zerar_empresa` para o próprio owner.
 *
 * Apaga: cache do React Query persister, outbox/local da camada offline,
 * IndexedDB do app, sessionStorage do app. **Não toca** em chaves de
 * autenticação Supabase (`sb-*-auth-token`), para não deslogar.
 */

import type { QueryClient } from "@tanstack/react-query";

const APP_KEY_PREFIXES = ["gp.", "gestao-pro.", "rq.cache"];
const APP_INDEXEDDB_DBS = ["gp-local", "gp-outbox", "gp.local", "gp.outbox"];

function isAppKey(key: string): boolean {
  return APP_KEY_PREFIXES.some((p) => key.startsWith(p));
}

export interface PurgeResult {
  localStorageKeys: number;
  sessionStorageKeys: number;
  indexedDbs: number;
  queryCacheCleared: boolean;
  reason: string;
}

export async function purgeLocalState(
  reason: string,
  queryClient?: QueryClient,
): Promise<PurgeResult> {
  const result: PurgeResult = {
    localStorageKeys: 0,
    sessionStorageKeys: 0,
    indexedDbs: 0,
    queryCacheCleared: false,
    reason,
  };

  if (typeof window === "undefined") return result;

  // 1) localStorage
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && isAppKey(k)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
    result.localStorageKeys = toRemove.length;
  } catch (e) {
    console.warn("[LOCAL_PURGE] localStorage falhou:", e);
  }

  // 2) sessionStorage
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && isAppKey(k)) toRemove.push(k);
    }
    for (const k of toRemove) window.sessionStorage.removeItem(k);
    result.sessionStorageKeys = toRemove.length;
  } catch (e) {
    console.warn("[LOCAL_PURGE] sessionStorage falhou:", e);
  }

  // 3) IndexedDB
  try {
    const idb = window.indexedDB;
    if (idb) {
      for (const name of APP_INDEXEDDB_DBS) {
        await new Promise<void>((resolve) => {
          const req = idb.deleteDatabase(name);
          req.onsuccess = () => {
            result.indexedDbs += 1;
            resolve();
          };
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
  } catch (e) {
    console.warn("[LOCAL_PURGE] indexedDB falhou:", e);
  }

  // 4) React Query cache (memória)
  if (queryClient) {
    try {
      queryClient.clear();
      result.queryCacheCleared = true;
    } catch (e) {
      console.warn("[LOCAL_PURGE] queryClient.clear falhou:", e);
    }
  }

  console.log("[LOCAL_PURGE] concluído", result);
  return result;
}

/**
 * Compara user.id atual com o último visto neste dispositivo.
 * Retorna true se for um usuário diferente (=> purga deve ocorrer).
 * Primeira sessão na máquina NÃO dispara purga.
 */
const LAST_UID_KEY = "gp.lastUid";

export function shouldPurgeOnSignIn(currentUid: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = window.localStorage.getItem(LAST_UID_KEY);
    return last !== null && last !== currentUid;
  } catch {
    return false;
  }
}

export function rememberSignedInUid(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_UID_KEY, uid);
  } catch {
    /* ignore */
  }
}

export function clearRememberedUid(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_UID_KEY);
  } catch {
    /* ignore */
  }
}
