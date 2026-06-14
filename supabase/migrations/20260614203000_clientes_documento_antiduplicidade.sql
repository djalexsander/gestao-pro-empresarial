-- Evita novos clientes duplicados pelo mesmo documento dentro do tenant.
-- Registros historicos existentes nao sao apagados; a RPC passa a reutilizar
-- o cadastro mais recente, preservando referencias de vendas antigas.
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
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = '28000';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.clientes
     WHERE owner_id = v_owner AND client_uuid = _client_uuid
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('cliente_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  v_doc := NULLIF(regexp_replace(COALESCE(_documento, ''), '\D+', '', 'g'), '');
  IF v_doc IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || v_doc, 0));
    SELECT id INTO v_existing
      FROM public.clientes
     WHERE owner_id = v_owner AND documento = v_doc
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'cliente_id', v_existing,
        'idempotente', true,
        'documento_existente', true
      );
    END IF;
  END IF;

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
