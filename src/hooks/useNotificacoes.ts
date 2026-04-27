import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type NotificacaoTipo = "estoque_baixo" | "conta_vencida" | "conta_vence_hoje" | "venda_pendente";
export type NotificacaoSeveridade = "info" | "warning" | "danger";

export type Notificacao = {
  id: string; // == notificacao_key (estável entre recargas)
  tipo: NotificacaoTipo;
  severidade: NotificacaoSeveridade;
  titulo: string;
  descricao: string;
  rota: string;
  criadoEm: string;
  read: boolean;
  readAt: string | null;
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
          read: false,
          readAt: null,
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
          read: false,
          readAt: null,
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
              read: false,
              readAt: null,
            });
          }
        }
      }

      // 4. Mescla com estados persistidos (lida/excluída) do usuário
      const { data: estados } = await supabase
        .from("notificacao_estados")
        .select("notificacao_key, read, read_at, deleted")
        .eq("user_id", user!.id);

      const mapaEstado = new Map<string, { read: boolean; read_at: string | null; deleted: boolean }>();
      for (const e of estados ?? []) {
        mapaEstado.set(e.notificacao_key, {
          read: e.read,
          read_at: e.read_at,
          deleted: e.deleted,
        });
      }

      const visiveis = notifs
        .map((n) => {
          const est = mapaEstado.get(n.id);
          if (!est) return n;
          return { ...n, read: est.read, readAt: est.read_at };
        })
        .filter((n) => {
          const est = mapaEstado.get(n.id);
          return !est?.deleted;
        });

      // Ordena: não lidas primeiro, depois por severidade
      const ordem: Record<NotificacaoSeveridade, number> = { danger: 0, warning: 1, info: 2 };
      visiveis.sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return ordem[a.severidade] - ordem[b.severidade];
      });

      return visiveis;
    },
  });
}

/**
 * Marca uma notificação como lida (upsert por notificacao_key).
 */
export function useMarcarNotificacaoLida() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificacaoKey: string) => {
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase.from("notificacao_estados").upsert(
        {
          user_id: user.id,
          notificacao_key: notificacaoKey,
          read: true,
          read_at: new Date().toISOString(),
        },
        { onConflict: "user_id,notificacao_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
    },
  });
}

/**
 * Exclui (soft-delete) uma notificação.
 */
export function useExcluirNotificacao() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificacaoKey: string) => {
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase.from("notificacao_estados").upsert(
        {
          user_id: user.id,
          notificacao_key: notificacaoKey,
          deleted: true,
          deleted_at: new Date().toISOString(),
        },
        { onConflict: "user_id,notificacao_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
    },
  });
}

/**
 * Marca todas as notificações visíveis como lidas.
 */
export function useMarcarTodasLidas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chaves: string[]) => {
      if (!user) throw new Error("Não autenticado");
      if (chaves.length === 0) return;
      const agora = new Date().toISOString();
      const linhas = chaves.map((k) => ({
        user_id: user.id,
        notificacao_key: k,
        read: true,
        read_at: agora,
      }));
      const { error } = await supabase
        .from("notificacao_estados")
        .upsert(linhas, { onConflict: "user_id,notificacao_key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
    },
  });
}
