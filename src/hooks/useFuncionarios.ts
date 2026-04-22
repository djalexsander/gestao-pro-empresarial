import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type FuncionarioRole = "gerente" | "caixa";

export interface Funcionario {
  id: string;
  nome: string;
  login: string;
  role: FuncionarioRole;
  ativo: boolean;
  ultimo_acesso: string | null;
  created_at: string;
}

export interface OperadorSessao {
  id: string;
  nome: string;
  login: string;
  role: FuncionarioRole;
}

/** Lista todos os funcionários do dono atual (para painel admin). */
export function useFuncionarios() {
  return useQuery({
    queryKey: ["funcionarios"],
    queryFn: async (): Promise<Funcionario[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("funcionarios_listar");
      if (error) throw error;
      return (data ?? []) as Funcionario[];
    },
    staleTime: 30_000,
  });
}

/** Lista apenas funcionários ativos (para tela de seleção do PDV). */
export function useFuncionariosAtivos() {
  return useQuery({
    queryKey: ["funcionarios", "ativos"],
    queryFn: async (): Promise<Funcionario[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("funcionarios_listar");
      if (error) throw error;
      return ((data ?? []) as Funcionario[]).filter((f) => f.ativo);
    },
    staleTime: 30_000,
  });
}

export function useCriarFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      login: string;
      pin: string;
      role: FuncionarioRole;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("funcionario_criar", {
        _nome: input.nome,
        _login: input.login,
        _pin: input.pin,
        _role: input.role,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success("Funcionário cadastrado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useResetarPinFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; pin: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("funcionario_resetar_pin", {
        _funcionario_id: input.id,
        _novo_pin: input.pin,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success("PIN redefinido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleFuncionarioAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; ativo: boolean }) => {
      const { error } = await supabase
        .from("funcionarios")
        .update({ ativo: input.ativo })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success(vars.ativo ? "Funcionário ativado." : "Funcionário desativado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useExcluirFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("funcionarios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success("Funcionário removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Valida o PIN de um funcionário. Retorna a sessão do operador. */
export async function validarPinOperador(
  funcionarioId: string,
  pin: string,
): Promise<OperadorSessao> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("funcionario_validar_pin", {
    _funcionario_id: funcionarioId,
    _pin: pin,
  });
  if (error) throw error;
  return data as OperadorSessao;
}
