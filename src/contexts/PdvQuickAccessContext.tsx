import { createContext, useContext, type ReactNode } from "react";

/**
 * Marca quando uma rota/módulo foi aberto via "Acesso rápido" do PDV (F3).
 * Componentes podem ler `usePdvQuickAccess()` para aplicar restrições
 * (ex.: em Compras o caixa só pode receber mercadorias).
 */
const PdvQuickAccessContext = createContext<boolean>(false);

export function PdvQuickAccessProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <PdvQuickAccessContext.Provider value={active}>
      {children}
    </PdvQuickAccessContext.Provider>
  );
}

export function usePdvQuickAccess(): boolean {
  return useContext(PdvQuickAccessContext);
}

export const PDV_QUICK_BLOCK_MSG =
  "No acesso rápido do PDV, o caixa pode apenas receber mercadorias. Para criar, editar ou cancelar compras, acesse o módulo Compras pelo menu principal com permissão administrativa.";
