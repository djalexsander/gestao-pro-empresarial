import { useMemo } from "react";
import { MODULES, type ModuleDef } from "./navigation";
import { useEmpresaAtual, podeVerFinanceiro } from "@/hooks/useEmpresa";

/** Retorna a lista de módulos filtrada de acordo com o papel do usuário na empresa atual */
export function useFilteredModules(): ModuleDef[] {
  const { papel } = useEmpresaAtual();
  return useMemo(() => {
    if (podeVerFinanceiro(papel)) return MODULES;
    // Gerente operacional: remove módulo financeiro inteiro
    return MODULES.filter((m) => m.key !== "financeiro");
  }, [papel]);
}
