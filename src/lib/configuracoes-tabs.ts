export const CONFIGURACOES_TABS = [
  "empresa",
  "planos",
  "socios",
  "funcionarios",
  "terminais",
  "balanca",
  "atualizacoes",
  "impressoras",
  "prefs",
  "cobranca-pix",
] as const;

export function normalizarTabConfiguracoes(tab?: string): (typeof CONFIGURACOES_TABS)[number] {
  if (tab === "integracoes") return "cobranca-pix";
  return CONFIGURACOES_TABS.includes(tab as (typeof CONFIGURACOES_TABS)[number])
    ? (tab as (typeof CONFIGURACOES_TABS)[number])
    : "empresa";
}
