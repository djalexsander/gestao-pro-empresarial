/**
 * Hook Onda 5 — Fiado agregado por cliente.
 *
 * Deriva, a partir dos lançamentos a receber (forma=fiado) ainda em aberto,
 * uma linha por cliente com: total em aberto, qtd títulos, vencidos, próximo vencimento.
 * Não consulta backend novo — só agrupa o que já está em `financeiro_lancamentos`.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data/client";
import type { LancamentoDetalhe } from "@/components/financeiro/LancamentoDetalheDialog";

export interface FiadoClienteLinha {
  cliente_id: string | null;
  cliente_nome: string;
  qtd_titulos: number;
  qtd_vencidos: number;
  total_aberto: number;
  total_vencido: number;
  proximo_vencimento: string | null;
}

export function useFiadoPorCliente() {
  const q = useQuery({
    queryKey: ["financeiro_lancamentos"],
    queryFn: async () =>
      (await dataClient.financeiro.listLancamentosCompleto()) as LancamentoDetalhe[],
    staleTime: 30_000,
  });

  const linhas: FiadoClienteLinha[] = useMemo(() => {
    const rows = q.data ?? [];
    const hoje = new Date().toISOString().slice(0, 10);
    const map = new Map<string, FiadoClienteLinha>();

    for (const l of rows) {
      if (l.tipo !== "receber") continue;
      if (l.status === "recebido" || l.status === "cancelado") continue;
      const isFiado = (l.forma_pagamento ?? "").toLowerCase() === "fiado";
      if (!isFiado) continue;

      const valor = Number(l.valor) - Number(l.valor_pago ?? 0);
      if (valor <= 0) continue;

      const key = l.cliente_id ?? `nome::${l.cliente_nome ?? "—"}`;
      const venc = l.data_vencimento ?? null;
      const vencido = venc ? venc < hoje : false;

      const existing = map.get(key);
      if (existing) {
        existing.qtd_titulos += 1;
        existing.total_aberto += valor;
        if (vencido) {
          existing.qtd_vencidos += 1;
          existing.total_vencido += valor;
        }
        if (venc && (!existing.proximo_vencimento || venc < existing.proximo_vencimento)) {
          existing.proximo_vencimento = venc;
        }
      } else {
        map.set(key, {
          cliente_id: l.cliente_id ?? null,
          cliente_nome: l.cliente_nome ?? "Consumidor final",
          qtd_titulos: 1,
          qtd_vencidos: vencido ? 1 : 0,
          total_aberto: valor,
          total_vencido: vencido ? valor : 0,
          proximo_vencimento: venc,
        });
      }
    }

    return [...map.values()].sort((a, b) => b.total_aberto - a.total_aberto);
  }, [q.data]);

  return { linhas, isLoading: q.isLoading };
}
