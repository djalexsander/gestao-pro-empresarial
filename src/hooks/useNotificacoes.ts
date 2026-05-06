import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data";
import { useAuth } from "@/components/auth/AuthProvider";

export type NotificacaoTipo =
  | "estoque_baixo"
  | "conta_vencida"
  | "conta_vence_hoje"
  | "venda_pendente";
export type NotificacaoSeveridade = "info" | "warning" | "danger";

export type Notificacao = {
  id: string;
  tipo: NotificacaoTipo;
  severidade: NotificacaoSeveridade;
  titulo: string;
  descricao: string;
  rota: string;
  criadoEm: string;
  read: boolean;
  readAt: string | null;
};

export function useNotificacoes() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notificacoes", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Notificacao[]> => {
      const notifs: Notificacao[] = [];

      const [vencidas, hojeData, produtos, estados] = await Promise.all([
        dataClient.notificacoes.vencidas(),
        dataClient.notificacoes.vencendoHoje(),
        dataClient.notificacoes.produtosEstoqueMinimo(),
        dataClient.notificacoes.estadosUsuario(user!.id),
      ]);

      for (const c of vencidas) {
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

      for (const c of hojeData) {
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

      if (produtos.length > 0) {
        const movs = await dataClient.notificacoes.movimentosEstoqueResumo();
        const saldos = new Map<string, number>();
        for (const m of movs) {
          const sinal =
            m.tipo === "entrada" || m.tipo === "devolucao"
              ? 1
              : m.tipo === "saida" || m.tipo === "transferencia"
                ? -1
                : 1;
          saldos.set(
            m.produto_id,
            (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade),
          );
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

      const mapaEstado = new Map<string, { read: boolean; read_at: string | null; deleted: boolean }>();
      for (const e of estados) {
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

      const ordem: Record<NotificacaoSeveridade, number> = { danger: 0, warning: 1, info: 2 };
      visiveis.sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return ordem[a.severidade] - ordem[b.severidade];
      });

      return visiveis;
    },
  });
}

export function useMarcarNotificacaoLida() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificacaoKey: string) => {
      if (!user) throw new Error("Não autenticado");
      await dataClient.notificacoes.marcarLida({
        user_id: user.id,
        notificacao_key: notificacaoKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
    },
  });
}

export function useExcluirNotificacao() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificacaoKey: string) => {
      if (!user) throw new Error("Não autenticado");
      await dataClient.notificacoes.excluir({
        user_id: user.id,
        notificacao_key: notificacaoKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
    },
  });
}

export function useMarcarTodasLidas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chaves: string[]) => {
      if (!user) throw new Error("Não autenticado");
      await dataClient.notificacoes.marcarVariasLidas({
        user_id: user.id,
        chaves,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes", user?.id] });
    },
  });
}
