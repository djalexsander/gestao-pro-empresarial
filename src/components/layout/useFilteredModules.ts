import { useMemo } from "react";
import { MODULES, type ModuleDef } from "./navigation";
import { useEmpresaAtual, podeVerFinanceiro } from "@/hooks/useEmpresa";
import { useMeusModulos } from "@/hooks/useSaasAdmin";

/**
 * Retorna a lista de módulos da navegação:
 * - Filtra por papel do usuário (ex.: gerente operacional não vê financeiro)
 * - Esconde itens vinculados a um módulo SaaS que NÃO esteja liberado
 *   (módulo bloqueado/pendente/cancelado e fora do trial)
 */
export function useFilteredModules(): ModuleDef[] {
  const { papel } = useEmpresaAtual();
  const { data: meusModulos = [] } = useMeusModulos();

  return useMemo(() => {
    // 1. Filtro por papel
    const base = podeVerFinanceiro(papel)
      ? MODULES
      : MODULES.filter((m) => m.key !== "financeiro");

    // 2. Conjunto de chaves liberadas (contratado + trial)
    const liberadas = new Set(
      meusModulos.filter((m) => m.liberado).map((m) => m.chave),
    );

    // 3. Esconde itens com moduloChave não liberado.
    //    Itens sem moduloChave sempre aparecem (não são pagos).
    return base
      .map((mod) => ({
        ...mod,
        items: mod.items.filter(
          (it) => !it.moduloChave || liberadas.has(it.moduloChave),
        ),
      }))
      .filter((mod) => mod.items.length > 0);
  }, [papel, meusModulos]);
}
