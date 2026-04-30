import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import type { FuncionarioRoleDomain, OperadorSessaoDomain } from "@/integrations/data";

export type FuncionarioRole = FuncionarioRoleDomain;

export interface Funcionario {
  id: string;
  nome: string;
  login: string;
  role: FuncionarioRole;
  ativo: boolean;
  ultimo_acesso: string | null;
  created_at: string;
}

export type OperadorSessao = OperadorSessaoDomain;

/**
 * Lista todos os funcionários do dono atual (para painel admin).
 *
 * Continua via `supabase.rpc` direto: leitura é abstraída em fase posterior
 * junto com os outros `useQuery` de listagem (Bloco "leitura unificada").
 */
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

/**
 * Cria funcionário com PIN.
 *
 * **PIN segue em texto até a RPC**, que aplica bcrypt no banco. O hook NÃO
 * deriva nem armazena hash em lugar nenhum.
 *
 * Idempotência: passe `client_uuid` estável por dialog aberto. Se o
 * `client_uuid` não for fornecido, a UI ainda fica protegida pelo
 * `mutation.isPending` do React Query (que bloqueia duplo clique no botão).
 */
export function useCriarFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      login: string;
      pin: string;
      role: FuncionarioRole;
      client_uuid?: string | null;
    }) => {
      return dataClient.funcionarios.criar(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success("Funcionário cadastrado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Edita nome / login / role. NÃO altera PIN.
 */
export function useEditarFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      nome: string;
      login: string;
      role: FuncionarioRole;
    }) => {
      return dataClient.funcionarios.editar({
        funcionario_id: input.id,
        nome: input.nome,
        login: input.login,
        role: input.role,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success("Funcionário atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useResetarPinFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; pin: string }) => {
      await dataClient.funcionarios.resetarPin({
        funcionario_id: input.id,
        pin: input.pin,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success("PIN redefinido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Ativa / inativa funcionário. RPC bloqueia inativar o último gerente ativo.
 */
export function useToggleFuncionarioAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; ativo: boolean }) => {
      return dataClient.funcionarios.alterarStatus({
        funcionario_id: input.id,
        ativo: input.ativo,
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      toast.success(vars.ativo ? "Funcionário ativado." : "Funcionário desativado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Hard delete. RPC bloqueia se houver caixas/movimentos/vendas — nesses casos
 * a UI deve oferecer inativação.
 */
export function useExcluirFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return dataClient.funcionarios.excluir(id);
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
  return dataClient.funcionarios.validarPin({
    funcionario_id: funcionarioId,
    pin,
  });
}
