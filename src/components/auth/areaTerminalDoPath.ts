import type { AreaTerminal } from "@/components/auth/RequireTerminalPermissao";

/**
 * Mapeia o pathname para a área de permissão correspondente do terminal.
 * Retorna null para rotas neutras (auth, hub) que não devem ser bloqueadas
 * pela permissão de terminal.
 */
export function areaTerminalDoPath(pathname: string): AreaTerminal | null {
  if (pathname === "/pos" || pathname === "/pdv") return "pdv";
  const startsWithSeg = (seg: string) =>
    pathname === seg || pathname.startsWith(seg + "/");
  if (startsWithSeg("/admin")) return "erp";
  if (startsWithSeg("/financeiro")) return "financeiro";
  if (startsWithSeg("/configuracoes")) return "configuracoes";
  if (startsWithSeg("/relatorios")) return "relatorios";
  // /produtos-vendidos é relatório de vendas, não cadastro — não aplica restrição de cadastros
  if (startsWithSeg("/produtos-vendidos")) return null;
  if (
    startsWithSeg("/produtos") ||
    startsWithSeg("/clientes") ||
    startsWithSeg("/fornecedores") ||
    startsWithSeg("/estoque") ||
    startsWithSeg("/compras")
  )
    return "cadastros";
  // index, hub, auth, vendas, caixa → sem restrição extra de terminal
  return null;
}
