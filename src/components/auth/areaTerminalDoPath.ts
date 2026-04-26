import type { AreaTerminal } from "@/components/auth/RequireTerminalPermissao";

/**
 * Mapeia o pathname para a área de permissão correspondente do terminal.
 * Retorna null para rotas neutras (auth, hub) que não devem ser bloqueadas
 * pela permissão de terminal.
 */
export function areaTerminalDoPath(pathname: string): AreaTerminal | null {
  if (pathname === "/pos" || pathname === "/pdv") return "pdv";
  if (pathname.startsWith("/admin")) return "erp";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  if (pathname.startsWith("/relatorios")) return "relatorios";
  if (
    pathname.startsWith("/produtos") ||
    pathname.startsWith("/clientes") ||
    pathname.startsWith("/fornecedores") ||
    pathname.startsWith("/estoque") ||
    pathname.startsWith("/compras")
  )
    return "cadastros";
  // index, hub, auth, vendas, caixa → sem restrição extra de terminal
  return null;
}
