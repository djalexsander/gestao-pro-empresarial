import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import { dataClient } from "@/integrations/data";
import { useAuth } from "@/components/auth/AuthProvider";
import type {
  EmpresaAcessivelDomain,
  EmpresaPapelDomain,
} from "@/integrations/data/extra-adapters";

export type EmpresaPapel = EmpresaPapelDomain;
export type EmpresaAcessivel = EmpresaAcessivelDomain;

const STORAGE_KEY = "empresa_atual_id";

/** Lista todas as empresas que o usuário acessa (dono OU membro) */
export function useEmpresasAcessiveis() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["empresas_acessiveis", user?.id],
    enabled: !!user?.id,
    queryFn: () => dataClient.empresa.acessiveis(user!.id),
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
