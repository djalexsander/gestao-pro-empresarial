import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type AppRole = "super_admin" | "admin" | "gerente" | "caixa" | "vendedor" | "financeiro";

/**
 * Retorna todos os papéis (roles) do usuário autenticado.
 * Resultado em cache por 60s. Considera ausência de roles como [].
 */
export function useUserRoles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-roles", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<AppRole[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) return [];
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
}

/**
 * Rotas que o operador `caixa` pode acessar dentro do ERP/menu lateral.
 * Além dessas, o caixa sempre pode acessar /pos e /pdv (frente de caixa).
 * Mantenha em sincronia com `useFilteredModules` e `RequireAdminLike`.
 */
export const CAIXA_ALLOWED_BASES = [
  "/pos",
  "/pdv",
  "/produtos-vendidos",
  "/produtos",
  "/estoque",
  "/compras",
];

/** Verifica se um pathname está na whitelist do operador de caixa. */
export function isCaixaAllowedPath(pathname: string): boolean {
  return CAIXA_ALLOWED_BASES.some((base) => pathname === base || pathname.startsWith(base + "/"));
}

/**
 * Helpers de papéis. `isAdminLike` libera acesso ao ERP completo.
 * Operadores `caixa` ficam restritos a /pos, /pdv, /produtos-vendidos, /produtos, /estoque, /compras.
 */
export function useUserRole() {
  const { data: roles = [], isLoading } = useUserRoles();
  const has = (r: AppRole) => roles.includes(r);

  const isSuperAdmin = has("super_admin");
  const isAdmin = has("admin");
  const isGerente = has("gerente");
  const isCaixa = has("caixa");

  // Quem pode acessar o ERP completo
  const isAdminLike = isSuperAdmin || isAdmin || isGerente || roles.length === 0;
  // Quem é restrito (caixa sem outro papel administrativo)
  const isCaixaOnly = isCaixa && !isAdminLike;

  return {
    roles,
    isLoading,
    isSuperAdmin,
    isAdmin,
    isGerente,
    isCaixa,
    isAdminLike,
    isCaixaOnly,
    has,
  };
}
