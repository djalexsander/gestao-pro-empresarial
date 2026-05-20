/**
 * Mapa centralizado domain → queryKeys a invalidar.
 * Onda 1: vendas, caixa, estoque, produtos, sync, terminais.
 */
import type { QueryClient } from "@tanstack/react-query";

const MAP: Record<string, string[]> = {
  vendas: ["vendas", "dashboard", "caixa", "financeiro"],
  estoque: ["estoque", "produtos", "dashboard"],
  caixa: ["caixa", "dashboard", "financeiro"],
  produtos: ["produtos", "pdv-busca-local"],
  financeiro: ["financeiro", "dashboard"],
  sync: ["sync"],
  terminais: ["terminais"],
};

export function invalidateForDomain(qc: QueryClient, domain: string) {
  const keys = MAP[domain];
  if (!keys || keys.length === 0) return;
  for (const k of keys) {
    qc.invalidateQueries({ queryKey: [k], refetchType: "active" });
  }
  if (typeof console !== "undefined") {
    console.debug("[REALTIME_INVALIDATE]", domain, "→", keys);
  }
}

export function invalidateAll(qc: QueryClient) {
  console.debug("[REALTIME_INVALIDATE] global resync");
  qc.invalidateQueries({ refetchType: "active" });
}
