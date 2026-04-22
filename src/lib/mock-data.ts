// Dados mockados para popular as telas (apenas visual, sem lógica de negócio).

export const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const kpis = [
  {
    label: "Vendas do mês",
    value: 184230,
    change: 12.4,
    trend: "up" as const,
    hint: "vs. mês anterior",
  },
  {
    label: "Compras do mês",
    value: 92140,
    change: -3.2,
    trend: "down" as const,
    hint: "vs. mês anterior",
  },
  {
    label: "Lucro do mês",
    value: 56720,
    change: 8.7,
    trend: "up" as const,
    hint: "margem 30,8%",
  },
  {
    label: "Contas a pagar",
    value: 28940,
    change: 4.1,
    trend: "up" as const,
    hint: "12 títulos abertos",
  },
  {
    label: "Contas a receber",
    value: 71820,
    change: 6.5,
    trend: "up" as const,
    hint: "23 títulos abertos",
  },
  {
    label: "Estoque baixo",
    value: 14,
    change: 2,
    trend: "up" as const,
    hint: "produtos críticos",
    isCount: true,
  },
];

export const salesByMonth = [
  { month: "Jan", vendas: 142000, compras: 78000 },
  { month: "Fev", vendas: 158000, compras: 82000 },
  { month: "Mar", vendas: 134000, compras: 71000 },
  { month: "Abr", vendas: 172000, compras: 90000 },
  { month: "Mai", vendas: 165000, compras: 85000 },
  { month: "Jun", vendas: 184000, compras: 92000 },
];

export const cashFlow = [
  { day: "01", entrada: 12000, saida: 8000 },
  { day: "05", entrada: 18000, saida: 11000 },
  { day: "10", entrada: 22000, saida: 14000 },
  { day: "15", entrada: 16000, saida: 12500 },
  { day: "20", entrada: 28000, saida: 18000 },
  { day: "25", entrada: 24000, saida: 16000 },
  { day: "30", entrada: 31000, saida: 21000 },
];

export const recentSales = [
  { id: "VND-1042", cliente: "Mercearia Central", valor: 1248.5, status: "Pago", data: "22/04/2026" },
  { id: "VND-1041", cliente: "Padaria Bom Pão", valor: 532.0, status: "Pendente", data: "22/04/2026" },
  { id: "VND-1040", cliente: "Restaurante Sabor", valor: 2890.9, status: "Pago", data: "21/04/2026" },
  { id: "VND-1039", cliente: "Mini Box Família", valor: 415.2, status: "Pago", data: "21/04/2026" },
  { id: "VND-1038", cliente: "Lanchonete do Zé", valor: 187.6, status: "Cancelado", data: "20/04/2026" },
];

export const recentPurchases = [
  { id: "CMP-0312", fornecedor: "Distribuidora Alfa", valor: 8420.0, status: "Recebido", data: "20/04/2026" },
  { id: "CMP-0311", fornecedor: "Atacado Beta", valor: 3150.5, status: "Pendente", data: "19/04/2026" },
  { id: "CMP-0310", fornecedor: "Importadora Gama", valor: 12740.0, status: "Recebido", data: "18/04/2026" },
  { id: "CMP-0309", fornecedor: "Fábrica Delta", valor: 2280.3, status: "Cancelado", data: "17/04/2026" },
];

export const products = [
  { sku: "P-001", nome: "Arroz Branco 5kg", categoria: "Alimentos", preco: 28.9, estoque: 142, status: "Ativo" },
  { sku: "P-002", nome: "Feijão Carioca 1kg", categoria: "Alimentos", preco: 9.5, estoque: 8, status: "Ativo" },
  { sku: "P-003", nome: "Óleo de Soja 900ml", categoria: "Alimentos", preco: 7.2, estoque: 56, status: "Ativo" },
  { sku: "P-004", nome: "Açúcar Refinado 1kg", categoria: "Alimentos", preco: 5.8, estoque: 0, status: "Inativo" },
  { sku: "P-005", nome: "Café Torrado 500g", categoria: "Bebidas", preco: 18.4, estoque: 32, status: "Ativo" },
  { sku: "P-006", nome: "Sabão em Pó 1kg", categoria: "Limpeza", preco: 14.9, estoque: 4, status: "Ativo" },
  { sku: "P-007", nome: "Detergente 500ml", categoria: "Limpeza", preco: 3.5, estoque: 88, status: "Ativo" },
  { sku: "P-008", nome: "Refrigerante 2L", categoria: "Bebidas", preco: 8.9, estoque: 24, status: "Ativo" },
];

export const stockItems = products.map((p) => ({
  ...p,
  minimo: 10,
  situacao:
    p.estoque === 0 ? "Esgotado" : p.estoque < 5 ? "Crítico" : p.estoque < 15 ? "Baixo" : "OK",
}));

export const customers = [
  { id: "C-001", nome: "Mercearia Central", documento: "12.345.678/0001-90", email: "contato@central.com", telefone: "(11) 4002-8922", cidade: "São Paulo/SP", status: "Ativo" },
  { id: "C-002", nome: "Padaria Bom Pão", documento: "98.765.432/0001-10", email: "padaria@bompao.com", telefone: "(11) 3344-5566", cidade: "Guarulhos/SP", status: "Ativo" },
  { id: "C-003", nome: "Restaurante Sabor", documento: "11.222.333/0001-44", email: "contato@sabor.com", telefone: "(21) 2233-4455", cidade: "Rio de Janeiro/RJ", status: "Ativo" },
  { id: "C-004", nome: "Mini Box Família", documento: "55.666.777/0001-88", email: "minibox@familia.com", telefone: "(31) 9988-7766", cidade: "BH/MG", status: "Inativo" },
];

export const suppliers = [
  { id: "F-001", nome: "Distribuidora Alfa", documento: "10.111.222/0001-33", email: "vendas@alfa.com", telefone: "(11) 5555-1212", cidade: "Campinas/SP", status: "Ativo" },
  { id: "F-002", nome: "Atacado Beta", documento: "20.222.333/0001-44", email: "comercial@beta.com", telefone: "(11) 4444-3232", cidade: "São Paulo/SP", status: "Ativo" },
  { id: "F-003", nome: "Importadora Gama", documento: "30.333.444/0001-55", email: "import@gama.com", telefone: "(13) 3333-4545", cidade: "Santos/SP", status: "Ativo" },
  { id: "F-004", nome: "Fábrica Delta", documento: "40.444.555/0001-66", email: "vendas@delta.com", telefone: "(47) 2222-7878", cidade: "Joinville/SC", status: "Inativo" },
];

export const accountsPayable = [
  { id: "AP-201", descricao: "Distribuidora Alfa - NF 4521", vencimento: "28/04/2026", valor: 8420.0, status: "Pendente" },
  { id: "AP-202", descricao: "Aluguel Loja Centro", vencimento: "30/04/2026", valor: 4500.0, status: "Pendente" },
  { id: "AP-203", descricao: "Energia Elétrica", vencimento: "15/04/2026", valor: 1280.45, status: "Vencido" },
  { id: "AP-204", descricao: "Atacado Beta - NF 1198", vencimento: "10/05/2026", valor: 3150.5, status: "Pendente" },
];

export const accountsReceivable = [
  { id: "AR-501", descricao: "Restaurante Sabor - VND 1040", vencimento: "30/04/2026", valor: 2890.9, status: "Pendente" },
  { id: "AR-502", descricao: "Padaria Bom Pão - VND 1041", vencimento: "25/04/2026", valor: 532.0, status: "Pendente" },
  { id: "AR-503", descricao: "Mercearia Central - VND 1035", vencimento: "12/04/2026", valor: 1820.7, status: "Vencido" },
  { id: "AR-504", descricao: "Mini Box Família - VND 1042", vencimento: "05/05/2026", valor: 1248.5, status: "Pendente" },
];
