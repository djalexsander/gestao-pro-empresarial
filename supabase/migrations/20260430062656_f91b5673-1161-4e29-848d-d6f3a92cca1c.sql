-- ============================================================
-- Bloco 12 — CRUD de categorias (produto + financeira)
-- ============================================================

-- 1) Idempotência em categorias_financeiras
ALTER TABLE public.categorias_financeiras
  ADD COLUMN IF NOT EXISTS client_uuid UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cat_fin_owner_client
  ON public.categorias_financeiras (owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ============================================================
-- 2) CATEGORIAS DE PRODUTO
-- ============================================================

-- 2a) Editar
CREATE OR REPLACE FUNCTION public.editar_categoria_produto(
  _categoria_id UUID,
  _nome TEXT,
  _parent_id UUID DEFAULT NULL,
  _descricao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_parent_owner UUID;
BEGIN
  IF _nome IS NULL OR length(btrim(_nome)) = 0 THEN
    RAISE EXCEPTION 'Nome da categoria é obrigatório' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.categorias_produto
  WHERE id = _categoria_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  -- Não permitir auto-referência nem ciclo direto
  IF _parent_id = _categoria_id THEN
    RAISE EXCEPTION 'Categoria não pode ser pai dela mesma' USING ERRCODE = '22023';
  END IF;

  IF _parent_id IS NOT NULL THEN
    SELECT owner_id INTO v_parent_owner
    FROM public.categorias_produto
    WHERE id = _parent_id;
    IF v_parent_owner IS NULL OR v_parent_owner <> v_owner THEN
      RAISE EXCEPTION 'Categoria pai inválida' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.categorias_produto
  SET nome       = btrim(_nome),
      parent_id  = _parent_id,
      descricao  = _descricao,
      updated_at = now()
  WHERE id = _categoria_id;

  RETURN jsonb_build_object('categoria_id', _categoria_id);
END;
$$;

REVOKE ALL ON FUNCTION public.editar_categoria_produto(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_categoria_produto(uuid, text, uuid, text) TO authenticated;

-- 2b) Alterar status (ativar/inativar)
CREATE OR REPLACE FUNCTION public.alterar_status_categoria_produto(
  _categoria_id UUID,
  _ativo BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_atual BOOLEAN;
BEGIN
  SELECT owner_id, ativo INTO v_owner, v_atual
  FROM public.categorias_produto
  WHERE id = _categoria_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  IF v_atual = _ativo THEN
    RETURN jsonb_build_object(
      'categoria_id', _categoria_id,
      'ativo',        _ativo,
      'idempotente',  TRUE
    );
  END IF;

  UPDATE public.categorias_produto
  SET ativo = _ativo, updated_at = now()
  WHERE id = _categoria_id;

  RETURN jsonb_build_object(
    'categoria_id', _categoria_id,
    'ativo',        _ativo,
    'idempotente',  FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.alterar_status_categoria_produto(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alterar_status_categoria_produto(uuid, boolean) TO authenticated;

-- 2c) Excluir (hard delete bloqueado por vínculos)
CREATE OR REPLACE FUNCTION public.excluir_categoria_produto(
  _categoria_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner       UUID;
  v_qtd_prod    INTEGER;
  v_qtd_filhas  INTEGER;
BEGIN
  SELECT owner_id INTO v_owner
  FROM public.categorias_produto
  WHERE id = _categoria_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_qtd_prod
  FROM public.produtos WHERE categoria_id = _categoria_id;

  SELECT count(*) INTO v_qtd_filhas
  FROM public.categorias_produto WHERE parent_id = _categoria_id;

  IF v_qtd_prod > 0 OR v_qtd_filhas > 0 THEN
    RAISE EXCEPTION
      'Categoria possui % produto(s) e % subcategoria(s) vinculadas. Inative em vez de excluir.',
      v_qtd_prod, v_qtd_filhas
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.categorias_produto WHERE id = _categoria_id;

  RETURN jsonb_build_object(
    'categoria_id', _categoria_id,
    'excluido',     TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_categoria_produto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_categoria_produto(uuid) TO authenticated;

-- ============================================================
-- 3) CATEGORIAS FINANCEIRAS
-- ============================================================

-- Helper de permissão (owner ou admin/owner da empresa)
CREATE OR REPLACE FUNCTION public._pode_gerenciar_categorias_financeiras(_owner UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = _owner
        AND m.papel IN ('owner','admin')
    );
$$;

REVOKE ALL ON FUNCTION public._pode_gerenciar_categorias_financeiras(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._pode_gerenciar_categorias_financeiras(uuid) TO authenticated;

-- Resolve owner_id da empresa ativa do caller
CREATE OR REPLACE FUNCTION public._owner_atual_categorias_financeiras()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Se for owner direto, retorna o próprio uid; senão, resolve via empresa_membros.
  SELECT COALESCE(
    (SELECT id FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1),
    (SELECT e.owner_id
     FROM public.empresa_membros m
     JOIN public.empresas e ON e.id = m.empresa_id
     WHERE m.user_id = auth.uid()
       AND m.papel IN ('owner','admin')
     LIMIT 1)
  )::uuid;
$$;

-- 3a) Criar (com idempotência)
CREATE OR REPLACE FUNCTION public.criar_categoria_financeira(
  _nome TEXT,
  _tipo categoria_financeira_tipo,
  _parent_id UUID DEFAULT NULL,
  _cor TEXT DEFAULT NULL,
  _client_uuid UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_parent_owner UUID;
  v_parent_tipo categoria_financeira_tipo;
  v_existente UUID;
  v_id UUID;
BEGIN
  IF _nome IS NULL OR length(btrim(_nome)) = 0 THEN
    RAISE EXCEPTION 'Nome da categoria é obrigatório' USING ERRCODE = '22023';
  END IF;

  -- Resolve owner_id baseado no caller
  v_owner := auth.uid();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- Se o caller for admin/membro mas não dono, ele pertence à empresa de outro owner.
  -- Buscamos o owner_id da empresa onde ele tem papel admin/owner.
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE owner_id = v_owner) THEN
    SELECT e.owner_id INTO v_owner
    FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND m.papel IN ('owner','admin')
    LIMIT 1;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Idempotência por client_uuid
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existente
    FROM public.categorias_financeiras
    WHERE owner_id = v_owner AND client_uuid = _client_uuid;
    IF v_existente IS NOT NULL THEN
      RETURN jsonb_build_object(
        'categoria_id', v_existente,
        'idempotente',  TRUE
      );
    END IF;
  END IF;

  -- Valida parent (mesmo owner, mesmo tipo)
  IF _parent_id IS NOT NULL THEN
    SELECT owner_id, tipo INTO v_parent_owner, v_parent_tipo
    FROM public.categorias_financeiras
    WHERE id = _parent_id;
    IF v_parent_owner IS NULL OR v_parent_owner <> v_owner THEN
      RAISE EXCEPTION 'Categoria pai inválida' USING ERRCODE = '22023';
    END IF;
    IF v_parent_tipo <> _tipo THEN
      RAISE EXCEPTION 'Categoria pai deve ser do mesmo tipo (%)', _tipo USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.categorias_financeiras
    (owner_id, nome, tipo, parent_id, cor, client_uuid)
  VALUES
    (v_owner, btrim(_nome), _tipo, _parent_id, _cor, _client_uuid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'categoria_id', v_id,
    'idempotente',  FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.criar_categoria_financeira(text, categoria_financeira_tipo, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_categoria_financeira(text, categoria_financeira_tipo, uuid, text, uuid) TO authenticated;

-- 3b) Editar (não muda tipo)
CREATE OR REPLACE FUNCTION public.editar_categoria_financeira(
  _categoria_id UUID,
  _nome TEXT,
  _parent_id UUID DEFAULT NULL,
  _cor TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_tipo  categoria_financeira_tipo;
  v_parent_owner UUID;
  v_parent_tipo  categoria_financeira_tipo;
BEGIN
  IF _nome IS NULL OR length(btrim(_nome)) = 0 THEN
    RAISE EXCEPTION 'Nome da categoria é obrigatório' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id, tipo INTO v_owner, v_tipo
  FROM public.categorias_financeiras
  WHERE id = _categoria_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._pode_gerenciar_categorias_financeiras(v_owner) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  IF _parent_id = _categoria_id THEN
    RAISE EXCEPTION 'Categoria não pode ser pai dela mesma' USING ERRCODE = '22023';
  END IF;

  IF _parent_id IS NOT NULL THEN
    SELECT owner_id, tipo INTO v_parent_owner, v_parent_tipo
    FROM public.categorias_financeiras
    WHERE id = _parent_id;
    IF v_parent_owner IS NULL OR v_parent_owner <> v_owner THEN
      RAISE EXCEPTION 'Categoria pai inválida' USING ERRCODE = '22023';
    END IF;
    IF v_parent_tipo <> v_tipo THEN
      RAISE EXCEPTION 'Categoria pai deve ser do mesmo tipo (%)', v_tipo USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.categorias_financeiras
  SET nome       = btrim(_nome),
      parent_id  = _parent_id,
      cor        = _cor,
      updated_at = now()
  WHERE id = _categoria_id;

  RETURN jsonb_build_object('categoria_id', _categoria_id);
END;
$$;

REVOKE ALL ON FUNCTION public.editar_categoria_financeira(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_categoria_financeira(uuid, text, uuid, text) TO authenticated;

-- 3c) Alterar status
CREATE OR REPLACE FUNCTION public.alterar_status_categoria_financeira(
  _categoria_id UUID,
  _ativo BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_atual BOOLEAN;
BEGIN
  SELECT owner_id, ativo INTO v_owner, v_atual
  FROM public.categorias_financeiras
  WHERE id = _categoria_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._pode_gerenciar_categorias_financeiras(v_owner) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  IF v_atual = _ativo THEN
    RETURN jsonb_build_object(
      'categoria_id', _categoria_id,
      'ativo',        _ativo,
      'idempotente',  TRUE
    );
  END IF;

  UPDATE public.categorias_financeiras
  SET ativo = _ativo, updated_at = now()
  WHERE id = _categoria_id;

  RETURN jsonb_build_object(
    'categoria_id', _categoria_id,
    'ativo',        _ativo,
    'idempotente',  FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.alterar_status_categoria_financeira(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alterar_status_categoria_financeira(uuid, boolean) TO authenticated;

-- 3d) Excluir (hard delete bloqueado por vínculos)
CREATE OR REPLACE FUNCTION public.excluir_categoria_financeira(
  _categoria_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner       UUID;
  v_qtd_lanc    INTEGER;
  v_qtd_filhas  INTEGER;
BEGIN
  SELECT owner_id INTO v_owner
  FROM public.categorias_financeiras
  WHERE id = _categoria_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._pode_gerenciar_categorias_financeiras(v_owner) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_qtd_lanc
  FROM public.financeiro_lancamentos WHERE categoria_id = _categoria_id;

  SELECT count(*) INTO v_qtd_filhas
  FROM public.categorias_financeiras WHERE parent_id = _categoria_id;

  IF v_qtd_lanc > 0 OR v_qtd_filhas > 0 THEN
    RAISE EXCEPTION
      'Categoria possui % lançamento(s) e % subcategoria(s) vinculadas. Inative em vez de excluir.',
      v_qtd_lanc, v_qtd_filhas
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.categorias_financeiras WHERE id = _categoria_id;

  RETURN jsonb_build_object(
    'categoria_id', _categoria_id,
    'excluido',     TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_categoria_financeira(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_categoria_financeira(uuid) TO authenticated;