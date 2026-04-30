-- 1) Coluna de idempotência em financeiro_lancamentos
ALTER TABLE public.financeiro_lancamentos
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS financeiro_lanc_client_uuid_owner_uniq
  ON public.financeiro_lancamentos (owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- =====================================================================
-- 2) criar_lancamento_avulso
-- =====================================================================
CREATE OR REPLACE FUNCTION public.criar_lancamento_avulso(
  _tipo               text,        -- 'receber' | 'pagar'
  _descricao          text,
  _valor              numeric,
  _data_vencimento    date,
  _data_emissao       date,
  _categoria_id       uuid,
  _cliente_id         uuid,
  _fornecedor_id      uuid,
  _numero_documento   text,
  _forma_pagamento    text,        -- enum forma_pagamento ou null
  _observacoes        text,
  _client_uuid        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_existing public.financeiro_lancamentos%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF _tipo NOT IN ('receber','pagar') THEN
    RAISE EXCEPTION 'Tipo inválido: % (use receber ou pagar)', _tipo;
  END IF;

  IF _descricao IS NULL OR length(btrim(_descricao)) = 0 THEN
    RAISE EXCEPTION 'Descrição é obrigatória.';
  END IF;

  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero.';
  END IF;

  IF _data_vencimento IS NULL THEN
    RAISE EXCEPTION 'Data de vencimento é obrigatória.';
  END IF;

  -- Idempotência
  IF _client_uuid IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.financeiro_lancamentos
     WHERE owner_id = v_owner
       AND client_uuid = _client_uuid
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'lancamento_id', v_existing.id,
        'idempotente',   true
      );
    END IF;
  END IF;

  INSERT INTO public.financeiro_lancamentos (
    owner_id, tipo, descricao, valor, valor_pago,
    data_vencimento, data_emissao, status,
    categoria_id, cliente_id, fornecedor_id,
    numero_documento, forma_pagamento, observacoes,
    client_uuid
  ) VALUES (
    v_owner, _tipo::lancamento_tipo, _descricao, _valor, 0,
    _data_vencimento, COALESCE(_data_emissao, CURRENT_DATE),
    'pendente'::lancamento_status,
    _categoria_id, _cliente_id, _fornecedor_id,
    _numero_documento,
    NULLIF(_forma_pagamento,'')::forma_pagamento,
    _observacoes, _client_uuid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'lancamento_id', v_id,
    'idempotente',   false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.criar_lancamento_avulso(
  text, text, numeric, date, date, uuid, uuid, uuid, text, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_lancamento_avulso(
  text, text, numeric, date, date, uuid, uuid, uuid, text, text, text, uuid
) TO authenticated;

-- =====================================================================
-- 3) editar_lancamento_avulso
-- =====================================================================
-- Permite editar descricao, valor, vencimento, categoria, fornecedor,
-- cliente, numero_documento, forma_pagamento e observacoes.
-- Não permite mudar tipo (receber↔pagar), nem editar lançamentos:
--   - vinculados a venda (use fluxo de venda),
--   - cancelados,
--   - totalmente quitados (pago/recebido).
-- Não permite reduzir valor abaixo de valor_pago.
-- Idempotente: reenvio com mesmo client_uuid retorna sem reaplicar.
CREATE OR REPLACE FUNCTION public.editar_lancamento_avulso(
  _lancamento_id      uuid,
  _descricao          text,
  _valor              numeric,
  _data_vencimento    date,
  _data_emissao       date,
  _categoria_id       uuid,
  _cliente_id         uuid,
  _fornecedor_id      uuid,
  _numero_documento   text,
  _forma_pagamento    text,
  _observacoes        text,
  _client_uuid        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_lanc  public.financeiro_lancamentos%ROWTYPE;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Idempotência por client_uuid: se já existe um lançamento marcado
  -- com este UUID e é o mesmo lançamento alvo, devolve sem reaplicar.
  IF _client_uuid IS NOT NULL THEN
    SELECT * INTO v_lanc
      FROM public.financeiro_lancamentos
     WHERE owner_id = v_owner
       AND client_uuid = _client_uuid
     LIMIT 1;
    IF FOUND AND v_lanc.id = _lancamento_id THEN
      RETURN jsonb_build_object(
        'lancamento_id', v_lanc.id,
        'idempotente',   true
      );
    END IF;
    -- Se o UUID existe mas em OUTRO título, é tentativa de duplicar UUID
    IF FOUND AND v_lanc.id <> _lancamento_id THEN
      RAISE EXCEPTION 'client_uuid já em uso por outro lançamento.';
    END IF;
  END IF;

  -- Lock do título antes de mexer (evita corrida com pagamento simultâneo)
  SELECT * INTO v_lanc
    FROM public.financeiro_lancamentos
   WHERE id = _lancamento_id
     AND owner_id = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF v_lanc.venda_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento vinculado a venda — não pode ser editado por aqui.';
  END IF;

  IF v_lanc.compra_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento vinculado a compra — não pode ser editado por aqui.';
  END IF;

  IF v_lanc.status IN ('cancelado'::lancamento_status,
                       'pago'::lancamento_status,
                       'recebido'::lancamento_status) THEN
    RAISE EXCEPTION 'Lançamento % não pode ser editado (status: %).',
      _lancamento_id, v_lanc.status;
  END IF;

  IF _descricao IS NULL OR length(btrim(_descricao)) = 0 THEN
    RAISE EXCEPTION 'Descrição é obrigatória.';
  END IF;

  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero.';
  END IF;

  IF _valor < COALESCE(v_lanc.valor_pago, 0) THEN
    RAISE EXCEPTION 'Novo valor (%) é menor que o já pago (%).',
      _valor, v_lanc.valor_pago;
  END IF;

  IF _data_vencimento IS NULL THEN
    RAISE EXCEPTION 'Data de vencimento é obrigatória.';
  END IF;

  UPDATE public.financeiro_lancamentos
     SET descricao        = _descricao,
         valor            = _valor,
         data_vencimento  = _data_vencimento,
         data_emissao     = COALESCE(_data_emissao, data_emissao),
         categoria_id     = _categoria_id,
         cliente_id       = _cliente_id,
         fornecedor_id    = _fornecedor_id,
         numero_documento = _numero_documento,
         forma_pagamento  = NULLIF(_forma_pagamento,'')::forma_pagamento,
         observacoes      = _observacoes,
         client_uuid      = COALESCE(_client_uuid, client_uuid),
         updated_at       = now()
   WHERE id = _lancamento_id
     AND owner_id = v_owner;

  RETURN jsonb_build_object(
    'lancamento_id', _lancamento_id,
    'idempotente',   false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.editar_lancamento_avulso(
  uuid, text, numeric, date, date, uuid, uuid, uuid, text, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_lancamento_avulso(
  uuid, text, numeric, date, date, uuid, uuid, uuid, text, text, text, uuid
) TO authenticated;

-- =====================================================================
-- 4) excluir_lancamento_avulso
-- =====================================================================
-- Hard delete. Só permitido se:
--   - lançamento não vinculado a venda nem compra,
--   - sem nenhum pagamento registrado,
--   - status pendente ou cancelado.
-- Para qualquer outro caso, usar `cancelar_lancamento` (mantém histórico).
CREATE OR REPLACE FUNCTION public.excluir_lancamento_avulso(
  _lancamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_lanc  public.financeiro_lancamentos%ROWTYPE;
  v_qtd_pag int;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_lanc
    FROM public.financeiro_lancamentos
   WHERE id = _lancamento_id
     AND owner_id = v_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF v_lanc.venda_id IS NOT NULL OR v_lanc.compra_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento vinculado a venda/compra não pode ser excluído.';
  END IF;

  SELECT COUNT(*) INTO v_qtd_pag
    FROM public.lancamento_pagamentos
   WHERE lancamento_id = _lancamento_id;

  IF v_qtd_pag > 0 THEN
    RAISE EXCEPTION 'Lançamento possui % pagamento(s) registrado(s) — use cancelar_lancamento.', v_qtd_pag;
  END IF;

  IF v_lanc.status NOT IN ('pendente'::lancamento_status,
                           'cancelado'::lancamento_status) THEN
    RAISE EXCEPTION 'Status % não permite exclusão.', v_lanc.status;
  END IF;

  DELETE FROM public.financeiro_lancamentos
   WHERE id = _lancamento_id
     AND owner_id = v_owner;

  RETURN jsonb_build_object(
    'lancamento_id', _lancamento_id,
    'excluido',      true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_lancamento_avulso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_lancamento_avulso(uuid) TO authenticated;