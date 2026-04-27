-- ============================================================
-- QA do Sistema (Validação de Lançamento) — apenas super_admin
-- ============================================================

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE public.qa_severidade AS ENUM ('critico', 'medio', 'leve');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.qa_status_avaliacao AS ENUM ('nao_testado', 'ok', 'leve', 'medio', 'critico');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.qa_validacao_status AS ENUM ('em_andamento', 'finalizada');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) Catálogo de módulos QA (PDV, Estoque, etc.)
CREATE TABLE IF NOT EXISTS public.qa_modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qa_modulos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin gerencia qa_modulos"
ON public.qa_modulos FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin lê qa_modulos"
ON public.qa_modulos FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

-- 3) Itens de checklist (catálogo global)
CREATE TABLE IF NOT EXISTS public.qa_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id uuid NOT NULL REFERENCES public.qa_modulos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  severidade public.qa_severidade NOT NULL DEFAULT 'medio',
  critico boolean NOT NULL DEFAULT false,
  rota_link text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_itens_modulo ON public.qa_itens(modulo_id);

ALTER TABLE public.qa_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin gerencia qa_itens"
ON public.qa_itens FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- 4) Rodadas de validação (cada execução completa do QA)
CREATE TABLE IF NOT EXISTS public.qa_validacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  responsavel_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsavel_nome text,
  status public.qa_validacao_status NOT NULL DEFAULT 'em_andamento',
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  observacao_final text,
  resumo jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qa_validacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin gerencia qa_validacoes"
ON public.qa_validacoes FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- 5) Avaliações por item dentro de cada rodada
CREATE TABLE IF NOT EXISTS public.qa_avaliacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validacao_id uuid NOT NULL REFERENCES public.qa_validacoes(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.qa_itens(id) ON DELETE CASCADE,
  status public.qa_status_avaliacao NOT NULL DEFAULT 'nao_testado',
  observacao text,
  evidencia_url text,
  testado_em timestamptz,
  testado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  testado_por_nome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (validacao_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_qa_avaliacoes_validacao ON public.qa_avaliacoes(validacao_id);
CREATE INDEX IF NOT EXISTS idx_qa_avaliacoes_item ON public.qa_avaliacoes(item_id);

ALTER TABLE public.qa_avaliacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin gerencia qa_avaliacoes"
ON public.qa_avaliacoes FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- 6) Trigger updated_at
CREATE OR REPLACE FUNCTION public.qa_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_qa_modulos_updated ON public.qa_modulos;
CREATE TRIGGER trg_qa_modulos_updated BEFORE UPDATE ON public.qa_modulos
FOR EACH ROW EXECUTE FUNCTION public.qa_set_updated_at();

DROP TRIGGER IF EXISTS trg_qa_itens_updated ON public.qa_itens;
CREATE TRIGGER trg_qa_itens_updated BEFORE UPDATE ON public.qa_itens
FOR EACH ROW EXECUTE FUNCTION public.qa_set_updated_at();

DROP TRIGGER IF EXISTS trg_qa_validacoes_updated ON public.qa_validacoes;
CREATE TRIGGER trg_qa_validacoes_updated BEFORE UPDATE ON public.qa_validacoes
FOR EACH ROW EXECUTE FUNCTION public.qa_set_updated_at();

DROP TRIGGER IF EXISTS trg_qa_avaliacoes_updated ON public.qa_avaliacoes;
CREATE TRIGGER trg_qa_avaliacoes_updated BEFORE UPDATE ON public.qa_avaliacoes
FOR EACH ROW EXECUTE FUNCTION public.qa_set_updated_at();

-- 7) Bucket privado de evidências
INSERT INTO storage.buckets (id, name, public)
VALUES ('qa-evidencias', 'qa-evidencias', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Super admin lê qa-evidencias"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'qa-evidencias' AND public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin envia qa-evidencias"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'qa-evidencias' AND public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin atualiza qa-evidencias"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'qa-evidencias' AND public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin remove qa-evidencias"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'qa-evidencias' AND public.is_super_admin(auth.uid()));

-- 8) Seed de módulos
INSERT INTO public.qa_modulos (chave, nome, descricao, ordem) VALUES
  ('login',       'Login & Auth',     'Acesso ao sistema, recuperação e cadastro', 10),
  ('empresa',     'Empresa & Usuários','Cadastro de empresa, usuários e permissões', 20),
  ('pdv',         'PDV',              'Frente de caixa', 30),
  ('estoque',     'Estoque',          'Movimentações e saldos', 40),
  ('compras',     'Compras',          'Compras e fornecedores', 50),
  ('financeiro',  'Financeiro',       'Contas a pagar, receber, fluxo de caixa', 60),
  ('clientes',    'Clientes',         'CRM e histórico', 70),
  ('relatorios',  'Relatórios',       'Relatórios e exportações', 80),
  ('planos',      'Planos & Módulos', 'Cobrança e liberação de módulos', 90),
  ('terminais',   'Terminais',        'Conexão, papel e sincronismo', 100),
  ('backup',      'Backup & Export',  'Exportações e segurança', 110)
ON CONFLICT (chave) DO NOTHING;

-- 9) Seed de itens
WITH m AS (SELECT id, chave FROM public.qa_modulos)
INSERT INTO public.qa_itens (modulo_id, titulo, severidade, critico, rota_link, ordem) VALUES
  -- Login
  ((SELECT id FROM m WHERE chave='login'), 'Login com e-mail e senha',           'critico', true, '/auth', 10),
  ((SELECT id FROM m WHERE chave='login'), 'Logout completo',                    'medio',   false,'/auth', 20),
  ((SELECT id FROM m WHERE chave='login'), 'Permissões por cargo (admin/caixa)', 'critico', true, '/configuracoes', 30),

  -- Empresa
  ((SELECT id FROM m WHERE chave='empresa'), 'Cadastro de empresa (CNPJ, endereço)', 'critico', true,  '/configuracoes', 10),
  ((SELECT id FROM m WHERE chave='empresa'), 'Upload de logo da empresa',            'leve',    false, '/configuracoes', 20),
  ((SELECT id FROM m WHERE chave='empresa'), 'Cadastro de usuário/funcionário',      'critico', true,  '/configuracoes', 30),
  ((SELECT id FROM m WHERE chave='empresa'), 'Permissões granulares por terminal',   'critico', true,  '/configuracoes', 40),

  -- PDV
  ((SELECT id FROM m WHERE chave='pdv'), 'Criar venda simples',                       'critico', true,  '/pdv', 10),
  ((SELECT id FROM m WHERE chave='pdv'), 'Venda com cliente vinculado',               'medio',   false, '/pdv', 20),
  ((SELECT id FROM m WHERE chave='pdv'), 'Buscar cliente por CPF',                    'medio',   false, '/pdv', 30),
  ((SELECT id FROM m WHERE chave='pdv'), 'Venda em dinheiro (com troco)',             'critico', true,  '/pdv', 40),
  ((SELECT id FROM m WHERE chave='pdv'), 'Venda em Pix',                              'critico', true,  '/pdv', 50),
  ((SELECT id FROM m WHERE chave='pdv'), 'Venda em cartão (débito/crédito)',          'critico', true,  '/pdv', 60),
  ((SELECT id FROM m WHERE chave='pdv'), 'Venda fiado com vencimento obrigatório',    'critico', true,  '/pdv', 70),
  ((SELECT id FROM m WHERE chave='pdv'), 'Venda iFood',                               'medio',   false, '/pdv', 80),
  ((SELECT id FROM m WHERE chave='pdv'), 'Baixa automática no estoque',               'critico', true,  '/pdv', 90),
  ((SELECT id FROM m WHERE chave='pdv'), 'Atalhos F1, F2, F3 e F7',                   'leve',    false, '/pdv', 100),
  ((SELECT id FROM m WHERE chave='pdv'), 'Botão Enter para confirmar venda',          'medio',   false, '/pdv', 110),
  ((SELECT id FROM m WHERE chave='pdv'), 'Cancelamento de venda (estoque + caixa)',   'critico', true,  '/vendas', 120),

  -- Estoque
  ((SELECT id FROM m WHERE chave='estoque'), 'Cadastro de produto',                  'critico', true,  '/produtos', 10),
  ((SELECT id FROM m WHERE chave='estoque'), 'Entrada manual de estoque',            'medio',   false, '/estoque', 20),
  ((SELECT id FROM m WHERE chave='estoque'), 'Baixa automática por venda',           'critico', true,  '/estoque', 30),
  ((SELECT id FROM m WHERE chave='estoque'), 'Alerta de estoque baixo',              'medio',   false, '/estoque', 40),
  ((SELECT id FROM m WHERE chave='estoque'), 'Histórico de movimentações',           'leve',    false, '/estoque', 50),
  ((SELECT id FROM m WHERE chave='estoque'), 'Ajuste manual de quantidade',          'medio',   false, '/estoque', 60),

  -- Compras
  ((SELECT id FROM m WHERE chave='compras'), 'Cadastro de fornecedor',               'medio',   false, '/fornecedores', 10),
  ((SELECT id FROM m WHERE chave='compras'), 'Registro de compra',                   'critico', true,  '/compras', 20),
  ((SELECT id FROM m WHERE chave='compras'), 'Entrada no estoque a partir da compra','critico', true,  '/compras', 30),
  ((SELECT id FROM m WHERE chave='compras'), 'Geração de conta a pagar',             'critico', true,  '/financeiro', 40),
  ((SELECT id FROM m WHERE chave='compras'), 'Edição/cancelamento de compra',        'medio',   false, '/compras', 50),

  -- Financeiro
  ((SELECT id FROM m WHERE chave='financeiro'), 'Conta a pagar',                     'critico', true,  '/financeiro', 10),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Conta a receber',                   'critico', true,  '/financeiro', 20),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Pagamento parcial',                 'medio',   false, '/financeiro', 30),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Baixa total',                       'critico', true,  '/financeiro', 40),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Cancelamento de lançamento',        'medio',   false, '/financeiro', 50),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Fluxo de caixa diário',             'medio',   false, '/relatorios/fluxo-caixa', 60),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Fluxo de caixa mensal',             'medio',   false, '/relatorios/fluxo-caixa', 70),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Separação por forma de pagamento',  'medio',   false, '/caixa', 80),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Lucro real (vendido, custo, lucro)','critico', true,  '/financeiro', 90),
  ((SELECT id FROM m WHERE chave='financeiro'), 'Relatórios exportáveis',            'medio',   false, '/relatorios', 100),

  -- Clientes
  ((SELECT id FROM m WHERE chave='clientes'), 'Cadastro de cliente',                 'medio',   false, '/clientes', 10),
  ((SELECT id FROM m WHERE chave='clientes'), 'Busca por CPF',                       'leve',    false, '/clientes', 20),
  ((SELECT id FROM m WHERE chave='clientes'), 'Vinculação do cliente à venda',       'medio',   false, '/pdv', 30),
  ((SELECT id FROM m WHERE chave='clientes'), 'Histórico de compras por cliente',    'leve',    false, '/clientes', 40),
  ((SELECT id FROM m WHERE chave='clientes'), 'Relatório por cliente',               'leve',    false, '/relatorios/vendas', 50),

  -- Relatórios
  ((SELECT id FROM m WHERE chave='relatorios'), 'Relatório de vendas',               'medio',   false, '/relatorios/vendas', 10),
  ((SELECT id FROM m WHERE chave='relatorios'), 'Relatório de caixa',                'medio',   false, '/relatorios/caixa', 20),
  ((SELECT id FROM m WHERE chave='relatorios'), 'Relatório DRE',                     'medio',   false, '/relatorios/dre', 30),
  ((SELECT id FROM m WHERE chave='relatorios'), 'Relatório fiscal',                  'leve',    false, '/relatorios/fiscal', 40),

  -- Planos
  ((SELECT id FROM m WHERE chave='planos'), 'Plano ativo do cliente',                'critico', true,  '/admin/empresas', 10),
  ((SELECT id FROM m WHERE chave='planos'), 'Módulos ativos por empresa',            'critico', true,  '/admin/modulos', 20),
  ((SELECT id FROM m WHERE chave='planos'), 'Bloqueio de módulo não contratado',     'critico', true,  '/admin/modulos', 30),
  ((SELECT id FROM m WHERE chave='planos'), 'Liberação manual pelo master',          'medio',   false, '/admin/empresas', 40),
  ((SELECT id FROM m WHERE chave='planos'), 'Alteração de plano/módulos',            'medio',   false, '/admin/planos', 50),

  -- Terminais
  ((SELECT id FROM m WHERE chave='terminais'), 'Cadastro de terminal',               'medio',   false, '/configuracoes', 10),
  ((SELECT id FROM m WHERE chave='terminais'), 'Identificação servidor/terminal',    'medio',   false, '/configuracoes', 20),
  ((SELECT id FROM m WHERE chave='terminais'), 'Status online/offline',              'critico', true,  '/configuracoes', 30),
  ((SELECT id FROM m WHERE chave='terminais'), 'Último sincronismo',                 'medio',   false, '/configuracoes', 40),
  ((SELECT id FROM m WHERE chave='terminais'), 'Reconexão automática',               'critico', true,  '/configuracoes', 50),
  ((SELECT id FROM m WHERE chave='terminais'), 'Bloqueio de operação sem conexão',   'medio',   false, '/configuracoes', 60),

  -- Backup
  ((SELECT id FROM m WHERE chave='backup'), 'Exportação CSV',                        'leve',    false, '/relatorios', 10),
  ((SELECT id FROM m WHERE chave='backup'), 'Exportação PDF',                        'leve',    false, '/relatorios', 20),
  ((SELECT id FROM m WHERE chave='backup'), 'Exportação PNG',                        'leve',    false, '/relatorios', 30)
ON CONFLICT DO NOTHING;