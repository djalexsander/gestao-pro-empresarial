import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useEffect, useMemo, useState } from "react";
import { invalidationBus, type DataDomain } from "@/integrations/data/realtime";
import { isDesktop } from "@/integrations/data/mode";

/**
 * Mapeamento global domínio → queryKeys impactadas.
 * Bridge default entre `invalidationBus` e React Query.
 *
 * Hooks específicos podem complementar via `useDomainInvalidation` quando
 * precisarem de keys parametrizadas (ex.: ["produto", id]).
 */
const DOMAIN_TO_KEYS: Record<DataDomain, string[][]> = {
  produtos: [["produtos"], ["categorias"]],
  estoque: [["estoque-saldos"], ["movimentacoes"]],
  lotes: [["lotes"]],
  clientes: [["clientes"], ["clientes-lite"]],
  fornecedores: [["fornecedores"]],
  categorias_produto: [["categorias"]],
  categorias_financeiras: [["categorias_financeiras_ativas"]],
  funcionarios: [["funcionarios"]],
  caixa: [["caixa"], ["caixa-resumo"], ["caixa-aberto"]],
  vendas: [["vendas"], ["dashboard"]],
  financeiro: [["financeiro"], ["financeiro-indicadores"], ["dashboard"]],
  terminais: [["terminais"]],
};

// Chaves que NÃO devem ser persistidas (dados sensíveis ou voláteis demais).
const NON_PERSISTED_KEYS = new Set<string>([
  // adicione aqui se algum domínio não puder sobreviver entre sessões
]);

const PERSIST_KEY = "gp.rq.cache.v1";
const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Mais agressivo no cache para boot local-first: o adapter local
            // refaz a query em background, mas a tela aparece imediatamente
            // com o último snapshot conhecido.
            staleTime: 60_000,
            gcTime: 24 * 60 * 60 * 1000, // 24h — sobrevive bem ao persister
            refetchOnWindowFocus: false,
            retry: 1,
            // Importante para offline-first: não jogar fora cache se a query
            // falhou — o último dado válido continua disponível.
            placeholderData: (prev: unknown) => prev,
          },
        },
      }),
  );

  // Bridge global do invalidationBus → React Query.
  useEffect(() => {
    const offs: Array<() => void> = [];
    (Object.keys(DOMAIN_TO_KEYS) as DataDomain[]).forEach((domain) => {
      const keys = DOMAIN_TO_KEYS[domain];
      offs.push(
        invalidationBus.subscribe(domain, () => {
          for (const k of keys) client.invalidateQueries({ queryKey: k });
        }),
      );
    });
    return () => {
      for (const off of offs) off();
    };
  }, [client]);

  // Persister: só ativa no desktop (Tauri). Web continua com cache em memória.
  const persistOptions = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!isDesktop()) return null;
    try {
      const persister = createSyncStoragePersister({
        storage: window.localStorage,
        key: PERSIST_KEY,
        throttleTime: 1000,
      });
      console.log("[BOOT_LOCAL_FIRST] React Query persister ativo (desktop).");
      return {
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) => {
            if (query.state.status !== "success") return false;
            const first = query.queryKey[0];
            if (typeof first === "string" && NON_PERSISTED_KEYS.has(first)) return false;
            return true;
          },
        },
      };
    } catch (e) {
      console.warn("[BOOT_LOCAL_FIRST] persister falhou, seguindo sem persistência:", e);
      return null;
    }
  }, [client]);

  if (persistOptions) {
    return (
      <PersistQueryClientProvider
        client={client}
        persistOptions={persistOptions}
        onSuccess={() => {
          console.log("[LOCAL_STATE_RESTORED] React Query cache restaurado do disco.");
        }}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
