
-- =====================================================
-- TRIGGERS UTILITÁRIOS
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- SISTEMA: ROLES DE USUÁRIO
-- =====================================================

CREATE TYPE public.app_role AS ENUM ('admin', 'gerente', 'vendedor', 'financeiro');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Usuários veem seus próprios papéis"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins gerenciam papéis"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================
-- SISTEMA: CONFIGURAÇÕES DA EMPRESA
-- =====================================================

CREATE TABLE public.configuracoes_empresa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj TEXT,
  inscricao_estadual TEXT,
  inscricao_municipal TEXT,
  email TEXT,
  telefone TEXT,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id)
);

CREATE TRIGGER trg_configuracoes_empresa_updated_at
  BEFORE UPDATE ON public.configuracoes_empresa
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.configuracoes_empresa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa configurações da empresa"
  ON public.configuracoes_empresa FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- PRODUTOS: CATEGORIAS
-- =====================================================

CREATE TABLE public.categorias_produto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.categorias_produto(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categorias_produto_owner ON public.categorias_produto(owner_id);
CREATE INDEX idx_categorias_produto_parent ON public.categorias_produto(parent_id);

CREATE TRIGGER trg_categorias_produto_updated_at
  BEFORE UPDATE ON public.categorias_produto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.categorias_produto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa categorias de produto"
  ON public.categorias_produto FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- PRODUTOS
-- =====================================================

CREATE TYPE public.produto_status AS ENUM ('ativo', 'inativo', 'descontinuado');

CREATE TABLE public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categoria_id UUID REFERENCES public.categorias_produto(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  codigo_barras TEXT,
  nome TEXT NOT NULL,
  descricao TEXT,
  marca TEXT,
  unidade TEXT NOT NULL DEFAULT 'UN',
  preco_custo NUMERIC(14,2) NOT NULL DEFAULT 0,
  preco_venda NUMERIC(14,2) NOT NULL DEFAULT 0,
  estoque_minimo NUMERIC(14,3) NOT NULL DEFAULT 0,
  ncm TEXT,
  cest TEXT,
  origem TEXT,
  imagem_url TEXT,
  status produto_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, sku)
);

CREATE INDEX idx_produtos_owner ON public.produtos(owner_id);
CREATE INDEX idx_produtos_categoria ON public.produtos(categoria_id);
CREATE INDEX idx_produtos_status ON public.produtos(status);
CREATE INDEX idx_produtos_nome ON public.produtos(nome);

CREATE TRIGGER trg_produtos_updated_at
  BEFORE UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa produtos"
  ON public.produtos FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- PRODUTOS: VARIAÇÕES
-- =====================================================

CREATE TABLE public.produto_variacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  codigo_barras TEXT,
  nome TEXT NOT NULL,
  atributos JSONB NOT NULL DEFAULT '{}'::jsonb,
  preco_custo NUMERIC(14,2),
  preco_venda NUMERIC(14,2),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, sku)
);

CREATE INDEX idx_produto_variacoes_owner ON public.produto_variacoes(owner_id);
CREATE INDEX idx_produto_variacoes_produto ON public.produto_variacoes(produto_id);

CREATE TRIGGER trg_produto_variacoes_updated_at
  BEFORE UPDATE ON public.produto_variacoes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.produto_variacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa variações de produto"
  ON public.produto_variacoes FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- ESTOQUE: LOTES
-- =====================================================

CREATE TABLE public.lotes_produto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  variacao_id UUID REFERENCES public.produto_variacoes(id) ON DELETE SET NULL,
  numero_lote TEXT NOT NULL,
  data_fabricacao DATE,
  data_validade DATE,
  quantidade_inicial NUMERIC(14,3) NOT NULL DEFAULT 0,
  quantidade_atual NUMERIC(14,3) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(14,2),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, produto_id, numero_lote)
);

CREATE INDEX idx_lotes_owner ON public.lotes_produto(owner_id);
CREATE INDEX idx_lotes_produto ON public.lotes_produto(produto_id);
CREATE INDEX idx_lotes_validade ON public.lotes_produto(data_validade);

CREATE TRIGGER trg_lotes_produto_updated_at
  BEFORE UPDATE ON public.lotes_produto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lotes_produto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa lotes"
  ON public.lotes_produto FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- ESTOQUE: MOVIMENTAÇÕES
-- =====================================================

CREATE TYPE public.movimentacao_tipo AS ENUM ('entrada', 'saida', 'ajuste', 'devolucao', 'transferencia');
CREATE TYPE public.movimentacao_origem AS ENUM ('compra', 'venda', 'ajuste_manual', 'devolucao_cliente', 'devolucao_fornecedor', 'inventario', 'outro');

CREATE TABLE public.estoque_movimentacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  variacao_id UUID REFERENCES public.produto_variacoes(id) ON DELETE SET NULL,
  lote_id UUID REFERENCES public.lotes_produto(id) ON DELETE SET NULL,
  tipo movimentacao_tipo NOT NULL,
  origem movimentacao_origem NOT NULL DEFAULT 'outro',
  quantidade NUMERIC(14,3) NOT NULL,
  custo_unitario NUMERIC(14,2),
  saldo_anterior NUMERIC(14,3),
  saldo_posterior NUMERIC(14,3),
  compra_id UUID,
  venda_id UUID,
  observacoes TEXT,
  data_movimentacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_movs_owner ON public.estoque_movimentacoes(owner_id);
CREATE INDEX idx_movs_produto ON public.estoque_movimentacoes(produto_id);
CREATE INDEX idx_movs_data ON public.estoque_movimentacoes(data_movimentacao DESC);
CREATE INDEX idx_movs_compra ON public.estoque_movimentacoes(compra_id);
CREATE INDEX idx_movs_venda ON public.estoque_movimentacoes(venda_id);

ALTER TABLE public.estoque_movimentacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa movimentações de estoque"
  ON public.estoque_movimentacoes FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- COMPRAS: FORNECEDORES
-- =====================================================

CREATE TYPE public.pessoa_tipo AS ENUM ('PF', 'PJ');
CREATE TYPE public.cadastro_status AS ENUM ('ativo', 'inativo');

CREATE TABLE public.fornecedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo pessoa_tipo NOT NULL DEFAULT 'PJ',
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  documento TEXT,
  inscricao_estadual TEXT,
  email TEXT,
  telefone TEXT,
  contato_nome TEXT,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  observacoes TEXT,
  status cadastro_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fornecedores_owner ON public.fornecedores(owner_id);
CREATE INDEX idx_fornecedores_documento ON public.fornecedores(documento);
CREATE INDEX idx_fornecedores_status ON public.fornecedores(status);

CREATE TRIGGER trg_fornecedores_updated_at
  BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa fornecedores"
  ON public.fornecedores FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- VENDAS: CLIENTES
-- =====================================================

CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo pessoa_tipo NOT NULL DEFAULT 'PJ',
  nome TEXT NOT NULL,
  nome_fantasia TEXT,
  documento TEXT,
  inscricao_estadual TEXT,
  email TEXT,
  telefone TEXT,
  celular TEXT,
  data_nascimento DATE,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  observacoes TEXT,
  status cadastro_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clientes_owner ON public.clientes(owner_id);
CREATE INDEX idx_clientes_documento ON public.clientes(documento);
CREATE INDEX idx_clientes_status ON public.clientes(status);
CREATE INDEX idx_clientes_nome ON public.clientes(nome);

CREATE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa clientes"
  ON public.clientes FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- COMPRAS
-- =====================================================

CREATE TYPE public.compra_status AS ENUM ('rascunho', 'pendente', 'aprovada', 'recebida', 'cancelada');

CREATE TABLE public.compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_prevista DATE,
  data_recebimento DATE,
  numero_nf TEXT,
  serie_nf TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
  frete NUMERIC(14,2) NOT NULL DEFAULT 0,
  outros NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  status compra_status NOT NULL DEFAULT 'rascunho',
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, numero)
);

CREATE INDEX idx_compras_owner ON public.compras(owner_id);
CREATE INDEX idx_compras_fornecedor ON public.compras(fornecedor_id);
CREATE INDEX idx_compras_status ON public.compras(status);
CREATE INDEX idx_compras_data ON public.compras(data_emissao DESC);

CREATE TRIGGER trg_compras_updated_at
  BEFORE UPDATE ON public.compras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa compras"
  ON public.compras FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- COMPRAS: ITENS
-- =====================================================

CREATE TABLE public.compra_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  compra_id UUID NOT NULL REFERENCES public.compras(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  variacao_id UUID REFERENCES public.produto_variacoes(id) ON DELETE SET NULL,
  lote_id UUID REFERENCES public.lotes_produto(id) ON DELETE SET NULL,
  descricao TEXT,
  quantidade NUMERIC(14,3) NOT NULL,
  preco_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_compra_itens_owner ON public.compra_itens(owner_id);
CREATE INDEX idx_compra_itens_compra ON public.compra_itens(compra_id);
CREATE INDEX idx_compra_itens_produto ON public.compra_itens(produto_id);

CREATE TRIGGER trg_compra_itens_updated_at
  BEFORE UPDATE ON public.compra_itens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.compra_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa itens de compra"
  ON public.compra_itens FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- VENDAS
-- =====================================================

CREATE TYPE public.venda_status AS ENUM ('rascunho', 'pendente', 'aprovada', 'faturada', 'entregue', 'cancelada');
CREATE TYPE public.forma_pagamento AS ENUM ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'cheque', 'outro');

CREATE TABLE public.vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  vendedor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_entrega DATE,
  numero_nf TEXT,
  serie_nf TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
  frete NUMERIC(14,2) NOT NULL DEFAULT 0,
  outros NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  forma_pagamento forma_pagamento,
  status venda_status NOT NULL DEFAULT 'rascunho',
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, numero)
);

CREATE INDEX idx_vendas_owner ON public.vendas(owner_id);
CREATE INDEX idx_vendas_cliente ON public.vendas(cliente_id);
CREATE INDEX idx_vendas_status ON public.vendas(status);
CREATE INDEX idx_vendas_data ON public.vendas(data_emissao DESC);

CREATE TRIGGER trg_vendas_updated_at
  BEFORE UPDATE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa vendas"
  ON public.vendas FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- VENDAS: ITENS
-- =====================================================

CREATE TABLE public.venda_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venda_id UUID NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  variacao_id UUID REFERENCES public.produto_variacoes(id) ON DELETE SET NULL,
  lote_id UUID REFERENCES public.lotes_produto(id) ON DELETE SET NULL,
  descricao TEXT,
  quantidade NUMERIC(14,3) NOT NULL,
  preco_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_venda_itens_owner ON public.venda_itens(owner_id);
CREATE INDEX idx_venda_itens_venda ON public.venda_itens(venda_id);
CREATE INDEX idx_venda_itens_produto ON public.venda_itens(produto_id);

CREATE TRIGGER trg_venda_itens_updated_at
  BEFORE UPDATE ON public.venda_itens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.venda_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa itens de venda"
  ON public.venda_itens FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Liga estoque_movimentacoes às compras/vendas (FKs adicionadas após criação dessas tabelas)
ALTER TABLE public.estoque_movimentacoes
  ADD CONSTRAINT fk_movs_compra FOREIGN KEY (compra_id) REFERENCES public.compras(id) ON DELETE SET NULL;

ALTER TABLE public.estoque_movimentacoes
  ADD CONSTRAINT fk_movs_venda FOREIGN KEY (venda_id) REFERENCES public.vendas(id) ON DELETE SET NULL;

-- =====================================================
-- FINANCEIRO: CATEGORIAS
-- =====================================================

CREATE TYPE public.categoria_financeira_tipo AS ENUM ('receita', 'despesa');

CREATE TABLE public.categorias_financeiras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.categorias_financeiras(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  tipo categoria_financeira_tipo NOT NULL,
  cor TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cat_fin_owner ON public.categorias_financeiras(owner_id);
CREATE INDEX idx_cat_fin_parent ON public.categorias_financeiras(parent_id);
CREATE INDEX idx_cat_fin_tipo ON public.categorias_financeiras(tipo);

CREATE TRIGGER trg_categorias_financeiras_updated_at
  BEFORE UPDATE ON public.categorias_financeiras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.categorias_financeiras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa categorias financeiras"
  ON public.categorias_financeiras FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- =====================================================
-- FINANCEIRO: LANÇAMENTOS
-- =====================================================

CREATE TYPE public.lancamento_tipo AS ENUM ('receita', 'despesa');
CREATE TYPE public.lancamento_status AS ENUM ('pendente', 'pago', 'recebido', 'vencido', 'cancelado');

CREATE TABLE public.financeiro_lancamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categoria_id UUID REFERENCES public.categorias_financeiras(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  fornecedor_id UUID REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  compra_id UUID REFERENCES public.compras(id) ON DELETE SET NULL,
  venda_id UUID REFERENCES public.vendas(id) ON DELETE SET NULL,
  tipo lancamento_tipo NOT NULL,
  descricao TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  valor_pago NUMERIC(14,2) NOT NULL DEFAULT 0,
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento DATE NOT NULL,
  data_pagamento DATE,
  forma_pagamento forma_pagamento,
  numero_documento TEXT,
  parcela_numero INTEGER,
  parcela_total INTEGER,
  status lancamento_status NOT NULL DEFAULT 'pendente',
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lanc_owner ON public.financeiro_lancamentos(owner_id);
CREATE INDEX idx_lanc_tipo ON public.financeiro_lancamentos(tipo);
CREATE INDEX idx_lanc_status ON public.financeiro_lancamentos(status);
CREATE INDEX idx_lanc_vencimento ON public.financeiro_lancamentos(data_vencimento);
CREATE INDEX idx_lanc_compra ON public.financeiro_lancamentos(compra_id);
CREATE INDEX idx_lanc_venda ON public.financeiro_lancamentos(venda_id);

CREATE TRIGGER trg_financeiro_lancamentos_updated_at
  BEFORE UPDATE ON public.financeiro_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.financeiro_lancamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa lançamentos financeiros"
  ON public.financeiro_lancamentos FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
