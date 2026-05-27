
-- =====================================================================
-- Serializa baixas de estoque por produto em vendas e cancelamentos.
-- Reaproveita o padrão de pg_advisory_xact_lock já validado em
-- registrar_movimento_estoque. Idempotência por client_uuid permanece
-- intacta (continua sendo o primeiro check da função).
-- =====================================================================

-- ============ finalizar_venda_pdv (16-arg, em uso) ============
CREATE OR REPLACE FUNCTION public.finalizar_venda_pdv(
  _cliente_id uuid, _subtotal numeric, _desconto numeric, _total numeric,
  _forma forma_pagamento, _status_pagamento text, _valor_recebido numeric,
  _troco numeric, _observacao text, _itens jsonb,
  _pagamentos jsonb DEFAULT NULL::jsonb,
  _gerar_financeiro boolean DEFAULT true,
  _operador_id uuid DEFAULT NULL::uuid,
  _terminal_id uuid DEFAULT NULL::uuid,
  _client_uuid uuid DEFAULT NULL::uuid,
  _data_vencimento date DEFAULT NULL::date
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venda_id uuid;
  v_existing_id uuid;
  v_numero text;
  v_count int;
  v_seq int;
  v_item jsonb;
  v_pgto jsonb;
  v_saldo numeric(14,3);
  v_lanc_status lancamento_status;
  v_forma_principal forma_pagamento := _forma;
  v_total_recebido numeric(14,2) := 0;
  v_total_troco numeric(14,2) := 0;
  v_max_valor numeric(14,2) := 0;
  v_pagamentos jsonb := _pagamentos;
  v_caixa_id uuid;
  v_tem_fiado boolean := false;
  v_data_venc date;
  v_check record;
  v_nome text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.vendas
    WHERE owner_id = v_uid AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.vendas SET idempotent_replay_count = idempotent_replay_count + 1 WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
  END IF;

  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;
  IF _status_pagamento NOT IN ('pago','pendente','parcial','cancelado','vencido') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', _status_pagamento;
  END IF;

  SELECT id INTO v_caixa_id FROM public.caixas
   WHERE owner_id = v_uid AND status = 'aberto'
   ORDER BY data_abertura DESC LIMIT 1;
  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto. Abra o caixa antes de vender.';
  END IF;

  -- ============ Lock + Validação atômica de estoque ============
  -- Adquire lock advisory por produto ANTES de validar o saldo, na ordem
  -- de produto_id (evita deadlock entre terminais concorrentes). O lock
  -- vale até o fim da transação, garantindo que validação + baixa
  -- ocorram serializadas entre vendas concorrentes do mesmo produto.
  FOR v_check IN
    SELECT (it->>'produto_id')::uuid AS produto_id,
           SUM((it->>'quantidade')::numeric) AS qtd_pedida
      FROM jsonb_array_elements(_itens) AS it
     GROUP BY (it->>'produto_id')::uuid
     ORDER BY (it->>'produto_id')::uuid
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('estoque:' || v_check.produto_id::text, 0)
    );
    v_saldo := public.calcular_saldo_estoque(v_check.produto_id, NULL);
    IF v_saldo < v_check.qtd_pedida THEN
      SELECT nome INTO v_nome FROM public.produtos WHERE id = v_check.produto_id;
      RAISE EXCEPTION 'Estoque insuficiente para "%". Disponível: %, solicitado: %.',
        COALESCE(v_nome, v_check.produto_id::text),
        v_saldo,
        v_check.qtd_pedida
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF _pagamentos IS NOT NULL AND jsonb_array_length(_pagamentos) > 0 THEN
    FOR v_pgto IN SELECT * FROM jsonb_array_elements(_pagamentos) LOOP
      v_total_recebido := v_total_recebido + COALESCE(NULLIF((v_pgto->>'valor_recebido')::numeric, 0), (v_pgto->>'valor')::numeric);
      v_total_troco := v_total_troco + COALESCE(NULLIF((v_pgto->>'troco')::numeric, 0), 0);
      IF (v_pgto->>'forma_pagamento')::forma_pagamento = 'fiado' THEN
        v_tem_fiado := true;
      END IF;
      IF COALESCE((v_pgto->>'valor')::numeric, 0) > v_max_valor THEN
        v_max_valor := (v_pgto->>'valor')::numeric;
        v_forma_principal := (v_pgto->>'forma_pagamento')::forma_pagamento;
      END IF;
    END LOOP;
    IF v_tem_fiado THEN
      IF _cliente_id IS NULL THEN
        RAISE EXCEPTION 'Vendas fiado exigem um cliente vinculado.';
      END IF;
      IF _data_vencimento IS NULL THEN
        RAISE EXCEPTION 'Vendas fiado exigem data de vencimento.';
      END IF;
    END IF;
  END IF;

  v_data_venc := COALESCE(_data_vencimento, CURRENT_DATE);

  SELECT COUNT(*) INTO v_count FROM public.vendas WHERE owner_id = v_uid;
  v_seq := v_count + 1;
  v_numero := 'VND-' || LPAD(v_seq::text, 6, '0');

  BEGIN
    INSERT INTO public.vendas (
      owner_id, numero, cliente_id, vendedor_id, caixa_id,
      data_emissao, subtotal, desconto, total,
      forma_pagamento, status, status_pagamento,
      valor_recebido, troco, observacoes, data_finalizacao,
      client_uuid
    ) VALUES (
      v_uid, v_numero, _cliente_id, v_uid, v_caixa_id,
      CURRENT_DATE, _subtotal, _desconto, _total,
      v_forma_principal,
      CASE WHEN _status_pagamento = 'pago' THEN 'faturada'::venda_status
           WHEN _status_pagamento = 'cancelado' THEN 'cancelada'::venda_status
           ELSE 'aprovada'::venda_status END,
      _status_pagamento,
      NULLIF(v_total_recebido, 0), NULLIF(v_total_troco, 0),
      NULLIF(trim(_observacao),''), now(),
      _client_uuid
    ) RETURNING id INTO v_venda_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing_id
      FROM public.vendas
     WHERE owner_id = v_uid AND client_uuid = _client_uuid
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.vendas SET idempotent_replay_count = idempotent_replay_count + 1 WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
    RAISE;
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    INSERT INTO public.venda_itens (
      owner_id, venda_id, produto_id, descricao,
      quantidade, preco_unitario, desconto, total,
      vendido_por_peso, preco_por_kg,
      codigo_lido, plu_extraido, peso_extraido, valor_extraido, tipo_interpretacao
    ) VALUES (
      v_uid, v_venda_id, (v_item->>'produto_id')::uuid, v_item->>'descricao',
      (v_item->>'quantidade')::numeric, (v_item->>'preco_unitario')::numeric,
      COALESCE((v_item->>'desconto')::numeric, 0),
      (v_item->>'quantidade')::numeric * (v_item->>'preco_unitario')::numeric
        - COALESCE((v_item->>'desconto')::numeric, 0),
      COALESCE((v_item->>'vendido_por_peso')::boolean, false),
      NULLIF((v_item->>'preco_por_kg')::numeric, 0),
      NULLIF(trim(v_item->>'codigo_lido'), ''),
      NULLIF(trim(v_item->>'plu_extraido'), ''),
      NULLIF((v_item->>'peso_extraido')::numeric, 0),
      NULLIF((v_item->>'valor_extraido')::numeric, 0),
      NULLIF(trim(v_item->>'tipo_interpretacao'), '')
    );

    v_saldo := public.calcular_saldo_estoque((v_item->>'produto_id')::uuid, NULL);
    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, tipo, origem, quantidade,
      saldo_anterior, saldo_posterior, venda_id, observacoes
    ) VALUES (
      v_uid, (v_item->>'produto_id')::uuid, 'saida', 'venda',
      (v_item->>'quantidade')::numeric, v_saldo,
      v_saldo - (v_item->>'quantidade')::numeric,
      v_venda_id, 'Saída automática da venda ' || v_numero
    );
  END LOOP;

  FOR v_pgto IN SELECT * FROM jsonb_array_elements(v_pagamentos) LOOP
    INSERT INTO public.venda_pagamentos (
      owner_id, venda_id, forma_pagamento, valor,
      valor_recebido, troco, parcelas, observacao
    ) VALUES (
      v_uid, v_venda_id, (v_pgto->>'forma_pagamento')::forma_pagamento,
      (v_pgto->>'valor')::numeric,
      NULLIF((v_pgto->>'valor_recebido')::numeric, 0),
      NULLIF((v_pgto->>'troco')::numeric, 0),
      COALESCE((v_pgto->>'parcelas')::int, 1),
      NULLIF(trim(v_pgto->>'observacao'),'')
    );
  END LOOP;

  IF _gerar_financeiro AND _status_pagamento <> 'cancelado' THEN
    v_lanc_status := CASE WHEN _status_pagamento = 'pago' THEN 'pago'::lancamento_status
                          WHEN _status_pagamento = 'parcial' THEN 'parcial'::lancamento_status
                          WHEN _status_pagamento = 'vencido' THEN 'vencido'::lancamento_status
                          ELSE 'pendente'::lancamento_status END;
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      forma_pagamento, status, cliente_id, venda_id, caixa_id
    ) VALUES (
      v_uid, 'receber', 'Venda ' || v_numero, _total,
      CASE WHEN v_lanc_status = 'pago'::lancamento_status THEN _total
           WHEN v_lanc_status = 'parcial'::lancamento_status THEN COALESCE(v_total_recebido, 0)
           ELSE 0 END,
      CURRENT_DATE, v_data_venc,
      CASE WHEN v_lanc_status IN ('pago'::lancamento_status,'parcial'::lancamento_status) THEN CURRENT_DATE ELSE NULL END,
      v_forma_principal, v_lanc_status,
      _cliente_id, v_venda_id, v_caixa_id
    );
  END IF;

  IF _status_pagamento = 'pago' THEN
    INSERT INTO public.caixa_movimentos (caixa_id, owner_id, tipo, valor, venda_id, motivo)
    VALUES (v_caixa_id, v_uid, 'venda', _total, v_venda_id, 'Venda ' || v_numero);
  END IF;

  RETURN v_venda_id;
END;
$function$;


-- ============ cancelar_venda (estorno) ============
-- Adquire lock por produto antes de gerar a devolução para serializar
-- com vendas concorrentes do mesmo item.
CREATE OR REPLACE FUNCTION public.cancelar_venda(
  _venda_id uuid,
  _motivo text DEFAULT NULL::text
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

  -- Lock advisory por produto envolvido no cancelamento — serializa
  -- com vendas concorrentes do mesmo item. Ordem determinística por
  -- produto_id evita deadlock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('estoque:' || produto_id::text, 0)
  )
  FROM (
    SELECT DISTINCT produto_id
      FROM public.venda_itens
     WHERE venda_id = _venda_id
     ORDER BY produto_id
  ) t;

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
           E'\n[Cancelado em ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']' ||
           COALESCE(' Motivo: ' || NULLIF(trim(_motivo),''), '')
   WHERE id = _venda_id;

  RETURN jsonb_build_object(
    'venda_id', _venda_id,
    'numero', v_numero,
    'total', v_total,
    'itens_estornados', v_itens_estornados,
    'lancamentos_cancelados', v_lancamentos_cancelados,
    'qtd_total_estornada', v_qtd_total_estornada,
    'total_lancamentos_cancelados', v_total_lanc_cancelado
  );
END;
$function$;
