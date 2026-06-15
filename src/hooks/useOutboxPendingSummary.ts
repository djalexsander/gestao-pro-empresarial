/**
 * useOutboxPendingSummary — agrega o estado das outboxes locais por domínio.
 *
 * Lê em paralelo as 5 outboxes (estoque, vendas, caixa, cancelamentos,
 * financeiro) do servidor local e devolve:
 *  - lista por domínio com pending / error / último erro classificado;
 *  - totais agregados (pending + error) para uso em alertas operacionais.
 *
 * Não altera nenhuma regra de sync — usa apenas endpoints `/db/outbox/*`
 * que já existem. Quando não há servidor local configurado (modo cloud puro
 * ou web), devolve um summary vazio sem fazer nenhuma requisição.
 */
import { useQuery } from "@tanstack/react-query";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import {
  fetchOutboxStats,
  fetchOutboxList,
  fetchOutboxVendasStats,
  fetchOutboxVendasList,
  fetchOutboxCaixaStats,
  fetchOutboxCaixaList,
  fetchOutboxCancelamentosStats,
  fetchOutboxFinanceiroStats,
  type OutboxStats,
} from "@/integrations/desktop/serverConnection";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import {
  classifyOutboxError,
  type OutboxErrorClass,
} from "@/integrations/desktop/outboxErrors";

export type OutboxDomainKey =
  | "estoque"
  | "vendas"
  | "caixa"
  | "cancelamentos"
  | "financeiro";

export interface OutboxDomainSummary {
  key: OutboxDomainKey;
  label: string;
  pending: number;
  error: number;
  lastErrorClass: OutboxErrorClass;
  lastErrorRaw: string | null;
  lastSentAtMs: number | null;
  /** "ok" quando 0/0; "pendente" quando só pending; "erro" quando há erros. */
  status: "ok" | "pendente" | "erro" | "indisponivel";
}

export interface OutboxPendingSummary {
  /** Há servidor local configurado e disponível para coletar essas stats? */
  enabled: boolean;
  loading: boolean;
  domains: OutboxDomainSummary[];
  totalPending: number;
  totalError: number;
  /** Domínios com erro relevante (para alertas). */
  comErro: OutboxDomainSummary[];
  /** Domínios com pendência (sem erro). */
  comPendencia: OutboxDomainSummary[];
}

function summarize(
  key: OutboxDomainKey,
  label: string,
  stats: OutboxStats | null,
): OutboxDomainSummary {
  if (!stats) {
    return {
      key,
      label,
      pending: 0,
      error: 0,
      lastErrorClass: classifyOutboxError(null),
      lastErrorRaw: null,
      lastSentAtMs: null,
      status: "indisponivel",
    };
  }
  const cls = classifyOutboxError(stats.last_error);
  const status: OutboxDomainSummary["status"] =
    stats.error > 0 ? "erro" : stats.pending > 0 ? "pendente" : "ok";
  return {
    key,
    label,
    pending: stats.pending,
    error: stats.error,
    lastErrorClass: cls,
    lastErrorRaw: stats.last_error ?? null,
    lastSentAtMs: stats.last_sent_at_ms ?? null,
    status,
  };
}

export function useOutboxPendingSummary(options?: {
  caixaId?: string | null;
  currentDayOnly?: boolean;
}): OutboxPendingSummary {
  const { isDesktop, role, config } = useDesktopRole();
  const cfg: TerminalConexaoConfig | undefined =
    role === "terminal"
      ? config.terminal
      : role === "server"
        ? {
            host: "127.0.0.1",
            porta: config.serverPort ?? config.terminal?.porta ?? 3333,
            terminalId: "self",
            terminalNome: "self",
          }
        : undefined;

  const enabled = !!(isDesktop && cfg);

  const { data, isLoading } = useQuery({
    queryKey: [
      "outbox-pending-summary",
      cfg?.host,
      cfg?.porta,
      options?.caixaId ?? null,
      options?.currentDayOnly ?? false,
    ],
    enabled,
    refetchInterval: 10_000,
    queryFn: async () => {
      const [estoque, vendas, caixa, cancel, fin, estoqueItems, vendaItems, caixaItems] =
        await Promise.all([
        fetchOutboxStats(cfg),
        fetchOutboxVendasStats(cfg),
        fetchOutboxCaixaStats(cfg),
        fetchOutboxCancelamentosStats(cfg),
        fetchOutboxFinanceiroStats(cfg),
        options?.currentDayOnly ? fetchOutboxList(cfg, { limit: 1000 }) : [],
        options?.currentDayOnly ? fetchOutboxVendasList(cfg, { limit: 1000 }) : [],
        options?.caixaId ? fetchOutboxCaixaList(cfg, { limit: 1000 }) : [],
      ]);
      return { estoque, vendas, caixa, cancel, fin, estoqueItems, vendaItems, caixaItems };
    },
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const scopedStats = (
    stats: OutboxStats | null,
    items: Array<{ status: string; created_at_ms: number; last_error: string | null }>,
  ): OutboxStats | null => {
    if (!stats) return null;
    const active = items.filter(
      (item) =>
        item.created_at_ms >= startOfToday.getTime() &&
        (item.status === "pending" || item.status === "error"),
    );
    const latestError = active
      .filter((item) => item.status === "error")
      .sort((a, b) => b.created_at_ms - a.created_at_ms)[0];
    return {
      ...stats,
      pending: active.filter((item) => item.status === "pending").length,
      error: active.filter((item) => item.status === "error").length,
      last_error: latestError?.last_error ?? null,
    };
  };

  const caixaScoped = data?.caixa
    ? {
        ...data.caixa,
        pending:
          data.caixaItems?.filter(
            (item) => item.caixa_local_uuid === options?.caixaId && item.status === "pending",
          ).length ?? 0,
        error:
          data.caixaItems?.filter(
            (item) => item.caixa_local_uuid === options?.caixaId && item.status === "error",
          ).length ?? 0,
        last_error:
          data.caixaItems
            ?.filter(
              (item) => item.caixa_local_uuid === options?.caixaId && item.status === "error",
            )
            .sort((a, b) => b.created_at_ms - a.created_at_ms)[0]?.last_error ?? null,
      }
    : null;

  const domains: OutboxDomainSummary[] = enabled
    ? [
        summarize(
          "vendas",
          "Vendas (PDV)",
          options?.currentDayOnly
            ? scopedStats(data?.vendas ?? null, data?.vendaItems ?? [])
            : data?.vendas ?? null,
        ),
        summarize("caixa", "Caixa", options?.caixaId ? caixaScoped : data?.caixa ?? null),
        summarize(
          "estoque",
          "Estoque",
          options?.currentDayOnly
            ? scopedStats(data?.estoque ?? null, data?.estoqueItems ?? [])
            : data?.estoque ?? null,
        ),
        ...(options?.currentDayOnly
          ? []
          : [
              summarize("cancelamentos", "Cancelamentos", data?.cancel ?? null),
              summarize("financeiro", "Financeiro", data?.fin ?? null),
            ]),
      ]
    : [];

  const totalPending = domains.reduce((acc, d) => acc + d.pending, 0);
  const totalError = domains.reduce((acc, d) => acc + d.error, 0);
  const comErro = domains.filter((d) => d.error > 0);
  const comPendencia = domains.filter((d) => d.error === 0 && d.pending > 0);

  return {
    enabled,
    loading: enabled && isLoading,
    domains,
    totalPending,
    totalError,
    comErro,
    comPendencia,
  };
}
