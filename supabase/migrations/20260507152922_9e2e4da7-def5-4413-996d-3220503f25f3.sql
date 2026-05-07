
-- ============================================================================
-- COMPRAS — RPCs auxiliares para o pipeline offline-first (Outbox v18 pt.5)
-- ============================================================================
-- Espelham o que cloudAdapter.compras (criar/atualizarStatus/excluir) faz hoje
-- em chamadas diretas, mas concentrados em uma RPC SECURITY DEFINER cada,
-- para o servidor local poder enviar via PostgREST RPC do mesmo jeito que faz
-- com fornecedores/clientes/cancelamento.

-- ---------- criar_compra(_payload jsonb) ----------
-- Espera-se o JSON construído por compra_criar_local em Rust:
--   _numero, _fornecedor_id, _data_emissao, _data_prevista, _data_vencimento,
--   _numero_nf, _serie_nf, _desconto, _frete, _outros, _observacoes, _status,
--   _client_uuid, _itens [{ produto_id, variacao_id?, descricao?, quantidade,
--   preco_unitario, desconto?, local_uuid? }]
-- Retorno: jsonb { id, status, total, subtotal, itens: [{id, local_uuid}] }
CREATE OR REPLACE FUNCTION public.criar_compra(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_subtotal     numeric := 0;
  v_total        numeric := 0;
  v_desconto     numeric := COALESCE((_payload->>'_desconto')::numeric, 0);
  v_frete        numeric := COALESCE((_payload->>'_frete')::numeric, 0);
  v_outros       numeric := COALESCE((_payload->>'_outros')::numeric, 0);
  v_status       text    := COALESCE(_payload->>'_status', 'pendente');
  v_data_em      date    := COALESCE((_payload->>'_data_emissao')::date, CURRENT_DATE);
  v_client_uuid  text    := _payload->>'_client_uuid';
  v_existing     uuid;
  v_itens        jsonb;
  v_item         jsonb;
  v_itens_out    jsonb := '[]'::jsonb;
  v_item_id      uuid;
  v_qtd          numeric;
  v_preco        numeric;
  v_desc_item    numeric;
  v_total_item   numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Idempotência cross-runs por _client_uuid (mesmo padrão de fornecedores).
  IF v_client_uuid IS NOT NULL AND length(v_client_uuid) > 0 THEN
    SELECT id INTO v_existing
      FROM public.compras
     WHERE owner_id = v_uid
       AND observacoes_json ->> '_client_uuid' = v_client_uuid
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_id := v_existing;
      SELECT jsonb_agg(jsonb_build_object('id', ci.id, 'local_uuid', ci.local_uuid))
        INTO v_itens_out
        FROM public.compra_itens ci
       WHERE ci.compra_id = v_id;
      RETURN jsonb_build_object(
        'id',         v_id,
        'idempotent', true,
        'itens',      COALESCE(v_itens_out, '[]'::jsonb)
      );
    END IF;
  END IF;

  v_itens := COALESCE(_payload->'_itens', '[]'::jsonb);

  -- Subtotal a partir dos itens
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_qtd       := COALESCE((v_item->>'quantidade')::numeric, 0);
    v_preco     := COALESCE((v_item->>'preco_unitario')::numeric, 0);
    v_desc_item := COALESCE((v_item->>'desconto')::numeric, 0);
    v_total_item := GREATEST(0, v_qtd * v_preco - v_desc_item);
    v_subtotal := v_subtotal + v_total_item;
  END LOOP;
  v_total := GREATEST(0, v_subtotal - v_desconto + v_frete + v_outros);

  INSERT INTO public.compras(
    owner_id, numero, fornecedor_id, data_emissao,
    data_prevista, data_vencimento, numero_nf, serie_nf,
    desconto, frete, outros, observacoes,
    subtotal, total, status, observacoes_json
  )
  VALUES (
    v_uid,
    NULLIF(_payload->>'_numero',''),
    NULLIF(_payload->>'_fornecedor_id','')::uuid,
    v_data_em,
    NULLIF(_payload->>'_data_prevista','')::date,
    NULLIF(_payload->>'_data_vencimento','')::date,
    NULLIF(_payload->>'_numero_nf',''),
    NULLIF(_payload->>'_serie_nf',''),
    v_desconto, v_frete, v_outros,
    NULLIF(_payload->>'_observacoes',''),
    v_subtotal, v_total,
    v_status::compra_status,
    CASE WHEN v_client_uuid IS NULL THEN NULL
         ELSE jsonb_build_object('_client_uuid', v_client_uuid)
    END
  )
  RETURNING id INTO v_id;

  -- Itens (preserva local_uuid no retorno para o servidor local mapear).
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_qtd       := COALESCE((v_item->>'quantidade')::numeric, 0);
    v_preco     := COALESCE((v_item->>'preco_unitario')::numeric, 0);
    v_desc_item := COALESCE((v_item->>'desconto')::numeric, 0);
    v_total_item := GREATEST(0, v_qtd * v_preco - v_desc_item);

    INSERT INTO public.compra_itens(
      owner_id, compra_id, produto_id, variacao_id, descricao,
      quantidade, preco_unitario, desconto, total
    )
    VALUES (
      v_uid, v_id,
      (v_item->>'produto_id')::uuid,
      NULLIF(v_item->>'variacao_id','')::uuid,
      NULLIF(v_item->>'descricao',''),
      v_qtd, v_preco, v_desc_item, v_total_item
    )
    RETURNING id INTO v_item_id;

    v_itens_out := v_itens_out || jsonb_build_object(
      'id', v_item_id,
      'local_uuid', v_item->>'local_uuid'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id',         v_id,
    'idempotent', false,
    'subtotal',   v_subtotal,
    'total',      v_total,
    'status',     v_status,
    'itens',      v_itens_out
  );
END;
$$;

-- Coluna observacoes_json é usada apenas para guardar o _client_uuid;
-- crie se ainda não existir (no-op caso já exista).
ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS observacoes_json jsonb;

REVOKE ALL ON FUNCTION public.criar_compra(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_compra(jsonb) TO authenticated;

-- ---------- alterar_status_compra(_id uuid, _status text) ----------
CREATE OR REPLACE FUNCTION public.alterar_status_compra(_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  UPDATE public.compras
     SET status = _status::compra_status
   WHERE id = _id AND owner_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.alterar_status_compra(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alterar_status_compra(uuid, text) TO authenticated;

-- ---------- excluir_compra(_compra_id uuid) ----------
CREATE OR REPLACE FUNCTION public.excluir_compra(_compra_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  DELETE FROM public.compras WHERE id = _compra_id AND owner_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_compra(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_compra(uuid) TO authenticated;
