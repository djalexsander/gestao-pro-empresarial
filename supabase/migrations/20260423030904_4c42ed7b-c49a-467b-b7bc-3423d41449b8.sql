-- =========================================================================
-- FASE 2 — Multi-usuário por empresa (infraestrutura)
-- =========================================================================

-- 1. Enum de papéis administrativos
DO $$ BEGIN
  CREATE TYPE public.empresa_papel AS ENUM ('owner', 'admin', 'gerente_operacional');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Tabela empresa_membros
CREATE TABLE IF NOT EXISTS public.empresa_membros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  papel public.empresa_papel NOT NULL DEFAULT 'admin',
  convidado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_empresa_membros_user ON public.empresa_membros(user_id);
CREATE INDEX IF NOT EXISTS idx_empresa_membros_empresa ON public.empresa_membros(empresa_id);

ALTER TABLE public.empresa_membros ENABLE ROW LEVEL SECURITY;

-- 3. Funções auxiliares (security definer para evitar recursão)
CREATE OR REPLACE FUNCTION public.is_member_of(_empresa_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.empresa_membros
    WHERE empresa_id = _empresa_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.empresas
    WHERE id = _empresa_id AND owner_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.papel_na_empresa(_empresa_id UUID, _user_id UUID)
RETURNS public.empresa_papel
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.empresas WHERE id = _empresa_id AND owner_id = _user_id)
      THEN 'owner'::public.empresa_papel
    ELSE (SELECT papel FROM public.empresa_membros
          WHERE empresa_id = _empresa_id AND user_id = _user_id LIMIT 1)
  END;
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_financeiro(_empresa_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.papel_na_empresa(_empresa_id, _user_id) IN ('owner', 'admin');
$$;

-- Retorna a empresa "ativa" do usuário: prioriza empresa que ele é dono,
-- depois a primeira empresa em que é membro.
CREATE OR REPLACE FUNCTION public.current_empresa_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.empresas WHERE owner_id = auth.uid()
  ORDER BY created_at ASC LIMIT 1
$$;

-- Lista de IDs de empresas que o usuário pertence (dono OU membro)
CREATE OR REPLACE FUNCTION public.minhas_empresas_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.empresas WHERE owner_id = _user_id
  UNION
  SELECT empresa_id FROM public.empresa_membros WHERE user_id = _user_id;
$$;

-- Owner_ids de todas as empresas que o usuário acessa (dono + membro)
-- Usado nas RLS para incluir dados das empresas em que ele é membro
CREATE OR REPLACE FUNCTION public.acessa_owner_id(_owner_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _owner_id = _user_id
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = _user_id AND e.owner_id = _owner_id
  );
$$;

-- 4. RLS para empresa_membros
DROP POLICY IF EXISTS "Membros leem outros membros da mesma empresa" ON public.empresa_membros;
CREATE POLICY "Membros leem outros membros da mesma empresa"
ON public.empresa_membros FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_member_of(empresa_id, auth.uid())
  OR public.is_super_admin(auth.uid())
);

DROP POLICY IF EXISTS "Owner gerencia membros da sua empresa" ON public.empresa_membros;
CREATE POLICY "Owner gerencia membros da sua empresa"
ON public.empresa_membros FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.empresas WHERE id = empresa_id AND owner_id = auth.uid())
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.empresas WHERE id = empresa_id AND owner_id = auth.uid())
  OR public.is_super_admin(auth.uid())
);

-- 5. Bootstrap: criar entrada de owner em empresa_membros para todas as empresas existentes
INSERT INTO public.empresa_membros (empresa_id, user_id, papel)
SELECT id, owner_id, 'owner'::public.empresa_papel
FROM public.empresas
WHERE owner_id IS NOT NULL
ON CONFLICT (empresa_id, user_id) DO NOTHING;

-- 6. Trigger: ao criar uma empresa, adicionar o owner em empresa_membros
CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.empresa_membros (empresa_id, user_id, papel)
  VALUES (NEW.id, NEW.owner_id, 'owner'::public.empresa_papel)
  ON CONFLICT (empresa_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_add_owner_as_member ON public.empresas;
CREATE TRIGGER trg_add_owner_as_member
AFTER INSERT ON public.empresas
FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- 7. RLS HÍBRIDA: adicionar políticas extras nas tabelas operacionais
-- Mantemos as policies antigas (owner_id = auth.uid()) e adicionamos
-- políticas adicionais para acesso via membership.

-- VENDAS
DROP POLICY IF EXISTS "Membros acessam vendas da empresa" ON public.vendas;
CREATE POLICY "Membros acessam vendas da empresa"
ON public.vendas FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- VENDA_ITENS
DROP POLICY IF EXISTS "Membros acessam itens de venda" ON public.venda_itens;
CREATE POLICY "Membros acessam itens de venda"
ON public.venda_itens FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- VENDA_PAGAMENTOS
DROP POLICY IF EXISTS "Membros acessam pagamentos de venda" ON public.venda_pagamentos;
CREATE POLICY "Membros acessam pagamentos de venda"
ON public.venda_pagamentos FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- PRODUTOS
DROP POLICY IF EXISTS "Membros acessam produtos da empresa" ON public.produtos;
CREATE POLICY "Membros acessam produtos da empresa"
ON public.produtos FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- PRODUTO_VARIACOES
DROP POLICY IF EXISTS "Membros acessam variacoes" ON public.produto_variacoes;
CREATE POLICY "Membros acessam variacoes"
ON public.produto_variacoes FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- PRODUTO_CODIGOS
DROP POLICY IF EXISTS "Membros acessam codigos de produto" ON public.produto_codigos;
CREATE POLICY "Membros acessam codigos de produto"
ON public.produto_codigos FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- LOTES
DROP POLICY IF EXISTS "Membros acessam lotes" ON public.lotes_produto;
CREATE POLICY "Membros acessam lotes"
ON public.lotes_produto FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- CATEGORIAS PRODUTO
DROP POLICY IF EXISTS "Membros acessam categorias produto" ON public.categorias_produto;
CREATE POLICY "Membros acessam categorias produto"
ON public.categorias_produto FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- CLIENTES
DROP POLICY IF EXISTS "Membros acessam clientes" ON public.clientes;
CREATE POLICY "Membros acessam clientes"
ON public.clientes FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- FORNECEDORES
DROP POLICY IF EXISTS "Membros acessam fornecedores" ON public.fornecedores;
CREATE POLICY "Membros acessam fornecedores"
ON public.fornecedores FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- COMPRAS
DROP POLICY IF EXISTS "Membros acessam compras" ON public.compras;
CREATE POLICY "Membros acessam compras"
ON public.compras FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- COMPRA_ITENS
DROP POLICY IF EXISTS "Membros acessam itens de compra" ON public.compra_itens;
CREATE POLICY "Membros acessam itens de compra"
ON public.compra_itens FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- ESTOQUE_MOVIMENTACOES
DROP POLICY IF EXISTS "Membros acessam estoque" ON public.estoque_movimentacoes;
CREATE POLICY "Membros acessam estoque"
ON public.estoque_movimentacoes FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- FINANCEIRO_LANCAMENTOS — bloqueado para gerente_operacional
DROP POLICY IF EXISTS "Membros admin acessam financeiro" ON public.financeiro_lancamentos;
CREATE POLICY "Membros admin acessam financeiro"
ON public.financeiro_lancamentos FOR ALL
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = financeiro_lancamentos.owner_id
      AND m.papel IN ('owner', 'admin')
  )
)
WITH CHECK (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = financeiro_lancamentos.owner_id
      AND m.papel IN ('owner', 'admin')
  )
);

-- CATEGORIAS_FINANCEIRAS — bloqueado para gerente_operacional
DROP POLICY IF EXISTS "Membros admin acessam categorias financeiras" ON public.categorias_financeiras;
CREATE POLICY "Membros admin acessam categorias financeiras"
ON public.categorias_financeiras FOR ALL
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = categorias_financeiras.owner_id
      AND m.papel IN ('owner', 'admin')
  )
)
WITH CHECK (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = categorias_financeiras.owner_id
      AND m.papel IN ('owner', 'admin')
  )
);

-- CAIXAS, CAIXA_MOVIMENTOS, TERMINAIS — operacional, todos podem ver
DROP POLICY IF EXISTS "Membros acessam caixas" ON public.caixas;
CREATE POLICY "Membros acessam caixas"
ON public.caixas FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

DROP POLICY IF EXISTS "Membros acessam movimentos de caixa" ON public.caixa_movimentos;
CREATE POLICY "Membros acessam movimentos de caixa"
ON public.caixa_movimentos FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

DROP POLICY IF EXISTS "Membros acessam terminais" ON public.terminais;
CREATE POLICY "Membros acessam terminais"
ON public.terminais FOR ALL
TO authenticated
USING (public.acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (public.acessa_owner_id(owner_id, auth.uid()));

-- FUNCIONARIOS — só owner/admin podem gerenciar
DROP POLICY IF EXISTS "Admins acessam funcionarios" ON public.funcionarios;
CREATE POLICY "Admins acessam funcionarios"
ON public.funcionarios FOR ALL
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = funcionarios.owner_id
      AND m.papel IN ('owner', 'admin')
  )
)
WITH CHECK (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = funcionarios.owner_id
      AND m.papel IN ('owner', 'admin')
  )
);

-- CONFIGURACOES_EMPRESA — owner/admin
DROP POLICY IF EXISTS "Admins acessam configuracoes empresa" ON public.configuracoes_empresa;
CREATE POLICY "Admins acessam configuracoes empresa"
ON public.configuracoes_empresa FOR ALL
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = configuracoes_empresa.owner_id
      AND m.papel IN ('owner', 'admin')
  )
)
WITH CHECK (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = configuracoes_empresa.owner_id
      AND m.papel IN ('owner', 'admin')
  )
);

-- 8. RPC: adicionar membro por email
CREATE OR REPLACE FUNCTION public.adicionar_membro_por_email(
  _empresa_id UUID,
  _email TEXT,
  _papel public.empresa_papel
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_caller_eh_owner BOOLEAN;
BEGIN
  -- Apenas owner pode adicionar
  SELECT EXISTS (
    SELECT 1 FROM public.empresas
    WHERE id = _empresa_id AND owner_id = auth.uid()
  ) INTO v_caller_eh_owner;

  IF NOT v_caller_eh_owner AND NOT public.is_super_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Apenas o proprietário pode adicionar membros');
  END IF;

  IF _papel = 'owner' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Não é possível atribuir o papel de proprietário');
  END IF;

  -- Buscar usuário pelo email
  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = LOWER(TRIM(_email)) LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhum usuário encontrado com esse e-mail. Peça para que ele se cadastre primeiro no sistema.');
  END IF;

  -- Verificar se já é membro
  IF EXISTS (SELECT 1 FROM public.empresa_membros WHERE empresa_id = _empresa_id AND user_id = v_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este usuário já é membro da empresa');
  END IF;

  INSERT INTO public.empresa_membros (empresa_id, user_id, papel, convidado_por)
  VALUES (_empresa_id, v_user_id, _papel, auth.uid());

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id);
END;
$$;

-- 9. RPC: remover membro
CREATE OR REPLACE FUNCTION public.remover_membro(_membro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa UUID;
  v_papel public.empresa_papel;
BEGIN
  SELECT empresa_id, papel INTO v_empresa, v_papel FROM public.empresa_membros WHERE id = _membro_id;
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Membro não encontrado');
  END IF;

  IF v_papel = 'owner' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Não é possível remover o proprietário');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = v_empresa AND owner_id = auth.uid())
     AND NOT public.is_super_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Apenas o proprietário pode remover membros');
  END IF;

  DELETE FROM public.empresa_membros WHERE id = _membro_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 10. RPC: listar membros com email
CREATE OR REPLACE FUNCTION public.listar_membros_empresa(_empresa_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  papel public.empresa_papel,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.user_id, u.email::text, m.papel, m.created_at
  FROM public.empresa_membros m
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.empresa_id = _empresa_id
    AND (
      public.is_member_of(_empresa_id, auth.uid())
      OR public.is_super_admin(auth.uid())
    )
  ORDER BY m.created_at ASC;
$$;

-- 11. Trigger updated_at
CREATE TRIGGER trg_empresa_membros_updated
BEFORE UPDATE ON public.empresa_membros
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();