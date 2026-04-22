import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type AppRole = "super_admin" | "admin" | "gerente" | "vendedor" | "financeiro";

export type AdminUser = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  roles: string[];
  total_produtos: number;
  total_vendas: number;
  total_compras: number;
};

export type AdminStats = {
  total_usuarios: number;
  usuarios_30d: number;
  usuarios_7d: number;
  usuarios_confirmados: number;
  total_empresas: number;
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

/** Detecta se o usuário logado é super_admin */
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

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      role,
      grant,
    }: {
      userId: string;
      role: AppRole;
      grant: boolean;
    }) => {
      const { error } = await supabase.rpc("admin_set_user_role", {
        _user_id: userId,
        _role: role,
        _grant: grant,
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
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
      toast.success("Usuário removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
