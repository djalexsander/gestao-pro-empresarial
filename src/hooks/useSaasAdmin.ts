import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data/client";

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

/* =========================================================
 * PLANOS
 * =======================================================*/
export function useAdminPlanos() {
  return useQuery({
    queryKey: ["admin-planos"],
    queryFn: async () => (await dataClient.saasAdmin.listarPlanos()) as Plano[],
  });
}

export function useUpsertPlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string | null;
      nome: string;
      descricao?: string | null;
      valor: number;
      tipo_cobranca: PlanoTipoCobranca;
      limite_usuarios?: number | null;
      limite_produtos?: number | null;
      ativo: boolean;
      ordem?: number;
    }) =>
      dataClient.saasAdmin.upsertPlano({
        _id: input.id,
        _nome: input.nome,
        _descricao: input.descricao ?? null,
        _valor: input.valor,
        _tipo_cobranca: input.tipo_cobranca,
        _limite_usuarios: input.limite_usuarios ?? null,
        _limite_produtos: input.limite_produtos ?? null,
        _ativo: input.ativo,
        _ordem: input.ordem ?? 0,
      }),
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
    mutationFn: (id: string) => dataClient.saasAdmin.deletePlano(id),
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
    queryFn: async () => (await dataClient.saasAdmin.listarModulos()) as Modulo[],
  });
}

export function useUpsertModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string | null;
      nome: string;
      chave: string;
      descricao?: string | null;
      valor: number;
      ativo: boolean;
      aplica_restricao: boolean;
      ordem?: number;
    }) =>
      dataClient.saasAdmin.upsertModulo({
        _id: input.id,
        _nome: input.nome,
        _chave: input.chave,
        _descricao: input.descricao ?? null,
        _valor: input.valor,
        _ativo: input.ativo,
        _aplica_restricao: input.aplica_restricao,
        _ordem: input.ordem ?? 0,
      }),
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
    mutationFn: (id: string) => dataClient.saasAdmin.deleteModulo(id),
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
    queryFn: async () => (await dataClient.saasAdmin.listarAssinaturas()) as AssinaturaRow[],
  });
}

export function useSetAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      empresa_id: string;
      plano_id: string | null;
      status: AssinaturaStatus;
      data_inicio?: string | null;
      data_expiracao?: string | null;
      observacoes?: string | null;
    }) =>
      dataClient.saasAdmin.setAssinatura({
        _empresa_id: input.empresa_id,
        _plano_id: input.plano_id,
        _status: input.status,
        _data_inicio: input.data_inicio ?? null,
        _data_expiracao: input.data_expiracao ?? null,
        _observacoes: input.observacoes ?? null,
      }),
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
    queryFn: async () =>
      (await dataClient.saasAdmin.listarEmpresaModulos(empresaId ?? null)) as EmpresaModuloRow[],
  });
}

export function useSetEmpresaModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      empresa_id: string;
      modulo_id: string;
      status: EmpresaModuloStatus;
      data_inicio?: string | null;
      data_expiracao?: string | null;
      observacoes?: string | null;
    }) =>
      dataClient.saasAdmin.setEmpresaModulo({
        _empresa_id: input.empresa_id,
        _modulo_id: input.modulo_id,
        _status: input.status,
        _data_inicio: input.data_inicio ?? null,
        _data_expiracao: input.data_expiracao ?? null,
        _observacoes: input.observacoes ?? null,
      }),
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
    mutationFn: (id: string) => dataClient.saasAdmin.removerEmpresaModulo(id),
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
    queryFn: async () =>
      (await dataClient.saasAdmin.listarPagamentos(empresaId ?? null)) as PagamentoRow[],
  });
}

export function useUpsertPagamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
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
    }) =>
      dataClient.saasAdmin.upsertPagamento({
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
      }),
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
    mutationFn: (id: string) => dataClient.saasAdmin.deletePagamento(id),
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
    queryFn: async () => (await dataClient.saasAdmin.obterConfigComercial()) as ConfigComercial,
  });
}

export function useSetConfigComercial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      dias_trial: number;
      permitir_modulos_no_trial: boolean;
      plano_padrao_id: string | null;
      valor_padrao_sistema: number;
      asaas_enabled?: boolean;
      asaas_ambiente?: "sandbox" | "producao";
    }) =>
      dataClient.saasAdmin.setConfigComercial({
        _dias_trial: input.dias_trial,
        _permitir_modulos_no_trial: input.permitir_modulos_no_trial,
        _plano_padrao_id: input.plano_padrao_id,
        _valor_padrao_sistema: input.valor_padrao_sistema,
        _asaas_enabled: input.asaas_enabled ?? null,
        _asaas_ambiente: input.asaas_ambiente ?? null,
      }),
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
    queryFn: async () => (await dataClient.saasAdmin.minhaAssinatura()) as MinhaAssinatura,
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
    queryFn: async (): Promise<MeuModulo[]> =>
      (await dataClient.saasAdmin.meusModulos()) as MeuModulo[],
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

/** Lista todos os modos (admin) com módulos vinculados. */
export function useAdminModos() {
  return useQuery({
    queryKey: ["admin-modos"],
    queryFn: async () => (await dataClient.saasAdmin.listarModos()) as SystemMode[],
  });
}

/** Lista modos ativos para tela de escolha. */
export function useModosDisponiveis() {
  return useQuery({
    queryKey: ["modos-disponiveis"],
    staleTime: 60_000,
    queryFn: async () => (await dataClient.saasAdmin.modosDisponiveis()) as ModoDisponivel[],
  });
}

export function useUpsertModo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string | null;
      chave: string;
      nome: string;
      descricao?: string | null;
      rota_inicial: string;
      tipo: SystemModeTipo;
      ativo: boolean;
      ordem?: number;
      icone?: string | null;
    }) =>
      dataClient.saasAdmin.upsertModo({
        _id: input.id,
        _chave: input.chave,
        _nome: input.nome,
        _descricao: input.descricao ?? null,
        _rota_inicial: input.rota_inicial,
        _tipo: input.tipo,
        _ativo: input.ativo,
        _ordem: input.ordem ?? 0,
        _icone: input.icone ?? null,
      }),
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
    mutationFn: (id: string) => dataClient.saasAdmin.deleteModo(id),
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
    mutationFn: (input: { mode_id: string; module_ids: string[] }) =>
      dataClient.saasAdmin.setModoModulos(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modos"] });
      toast.success("Vínculos atualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
