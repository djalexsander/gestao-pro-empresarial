import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/integrations/data/mode";

/* =========================================================
 * Tipos
 * =======================================================*/
export type PlanoTipoCobranca = "mensal" | "anual" | "vitalicio";
export type AssinaturaStatus = "trial" | "ativo" | "vencido" | "cancelado";
export type EmpresaModuloStatus = "ativo" | "pendente" | "cancelado";
export type PagamentoStatus = "pago" | "pendente" | "atrasado" | "cancelado";
export type PagamentoReferencia = "plano" | "modulo" | "outro";

export type Plano = {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number;
  tipo_cobranca: PlanoTipoCobranca;
  limite_usuarios: number | null;
  limite_produtos: number | null;
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type Modulo = {
  id: string;
  nome: string;
  chave: string;
  descricao: string | null;
  valor: number;
  ativo: boolean;
  aplica_restricao: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type AssinaturaRow = {
  id: string | null;
  empresa_id: string;
  empresa_nome: string;
  empresa_status: string | null;
  plano_id: string | null;
  plano_nome: string | null;
  plano_valor: number | null;
  plano_tipo: string | null;
  status: AssinaturaStatus | null;
  status_efetivo: string;
  data_inicio: string | null;
  data_expiracao: string | null;
  dias_restantes: number;
  modulos_ativos: number;
  observacoes: string | null;
  updated_at: string | null;
};

export type EmpresaModuloRow = {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  modulo_id: string;
  modulo_nome: string;
  modulo_chave: string;
  modulo_valor: number;
  aplica_restricao: boolean;
  status: EmpresaModuloStatus;
  data_inicio: string;
  data_expiracao: string | null;
  observacoes: string | null;
};

export type PagamentoRow = {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  referencia_tipo: PagamentoReferencia;
  plano_id: string | null;
  plano_nome: string | null;
  modulo_id: string | null;
  modulo_nome: string | null;
  descricao: string | null;
  valor: number;
  status: PagamentoStatus;
  forma_pagamento: string | null;
  data_vencimento: string | null;
  data_pagamento: string | null;
  observacoes: string | null;
  created_at: string;
};

export type ConfigComercial = {
  dias_trial: number;
  permitir_modulos_no_trial: boolean;
  plano_padrao_id: string | null;
  valor_padrao_sistema: number;
  asaas_enabled: boolean;
  asaas_ambiente: "sandbox" | "producao";
  updated_at: string;
};

export type ReajusteCatalogoRow = {
  tipo: "plano" | "modulo";
  item_id: string;
  nome: string;
  preco_catalogo: number;
  preco_futuro: number | null;
  empresas_ativas: number;
  valor_medio_contratado: number | null;
};

export type ReajusteEmpresaRow = {
  empresa_id: string;
  empresa_nome: string;
  plano_nome: string | null;
  valor_contratado: number;
  valor_personalizado: boolean;
};

export type ReajusteHistoricoRow = {
  id: string;
  empresa_nome: string;
  tipo: "plano" | "modulo";
  item_nome: string;
  valor_anterior: number;
  valor_novo: number;
  vigencia: string;
  modo_aplicacao: "imediato" | "proxima_renovacao";
  motivo: string | null;
  alterado_por: string;
  criado_em: string;
  aplicado_em: string | null;
};

/* =========================================================
 * PLANOS
 * =======================================================*/
export function useAdminPlanos() {
  return useQuery({
    queryKey: ["admin-planos"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_listar_planos");
      if (error) throw error;
      return (data ?? []) as Plano[];
    },
  });
}

export function useUpsertPlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string | null;
      nome: string;
      descricao?: string | null;
      valor: number;
      tipo_cobranca: PlanoTipoCobranca;
      limite_usuarios?: number | null;
      limite_produtos?: number | null;
      ativo: boolean;
      ordem?: number;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_upsert_plano", {
        _id: input.id,
        _nome: input.nome,
        _descricao: input.descricao ?? null,
        _valor: input.valor,
        _tipo_cobranca: input.tipo_cobranca,
        _limite_usuarios: input.limite_usuarios ?? null,
        _limite_produtos: input.limite_produtos ?? null,
        _ativo: input.ativo,
        _ordem: input.ordem ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-planos"] });
      qc.invalidateQueries({ queryKey: ["admin-config-comercial"] });
      toast.success("Plano salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("admin_delete_plano", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-planos"] });
      toast.success("Plano excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * MODULOS
 * =======================================================*/
export function useAdminModulos() {
  return useQuery({
    queryKey: ["admin-modulos"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_listar_modulos");
      if (error) throw error;
      return (data ?? []) as Modulo[];
    },
  });
}

export function useUpsertModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string | null;
      nome: string;
      chave: string;
      descricao?: string | null;
      valor: number;
      ativo: boolean;
      aplica_restricao: boolean;
      ordem?: number;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_upsert_modulo", {
        _id: input.id,
        _nome: input.nome,
        _chave: input.chave,
        _descricao: input.descricao ?? null,
        _valor: input.valor,
        _ativo: input.ativo,
        _aplica_restricao: input.aplica_restricao,
        _ordem: input.ordem ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modulos"] });
      toast.success("Módulo salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("admin_delete_modulo", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modulos"] });
      toast.success("Módulo excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * ASSINATURAS
 * =======================================================*/
export function useAdminAssinaturas() {
  return useQuery({
    queryKey: ["admin-assinaturas"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_listar_assinaturas");
      if (error) throw error;
      return (data ?? []) as AssinaturaRow[];
    },
  });
}

export function useSetAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      empresa_id: string;
      plano_id: string | null;
      status: AssinaturaStatus;
      data_inicio?: string | null;
      data_expiracao?: string | null;
      observacoes?: string | null;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_set_assinatura", {
        _empresa_id: input.empresa_id,
        _plano_id: input.plano_id,
        _status: input.status,
        _data_inicio: input.data_inicio ?? null,
        _data_expiracao: input.data_expiracao ?? null,
        _observacoes: input.observacoes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-assinaturas"] });
      toast.success("Assinatura atualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * EMPRESA_MODULOS
 * =======================================================*/
export function useEmpresaModulos(empresaId?: string | null) {
  return useQuery({
    queryKey: ["admin-empresa-modulos", empresaId ?? "all"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_listar_empresa_modulos", {
        _empresa_id: empresaId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as EmpresaModuloRow[];
    },
  });
}

export function useSetEmpresaModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      empresa_id: string;
      modulo_id: string;
      status: EmpresaModuloStatus;
      data_inicio?: string | null;
      data_expiracao?: string | null;
      observacoes?: string | null;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_set_empresa_modulo", {
        _empresa_id: input.empresa_id,
        _modulo_id: input.modulo_id,
        _status: input.status,
        _data_inicio: input.data_inicio ?? null,
        _data_expiracao: input.data_expiracao ?? null,
        _observacoes: input.observacoes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-empresa-modulos"] });
      qc.invalidateQueries({ queryKey: ["admin-assinaturas"] });
      toast.success("Módulo da empresa atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoverEmpresaModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("admin_remover_empresa_modulo", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-empresa-modulos"] });
      qc.invalidateQueries({ queryKey: ["admin-assinaturas"] });
      toast.success("Módulo removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * PAGAMENTOS
 * =======================================================*/
export function useAdminPagamentos(empresaId?: string | null) {
  return useQuery({
    queryKey: ["admin-pagamentos", empresaId ?? "all"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_listar_pagamentos", {
        _empresa_id: empresaId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as PagamentoRow[];
    },
  });
}

export function useUpsertPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string | null;
      empresa_id: string;
      referencia_tipo: PagamentoReferencia;
      plano_id?: string | null;
      modulo_id?: string | null;
      descricao?: string | null;
      valor: number;
      status: PagamentoStatus;
      forma_pagamento?: string | null;
      data_vencimento?: string | null;
      data_pagamento?: string | null;
      observacoes?: string | null;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_registrar_pagamento", {
        _id: input.id,
        _empresa_id: input.empresa_id,
        _referencia_tipo: input.referencia_tipo,
        _plano_id: input.plano_id ?? null,
        _modulo_id: input.modulo_id ?? null,
        _descricao: input.descricao ?? null,
        _valor: input.valor,
        _status: input.status,
        _forma_pagamento: input.forma_pagamento ?? null,
        _data_vencimento: input.data_vencimento ?? null,
        _data_pagamento: input.data_pagamento ?? null,
        _observacoes: input.observacoes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-pagamentos"] });
      toast.success("Pagamento salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("admin_delete_pagamento", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-pagamentos"] });
      toast.success("Pagamento removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * CONFIG COMERCIAL
 * =======================================================*/
export function useConfigComercial() {
  return useQuery({
    queryKey: ["admin-config-comercial"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_get_config_comercial");
      if (error) throw error;
      return data as unknown as ConfigComercial;
    },
  });
}

export function useSetConfigComercial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      dias_trial: number;
      permitir_modulos_no_trial: boolean;
      plano_padrao_id: string | null;
      valor_padrao_sistema: number;
      asaas_enabled?: boolean;
      asaas_ambiente?: "sandbox" | "producao";
    }) => {
      const { error } = await (supabase.rpc as any)("admin_set_config_comercial", {
        _dias_trial: input.dias_trial,
        _permitir_modulos_no_trial: input.permitir_modulos_no_trial,
        _plano_padrao_id: input.plano_padrao_id,
        _valor_padrao_sistema: input.valor_padrao_sistema,
        _asaas_enabled: input.asaas_enabled ?? null,
        _asaas_ambiente: input.asaas_ambiente ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-config-comercial"] });
      toast.success("Configurações comerciais atualizadas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * REAJUSTES
 * =======================================================*/
export function useAdminReajustesCatalogo() {
  return useQuery({
    queryKey: ["admin-reajustes-catalogo"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_reajustes_catalogo");
      if (error) throw error;
      return (data ?? []) as ReajusteCatalogoRow[];
    },
  });
}

export function useAdminReajusteEmpresas(tipo?: string, itemId?: string) {
  return useQuery({
    queryKey: ["admin-reajuste-empresas", tipo, itemId],
    enabled: Boolean(tipo && itemId),
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_reajuste_empresas", {
        _tipo: tipo,
        _item_id: itemId,
      });
      if (error) throw error;
      return (data ?? []) as ReajusteEmpresaRow[];
    },
  });
}

export function useAdminAplicarReajuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      tipo: "plano" | "modulo";
      item_id: string;
      novo_valor: number;
      escopo: "novos" | "todos_ativos" | "empresas" | "plano_base" | "premium";
      empresas: string[];
      vigencia: string;
      modo: "imediato" | "proxima_renovacao";
      motivo?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("admin_aplicar_reajuste", {
        _tipo: input.tipo,
        _item_id: input.item_id,
        _novo_valor: input.novo_valor,
        _escopo: input.escopo,
        _empresas: input.empresas,
        _vigencia: input.vigencia,
        _modo: input.modo,
        _motivo: input.motivo ?? null,
      });
      if (error) throw error;
      return data as { ok: boolean; afetadas: number; aplicado_agora?: boolean };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin-reajustes-catalogo"] });
      qc.invalidateQueries({ queryKey: ["admin-reajuste-historico"] });
      qc.invalidateQueries({ queryKey: ["admin-planos"] });
      qc.invalidateQueries({ queryKey: ["admin-modulos"] });
      qc.invalidateQueries({ queryKey: ["admin-assinaturas"] });
      toast.success(`Reajuste salvo para ${result.afetadas} empresa(s).`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAdminReajusteHistorico() {
  return useQuery({
    queryKey: ["admin-reajuste-historico"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_reajuste_historico", { _limit: 100 });
      if (error) throw error;
      return (data ?? []) as ReajusteHistoricoRow[];
    },
  });
}

export function useAdminPrecoAssinatura(empresaId?: string) {
  return useQuery({
    queryKey: ["admin-preco-assinatura", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_obter_preco_assinatura", { _empresa_id: empresaId });
      if (error) throw error;
      return data as { valor_contratado: number | null; valor_personalizado: boolean; proximo_valor: number | null; reajuste_vigencia: string | null };
    },
  });
}

export function useAdminSetPrecoAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { empresa_id: string; valor: number; personalizado: boolean; motivo?: string }) => {
      const { error } = await (supabase.rpc as any)("admin_set_preco_assinatura", {
        _empresa_id: input.empresa_id, _valor: input.valor,
        _personalizado: input.personalizado, _motivo: input.motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-preco-assinatura"] });
      qc.invalidateQueries({ queryKey: ["admin-reajustes-catalogo"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAdminSetPrecoModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { empresa_id: string; modulo_id: string; valor: number; personalizado: boolean }) => {
      const { error } = await (supabase.rpc as any)("admin_set_preco_modulo", {
        _empresa_id: input.empresa_id, _modulo_id: input.modulo_id,
        _valor: input.valor, _personalizado: input.personalizado, _motivo: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-empresa-modulos"] });
      qc.invalidateQueries({ queryKey: ["admin-reajustes-catalogo"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAdminPrecosModulos(empresaId?: string) {
  return useQuery({
    queryKey: ["admin-precos-modulos", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_obter_precos_modulos", { _empresa_id: empresaId });
      if (error) throw error;
      return (data ?? []) as Array<{
        modulo_id: string;
        valor_contratado: number;
        valor_personalizado: boolean;
        proximo_valor: number | null;
        reajuste_vigencia: string | null;
      }>;
    },
  });
}

/* =========================================================
 * MINHA ASSINATURA (usado pelo ERP)
 * =======================================================*/
export type MinhaAssinatura = {
  status: AssinaturaStatus | "active" | "pending_payment" | "overdue" | "expired" | "canceled";
  readonly: boolean;
  limited?: boolean;
  dias_restantes: number;
  dias_atraso?: number;
  tem_pendente?: boolean;
  data_inicio?: string | null;
  data_expiracao?: string | null;
  plano_id?: string | null;
  sem_empresa?: boolean;
};

export function useMinhaAssinatura() {
  return useQuery({
    queryKey: ["minha-assinatura"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("minha_assinatura_status");
      if (error) throw error;
      return data as unknown as MinhaAssinatura;
    },
  });
}

/* =========================================================
 * MEUS MÓDULOS (gating no ERP)
 * =======================================================*/
export type MeuModulo = {
  modulo_id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  valor: number;
  aplica_restricao: boolean;
  liberado: boolean;
  origem: "ativo" | "trial" | "sem_restricao" | "bloqueado";
};

export function useMeusModulos() {
  return useQuery({
    queryKey: ["meus-modulos"],
    staleTime: 60_000,
    queryFn: async (): Promise<MeuModulo[]> => {
      const { data, error } = await (supabase.rpc as any)("meus_modulos");
      if (error) throw error;
      return (data ?? []) as MeuModulo[];
    },
  });
}

/** Retorna o estado de um módulo específico pela chave. */
export function useModulo(chave: string) {
  const { data, isLoading } = useMeusModulos();
  const modulo = data?.find((m) => m.chave === chave);
  return {
    isLoading,
    modulo,
    liberado: modulo?.liberado ?? false,
    origem: modulo?.origem ?? "bloqueado",
  };
}

/* =========================================================
 * MODOS DO SISTEMA
 * =======================================================*/
export type SystemModeTipo = "admin" | "operador";

export type SystemMode = {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  rota_inicial: string;
  tipo: SystemModeTipo;
  ativo: boolean;
  ordem: number;
  icone: string | null;
  modulos: { id: string; chave: string; nome: string }[];
};

export type ModoDisponivel = {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  rota_inicial: string;
  tipo: SystemModeTipo;
  icone: string | null;
};

const MODOS_CACHE_KEY = "gp.desktop.modos_disponiveis.v1";
const OFFLINE_USER_STORAGE_KEY = "gp.auth.offline_user.v1";

type ModosDisponiveisCache = {
  user_id: string | null;
  email: string | null;
  modos: ModoDisponivel[];
  synced_at_ms: number;
};

function loadOfflineUserHint(): { id: string | null; email: string | null } {
  if (typeof window === "undefined") return { id: null, email: null };
  try {
    const raw = window.localStorage.getItem(OFFLINE_USER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      id: typeof parsed?.id === "string" ? parsed.id : null,
      email: typeof parsed?.email === "string" ? parsed.email : null,
    };
  } catch {
    return { id: null, email: null };
  }
}

function loadCachedModosDisponiveis(): ModoDisponivel[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MODOS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ModosDisponiveisCache>) : null;
    if (!parsed || !Array.isArray(parsed.modos)) return null;
    const offline = loadOfflineUserHint();
    if (offline.id && parsed.user_id && offline.id !== parsed.user_id) return null;
    if (offline.email && parsed.email && offline.email !== parsed.email) return null;
    return parsed.modos as ModoDisponivel[];
  } catch {
    return null;
  }
}

async function cacheModosDisponiveis(modos: ModoDisponivel[]) {
  if (!isDesktop() || typeof window === "undefined") return;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    window.localStorage.setItem(
      MODOS_CACHE_KEY,
      JSON.stringify({
        user_id: user?.id ?? null,
        email: user?.email ?? null,
        modos,
        synced_at_ms: Date.now(),
      } satisfies ModosDisponiveisCache),
    );
  } catch {
    /* cache best-effort */
  }
}

/** Lista todos os modos (admin) com módulos vinculados. */
export function useAdminModos() {
  return useQuery({
    queryKey: ["admin-modos"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_modos_listar");
      if (error) throw error;
      return (data ?? []) as SystemMode[];
    },
  });
}

/** Lista modos ativos para tela de escolha. */
export function useModosDisponiveis() {
  return useQuery({
    queryKey: ["modos-disponiveis"],
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("modos_disponiveis");
        if (error) throw error;
        const modos = (data ?? []) as ModoDisponivel[];
        await cacheModosDisponiveis(modos);
        return modos;
      } catch (error) {
        if (isDesktop()) {
          const cached = loadCachedModosDisponiveis();
          if (cached) return cached;
        }
        throw error;
      }
    },
  });
}

export function useUpsertModo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string | null;
      chave: string;
      nome: string;
      descricao?: string | null;
      rota_inicial: string;
      tipo: SystemModeTipo;
      ativo: boolean;
      ordem?: number;
      icone?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("admin_modo_upsert", {
        _id: input.id,
        _chave: input.chave,
        _nome: input.nome,
        _descricao: input.descricao ?? null,
        _rota_inicial: input.rota_inicial,
        _tipo: input.tipo,
        _ativo: input.ativo,
        _ordem: input.ordem ?? 0,
        _icone: input.icone ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modos"] });
      qc.invalidateQueries({ queryKey: ["modos-disponiveis"] });
      toast.success("Modo salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteModo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("admin_modo_deletar", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modos"] });
      qc.invalidateQueries({ queryKey: ["modos-disponiveis"] });
      toast.success("Modo excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetModoModulos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { mode_id: string; module_ids: string[] }) => {
      const { error } = await (supabase.rpc as any)("admin_modo_set_modulos", {
        _mode_id: input.mode_id,
        _module_ids: input.module_ids,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modos"] });
      toast.success("Vínculos atualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

