import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Receipt,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  Truck,
  Users,
  BarChart3,
  Settings,
  CircleDollarSign,
  TrendingUp,
  CreditCard,
  HandCoins,
  type LucideIcon,
} from "lucide-react";

export type ModuleKey =
  | "principal"
  | "operacional"
  | "financeiro"
  | "cadastros"
  | "analise"
  | "configuracoes";

export interface ModuleItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  /**
   * Chave técnica do módulo SaaS (tabela `modulos.chave`).
   * Quando definida, o item só aparece no menu se o módulo estiver liberado
   * (contratado ou em trial). Use junto com <RequireModulo> nas rotas.
   */
  moduloChave?: string;
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  /** Quando o módulo só tem 1 item, clicar no menu superior leva direto para a rota */
  directRoute?: string;
  items: ModuleItem[];
}

export const MODULES: ModuleDef[] = [
  {
    key: "principal",
    label: "Principal",
    directRoute: "/",
    items: [
      {
        to: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        description: "Visão geral do negócio",
      },
    ],
  },
  {
    key: "operacional",
    label: "Operacional",
    items: [
      { to: "/produtos", label: "Produtos", icon: Package, description: "Catálogo e cadastro" },
      { to: "/estoque", label: "Estoque", icon: Boxes, description: "Movimentações e saldos" },
      {
        to: "/compras",
        label: "Compras",
        icon: ShoppingCart,
        description: "Pedidos a fornecedores",
      },
      { to: "/vendas", label: "Vendas", icon: Receipt, description: "Pedidos e faturamento" },
      {
        to: "/caixa",
        label: "Caixa",
        icon: CircleDollarSign,
        description: "Abertura, operação e fechamento",
      },
      {
        to: "/produtos-vendidos",
        label: "Produtos vendidos",
        icon: BarChart3,
        description: "Consulta por dia/período",
      },
    ],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    items: [
      { to: "/financeiro", label: "Financeiro", icon: Wallet, description: "Visão geral" },
      {
        to: "/financeiro?tab=pagar",
        label: "Contas a pagar",
        icon: ArrowUpFromLine,
        description: "Despesas e fornecedores",
      },
      {
        to: "/financeiro?tab=receber",
        label: "Contas a receber",
        icon: ArrowDownToLine,
        description: "Recebíveis de clientes",
      },
      {
        to: "/financeiro?tab=fluxo",
        label: "Fluxo de caixa",
        icon: TrendingUp,
        description: "Entradas e saídas no tempo",
      },
      {
        to: "/fiado",
        label: "Clientes a Receber",
        icon: HandCoins,
        description: "Carteira de recebimentos pendentes",
      },
    ],
  },
  {
    key: "cadastros",
    label: "Cadastros",
    items: [
      {
        to: "/fornecedores",
        label: "Fornecedores",
        icon: Truck,
        description: "Parceiros e compras",
      },
      { to: "/clientes", label: "Clientes", icon: Users, description: "Base de clientes" },
    ],
  },
  {
    key: "analise",
    label: "Análise",
    directRoute: "/relatorios",
    items: [
      {
        to: "/relatorios",
        label: "Relatórios",
        icon: BarChart3,
        description: "Indicadores e exports",
      },
    ],
  },
  {
    key: "configuracoes",
    label: "Configurações",
    items: [
      {
        to: "/configuracoes",
        label: "Configurações",
        icon: Settings,
        description: "Ajustes do sistema",
      },
      {
        to: "/modulos",
        label: "Meu Plano",
        icon: CreditCard,
        description: "Plano e módulos contratados",
      },
    ],
  },
];

/** Descobre qual módulo está ativo a partir do pathname atual */
export function findModuleByPath(pathname: string): ModuleDef {
  if (pathname === "/" || pathname === "") return MODULES[0];
  // Match por prefixo de rota base
  for (const mod of MODULES) {
    for (const item of mod.items) {
      const base = item.to.split("?")[0];
      if (base !== "/" && (pathname === base || pathname.startsWith(base + "/"))) return mod;
    }
  }
  return MODULES[0];
}
