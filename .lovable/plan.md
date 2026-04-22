
# Plano: Sistema de Gestão Empresarial — Estrutura Visual

Vou criar a base visual completa de um ERP/sistema de gestão genérico, com design SaaS moderno, sem lógica de negócio (apenas dados mockados para visualização).

## 🎨 Design System

- **Paleta profissional**: tons de azul/slate como primária, com acentos para status (verde sucesso, vermelho perigo, âmbar aviso)
- **Tipografia**: Inter, hierarquia clara
- **Tema claro** por padrão (estrutura pronta para dark mode futuro)
- **Componentes shadcn/ui** já disponíveis no projeto
- Tokens semânticos em `src/styles.css` (sem cores hardcoded nos componentes)

## 🧱 Layout Global

**Sidebar fixa (colapsável para modo ícone)**
- Logo + nome do sistema no topo
- Navegação agrupada: Principal (Dashboard), Operacional (Produtos, Estoque, Compras, Vendas), Financeiro, Cadastros (Clientes, Fornecedores), Análise (Relatórios), Configurações
- Indicador de rota ativa
- Perfil do usuário no rodapé

**Topbar**
- Botão de toggle da sidebar
- Campo de busca global
- Ações rápidas (botão "+ Novo")
- Notificações (sino com badge)
- Avatar do usuário com dropdown

**Área de conteúdo**
- Container responsivo com padding consistente
- Breadcrumb opcional + título da página + ações da página

## 📄 Páginas (rotas separadas via TanStack Router)

Cada página em `src/routes/` com metadata própria (head):

1. **`/` Dashboard**
   - 6 cards de KPI: Vendas do mês, Compras do mês, Lucro, Contas a pagar, Contas a receber, Estoque baixo (com ícones, variação % e mini-trend)
   - 3 gráficos (recharts): Vendas por período (linha), Compras por período (barra), Fluxo financeiro (área)
   - 2 tabelas: Últimas vendas e Últimas compras

2. **`/produtos`** — tabela de produtos (SKU, nome, categoria, preço, estoque, status), filtros, busca, modal de cadastro/edição

3. **`/estoque`** — visão de estoque atual, alertas de estoque baixo, badges de status (OK / Baixo / Crítico / Esgotado), modal de movimentação (entrada/saída/ajuste)

4. **`/compras`** — lista de pedidos de compra, status (Pendente / Recebido / Cancelado), modal de novo pedido com itens

5. **`/vendas`** — lista de vendas, status, modal de nova venda (cliente + itens + totais)

6. **`/financeiro`** — abas: Contas a Pagar, Contas a Receber, Fluxo de Caixa; cards de resumo + tabelas com vencimento e status

7. **`/fornecedores`** — CRUD visual (tabela + modal)

8. **`/clientes`** — CRUD visual (tabela + modal)

9. **`/relatorios`** — grid de cards de relatórios disponíveis (Vendas, Compras, Estoque, Financeiro, DRE simplificado) com filtros de período

10. **`/configuracoes`** — abas: Empresa, Usuários, Preferências, Integrações

## 🧩 Componentes Base Reutilizáveis

- `AppSidebar` — navegação lateral
- `AppTopbar` — topo com busca e ações
- `AppLayout` — shell que combina sidebar + topbar + outlet
- `PageHeader` — título + descrição + ações da página
- `StatCard` — card de KPI com ícone, valor, variação
- `DataTable` — wrapper sobre table com busca, filtros, paginação visual
- `StatusBadge` — badge com variantes (sucesso, aviso, perigo, neutro, info)
- `EmptyState` — placeholder para listas vazias
- `FormDialog` — modal padrão para formulários de cadastro/edição
- `ChartCard` — wrapper para gráficos com título e período

## 🗂️ Estrutura de arquivos

```
src/
├── routes/
│   ├── __root.tsx          (atualizado com AppLayout)
│   ├── index.tsx           (Dashboard)
│   ├── produtos.tsx
│   ├── estoque.tsx
│   ├── compras.tsx
│   ├── vendas.tsx
│   ├── financeiro.tsx
│   ├── fornecedores.tsx
│   ├── clientes.tsx
│   ├── relatorios.tsx
│   └── configuracoes.tsx
├── components/
│   ├── layout/ (AppSidebar, AppTopbar, AppLayout)
│   ├── shared/ (StatCard, DataTable, StatusBadge, PageHeader, EmptyState, FormDialog, ChartCard)
│   └── dashboard/ (gráficos e tabelas específicas)
└── lib/mock-data.ts        (dados de exemplo para popular as telas)
```

## ✅ O que entra agora
- Layout completo, navegação funcionando entre todas as páginas
- Todas as 10 páginas criadas com conteúdo visual realista (dados mockados)
- Componentes base prontos para reuso
- Design responsivo e profissional

## ⏭️ Fora do escopo (próximas etapas)
- Lógica de negócio, cálculos reais
- Backend / banco de dados (Lovable Cloud)
- Autenticação e permissões
- Persistência e CRUD funcional
