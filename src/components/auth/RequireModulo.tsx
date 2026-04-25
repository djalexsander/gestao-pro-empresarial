import { ReactNode } from "react";
import { ModuloGate } from "@/components/saas/ModuloGate";

interface RequireModuloProps {
  /** Chave técnica do módulo (ex.: "financeiro_avancado", "relatorios_dre") */
  chave: string;
  /** Título amigável exibido na tela de bloqueio */
  titulo?: string;
  children: ReactNode;
}

/**
 * Guarda de rota baseada em módulo SaaS.
 * - Liberado (contratado ou trial) → renderiza children.
 * - Bloqueado → exibe CTA "Ativar módulo" via ModuloGate.
 *
 * Uso típico em rotas:
 *   component: () => (
 *     <RequireModulo chave="financeiro_avancado">
 *       <FinanceiroPage />
 *     </RequireModulo>
 *   )
 */
export function RequireModulo({ chave, titulo, children }: RequireModuloProps) {
  return (
    <ModuloGate chave={chave} titulo={titulo}>
      {children}
    </ModuloGate>
  );
}
