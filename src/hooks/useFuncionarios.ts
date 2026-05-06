import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
// supabase removido — tudo via dataClient
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
    queryFn: () => dataClient.funcionarios.list() as Promise<Funcionario[]>,
    staleTime: 30_000,
  });
}

/** Lista apenas funcionários ativos (para tela de seleção do PDV). */
export function useFuncionariosAtivos() {
  return useQuery({
    queryKey: ["funcionarios", "ativos"],
    queryFn: () =>
      dataClient.funcionarios.list({ somente_ativos: true }) as Promise<Funcionario[]>,
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

/**
 * Valida o PIN de um funcionário. Retorna a sessão do operador.
 *
 * **Bloco 11 — Rate limit / lockout:**
 *  - O servidor registra cada tentativa em `funcionario_tentativas_pin` e
 *    aplica bloqueio temporário (5 falhas em 10 min => 15 min de lockout).
 *  - O `error.message` já vem com mensagem clara para mostrar no toast:
 *      * `"PIN incorreto. N tentativa(s) restante(s)."`
 *      * `"Operador temporariamente bloqueado. Tente novamente em N segundo(s)."`
 *      * `"Muitas tentativas inválidas. Operador bloqueado por N segundo(s)."`
 *  - O parâmetro `terminalId` é opcional e usado só para auditoria.
 */
export async function validarPinOperador(
  funcionarioId: string,
  pin: string,
  terminalId?: string | null,
): Promise<OperadorSessao> {
  return dataClient.funcionarios.validarPin({
    funcionario_id: funcionarioId,
    pin,
    terminal_id: terminalId ?? null,
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent ?? null : null,
  });
}

/**
 * Desbloqueia manualmente um operador antes do prazo. Apenas owner/admin
 * da empresa pode chamar (validado server-side). Útil para painel admin.
 */
export async function desbloquearPinOperador(funcionarioId: string) {
  return dataClient.funcionarios.desbloquearPin({ funcionario_id: funcionarioId });
}
