-- ============================================================================
-- PRODUTO / CÓDIGOS / VARIAÇÕES — CRUD via RPC SECURITY DEFINER
-- ============================================================================

-- Idempotência: client_uuid em produtos, produto_codigos, produto_variacoes
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS produtos_owner_client_uuid_uniq
  ON public.produtos(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

ALTER TABLE public.produto_codigos
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS produto_codigos_owner_client_uuid_uniq
  ON public.produto_codigos(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

ALTER TABLE public.produto_variacoes
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS produto_variacoes_owner_client_uuid_uniq
  ON public.produto_variacoes(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS categorias_produto_owner_client_uuid_uniq
  ON public.categorias_produto(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ============================================================================
-- CATEGORIA DE PRODUTO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.criar_categoria_produto(
  _nome text,
  _parent_id uuid DEFAULT NULL,
  _descricao text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.categorias_produto
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('categoria_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  INSERT INTO public.categorias_produto (owner_id, nome, parent_id, descricao, client_uuid)
  VALUES (v_owner, trim(_nome), _parent_id, NULLIF(trim(COALESCE(_descricao,'')),''), _client_uuid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('categoria_id', v_id, 'idempotente', false);
END;
$$;

-- ============================================================================
-- PRODUTO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.criar_produto(
  _sku text,
  _nome text,
  _unidade text,
  _preco_custo numeric,
  _preco_venda numeric,
  _estoque_minimo numeric,
  _status produto_status,
  _tipo_identificacao_principal text DEFAULT 'sku',
  _codigo_barras text DEFAULT NULL,
  _qr_code text DEFAULT NULL,
  _codigo_interno text DEFAULT NULL,
  _observacao_tecnica text DEFAULT NULL,
  _descricao text DEFAULT NULL,
  _marca text DEFAULT NULL,
  _categoria_id uuid DEFAULT NULL,
  _estoque_inicial numeric DEFAULT 0,
  _ncm text DEFAULT NULL,
  _vendido_por_peso boolean DEFAULT false,
  _plu text DEFAULT NULL,
  _aceita_etiqueta_balanca boolean DEFAULT false,
  _casas_decimais_quantidade int DEFAULT 3,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.produtos
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('produto_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  INSERT INTO public.produtos (
    owner_id, sku, nome, unidade, preco_custo, preco_venda, estoque_minimo,
    status, tipo_identificacao_principal,
    codigo_barras, qr_code, codigo_interno, observacao_tecnica,
    descricao, marca, categoria_id, estoque_inicial, ncm,
    vendido_por_peso, plu, aceita_etiqueta_balanca, casas_decimais_quantidade,
    client_uuid
  ) VALUES (
    v_owner, trim(_sku), trim(_nome), _unidade, _preco_custo, _preco_venda,
    COALESCE(_estoque_minimo, 0), _status,
    COALESCE(_tipo_identificacao_principal, 'sku'),
    NULLIF(trim(COALESCE(_codigo_barras,'')),''),
    NULLIF(trim(COALESCE(_qr_code,'')),''),
    NULLIF(trim(COALESCE(_codigo_interno,'')),''),
    NULLIF(trim(COALESCE(_observacao_tecnica,'')),''),
    NULLIF(trim(COALESCE(_descricao,'')),''),
    NULLIF(trim(COALESCE(_marca,'')),''),
    _categoria_id, COALESCE(_estoque_inicial, 0),
    NULLIF(trim(COALESCE(_ncm,'')),''),
    COALESCE(_vendido_por_peso, false),
    NULLIF(trim(COALESCE(_plu,'')),''),
    COALESCE(_aceita_etiqueta_balanca, false),
    COALESCE(_casas_decimais_quantidade, 3),
    _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('produto_id', v_id, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.editar_produto(
  _produto_id uuid,
  _sku text,
  _nome text,
  _unidade text,
  _preco_custo numeric,
  _preco_venda numeric,
  _estoque_minimo numeric,
  _status produto_status,
  _tipo_identificacao_principal text DEFAULT 'sku',
  _codigo_barras text DEFAULT NULL,
  _qr_code text DEFAULT NULL,
  _codigo_interno text DEFAULT NULL,
  _observacao_tecnica text DEFAULT NULL,
  _descricao text DEFAULT NULL,
  _marca text DEFAULT NULL,
  _categoria_id uuid DEFAULT NULL,
  _estoque_inicial numeric DEFAULT NULL,
  _ncm text DEFAULT NULL,
  _vendido_por_peso boolean DEFAULT NULL,
  _plu text DEFAULT NULL,
  _aceita_etiqueta_balanca boolean DEFAULT NULL,
  _casas_decimais_quantidade int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.produtos
    WHERE id = _produto_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.produtos SET
    sku = trim(_sku),
    nome = trim(_nome),
    unidade = _unidade,
    preco_custo = _preco_custo,
    preco_venda = _preco_venda,
    estoque_minimo = COALESCE(_estoque_minimo, estoque_minimo),
    status = _status,
    tipo_identificacao_principal = COALESCE(_tipo_identificacao_principal, tipo_identificacao_principal),
    codigo_barras = NULLIF(trim(COALESCE(_codigo_barras,'')),''),
    qr_code = NULLIF(trim(COALESCE(_qr_code,'')),''),
    codigo_interno = NULLIF(trim(COALESCE(_codigo_interno,'')),''),
    observacao_tecnica = NULLIF(trim(COALESCE(_observacao_tecnica,'')),''),
    descricao = NULLIF(trim(COALESCE(_descricao,'')),''),
    marca = NULLIF(trim(COALESCE(_marca,'')),''),
    categoria_id = _categoria_id,
    estoque_inicial = COALESCE(_estoque_inicial, estoque_inicial),
    ncm = NULLIF(trim(COALESCE(_ncm,'')),''),
    vendido_por_peso = COALESCE(_vendido_por_peso, vendido_por_peso),
    plu = NULLIF(trim(COALESCE(_plu,'')),''),
    aceita_etiqueta_balanca = COALESCE(_aceita_etiqueta_balanca, aceita_etiqueta_balanca),
    casas_decimais_quantidade = COALESCE(_casas_decimais_quantidade, casas_decimais_quantidade),
    updated_at = now()
  WHERE id = _produto_id;

  RETURN jsonb_build_object('produto_id', _produto_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.alterar_status_produto(
  _produto_id uuid,
  _status produto_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  UPDATE public.produtos
  SET status = _status, updated_at = now()
  WHERE id = _produto_id AND acessa_owner_id(owner_id, v_owner);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('produto_id', _produto_id, 'status', _status);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_produto(_produto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_vendas int;
  v_compras int;
  v_movs int;
  v_lotes int;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.produtos
    WHERE id = _produto_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_vendas FROM public.venda_itens WHERE produto_id = _produto_id;
  SELECT count(*) INTO v_compras FROM public.compra_itens WHERE produto_id = _produto_id;
  SELECT count(*) INTO v_movs FROM public.estoque_movimentacoes WHERE produto_id = _produto_id;
  SELECT count(*) INTO v_lotes FROM public.lotes_produto WHERE produto_id = _produto_id;

  IF v_vendas > 0 OR v_compras > 0 OR v_movs > 0 OR v_lotes > 0 THEN
    RAISE EXCEPTION 'Produto possui % venda(s), % compra(s), % movimento(s) de estoque e % lote(s) vinculado(s). Inative o cadastro em vez de excluir.',
      v_vendas, v_compras, v_movs, v_lotes
      USING ERRCODE = '23503';
  END IF;

  -- Sem vínculos: limpa filhos diretos (códigos auxiliares e variações vazias).
  DELETE FROM public.produto_codigos WHERE produto_id = _produto_id;
  DELETE FROM public.produto_variacoes WHERE produto_id = _produto_id;
  DELETE FROM public.produtos WHERE id = _produto_id;

  RETURN jsonb_build_object('produto_id', _produto_id, 'excluido', true);
END;
$$;

-- ============================================================================
-- PRODUTO_CODIGOS (códigos auxiliares — barras/QR/SKU/interno/alternativo)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adicionar_produto_codigo(
  _produto_id uuid,
  _tipo_codigo text,
  _valor_codigo text,
  _variacao_id uuid DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
  v_valor text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  v_valor := NULLIF(trim(COALESCE(_valor_codigo, '')), '');
  IF v_valor IS NULL THEN
    RAISE EXCEPTION 'Código vazio' USING ERRCODE = '22023';
  END IF;

  -- Valida tenant do produto
  IF NOT EXISTS (
    SELECT 1 FROM public.produtos
    WHERE id = _produto_id AND acessa_owner_id(owner_id, v_owner)
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.produto_codigos
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('codigo_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  INSERT INTO public.produto_codigos (
    owner_id, produto_id, variacao_id, tipo_codigo, valor_codigo, observacao, client_uuid
  ) VALUES (
    v_owner, _produto_id, _variacao_id, _tipo_codigo, v_valor,
    NULLIF(trim(COALESCE(_observacao,'')),''), _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('codigo_id', v_id, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_produto_codigo(_codigo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.produto_codigos
  WHERE id = _codigo_id AND acessa_owner_id(owner_id, v_owner);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código não encontrado' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('codigo_id', _codigo_id, 'excluido', true);
END;
$$;

-- ============================================================================
-- PRODUTO_VARIACOES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.criar_produto_variacao(
  _produto_id uuid,
  _sku text,
  _nome text,
  _atributos jsonb DEFAULT '{}'::jsonb,
  _preco_custo numeric DEFAULT NULL,
  _preco_venda numeric DEFAULT NULL,
  _codigo_barras text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.produtos
    WHERE id = _produto_id AND acessa_owner_id(owner_id, v_owner)
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.produto_variacoes
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('variacao_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  INSERT INTO public.produto_variacoes (
    owner_id, produto_id, sku, nome, atributos, preco_custo, preco_venda,
    codigo_barras, client_uuid
  ) VALUES (
    v_owner, _produto_id, trim(_sku), trim(_nome),
    COALESCE(_atributos, '{}'::jsonb), _preco_custo, _preco_venda,
    NULLIF(trim(COALESCE(_codigo_barras,'')),''), _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('variacao_id', v_id, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_produto_variacao(_variacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_vendas int;
  v_compras int;
  v_movs int;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.produto_variacoes
    WHERE id = _variacao_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Variação não encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_vendas FROM public.venda_itens WHERE variacao_id = _variacao_id;
  SELECT count(*) INTO v_compras FROM public.compra_itens WHERE variacao_id = _variacao_id;
  SELECT count(*) INTO v_movs FROM public.estoque_movimentacoes WHERE variacao_id = _variacao_id;

  IF v_vendas > 0 OR v_compras > 0 OR v_movs > 0 THEN
    RAISE EXCEPTION 'Variação possui % venda(s), % compra(s) e % movimento(s) de estoque vinculado(s). Inative o produto em vez de excluir a variação.',
      v_vendas, v_compras, v_movs
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.produto_codigos WHERE variacao_id = _variacao_id;
  DELETE FROM public.produto_variacoes WHERE id = _variacao_id;

  RETURN jsonb_build_object('variacao_id', _variacao_id, 'excluido', true);
END;
$$;