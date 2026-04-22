
DROP FUNCTION IF EXISTS public.cancelar_venda(uuid, text);

CREATE OR REPLACE FUNCTION public.cancelar_venda(
  _venda_id uuid,
  _motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status venda_status;
  v_numero text;
  v_total numeric(14,2);
  item RECORD;
  v_saldo numeric(14,3);
  v_lanc RECORD;
  v_itens_estornados jsonb := '[]'::jsonb;
  v_lancamentos_cancelados jsonb := '[]'::jsonb;
  v_qtd_total_estornada numeric(14,3) := 0;
  v_total_lanc_cancelado numeric(14,2) := 0;
  v_produto_nome text;
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

  FOR item IN
    SELECT vi.produto_id, vi.variacao_id, vi.quantidade, vi.descricao, vi.total
    FROM public.venda_itens vi
    WHERE vi.venda_id = _venda_id
  LOOP
    v_saldo := public.calcular_saldo_estoque(item.produto_id, item.variacao_id);

    SELECT nome INTO v_produto_nome FROM public.produtos WHERE id = item.produto_id;

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

    v_itens_estornados := v_itens_estornados || jsonb_build_object(
      'produto_id', item.produto_id,
      'produto_nome', COALESCE(v_produto_nome, item.descricao, 'Item'),
      'quantidade', item.quantidade,
      'saldo_anterior', v_saldo,
      'saldo_posterior', v_saldo + item.quantidade,
      'valor_total', item.total
    );
    v_qtd_total_estornada := v_qtd_total_estornada + item.quantidade;
  END LOOP;

  FOR v_lanc IN
    SELECT id, status, valor_pago, valor, descricao, tipo
    FROM public.financeiro_lancamentos
    WHERE venda_id = _venda_id AND owner_id = v_uid
  LOOP
    UPDATE public.financeiro_lancamentos
       SET status = 'cancelado'::lancamento_status,
           observacoes = COALESCE(observacoes, '') ||
             E'\n[Cancelado em ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']' ||
             COALESCE(' Motivo: ' || NULLIF(trim(_motivo),''), '')
     WHERE id = v_lanc.id;

    v_lancamentos_cancelados := v_lancamentos_cancelados || jsonb_build_object(
      'id', v_lanc.id,
      'descricao', v_lanc.descricao,
      'valor', v_lanc.valor,
      'valor_pago', v_lanc.valor_pago,
      'tipo', v_lanc.tipo,
      'status_anterior', v_lanc.status
    );
    v_total_lanc_cancelado := v_total_lanc_cancelado + COALESCE(v_lanc.valor, 0);
  END LOOP;

  UPDATE public.vendas
     SET status = 'cancelada'::venda_status,
         status_pagamento = 'cancelado',
         observacoes = COALESCE(observacoes, '') ||
           E'\n[Cancelada em ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']' ||
           COALESCE(' Motivo: ' || NULLIF(trim(_motivo),''), '')
   WHERE id = _venda_id;

  PERFORM public.registrar_audit_log(
    'venda.cancelar',
    'venda',
    _venda_id::text,
    jsonb_build_object(
      'numero', v_numero,
      'motivo', _motivo,
      'total', v_total,
      'qtd_itens_estornados', jsonb_array_length(v_itens_estornados),
      'qtd_lancamentos_cancelados', jsonb_array_length(v_lancamentos_cancelados)
    )
  );

  RETURN jsonb_build_object(
    'venda_id', _venda_id,
    'numero', v_numero,
    'total', v_total,
    'motivo', _motivo,
    'cancelado_em', now(),
    'qtd_itens_estornados', jsonb_array_length(v_itens_estornados),
    'qtd_total_estornada', v_qtd_total_estornada,
    'itens_estornados', v_itens_estornados,
    'qtd_lancamentos_cancelados', jsonb_array_length(v_lancamentos_cancelados),
    'total_lancamentos_cancelados', v_total_lanc_cancelado,
    'lancamentos_cancelados', v_lancamentos_cancelados
  );
END;
$function$;
