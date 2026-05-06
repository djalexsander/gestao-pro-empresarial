import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data/client";
import { useAuth } from "@/components/auth/AuthProvider";
import type {
  AdminEmpresaDomain,
  AdminStatsDomain,
  AdminUserDomain,
  AuditLogDomain,
  EmpresaPlanoAdminDomain,
  EmpresaStatusAdminDomain,
  SerieCrescimentoDomain,
} from "@/integrations/data/extra-adapters";

export type AppRole = "super_admin" | "admin" | "gerente" | "vendedor" | "financeiro";
export type EmpresaStatus = EmpresaStatusAdminDomain;
export type EmpresaPlano = EmpresaPlanoAdminDomain;

export type AdminUser = AdminUserDomain;
export type AdminEmpresa = AdminEmpresaDomain;
export type AdminStats = AdminStatsDomain;
export type AuditLog = AuditLogDomain;
export type SerieCrescimento = SerieCrescimentoDomain;

/* =========================================================
 * DETECÇÃO DE ROLE
 * =======================================================*/
export function useIsSuperAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-super-admin", user?.id],
    enabled: !!user,
    queryFn: () => dataClient.admin.isSuperAdmin(user!.id),
  });
}

/* =========================================================
 * STATS / SÉRIES
 * =======================================================*/
export function useAdminStats() {
  return useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => dataClient.admin.stats(),
  });
}

export function useAdminSerieCrescimento(dias = 30) {
  return useQuery({
    queryKey: ["admin-serie-crescimento", dias],
    queryFn: () => dataClient.admin.serieCrescimento(dias),
  });
}

/* =========================================================
 * USUÁRIOS
 * =======================================================*/
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => dataClient.admin.listarUsuarios(),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: AppRole; grant: boolean }) =>
      dataClient.admin.setUserRole(input),
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
    mutationFn: (userId: string) => dataClient.admin.deleteUser(userId),
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
    queryFn: () => dataClient.admin.listarEmpresas(),
  });
}

export function useUpsertEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      nome: string;
      email?: string | null;
      telefone?: string | null;
      documento?: string | null;
      plano?: EmpresaPlano;
      observacoes?: string | null;
    }) => dataClient.admin.upsertEmpresa(input),
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
    mutationFn: (input: { id: string; status: EmpresaStatus; motivo?: string }) =>
      dataClient.admin.setEmpresaStatus(input),
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
    mutationFn: (id: string) => dataClient.admin.deleteEmpresa(id),
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
    queryFn: () => dataClient.admin.auditLogs(limit),
  });
}

/** Helper para registrar eventos do client (login, logout etc) */
export async function registrarAuditLog(
  action: string,
  options?: { target_type?: string; target_id?: string; metadata?: Record<string, unknown> }
) {
  await dataClient.admin.registrarAuditLog({
    action,
    target_type: options?.target_type,
    target_id: options?.target_id,
    metadata: options?.metadata ?? {},
  });
}
