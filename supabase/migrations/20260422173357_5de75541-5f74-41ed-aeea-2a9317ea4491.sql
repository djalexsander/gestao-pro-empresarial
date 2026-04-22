-- ============ Validação de estoque + cancelamento de venda ============

-- Função utilitária: lista saldos atuais para uma lista de produtos (jsonb array de uuids)
CREATE OR REPLACE FUNCTION public.saldos_estoque_lote(_produto_ids uuid[])
RETURNS TABLE(produto_id uuid, saldo numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  RETURN QUERY
  SELECT p.id, public.calcular_saldo_estoque(p.id, NULL)
  FROM public.produtos p
  WHERE p.owner_id = auth.uid()
    AND p.id = ANY(_produto_ids);
END;
$$;

-- Função: cancelar venda com estorno completo de estoque e financeiro
CREATE OR REPLACE FUNCTION public.cancelar_venda(
  _venda_id uuid,
  _motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status venda_status;
  v_numero text;
  v_total numeric(14,2);
  item RECORD;
  v_saldo numeric(14,3);
  v_lanc RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT owner_id, status, numero, total
    INTO v_owner, v_status, v_numero, v_total
  FROM public.vendas
  WHERE id = _venda_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'Sem permissão sobre esta venda';
  END IF;
  IF v_status = 'cancelada' THEN
    RAISE EXCEPTION 'Venda já está cancelada';
  END IF;

  -- 1) Estornar estoque: para cada item, registra entrada do tipo 'devolucao'
  FOR item IN
    SELECT produto_id, variacao_id, quantidade, descricao
    FROM public.venda_itens
    WHERE venda_id = _venda_id
  LOOP
    v_saldo := public.calcular_saldo_estoque(item.produto_id, item.variacao_id);
    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, variacao_id, tipo, origem,
      quantidade, saldo_anterior, saldo_posterior,
      venda_id, observacoes
    ) VALUES (
      v_uid, item.produto_id, item.variacao_id, 'devolucao', 'venda',
      item.quantidade,
      v_saldo,
      v_saldo + item.quantidade,
      _venda_id,
      'Estorno por cancelamento da venda ' || v_numero
        || COALESCE(' — ' || NULLIF(trim(_motivo),''), '')
    );
  END LOOP;

  -- 2) Cancelar lançamentos financeiros vinculados
  FOR v_lanc IN
    SELECT id, status, valor_pago, valor
    FROM public.financeiro_lancamentos
    WHERE venda_id = _venda_id AND owner_id = v_uid
  LOOP
    UPDATE public.financeiro_lancamentos
       SET status = 'cancelado'::lancamento_status,
           observacoes = COALESCE(observacoes, '') ||
             E'\n[Cancelado em ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']' ||
             COALESCE(' Motivo: ' || NULLIF(trim(_motivo),''), '')
     WHERE id = v_lanc.id;
  END LOOP;

  -- 3) Atualizar venda
  UPDATE public.vendas
     SET status = 'cancelada'::venda_status,
         status_pagamento = 'cancelado',
         observacoes = COALESCE(observacoes, '') ||
           E'\n[Cancelada em ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']' ||
           COALESCE(' Motivo: ' || NULLIF(trim(_motivo),''), '')
   WHERE id = _venda_id;

  -- 4) Auditoria
  PERFORM public.registrar_audit_log(
    'venda.cancelar',
    'venda',
    _venda_id::text,
    jsonb_build_object('numero', v_numero, 'motivo', _motivo, 'total', v_total)
  );

  RETURN _venda_id;
END;
$$;