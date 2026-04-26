import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface Terminal {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  identificador_dispositivo: string | null;
  pareamento_token: string | null;
  ultimo_uso: string | null;
  caixa_aberto_id: string | null;
  created_at: string;
  papel: "servidor" | "terminal";
  heartbeat_at: string | null;
  operador_atual_id: string | null;
  operador_atual_nome: string | null;
  user_agent: string | null;
  ip_local: string | null;
  pode_pdv: boolean;
  pode_erp: boolean;
  pode_financeiro: boolean;
  pode_configuracoes: boolean;
  pode_relatorios: boolean;
  pode_cadastros: boolean;
}

/** Considera online se o último heartbeat foi há menos de 90s. */
export function isTerminalOnline(t: Pick<Terminal, "heartbeat_at">): boolean {
  if (!t.heartbeat_at) return false;
  const diff = Date.now() - new Date(t.heartbeat_at).getTime();
  return diff < 90_000;
}

export function useTerminais() {
  return useQuery({
    queryKey: ["terminais"],
    queryFn: async (): Promise<Terminal[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("terminais_listar");
      if (error) throw error;
      return (data ?? []) as Terminal[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTerminaisAtivos() {
  const q = useTerminais();
  return {
    ...q,
    data: (q.data ?? []).filter((t) => t.ativo),
  };
}

export function useCriarTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      descricao?: string | null;
      identificador_dispositivo?: string | null;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("terminais")
        .insert({
          owner_id: u.user.id,
          nome: input.nome,
          descricao: input.descricao ?? null,
          identificador_dispositivo: input.identificador_dispositivo ?? null,
          ativo: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data?.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Terminal cadastrado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAtualizarTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      nome?: string;
      descricao?: string | null;
      identificador_dispositivo?: string | null;
    }) => {
      const { error } = await supabase
        .from("terminais")
        .update({
          ...(input.nome !== undefined ? { nome: input.nome } : {}),
          ...(input.descricao !== undefined ? { descricao: input.descricao } : {}),
          ...(input.identificador_dispositivo !== undefined
            ? { identificador_dispositivo: input.identificador_dispositivo }
            : {}),
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Terminal atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleTerminalAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; ativo: boolean }) => {
      const { error } = await supabase
        .from("terminais")
        .update({ ativo: input.ativo })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success(vars.ativo ? "Terminal ativado." : "Terminal desativado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useExcluirTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("terminais").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Terminal excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useGerarTokenTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("terminal_gerar_token", {
        _terminal_id: id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Token gerado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Promove um terminal a "Servidor principal" (rebaixa o anterior). */
export function useDefinirServidor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("terminal_definir_servidor", {
        _terminal_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Servidor principal definido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
