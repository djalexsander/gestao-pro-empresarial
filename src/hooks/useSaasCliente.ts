import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/* =========================================================
 * Tipos visíveis ao cliente (dono da empresa)
 * =======================================================*/
export type PlanoDisponivel = {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number;
  tipo_cobranca: "mensal" | "anual" | "vitalicio";
  limite_usuarios: number | null;
  limite_produtos: number | null;
  ordem: number;
  atual: boolean;
};

export type ModuloDisponivelCliente = {
  id: string;
  nome: string;
  chave: string;
  descricao: string | null;
  valor: number;
  aplica_restricao: boolean;
  /** "ativo" | "pendente" | "cancelado" | "nao_contratado" */
  status: string;
  data_expiracao: string | null;
};

/* =========================================================
 * QUERIES
 * =======================================================*/
export function usePlanosDisponiveis() {
  return useQuery({
    queryKey: ["planos-disponiveis"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("planos_disponiveis");
      if (error) throw error;
      return (data ?? []) as PlanoDisponivel[];
    },
  });
}

export function useModulosDisponiveisCliente() {
  return useQuery({
    queryKey: ["modulos-disponiveis-cliente"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "modulos_disponiveis_cliente",
      );
      if (error) throw error;
      return (data ?? []) as ModuloDisponivelCliente[];
    },
  });
}

/* =========================================================
 * MUTATIONS
 * =======================================================*/
export type CobrancaCriada = {
  pagamento_id: string;
  asaas_payment_id: string;
  invoice_url?: string | null;
  pix_qrcode?: string | null;
  pix_copia_cola?: string | null;
  due_date?: string | null;
};

/**
 * Lê a mensagem real de erro retornada pela edge function.
 * `supabase.functions.invoke` em status não-2xx só expõe
 * "Edge Function returned a non-2xx status code" no `error.message`.
 * O corpo real da resposta vive em `error.context.response`.
 */
async function extrairErroEdge(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: { response?: Response } })?.context;
  const resp = ctx?.response;
  if (resp) {
    try {
      const body = await resp.clone().json();
      const msg =
        (body as { error?: string; message?: string })?.error ??
        (body as { error?: string; message?: string })?.message;
      if (msg) return String(msg);
    } catch {
      try {
        const txt = await resp.clone().text();
        if (txt) return txt;
      } catch {
        /* ignora */
      }
    }
  }
  const msg = (error as { message?: string })?.message;
  return msg && msg !== "Edge Function returned a non-2xx status code"
    ? msg
    : fallback;
}

async function criarCobrancaAsaas(pagamento_id: string): Promise<CobrancaCriada | null> {
  // Verifica se a cobrança automática está habilitada antes de chamar a função.
  const { data: cfg } = await supabase
    .from("config_comercial")
    .select("asaas_enabled")
    .maybeSingle();
  if (!cfg?.asaas_enabled) return null;

  const { data, error } = await supabase.functions.invoke("asaas-criar-cobranca", {
    body: { pagamento_id, billing_type: "PIX" },
  });
  if (error) {
    const detalhe = await extrairErroEdge(
      error,
      "Não foi possível criar a cobrança Pix. Confira o CNPJ/CPF em Configurações → Empresa e tente novamente.",
    );
    throw new Error(detalhe);
  }
  return { ...(data as Omit<CobrancaCriada, "pagamento_id">), pagamento_id };
}

export function useSolicitarPlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plano_id: string) => {
      const { data: pagamentoId, error } = await (supabase.rpc as any)(
        "solicitar_contratacao_plano",
        { _plano_id: plano_id },
      );
      if (error) throw error;
      const cobranca = await criarCobrancaAsaas(pagamentoId as string);
      return { pagamentoId: pagamentoId as string, cobranca };
    },
    onSuccess: ({ cobranca }) => {
      qc.invalidateQueries({ queryKey: ["planos-disponiveis"] });
      if (!cobranca) {
        toast.success(
          "Solicitação enviada! Aguarde a confirmação do pagamento pelo suporte.",
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSolicitarModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modulo_id: string) => {
      const { data: pagamentoId, error } = await (supabase.rpc as any)(
        "solicitar_contratacao_modulo",
        { _modulo_id: modulo_id },
      );
      if (error) throw error;
      const cobranca = await criarCobrancaAsaas(pagamentoId as string);
      return { pagamentoId: pagamentoId as string, cobranca };
    },
    onSuccess: ({ cobranca }) => {
      qc.invalidateQueries({ queryKey: ["modulos-disponiveis-cliente"] });
      qc.invalidateQueries({ queryKey: ["meus-modulos"] });
      if (!cobranca) {
        toast.success(
          "Solicitação enviada! Aguarde a liberação após confirmação do pagamento.",
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * RESET DE DADOS
 * =======================================================*/
export function useResetarDadosEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("resetar_dados_empresa");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Todos os dados operacionais foram apagados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
