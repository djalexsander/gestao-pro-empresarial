import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type EmpresaPapel = "owner" | "admin" | "gerente_operacional";

export interface EmpresaAcessivel {
  id: string;
  nome: string;
  owner_id: string;
  papel: EmpresaPapel;
}

const STORAGE_KEY = "empresa_atual_id";

/** Lista todas as empresas que o usuário acessa (dono OU membro) */
export function useEmpresasAcessiveis() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["empresas_acessiveis", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<EmpresaAcessivel[]> => {
      // Busca empresas onde é dono
      const { data: proprias } = await supabase
        .from("empresas")
        .select("id, nome, owner_id")
        .eq("owner_id", user!.id);

      // Busca empresas onde é membro
      const { data: memberships } = await supabase
        .from("empresa_membros")
        .select("papel, empresa:empresas(id, nome, owner_id)")
        .eq("user_id", user!.id);

      const map = new Map<string, EmpresaAcessivel>();

      (proprias || []).forEach((e) => {
        map.set(e.id, {
          id: e.id,
          nome: e.nome,
          owner_id: e.owner_id,
          papel: "owner",
        });
      });

      (memberships || []).forEach((m: any) => {
        if (!m.empresa) return;
        // Se já está como owner, não sobrescreve
        if (!map.has(m.empresa.id)) {
          map.set(m.empresa.id, {
            id: m.empresa.id,
            nome: m.empresa.nome,
            owner_id: m.empresa.owner_id,
            papel: m.papel as EmpresaPapel,
          });
        }
      });

      return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });
}

/** Hook principal: retorna a empresa ativa e função para alternar */
export function useEmpresaAtual() {
  const { data: empresas = [], isLoading } = useEmpresasAcessiveis();
  const [empresaId, setEmpresaIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  // Garante que a empresa salva ainda existe na lista — senão usa a primeira
  useEffect(() => {
    if (empresas.length === 0) return;
    if (!empresaId || !empresas.find((e) => e.id === empresaId)) {
      const fallback = empresas[0].id;
      setEmpresaIdState(fallback);
      localStorage.setItem(STORAGE_KEY, fallback);
    }
  }, [empresas, empresaId]);

  const setEmpresaId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setEmpresaIdState(id);
    // Recarrega para reaplicar todas as queries com novo contexto
    window.location.reload();
  }, []);

  const empresaAtual = empresas.find((e) => e.id === empresaId) || empresas[0] || null;

  return {
    empresaAtual,
    empresas,
    empresaId: empresaAtual?.id ?? null,
    papel: empresaAtual?.papel ?? null,
    setEmpresaId,
    isLoading,
  };
}

/** Helpers de permissão */
export function podeVerFinanceiro(papel: EmpresaPapel | null): boolean {
  return papel === "owner" || papel === "admin";
}

export function podeGerenciarMembros(papel: EmpresaPapel | null): boolean {
  return papel === "owner";
}

export function podeGerenciarPlano(papel: EmpresaPapel | null): boolean {
  return papel === "owner";
}
