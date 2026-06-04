import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";

// =============== Tipos ===============
export type ClienteStatus = "ativo" | "inativo";
export type PessoaTipo = "PF" | "PJ";

export type ClienteLite = {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  documento: string | null;
};

export interface Cliente {
  id: string;
  owner_id: string;
  tipo: PessoaTipo;
  nome: string;
  nome_fantasia: string | null;
  documento: string | null;
  inscricao_estadual: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  data_nascimento: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  status: ClienteStatus;
  created_at: string;
  updated_at: string;
}

export interface ClienteInput {
  tipo: PessoaTipo;
  nome: string;
  nome_fantasia?: string | null;
  documento?: string | null;
  inscricao_estadual?: string | null;
  email?: string | null;
  telefone?: string | null;
  celular?: string | null;
  data_nascimento?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  observacoes?: string | null;
  status?: ClienteStatus;
}

export interface ClienteMetricas {
  cliente_id: string;
  total_vendas: number;
  valor_total: number;
  ticket_medio: number;
  ultima_venda: string | null;
}

// =============== Queries ===============
/**
 * Lista resumida (compat: usado no PDV).
 */
export function useClientes() {
  return useQuery({
    queryKey: ["clientes-lite"],
    queryFn: () => dataClient.clientes.listLite() as Promise<ClienteLite[]>,
  });
}

/**
 * Lista completa para a tela de gerenciamento de clientes.
 */
export function useClientesFull() {
  return useQuery({
    queryKey: ["clientes", "full"],
    queryFn: () => dataClient.clientes.list() as Promise<Cliente[]>,
  });
}

/**
 * Métricas agregadas por cliente.
 */
export function useClienteMetricas() {
  return useQuery({
    queryKey: ["clientes", "metricas"],
    queryFn: () =>
      dataClient.clientes.metricas() as Promise<Map<string, ClienteMetricas>>,
  });
}

/**
 * Histórico de vendas de um cliente.
 */
export function useClienteHistorico(clienteId: string | null) {
  return useQuery({
    queryKey: ["clientes", "historico", clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      if (!clienteId) return [];
      return dataClient.clientes.historico(clienteId);
    },
  });
}

// =============== Mutations ===============
function sanitize(input: ClienteInput) {
  const norm = (v?: string | null) => {
    if (v == null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };
  // Documento: remover tudo que não é dígito (mas mantém null se vazio)
  const docRaw = norm(input.documento ?? null);
  const documento = docRaw ? docRaw.replace(/\D+/g, "") || null : null;
  return {
    tipo: input.tipo,
    nome: input.nome.trim(),
    nome_fantasia: norm(input.nome_fantasia ?? null),
    documento,
    inscricao_estadual: norm(input.inscricao_estadual ?? null),
    email: norm(input.email ?? null),
    telefone: norm(input.telefone ?? null),
    celular: norm(input.celular ?? null),
    data_nascimento: input.data_nascimento || null,
    cep: norm(input.cep ?? null),
    logradouro: norm(input.logradouro ?? null),
    numero: norm(input.numero ?? null),
    complemento: norm(input.complemento ?? null),
    bairro: norm(input.bairro ?? null),
    cidade: norm(input.cidade ?? null),
    estado: norm(input.estado ?? null),
    observacoes: norm(input.observacoes ?? null),
    status: input.status ?? "ativo",
  };
}

function mapError(e: unknown): Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any;
  const msg: string = err?.message ?? String(e);
  if (
    err?.code === "23505" ||
    /duplicate key/i.test(msg) ||
    /clientes_owner_documento_uniq/i.test(msg)
  ) {
    return new Error("Já existe um cliente com este CPF/CNPJ.");
  }
  return new Error(msg);
}

async function fetchClienteById(id: string): Promise<Cliente> {
  return dataClient.clientes.get(id) as Promise<Cliente>;
}

export function useCreateCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClienteInput): Promise<Cliente> => {
      const payload = sanitize(input);
      const client_uuid = crypto.randomUUID();
      try {
        const r = await dataClient.clientes.criar({ ...payload, client_uuid });
        return await fetchClienteById(r.cliente_id);
      } catch (e) {
        throw mapError(e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes-lite"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      toast.success("Cliente cadastrado com sucesso");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: ClienteInput & { id: string }): Promise<Cliente> => {
      try {
        const r = await dataClient.clientes.editar({
          cliente_id: id,
          ...sanitize(input),
        });
        return await fetchClienteById(r.cliente_id);
      } catch (e) {
        throw mapError(e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes-lite"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      toast.success("Cliente atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleClienteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ClienteStatus }) =>
      dataClient.clientes.alterarStatus({ cliente_id: id, status }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["clientes-lite"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      toast.success(vars.status === "ativo" ? "Cliente ativado" : "Cliente inativado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Hard delete. A RPC bloqueia se houver vendas/lançamentos vinculados —
 * nesse caso, a UI deve oferecer "inativar" via `useToggleClienteStatus`.
 */
export function useDeleteCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => dataClient.clientes.excluir(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes-lite"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      toast.success("Cliente removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Verifica se um documento já existe (sem contar o próprio id em edição).
 * Retorna o cliente conflitante ou null.
 */
export async function checkDocumentoDuplicado(
  documento: string,
  ignoreId?: string,
): Promise<Cliente | null> {
  return dataClient.clientes.checkDocumentoDuplicado(
    documento,
    ignoreId ?? null,
  ) as Promise<Cliente | null>;
}
