/**
 * ============================================================================
 * Desktop Terminal — regras de navegação
 * ============================================================================
 *
 * Quando a máquina é `desktop-terminal`, restringimos a navegação a:
 *  - PDV (/pos, /pdv)
 *  - Consultas operacionais: /produtos-vendidos, /produtos, /estoque, /clientes
 *  - Configurações apenas do próprio terminal (/configuracoes — a aba Desktop)
 *  - Auth/hub (sempre liberados)
 *
 * Bloqueamos: financeiro, relatórios gerenciais, vendas (gestão), compras,
 * fornecedores, caixa (gestão), painel master, módulos/planos.
 *
 * Em `server` ou web, nada é restringido aqui.
 */

const TERMINAL_ROTAS_PERMITIDAS = [
  "/auth",
  "/hub",
  "/pos",
  "/pdv",
  "/produtos-vendidos",
  "/produtos",
  "/estoque",
  "/clientes",
  "/configuracoes",
];

export function isTerminalPathAllowed(pathname: string): boolean {
  if (!pathname) return false;
  return TERMINAL_ROTAS_PERMITIDAS.some((base) => {
    if (pathname === base) return true;
    return pathname.startsWith(base + "/") || pathname.startsWith(base + "?");
  });
}

/** Rota inicial padrão no modo terminal. */
export const TERMINAL_HOME = "/pos";
