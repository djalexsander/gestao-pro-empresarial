import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type NotificacaoTipo = "estoque_baixo" | "conta_vencida" | "conta_vence_hoje" | "venda_pendente";
export type NotificacaoSeveridade = "info" | "warning" | "danger";

export type Notificacao = {
  id: string;
  tipo: NotificacaoTipo;
  severidade: NotificacaoSeveridade;
  titulo: string;
  descricao: string;
  rota: string;
  criadoEm: string;
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export function useNotificacoes() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notificacoes", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Notificacao[]> => {
      const notifs: Notificacao[] = [];
      const hoje = hojeISO();

      // 1. Contas vencidas (a pagar e a receber)
      const { data: vencidas } = await supabase
        .from("financeiro_lancamentos")
        .select("id, descricao, valor, data_vencimento, tipo")
        .eq("status", "pendente")
        .lt("data_vencimento", hoje)
        .order("data_vencimento", { ascending: true })
        .limit(20);

      for (const c of vencidas ?? []) {
        notifs.push({
          id: `venc-${c.id}`,
          tipo: "conta_vencida",
          severidade: "danger",
          titulo: c.tipo === "receita" ? "Conta a receber vencida" : "Conta a pagar vencida",
          descricao: `${c.descricao} — R$ ${Number(c.valor).toFixed(2).replace(".", ",")} (venc. ${new Date(c.data_vencimento).toLocaleDateString("pt-BR")})`,
          rota: "/financeiro",
          criadoEm: c.data_vencimento,
        });
      }

      // 2. Contas vencendo hoje
      const { data: hojeData } = await supabase
        .from("financeiro_lancamentos")
        .select("id, descricao, valor, data_vencimento, tipo")
        .eq("status", "pendente")
        .eq("data_vencimento", hoje)
        .limit(20);

      for (const c of hojeData ?? []) {
        notifs.push({
          id: `hoje-${c.id}`,
          tipo: "conta_vence_hoje",
          severidade: "warning",
          titulo: c.tipo === "receita" ? "A receber hoje" : "A pagar hoje",
          descricao: `${c.descricao} — R$ ${Number(c.valor).toFixed(2).replace(".", ",")}`,
          rota: "/financeiro",
          criadoEm: c.data_vencimento,
        });
      }

      // 3. Estoque baixo
      const { data: produtos } = await supabase
        .from("produtos")
        .select("id, nome, estoque_minimo")
        .eq("status", "ativo")
        .gt("estoque_minimo", 0);

      if (produtos && produtos.length > 0) {
        const { data: movs } = await supabase
          .from("estoque_movimentacoes")
          .select("produto_id, tipo, quantidade");

        const saldos = new Map<string, number>();
        for (const m of movs ?? []) {
          const sinal =
            m.tipo === "entrada" || m.tipo === "devolucao"
              ? 1
              : m.tipo === "saida" || m.tipo === "transferencia"
                ? -1
                : 1;
          saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
        }

        for (const p of produtos) {
          const saldo = saldos.get(p.id) ?? 0;
          if (saldo <= Number(p.estoque_minimo)) {
            notifs.push({
              id: `estoque-${p.id}`,
              tipo: "estoque_baixo",
              severidade: saldo <= 0 ? "danger" : "warning",
              titulo: saldo <= 0 ? "Produto sem estoque" : "Estoque baixo",
              descricao: `${p.nome} — saldo ${saldo} (mínimo ${p.estoque_minimo})`,
              rota: "/estoque",
              criadoEm: new Date().toISOString(),
            });
          }
        }
      }

      // Ordena por severidade
      const ordem: Record<NotificacaoSeveridade, number> = { danger: 0, warning: 1, info: 2 };
      notifs.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);

      return notifs;
    },
  });
}
