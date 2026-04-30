-- ============================================================================
-- Cliente / Fornecedor: CRUD via RPC SECURITY DEFINER
-- ============================================================================
-- Padroniza writes de cliente/fornecedor centralizando validações no banco:
--   - tenant resolvido pelo banco (auth.uid)
--   - idempotência em criar via client_uuid
--   - exclusão segura: hard delete só sem vínculos; com vínculo, bloqueia
--     e sugere soft delete (status='inativo')
--   - histórico preservado: nunca apagar cliente/fornecedor referenciado por
--     vendas/compras/lançamentos
-- ============================================================================

-- Idempotência: client_uuid em clientes/fornecedores (CRIAÇÃO)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS clientes_owner_client_uuid_uniq
  ON public.clientes(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS fornecedores_owner_client_uuid_uniq
  ON public.fornecedores(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ============================================================================
-- CLIENTE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.criar_cliente(
  _tipo pessoa_tipo,
  _nome text,
  _nome_fantasia text DEFAULT NULL,
  _documento text DEFAULT NULL,
  _inscricao_estadual text DEFAULT NULL,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _celular text DEFAULT NULL,
  _data_nascimento date DEFAULT NULL,
  _cep text DEFAULT NULL,
  _logradouro text DEFAULT NULL,
  _numero text DEFAULT NULL,
  _complemento text DEFAULT NULL,
  _bairro text DEFAULT NULL,
  _cidade text DEFAULT NULL,
  _estado text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _status cadastro_status DEFAULT 'ativo',
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
  v_doc text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  -- Idempotência
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.clientes
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('cliente_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  -- Normaliza documento
  v_doc := NULLIF(regexp_replace(COALESCE(_documento, ''), '\D+', '', 'g'), '');

  INSERT INTO public.clientes (
    owner_id, tipo, nome, nome_fantasia, documento, inscricao_estadual,
    email, telefone, celular, data_nascimento, cep, logradouro, numero,
    complemento, bairro, cidade, estado, observacoes, status, client_uuid
  ) VALUES (
    v_owner, _tipo, trim(_nome), NULLIF(trim(COALESCE(_nome_fantasia,'')),''),
    v_doc, NULLIF(trim(COALESCE(_inscricao_estadual,'')),''),
    NULLIF(trim(COALESCE(_email,'')),''), NULLIF(trim(COALESCE(_telefone,'')),''),
    NULLIF(trim(COALESCE(_celular,'')),''), _data_nascimento,
    NULLIF(trim(COALESCE(_cep,'')),''), NULLIF(trim(COALESCE(_logradouro,'')),''),
    NULLIF(trim(COALESCE(_numero,'')),''), NULLIF(trim(COALESCE(_complemento,'')),''),
    NULLIF(trim(COALESCE(_bairro,'')),''), NULLIF(trim(COALESCE(_cidade,'')),''),
    NULLIF(trim(COALESCE(_estado,'')),''), NULLIF(trim(COALESCE(_observacoes,'')),''),
    COALESCE(_status, 'ativo'), _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('cliente_id', v_id, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.editar_cliente(
  _cliente_id uuid,
  _tipo pessoa_tipo,
  _nome text,
  _nome_fantasia text DEFAULT NULL,
  _documento text DEFAULT NULL,
  _inscricao_estadual text DEFAULT NULL,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _celular text DEFAULT NULL,
  _data_nascimento date DEFAULT NULL,
  _cep text DEFAULT NULL,
  _logradouro text DEFAULT NULL,
  _numero text DEFAULT NULL,
  _complemento text DEFAULT NULL,
  _bairro text DEFAULT NULL,
  _cidade text DEFAULT NULL,
  _estado text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _status cadastro_status DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_doc text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clientes
    WHERE id = _cliente_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING ERRCODE = 'P0002';
  END IF;

  v_doc := NULLIF(regexp_replace(COALESCE(_documento, ''), '\D+', '', 'g'), '');

  UPDATE public.clientes SET
    tipo = _tipo,
    nome = trim(_nome),
    nome_fantasia = NULLIF(trim(COALESCE(_nome_fantasia,'')),''),
    documento = v_doc,
    inscricao_estadual = NULLIF(trim(COALESCE(_inscricao_estadual,'')),''),
    email = NULLIF(trim(COALESCE(_email,'')),''),
    telefone = NULLIF(trim(COALESCE(_telefone,'')),''),
    celular = NULLIF(trim(COALESCE(_celular,'')),''),
    data_nascimento = _data_nascimento,
    cep = NULLIF(trim(COALESCE(_cep,'')),''),
    logradouro = NULLIF(trim(COALESCE(_logradouro,'')),''),
    numero = NULLIF(trim(COALESCE(_numero,'')),''),
    complemento = NULLIF(trim(COALESCE(_complemento,'')),''),
    bairro = NULLIF(trim(COALESCE(_bairro,'')),''),
    cidade = NULLIF(trim(COALESCE(_cidade,'')),''),
    estado = NULLIF(trim(COALESCE(_estado,'')),''),
    observacoes = NULLIF(trim(COALESCE(_observacoes,'')),''),
    status = COALESCE(_status, status),
    updated_at = now()
  WHERE id = _cliente_id;

  RETURN jsonb_build_object('cliente_id', _cliente_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.alterar_status_cliente(
  _cliente_id uuid,
  _status cadastro_status
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

  UPDATE public.clientes
  SET status = _status, updated_at = now()
  WHERE id = _cliente_id AND acessa_owner_id(owner_id, v_owner);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('cliente_id', _cliente_id, 'status', _status);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_cliente(_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_vendas int;
  v_lancamentos int;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clientes
    WHERE id = _cliente_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Conta vínculos
  SELECT count(*) INTO v_vendas FROM public.vendas WHERE cliente_id = _cliente_id;
  SELECT count(*) INTO v_lancamentos FROM public.financeiro_lancamentos WHERE cliente_id = _cliente_id;

  IF v_vendas > 0 OR v_lancamentos > 0 THEN
    RAISE EXCEPTION 'Cliente possui % venda(s) e % lançamento(s) vinculado(s). Inative o cadastro em vez de excluir.', v_vendas, v_lancamentos
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.clientes WHERE id = _cliente_id;

  RETURN jsonb_build_object('cliente_id', _cliente_id, 'excluido', true);
END;
$$;

-- ============================================================================
-- FORNECEDOR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.criar_fornecedor(
  _tipo pessoa_tipo,
  _razao_social text,
  _nome_fantasia text DEFAULT NULL,
  _documento text DEFAULT NULL,
  _inscricao_estadual text DEFAULT NULL,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _contato_nome text DEFAULT NULL,
  _cep text DEFAULT NULL,
  _logradouro text DEFAULT NULL,
  _numero text DEFAULT NULL,
  _complemento text DEFAULT NULL,
  _bairro text DEFAULT NULL,
  _cidade text DEFAULT NULL,
  _estado text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _status cadastro_status DEFAULT 'ativo',
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
  v_doc text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.fornecedores
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('fornecedor_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  v_doc := NULLIF(regexp_replace(COALESCE(_documento, ''), '\D+', '', 'g'), '');

  INSERT INTO public.fornecedores (
    owner_id, tipo, razao_social, nome_fantasia, documento, inscricao_estadual,
    email, telefone, contato_nome, cep, logradouro, numero, complemento,
    bairro, cidade, estado, observacoes, status, client_uuid
  ) VALUES (
    v_owner, _tipo, trim(_razao_social),
    NULLIF(trim(COALESCE(_nome_fantasia,'')),''),
    v_doc, NULLIF(trim(COALESCE(_inscricao_estadual,'')),''),
    NULLIF(trim(COALESCE(_email,'')),''), NULLIF(trim(COALESCE(_telefone,'')),''),
    NULLIF(trim(COALESCE(_contato_nome,'')),''),
    NULLIF(trim(COALESCE(_cep,'')),''), NULLIF(trim(COALESCE(_logradouro,'')),''),
    NULLIF(trim(COALESCE(_numero,'')),''), NULLIF(trim(COALESCE(_complemento,'')),''),
    NULLIF(trim(COALESCE(_bairro,'')),''), NULLIF(trim(COALESCE(_cidade,'')),''),
    NULLIF(trim(COALESCE(_estado,'')),''), NULLIF(trim(COALESCE(_observacoes,'')),''),
    COALESCE(_status, 'ativo'), _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('fornecedor_id', v_id, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.editar_fornecedor(
  _fornecedor_id uuid,
  _tipo pessoa_tipo,
  _razao_social text,
  _nome_fantasia text DEFAULT NULL,
  _documento text DEFAULT NULL,
  _inscricao_estadual text DEFAULT NULL,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _contato_nome text DEFAULT NULL,
  _cep text DEFAULT NULL,
  _logradouro text DEFAULT NULL,
  _numero text DEFAULT NULL,
  _complemento text DEFAULT NULL,
  _bairro text DEFAULT NULL,
  _cidade text DEFAULT NULL,
  _estado text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _status cadastro_status DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_doc text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.fornecedores
    WHERE id = _fornecedor_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Fornecedor não encontrado' USING ERRCODE = 'P0002';
  END IF;

  v_doc := NULLIF(regexp_replace(COALESCE(_documento, ''), '\D+', '', 'g'), '');

  UPDATE public.fornecedores SET
    tipo = _tipo,
    razao_social = trim(_razao_social),
    nome_fantasia = NULLIF(trim(COALESCE(_nome_fantasia,'')),''),
    documento = v_doc,
    inscricao_estadual = NULLIF(trim(COALESCE(_inscricao_estadual,'')),''),
    email = NULLIF(trim(COALESCE(_email,'')),''),
    telefone = NULLIF(trim(COALESCE(_telefone,'')),''),
    contato_nome = NULLIF(trim(COALESCE(_contato_nome,'')),''),
    cep = NULLIF(trim(COALESCE(_cep,'')),''),
    logradouro = NULLIF(trim(COALESCE(_logradouro,'')),''),
    numero = NULLIF(trim(COALESCE(_numero,'')),''),
    complemento = NULLIF(trim(COALESCE(_complemento,'')),''),
    bairro = NULLIF(trim(COALESCE(_bairro,'')),''),
    cidade = NULLIF(trim(COALESCE(_cidade,'')),''),
    estado = NULLIF(trim(COALESCE(_estado,'')),''),
    observacoes = NULLIF(trim(COALESCE(_observacoes,'')),''),
    status = COALESCE(_status, status),
    updated_at = now()
  WHERE id = _fornecedor_id;

  RETURN jsonb_build_object('fornecedor_id', _fornecedor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.alterar_status_fornecedor(
  _fornecedor_id uuid,
  _status cadastro_status
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

  UPDATE public.fornecedores
  SET status = _status, updated_at = now()
  WHERE id = _fornecedor_id AND acessa_owner_id(owner_id, v_owner);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fornecedor não encontrado' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('fornecedor_id', _fornecedor_id, 'status', _status);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_fornecedor(_fornecedor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_compras int;
  v_lancamentos int;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.fornecedores
    WHERE id = _fornecedor_id AND acessa_owner_id(owner_id, v_owner)
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Fornecedor não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_compras FROM public.compras WHERE fornecedor_id = _fornecedor_id;
  SELECT count(*) INTO v_lancamentos FROM public.financeiro_lancamentos WHERE fornecedor_id = _fornecedor_id;

  IF v_compras > 0 OR v_lancamentos > 0 THEN
    RAISE EXCEPTION 'Fornecedor possui % compra(s) e % lançamento(s) vinculado(s). Inative o cadastro em vez de excluir.', v_compras, v_lancamentos
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.fornecedores WHERE id = _fornecedor_id;

  RETURN jsonb_build_object('fornecedor_id', _fornecedor_id, 'excluido', true);
END;
$$;