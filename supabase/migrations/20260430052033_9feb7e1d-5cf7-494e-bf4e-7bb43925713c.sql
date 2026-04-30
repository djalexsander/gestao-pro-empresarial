-- =====================================================================
-- Hardening financeiro — Fase 1
-- =====================================================================
-- 1) Idempotência de pagamentos: client_uuid em lancamento_pagamentos
--    (mesma estratégia já adotada em vendas e caixa_movimentos).
-- 2) RPCs dedicadas para baixa/edição/cancelamento de título — substituem
--    INSERT/UPDATE direto na tabela e ficam prontas para LAN multi-terminal.
-- =====================================================================

-- 1) client_uuid -------------------------------------------------------
ALTER TABLE public.lancamento_pagamentos
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS lancamento_pagamentos_client_uuid_owner_uniq
  ON public.lancamento_pagamentos (owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 2.1) Registrar pagamento (idempotente) ------------------------------
CREATE OR REPLACE FUNCTION public.registrar_pagamento_lancamento(
  _lancamento_id uuid,
  _valor numeric,
  _data_pagamento date,
  _forma_pagamento forma_pagamento DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_existing uuid;
  v_pag_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor do pagamento deve ser positivo.';
  END IF;

  -- Idempotência: se já existe pagamento com mesmo client_uuid, retorna
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.lancamento_pagamentos
    WHERE client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'pagamento_id', v_existing,
        'lancamento_id', _lancamento_id,
        'idempotente', true
      );
    END IF;
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.financeiro_lancamentos WHERE id = _lancamento_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF v_owner <> v_uid AND NOT public.acessa_owner_id(v_owner, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão sobre este lançamento.';
  END IF;

  -- Trigger validar_pagamento_lancamento valida saldo e status='cancelado'
  -- Trigger recalcular_lancamento_apos_pagamento atualiza valor_pago/status
  INSERT INTO public.lancamento_pagamentos
    (owner_id, lancamento_id, valor, data_pagamento, forma_pagamento,
     observacao, registrado_por, client_uuid)
  VALUES
    (v_owner, _lancamento_id, _valor, _data_pagamento, _forma_pagamento,
     NULLIF(_observacao, ''), v_uid, _client_uuid)
  RETURNING id INTO v_pag_id;

  RETURN jsonb_build_object(
    'pagamento_id', v_pag_id,
    'lancamento_id', _lancamento_id,
    'idempotente', false
  );
END;
$$;

-- 2.2) Remover pagamento (com lock no lançamento) ---------------------
CREATE OR REPLACE FUNCTION public.remover_pagamento_lancamento(
  _pagamento_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_lanc_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT owner_id, lancamento_id INTO v_owner, v_lanc_id
  FROM public.lancamento_pagamentos WHERE id = _pagamento_id;
  IF v_owner IS NULL THEN
    -- já removido — idempotente
    RETURN jsonb_build_object('removido', false, 'idempotente', true);
  END IF;
  IF v_owner <> v_uid AND NOT public.acessa_owner_id(v_owner, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  -- Lock do lançamento pai para evitar corrida com outros pagamentos
  PERFORM 1 FROM public.financeiro_lancamentos
    WHERE id = v_lanc_id FOR UPDATE;

  DELETE FROM public.lancamento_pagamentos WHERE id = _pagamento_id;
  RETURN jsonb_build_object('removido', true, 'lancamento_id', v_lanc_id);
END;
$$;

-- 2.3) Cancelar título -------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_lancamento(
  _lancamento_id uuid,
  _motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status lancamento_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.financeiro_lancamentos WHERE id = _lancamento_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF v_owner <> v_uid AND NOT public.acessa_owner_id(v_owner, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF v_status = 'cancelado' THEN
    RETURN jsonb_build_object('idempotente', true, 'lancamento_id', _lancamento_id);
  END IF;

  UPDATE public.financeiro_lancamentos
     SET status = 'cancelado',
         observacoes = CASE
           WHEN _motivo IS NOT NULL AND _motivo <> ''
             THEN COALESCE(observacoes || E'\n', '') || 'Cancelado: ' || _motivo
           ELSE observacoes
         END,
         updated_at = now()
   WHERE id = _lancamento_id;

  RETURN jsonb_build_object('idempotente', false, 'lancamento_id', _lancamento_id);
END;
$$;

-- 2.4) Reabrir título (recalcula status pelo total já pago) -----------
CREATE OR REPLACE FUNCTION public.reabrir_lancamento(
  _lancamento_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_valor numeric;
  v_pago numeric;
  v_tipo lancamento_tipo;
  v_status lancamento_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT owner_id, valor, tipo
    INTO v_owner, v_valor, v_tipo
  FROM public.financeiro_lancamentos WHERE id = _lancamento_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF v_owner <> v_uid AND NOT public.acessa_owner_id(v_owner, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(SUM(valor), 0) INTO v_pago
  FROM public.lancamento_pagamentos WHERE lancamento_id = _lancamento_id;

  IF v_pago <= 0 THEN v_status := 'pendente';
  ELSIF v_pago >= v_valor THEN
    v_status := CASE WHEN v_tipo = 'pagar' THEN 'pago' ELSE 'recebido' END;
  ELSE v_status := 'parcial';
  END IF;

  UPDATE public.financeiro_lancamentos
     SET status = v_status, valor_pago = v_pago, updated_at = now()
   WHERE id = _lancamento_id;

  RETURN jsonb_build_object('lancamento_id', _lancamento_id, 'novo_status', v_status);
END;
$$;

-- 2.5) Alterar vencimento ---------------------------------------------
CREATE OR REPLACE FUNCTION public.alterar_vencimento_lancamento(
  _lancamento_id uuid,
  _nova_data date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status lancamento_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _nova_data IS NULL THEN RAISE EXCEPTION 'Data inválida.'; END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.financeiro_lancamentos WHERE id = _lancamento_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF v_owner <> v_uid AND NOT public.acessa_owner_id(v_owner, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF v_status IN ('pago', 'recebido', 'cancelado') THEN
    RAISE EXCEPTION 'Não é possível alterar vencimento de título %.', v_status;
  END IF;

  UPDATE public.financeiro_lancamentos
     SET data_vencimento = _nova_data, updated_at = now()
   WHERE id = _lancamento_id;

  RETURN jsonb_build_object(
    'lancamento_id', _lancamento_id,
    'data_vencimento', _nova_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_pagamento_lancamento(uuid, numeric, date, forma_pagamento, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_pagamento_lancamento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_lancamento(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reabrir_lancamento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.alterar_vencimento_lancamento(uuid, date) TO authenticated;