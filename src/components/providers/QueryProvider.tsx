import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { invalidationBus, type DataDomain } from "@/integrations/data/realtime";

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

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Bridge global do invalidationBus → React Query.
  // Single source of truth: hooks NÃO precisam mais conhecer queryKeys
  // alheias para reagir a eventos vindos de outros terminais.
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

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
