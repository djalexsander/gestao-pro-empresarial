import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
// supabase removido — tudo via dataClient
import { dataClient } from "@/integrations/data";
import type { FuncionarioRoleDomain, OperadorSessaoDomain } from "@/integrations/data";
import { isDesktop } from "@/integrations/data/mode";
import {
  hasOperadorOffline,
  saveOperadorPin,
  verifyOperadorPinOffline,
  OperadorOfflineError,
} from "@/lib/operadorOfflineCache";
import { isNetworkAuthError } from "@/lib/erpOfflineCache";
import { aquecerPinServidor } from "@/integrations/desktop/serverConnection";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import { friendlyDeleteError, logSoftDelete } from "@/lib/softDeleteError";

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
 * Todas as leituras/escritas passam por `dataClient.funcionarios.*`. Em
 * desktop com modo "local-server"/"local-terminal", o adapter decide
 * SQLite local + outbox e cai em cloud só como fallback. Em PWA/web,
 * resolve direto pela nuvem normalmente.
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
      // Gera o UUID no cliente para que desktop offline e Supabase fiquem
      // com o MESMO id após o sync. A RPC `funcionario_criar` aceita
      // `_funcionario_id` opcional e é idempotente por id.
      const funcionario_id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : null;
      // eslint-disable-next-line no-console
      console.debug("[FUNCIONARIOS_LOCAL_CREATE] gerando id no cliente:", funcionario_id);
      return dataClient.funcionarios.criar({ ...input, funcionario_id });
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
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["funcionarios"] });
      const snapshots = qc.getQueriesData<Funcionario[]>({ queryKey: ["funcionarios"] });
      snapshots.forEach(([key, prev]) => {
        if (!Array.isArray(prev)) return;
        qc.setQueryData<Funcionario[]>(
          key,
          prev.map((f) =>
            f.id === input.id ? { ...f, nome: input.nome, login: input.login, role: input.role } : f,
          ),
        );
      });
      return { snapshots };
    },
    onError: (e: Error, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, prev]) => qc.setQueryData(key, prev));
      toast.error(e.message);
    },
    onSuccess: () => {
      toast.success("Funcionário atualizado.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["funcionarios"] }),
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
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["funcionarios"] });
      const snapshots = qc.getQueriesData<Funcionario[]>({ queryKey: ["funcionarios"] });
      snapshots.forEach(([key, prev]) => {
        if (!Array.isArray(prev)) return;
        qc.setQueryData<Funcionario[]>(
          key,
          prev.map((f) => (f.id === input.id ? { ...f, ativo: input.ativo } : f)),
        );
      });
      return { snapshots };
    },
    onError: (e: Error, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, prev]) => qc.setQueryData(key, prev));
      toast.error(e.message);
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.ativo ? "Funcionário ativado." : "Funcionário desativado.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["funcionarios"] }),
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["funcionarios"] });
      const snapshots = qc.getQueriesData<Funcionario[]>({ queryKey: ["funcionarios"] });
      snapshots.forEach(([key, prev]) => {
        if (!Array.isArray(prev)) return;
        qc.setQueryData<Funcionario[]>(
          key,
          prev.filter((f) => f.id !== id),
        );
      });
      return { snapshots };
    },
    onError: (e: Error, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, prev]) => qc.setQueryData(key, prev));
      toast.error(e.message);
    },
    onSuccess: () => {
      toast.success("Funcionário removido.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["funcionarios"] }),
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
  const desktop = isDesktop();
  const navigatorOnline =
    typeof navigator !== "undefined" ? navigator.onLine : true;

  // Desktop totalmente offline → cache local é o único caminho.
  if (desktop && !navigatorOnline) {
    if (!hasOperadorOffline(funcionarioId)) {
      // eslint-disable-next-line no-console
      console.warn("[OFFLINE_AUTH] PIN recusado localmente — sem cache para o operador");
      throw new Error(
        "PIN offline indisponível. Faça a sincronização inicial com internet antes de usar o PDV offline.",
      );
    }
    try {
      const op = await verifyOperadorPinOffline(funcionarioId, pin);
      // eslint-disable-next-line no-console
      console.debug("[OFFLINE_AUTH] PIN validado localmente");
      return op;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[OFFLINE_AUTH] PIN recusado localmente:", (e as Error).message);
      throw e instanceof OperadorOfflineError ? new Error(e.message) : (e as Error);
    }
  }

  try {
    const op = await dataClient.funcionarios.validarPin({
      funcionario_id: funcionarioId,
      pin,
      terminal_id: terminalId ?? null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent ?? null : null,
    });
    // Aquece o cache local para futuras validações offline (apenas desktop).
    if (desktop) {
      try {
        await saveOperadorPin({
          funcionario_id: op.id,
          nome: op.nome,
          login: op.login,
          role: op.role,
          pin,
        });
      } catch {
        /* noop — não bloqueia o login */
      }
      // Sub-etapa 4.1: também aquece o verificador no SERVIDOR LOCAL (LAN)
      // para que outros terminais validem PIN sem internet. Best-effort.
      try {
        const cfg = getDesktopConfig().terminal;
        const ok = await aquecerPinServidor(cfg, {
          funcionario_id: op.id,
          nome: op.nome,
          login: op.login,
          role: op.role,
          pin,
        });
        if (ok) {
          // eslint-disable-next-line no-console
          console.debug("[OFFLINE_AUTH] PIN aquecido no servidor local");
        }
      } catch {
        /* noop — sem servidor local não é erro */
      }
    }
    return op;
  } catch (err) {
    // Se foi falha de rede em desktop, tenta validar pelo cache local.
    if (desktop && isNetworkAuthError(err) && hasOperadorOffline(funcionarioId)) {
      try {
        const op = await verifyOperadorPinOffline(funcionarioId, pin);
        // eslint-disable-next-line no-console
        console.debug("[OFFLINE_AUTH] fallback cloud → PIN validado localmente");
        return op;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[OFFLINE_AUTH] fallback cloud → PIN recusado localmente");
        throw e instanceof OperadorOfflineError ? new Error(e.message) : (e as Error);
      }
    }
    if (desktop && isNetworkAuthError(err) && !hasOperadorOffline(funcionarioId)) {
      throw new Error(
        "Sem conexão e este operador ainda não foi preparado para uso offline. Faça uma validação online primeiro.",
      );
    }
    throw err;
  }
}

/**
 * Desbloqueia manualmente um operador antes do prazo. Apenas owner/admin
 * da empresa pode chamar (validado server-side). Útil para painel admin.
 */
export async function desbloquearPinOperador(funcionarioId: string) {
  return dataClient.funcionarios.desbloquearPin({ funcionario_id: funcionarioId });
}
