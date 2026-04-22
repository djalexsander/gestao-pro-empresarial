CREATE OR REPLACE FUNCTION public.finalizar_venda_pdv(
  _cliente_id uuid,
  _subtotal numeric,
  _desconto numeric,
  _total numeric,
  _forma forma_pagamento,
  _status_pagamento text,
  _valor_recebido numeric,
  _troco numeric,
  _observacao text,
  _itens jsonb,
  _pagamentos jsonb DEFAULT NULL,
  _gerar_financeiro boolean DEFAULT true,
  _operador_id uuid DEFAULT NULL,
  _terminal_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_venda_id UUID;
  v_numero TEXT;
  v_count INT;
  v_seq INT;
  v_item JSONB;
  v_pgto JSONB;
  v_saldo NUMERIC(14,3);
  v_lanc_status lancamento_status;
  v_forma_principal forma_pagamento := _forma;
  v_total_recebido NUMERIC(14,2) := 0;
  v_total_troco NUMERIC(14,2) := 0;
  v_max_valor NUMERIC(14,2) := 0;
  v_pagamentos JSONB := _pagamentos;
  v_caixa_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;
  IF _status_pagamento NOT IN ('pago','pendente','parcial','cancelado') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', _status_pagamento;
  END IF;

  -- Caixa aberto do operador (ou do admin se sem operador)
  SELECT id INTO v_caixa_id FROM public.caixas
  WHERE owner_id = v_uid
    AND status = 'aberto'
    AND COALESCE(operador_id::text,'') = COALESCE(_operador_id::text,'')
  ORDER BY data_abertura DESC LIMIT 1;

  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto para este operador. Abra o caixa antes de vender.';
  END IF;

  IF v_pagamentos IS NULL OR jsonb_array_length(v_pagamentos) = 0 THEN
    v_pagamentos := jsonb_build_array(
      jsonb_build_object(
        'forma_pagamento', _forma::text,
        'valor', _total,
        'valor_recebido', _valor_recebido,
        'troco', _troco,
        'parcelas', 1,
        'observacao', _observacao
      )
    );
  END IF;

  FOR v_pgto IN SELECT * FROM jsonb_array_elements(v_pagamentos) LOOP
    IF (v_pgto->>'valor')::numeric > v_max_valor THEN
      v_max_valor := (v_pgto->>'valor')::numeric;
      v_forma_principal := (v_pgto->>'forma_pagamento')::forma_pagamento;
    END IF;
    v_total_recebido := v_total_recebido + COALESCE((v_pgto->>'valor_recebido')::numeric, (v_pgto->>'valor')::numeric, 0);
    v_total_troco    := v_total_troco    + COALESCE((v_pgto->>'troco')::numeric, 0);
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM public.vendas WHERE owner_id = v_uid;
  v_seq := v_count + 1;
  v_numero := 'VND-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO public.vendas (
    owner_id, numero, cliente_id, vendedor_id, operador_id, caixa_id, terminal_id,
    data_emissao, subtotal, desconto, total,
    forma_pagamento, status, status_pagamento,
    valor_recebido, troco, observacoes, data_finalizacao
  ) VALUES (
    v_uid, v_numero, _cliente_id, v_uid, _operador_id, v_caixa_id, _terminal_id,
    CURRENT_DATE, _subtotal, _desconto, _total,
    v_forma_principal,
    CASE WHEN _status_pagamento = 'pago' THEN 'faturada'::venda_status
         WHEN _status_pagamento = 'cancelado' THEN 'cancelada'::venda_status
         ELSE 'aprovada'::venda_status END,
    _status_pagamento,
    NULLIF(v_total_recebido, 0), NULLIF(v_total_troco, 0),
    NULLIF(trim(_observacao),''), now()
  ) RETURNING id INTO v_venda_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    INSERT INTO public.venda_itens (
      owner_id, venda_id, produto_id, descricao,
      quantidade, preco_unitario, desconto, total
    ) VALUES (
      v_uid, v_venda_id, (v_item->>'produto_id')::uuid, v_item->>'descricao',
      (v_item->>'quantidade')::numeric, (v_item->>'preco_unitario')::numeric,
      COALESCE((v_item->>'desconto')::numeric, 0),
      (v_item->>'quantidade')::numeric * (v_item->>'preco_unitario')::numeric
        - COALESCE((v_item->>'desconto')::numeric, 0)
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

  INSERT INTO public.caixa_movimentos (
    owner_id, caixa_id, tipo, valor, motivo,
    venda_id, usuario_id, operador_id, terminal_id
  )
  VALUES (
    v_uid, v_caixa_id, 'venda', _total, 'Venda ' || v_numero,
    v_venda_id, v_uid, _operador_id, _terminal_id
  );

  IF _gerar_financeiro AND _status_pagamento IN ('pendente','parcial') AND _total > 0 THEN
    v_lanc_status := 'pendente'::lancamento_status;
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes
    ) VALUES (
      v_uid, 'receber'::lancamento_tipo, 'Venda ' || v_numero, _total,
      CASE WHEN _status_pagamento = 'parcial' THEN COALESCE(v_total_recebido,0) ELSE 0 END,
      CURRENT_DATE, CURRENT_DATE, NULL, _cliente_id, v_venda_id,
      v_forma_principal, v_lanc_status, NULLIF(trim(_observacao),'')
    );
  ELSIF _gerar_financeiro AND _status_pagamento = 'pago' AND _total > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes
    ) VALUES (
      v_uid, 'receber'::lancamento_tipo, 'Venda ' || v_numero, _total, _total,
      CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, _cliente_id, v_venda_id,
      v_forma_principal, 'recebido'::lancamento_status, NULLIF(trim(_observacao),'')
    );
  END IF;

  RETURN v_venda_id;
END;
$function$;