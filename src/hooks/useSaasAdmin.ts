import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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
  updated_at: string;
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
    }) => {
      const { error } = await (supabase.rpc as any)("admin_set_config_comercial", {
        _dias_trial: input.dias_trial,
        _permitir_modulos_no_trial: input.permitir_modulos_no_trial,
        _plano_padrao_id: input.plano_padrao_id,
        _valor_padrao_sistema: input.valor_padrao_sistema,
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
 * MINHA ASSINATURA (usado pelo ERP)
 * =======================================================*/
export type MinhaAssinatura = {
  status: AssinaturaStatus;
  readonly: boolean;
  dias_restantes: number;
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
