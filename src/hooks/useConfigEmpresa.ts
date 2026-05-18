import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import { invalidarEmpresaHeaderCache } from "@/lib/export-empresa-header";
import type { ConfigEmpresaDomain } from "@/integrations/data/extra-adapters";
import {
  getCachedConfigEmpresa,
  setCachedConfigEmpresa,
  mergeCachedConfigEmpresa,
  enqueueConfigEmpresaPending,
  getConfigEmpresaPending,
  clearConfigEmpresaPending,
  isNetworkLikeError,
} from "@/lib/configEmpresaOfflineCache";

export type ConfigEmpresa = ConfigEmpresaDomain;
export type ConfigEmpresaInput = Omit<ConfigEmpresa, "id">;

/**
 * Resolve o user_id atual de forma síncrona-amigável.
 * Como `dataClient.auth.getUser()` é async, usamos um pequeno cache em
 * memória para evitar lookups repetidos durante render.
 */
let cachedUserId: string | null = null;
async function resolveUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  try {
    const { user } = await dataClient.auth.getUser();
    cachedUserId = user?.id ?? null;
  } catch {
    cachedUserId = null;
  }
  return cachedUserId;
}

/**
 * Carrega as configurações da empresa.
 *
 * Estratégia offline-first:
 *  1. `initialData` vem do localStorage (instantâneo).
 *  2. `queryFn` tenta a nuvem; se conseguir, atualiza o cache.
 *  3. Se a rede falhar, retorna o cache (mantendo a UI funcional).
 */
export function useConfigEmpresa() {
  const qc = useQueryClient();

  // initialData precisa ser síncrono — usamos placeholder via cache lido aqui.
  // Mas user_id é async, então fazemos um best-effort: lemos qualquer entrada
  // no cache se houver apenas uma (caso comum em desktop single-user).
  const placeholder = readSinglePlaceholder();

  return useQuery({
    queryKey: ["config_empresa"],
    queryFn: async () => {
      const userId = await resolveUserId();
      try {
        const fresh = await dataClient.configEmpresa.obter();
        if (userId && fresh) setCachedConfigEmpresa(userId, fresh);
        // Após carregar com sucesso, tenta drenar pendência.
        if (userId) void tryFlushPending(userId, qc);
        return fresh;
      } catch (err) {
        if (isNetworkLikeError(err) && userId) {
          const cached = getCachedConfigEmpresa(userId);
          if (cached) return cached;
        }
        throw err;
      }
    },
    initialData: placeholder ?? undefined,
    staleTime: 5 * 60 * 1000,
  });
}

function readSinglePlaceholder(): ConfigEmpresaDomain | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("config_empresa_cache_v1");
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, ConfigEmpresaDomain>;
    const values = Object.values(map);
    return values.length === 1 ? values[0] : null;
  } catch {
    return null;
  }
}

async function tryFlushPending(userId: string, qc: ReturnType<typeof useQueryClient>) {
  const pending = getConfigEmpresaPending(userId);
  if (!pending) return;
  try {
    const saved = await dataClient.configEmpresa.salvar(pending.input);
    setCachedConfigEmpresa(userId, saved);
    clearConfigEmpresaPending(userId);
    qc.setQueryData(["config_empresa"], saved);
    invalidarEmpresaHeaderCache();
    toast.success("Configurações da empresa sincronizadas com a nuvem.");
  } catch (err) {
    if (!isNetworkLikeError(err)) {
      // Erro não relacionado a rede — mostra para o usuário e limpa,
      // senão a fila ficaria entupida com payload inválido.
      clearConfigEmpresaPending(userId);
      toast.error(
        `Não foi possível sincronizar configurações: ${(err as Error).message ?? "erro desconhecido"}`,
      );
    }
    // Senão: ainda offline — mantém pendente para próxima tentativa.
  }
}

/**
 * Hook auxiliar: dispara flush quando a rede volta ou a aba ganha foco.
 * Pode ser plugado em qualquer layout raiz (ex.: AppLayout) para garantir
 * que mudanças feitas offline cheguem à nuvem assim que possível.
 */
export function useFlushConfigEmpresaPending() {
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const userId = await resolveUserId();
      if (!userId || cancelled) return;
      await tryFlushPending(userId, qc);
    };
    const onOnline = () => void run();
    const onFocus = () => void run();
    void run();
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("focus", onFocus);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [qc]);
}

/**
 * Salva (cria/atualiza) a configuração da empresa.
 *
 * Fluxo offline-first:
 *  1. `onMutate` atualiza cache local + cache do React Query (UI instantânea).
 *  2. `mutationFn` tenta gravar na nuvem.
 *  3. Se a rede falhar, enfileira pendência e retorna o estado otimista
 *     como se tivesse dado certo — o usuário não é bloqueado.
 *  4. Próxima carga / `useFlushConfigEmpresaPending` drena a fila.
 */
export function useSalvarConfigEmpresa() {
  const qc = useQueryClient();
  return useMutation<
    ConfigEmpresaDomain,
    Error,
    Partial<ConfigEmpresaInput> & { id?: string },
    { previous: ConfigEmpresaDomain | null; userId: string | null }
  >({
    mutationFn: async (input) => {
      const userId = await resolveUserId();
      try {
        const saved = await dataClient.configEmpresa.salvar(input);
        if (userId) {
          setCachedConfigEmpresa(userId, saved);
          clearConfigEmpresaPending(userId);
        }
        return saved;
      } catch (err) {
        if (userId && isNetworkLikeError(err)) {
          enqueueConfigEmpresaPending(userId, input);
          const optimistic = mergeCachedConfigEmpresa(userId, input);
          // Devolve o estado otimista para a UI — flush cuidará da nuvem.
          return optimistic;
        }
        throw err;
      }
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["config_empresa"] });
      const previous = qc.getQueryData<ConfigEmpresaDomain | null>(["config_empresa"]) ?? null;
      const userId = await resolveUserId();
      if (userId) {
        const optimistic = mergeCachedConfigEmpresa(userId, input);
        qc.setQueryData(["config_empresa"], optimistic);
      }
      return { previous, userId };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(["config_empresa"], ctx.previous);
      }
      toast.error(e.message);
    },
    onSuccess: (saved, _vars, ctx) => {
      invalidarEmpresaHeaderCache();
      qc.setQueryData(["config_empresa"], saved);
      qc.invalidateQueries({ queryKey: ["config_empresa"] });
      const wasQueued = ctx?.userId ? !!getConfigEmpresaPending(ctx.userId) : false;
      if (wasQueued) {
        toast.success("Dados salvos localmente. Sincronizando com a nuvem quando voltar a conexão.");
      } else {
        toast.success("Dados da empresa salvos.");
      }
    },
  });
}

/** Faz upload da logo no bucket "empresa-logos" e retorna a URL pública. */
export async function uploadLogoEmpresa(file: File): Promise<string> {
  const { user } = await dataClient.auth.getUser();
  if (!user) throw new Error("Não autenticado");
  return dataClient.configEmpresa.uploadLogo({ file, userId: user.id });
}

/** Remove a logo do storage (best-effort). */
export async function removerLogoEmpresa(url: string | null): Promise<void> {
  return dataClient.configEmpresa.removerLogo(url);
}
