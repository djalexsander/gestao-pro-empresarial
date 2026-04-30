-- 1) Coluna de idempotência
ALTER TABLE public.estoque_movimentacoes
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

-- Índice único parcial: client_uuid é opcional, mas quando presente
-- não pode repetir para o mesmo owner.
CREATE UNIQUE INDEX IF NOT EXISTS estoque_mov_client_uuid_owner_uniq
  ON public.estoque_movimentacoes (owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 2) RPC server-side para registrar movimentação manual de estoque,
--    com lock por produto, recálculo de saldo e idempotência.
CREATE OR REPLACE FUNCTION public.registrar_movimento_estoque(
  _produto_id      uuid,
  _variacao_id     uuid,
  _tipo            text,        -- 'entrada' | 'saida' | 'ajuste' | 'devolucao' | 'transferencia'
  _quantidade      numeric,     -- sempre positivo; sinal vem do tipo
  _custo_unitario  numeric,
  _observacoes     text,
  _origem          text,        -- ex: 'ajuste_manual', 'inventario'
  _client_uuid     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner          uuid := auth.uid();
  v_existing       public.estoque_movimentacoes%ROWTYPE;
  v_saldo_anterior numeric := 0;
  v_delta          numeric;
  v_saldo_posterior numeric;
  v_movimento_id   uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF _quantidade IS NULL OR _quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  IF _tipo NOT IN ('entrada','saida','ajuste','devolucao','transferencia') THEN
    RAISE EXCEPTION 'Tipo de movimentação inválido: %', _tipo;
  END IF;

  -- Idempotência: se já existe movimentação com esse client_uuid,
  -- devolve a existente sem duplicar.
  IF _client_uuid IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.estoque_movimentacoes
     WHERE owner_id = v_owner
       AND client_uuid = _client_uuid
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'movimento_id',     v_existing.id,
        'idempotente',      true,
        'saldo_anterior',   v_existing.saldo_anterior,
        'saldo_posterior',  v_existing.saldo_posterior
      );
    END IF;
  END IF;

  -- Lock advisory por produto para serializar movimentações concorrentes
  -- do MESMO produto entre vários terminais.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('estoque:' || _produto_id::text, 0)
  );

  -- Recalcula saldo atual server-side a partir do histórico.
  SELECT COALESCE(SUM(
           CASE
             WHEN tipo IN ('entrada','devolucao') THEN quantidade
             WHEN tipo IN ('saida','transferencia') THEN -quantidade
             ELSE quantidade  -- ajuste já vem com sinal embutido em saldo_posterior
           END
         ), 0)
    INTO v_saldo_anterior
    FROM public.estoque_movimentacoes
   WHERE owner_id = v_owner
     AND produto_id = _produto_id;

  -- Calcula delta para esta movimentação
  v_delta := CASE
    WHEN _tipo IN ('entrada','devolucao') THEN _quantidade
    WHEN _tipo IN ('saida','transferencia') THEN -_quantidade
    ELSE _quantidade
  END;

  v_saldo_posterior := v_saldo_anterior + v_delta;

  IF v_saldo_posterior < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente. Saldo atual: %, saída solicitada: %.',
      v_saldo_anterior, _quantidade;
  END IF;

  INSERT INTO public.estoque_movimentacoes (
    owner_id, produto_id, variacao_id,
    tipo, origem, quantidade,
    custo_unitario, saldo_anterior, saldo_posterior,
    observacoes, client_uuid
  ) VALUES (
    v_owner, _produto_id, _variacao_id,
    _tipo::movimentacao_tipo,
    COALESCE(_origem,'ajuste_manual')::movimentacao_origem,
    _quantidade,
    _custo_unitario, v_saldo_anterior, v_saldo_posterior,
    _observacoes, _client_uuid
  )
  RETURNING id INTO v_movimento_id;

  RETURN jsonb_build_object(
    'movimento_id',     v_movimento_id,
    'idempotente',      false,
    'saldo_anterior',   v_saldo_anterior,
    'saldo_posterior',  v_saldo_posterior
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_movimento_estoque(
  uuid, uuid, text, numeric, numeric, text, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_movimento_estoque(
  uuid, uuid, text, numeric, numeric, text, text, uuid
) TO authenticated;