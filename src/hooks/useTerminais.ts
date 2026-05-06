import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import type { TerminalDomain } from "@/integrations/data/extra-adapters";

export type Terminal = TerminalDomain;

/** Considera online se o último heartbeat foi há menos de 90s. */
export function isTerminalOnline(t: Pick<Terminal, "heartbeat_at">): boolean {
  if (!t.heartbeat_at) return false;
  const diff = Date.now() - new Date(t.heartbeat_at).getTime();
  return diff < 90_000;
}

export function useTerminais() {
  return useQuery({
    queryKey: ["terminais"],
    queryFn: () => dataClient.terminais.list(),
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
    mutationFn: (input: {
      nome: string;
      descricao?: string | null;
      identificador_dispositivo?: string | null;
    }) => dataClient.terminais.criar(input),
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
    mutationFn: (input: {
      id: string;
      nome?: string;
      descricao?: string | null;
      identificador_dispositivo?: string | null;
    }) => dataClient.terminais.atualizar(input),
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
    mutationFn: (input: { id: string; ativo: boolean }) =>
      dataClient.terminais.alterarStatus(input),
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
    mutationFn: (id: string) => dataClient.terminais.excluir(id),
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
    mutationFn: (id: string) => dataClient.terminais.gerarToken(id),
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
    mutationFn: (id: string) => dataClient.terminais.definirServidor(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Servidor principal definido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
