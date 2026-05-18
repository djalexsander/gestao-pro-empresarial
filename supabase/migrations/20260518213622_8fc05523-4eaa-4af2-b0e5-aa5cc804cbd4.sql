-- =============================================================================
-- Local-first: aceitar IDs vindos do desktop (Fase 1 — Produtos/Categorias/Variações)
-- =============================================================================

-- 1) criar_produto: aceita _produto_id opcional
DROP FUNCTION IF EXISTS public.criar_produto(text, text, text, numeric, numeric, numeric, produto_status, text, text, text, text, text, text, text, uuid, numeric, text, boolean, text, boolean, integer, uuid);

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
  _casas_decimais_quantidade integer DEFAULT 3,
  _client_uuid uuid DEFAULT NULL,
  _produto_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  -- Idempotência por ID vindo do cliente (desktop offline)
  IF _produto_id IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.produtos
    WHERE owner_id = v_owner AND id = _produto_id
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('produto_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  -- Idempotência por client_uuid (compat)
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
    id, owner_id, sku, nome, unidade, preco_custo, preco_venda, estoque_minimo,
    status, tipo_identificacao_principal,
    codigo_barras, qr_code, codigo_interno, observacao_tecnica,
    descricao, marca, categoria_id, estoque_inicial, ncm,
    vendido_por_peso, plu, aceita_etiqueta_balanca, casas_decimais_quantidade,
    client_uuid
  ) VALUES (
    COALESCE(_produto_id, gen_random_uuid()),
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
$function$;


-- 2) criar_categoria_produto: aceita _categoria_id_in opcional
DROP FUNCTION IF EXISTS public.criar_categoria_produto(text, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.criar_categoria_produto(
  _nome text,
  _parent_id uuid DEFAULT NULL,
  _descricao text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL,
  _categoria_id_in uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF _categoria_id_in IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.categorias_produto
    WHERE owner_id = v_owner AND id = _categoria_id_in
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('categoria_id', v_existing, 'idempotente', true);
    END IF;
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

  INSERT INTO public.categorias_produto (id, owner_id, nome, parent_id, descricao, client_uuid)
  VALUES (
    COALESCE(_categoria_id_in, gen_random_uuid()),
    v_owner, trim(_nome), _parent_id,
    NULLIF(trim(COALESCE(_descricao,'')),''), _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('categoria_id', v_id, 'idempotente', false);
END;
$function$;


-- 3) criar_produto_variacao: aceita _variacao_id_in opcional
DROP FUNCTION IF EXISTS public.criar_produto_variacao(uuid, text, text, jsonb, numeric, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.criar_produto_variacao(
  _produto_id uuid,
  _sku text,
  _nome text,
  _atributos jsonb DEFAULT '{}'::jsonb,
  _preco_custo numeric DEFAULT NULL,
  _preco_venda numeric DEFAULT NULL,
  _codigo_barras text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL,
  _variacao_id_in uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF _variacao_id_in IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.produto_variacoes
    WHERE owner_id = v_owner AND id = _variacao_id_in
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('variacao_id', v_existing, 'idempotente', true);
    END IF;
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
    id, owner_id, produto_id, sku, nome, atributos, preco_custo, preco_venda,
    codigo_barras, client_uuid
  ) VALUES (
    COALESCE(_variacao_id_in, gen_random_uuid()),
    v_owner, _produto_id, trim(_sku), trim(_nome),
    COALESCE(_atributos, '{}'::jsonb), _preco_custo, _preco_venda,
    NULLIF(trim(COALESCE(_codigo_barras,'')),''), _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('variacao_id', v_id, 'idempotente', false);
END;
$function$;