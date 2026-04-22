import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type AppRole = "super_admin" | "admin" | "gerente" | "vendedor" | "financeiro";
export type EmpresaStatus = "ativa" | "inativa" | "bloqueada";
export type EmpresaPlano = "free" | "starter" | "pro" | "enterprise";

export type AdminUser = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  roles: string[];
  empresa_id: string | null;
  empresa_nome: string | null;
  empresa_status: EmpresaStatus | null;
  empresa_plano: EmpresaPlano | null;
  total_produtos: number;
  total_vendas: number;
  total_compras: number;
};

export type AdminEmpresa = {
  id: string;
  owner_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  documento: string | null;
  status: EmpresaStatus;
  plano: EmpresaPlano;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
  total_usuarios: number;
  total_produtos: number;
  total_vendas: number;
  total_compras: number;
  total_movimentacoes: number;
  volume_vendas: number;
  volume_compras: number;
};

export type AdminStats = {
  total_usuarios: number;
  usuarios_30d: number;
  usuarios_7d: number;
  usuarios_confirmados: number;
  usuarios_ativos_30d: number;
  total_empresas: number;
  empresas_ativas: number;
  empresas_inativas: number;
  empresas_bloqueadas: number;
  empresas_30d: number;
  empresas_7d: number;
  total_produtos: number;
  total_clientes: number;
  total_fornecedores: number;
  total_vendas: number;
  total_compras: number;
  total_movimentacoes: number;
  volume_vendas_total: number;
  volume_compras_total: number;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type SerieCrescimento = {
  data: string;
  novos_usuarios: number;
  novas_empresas: number;
  total_usuarios_acum: number;
  total_empresas_acum: number;
};

/* =========================================================
 * DETECÇÃO DE ROLE
 * =======================================================*/
export function useIsSuperAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-super-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "super_admin")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
  });
}

/* =========================================================
 * STATS / SÉRIES
 * =======================================================*/
export function useAdminStats() {
  return useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_estatisticas_globais");
      if (error) throw error;
      return data as unknown as AdminStats;
    },
  });
}

export function useAdminSerieCrescimento(dias = 30) {
  return useQuery({
    queryKey: ["admin-serie-crescimento", dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_serie_crescimento", { _dias: dias });
      if (error) throw error;
      return (data ?? []) as SerieCrescimento[];
    },
  });
}

/* =========================================================
 * USUÁRIOS
 * =======================================================*/
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_listar_usuarios");
      if (error) throw error;
      return (data ?? []) as AdminUser[];
    },
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId, role, grant,
    }: { userId: string; role: AppRole; grant: boolean }) => {
      const { error } = await supabase.rpc("admin_set_user_role", {
        _user_id: userId, _role: role, _grant: grant,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
      toast.success("Papel atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_delete_user", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-empresas"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
      toast.success("Usuário removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * EMPRESAS
 * =======================================================*/
export function useAdminEmpresas() {
  return useQuery({
    queryKey: ["admin-empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_listar_empresas");
      if (error) throw error;
      return (data ?? []) as AdminEmpresa[];
    },
  });
}

export function useUpsertEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      nome: string;
      email?: string | null;
      telefone?: string | null;
      documento?: string | null;
      plano?: EmpresaPlano;
      observacoes?: string | null;
    }) => {
      const { error } = await supabase.rpc("admin_upsert_empresa", {
        _id: input.id,
        _nome: input.nome,
        _email: input.email ?? null,
        _telefone: input.telefone ?? null,
        _documento: input.documento ?? null,
        _plano: input.plano ?? "free",
        _observacoes: input.observacoes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-empresas"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
      toast.success("Empresa atualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetEmpresaStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: EmpresaStatus; motivo?: string }) => {
      const { error } = await supabase.rpc("admin_set_empresa_status", {
        _id: input.id, _status: input.status, _motivo: input.motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-empresas"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
      toast.success("Status atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_delete_empresa", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-empresas"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
      toast.success("Empresa excluída.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * AUDITORIA
 * =======================================================*/
export function useAdminAuditLogs(limit = 200) {
  return useQuery({
    queryKey: ["admin-audit-logs", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_listar_audit_logs", { _limit: limit });
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });
}

/** Helper para registrar eventos do client (login, logout etc) */
export async function registrarAuditLog(
  action: string,
  options?: { target_type?: string; target_id?: string; metadata?: Record<string, unknown> }
) {
  try {
    await supabase.rpc("registrar_audit_log", {
      _action: action,
      _target_type: options?.target_type ?? null,
      _target_id: options?.target_id ?? null,
      _metadata: (options?.metadata ?? {}) as never,
    });
  } catch {
    /* silencioso */
  }
}
