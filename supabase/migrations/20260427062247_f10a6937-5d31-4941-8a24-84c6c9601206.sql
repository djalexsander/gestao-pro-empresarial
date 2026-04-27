-- 1) Colunas de auditoria de balança em venda_itens
ALTER TABLE public.venda_itens
  ADD COLUMN IF NOT EXISTS vendido_por_peso boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preco_por_kg numeric(14,2),
  ADD COLUMN IF NOT EXISTS codigo_lido text,
  ADD COLUMN IF NOT EXISTS plu_extraido text,
  ADD COLUMN IF NOT EXISTS peso_extraido numeric(14,3),
  ADD COLUMN IF NOT EXISTS valor_extraido numeric(14,2),
  ADD COLUMN IF NOT EXISTS tipo_interpretacao text
    CHECK (tipo_interpretacao IS NULL OR tipo_interpretacao IN ('peso','valor','manual'));

COMMENT ON COLUMN public.venda_itens.vendido_por_peso IS 'Snapshot: produto era vendido por peso no momento da venda';
COMMENT ON COLUMN public.venda_itens.preco_por_kg     IS 'Snapshot: preço por KG aplicado (apenas para vendido_por_peso)';
COMMENT ON COLUMN public.venda_itens.codigo_lido       IS 'Auditoria: código completo lido da etiqueta da balança';
COMMENT ON COLUMN public.venda_itens.plu_extraido      IS 'Auditoria: PLU / código base extraído da etiqueta';
COMMENT ON COLUMN public.venda_itens.peso_extraido     IS 'Auditoria: peso (KG) extraído da etiqueta ou informado manualmente';
COMMENT ON COLUMN public.venda_itens.valor_extraido    IS 'Auditoria: valor total (R$) extraído da etiqueta, quando aplicável';
COMMENT ON COLUMN public.venda_itens.tipo_interpretacao IS 'Auditoria: peso | valor | manual — origem do peso/valor do item';

-- 2) Atualiza RPC finalizar_venda_pdv (assinatura completa com _pagamentos)
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
  v_uid uuid := auth.uid();
  v_venda_id uuid;
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;
  IF _status_pagamento NOT IN ('pago','pendente','parcial','cancelado') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', _status_pagamento;
  END IF;

  -- Caixa aberto é obrigatório
  SELECT id INTO v_caixa_id FROM public.caixas
  WHERE owner_id = v_uid AND usuario_id = v_uid AND status = 'aberto'
  ORDER BY data_abertura DESC LIMIT 1;

  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto. Abra o caixa antes de vender.';
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
    owner_id, numero, cliente_id, vendedor_id, caixa_id,
    data_emissao, subtotal, desconto, total,
    forma_pagamento, status, status_pagamento,
    valor_recebido, troco, observacoes, data_finalizacao
  ) VALUES (
    v_uid, v_numero, _cliente_id, v_uid, v_caixa_id,
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

  -- Movimento de venda no caixa
  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, venda_id, usuario_id, operador_id, terminal_id)
  VALUES (v_uid, v_caixa_id, 'venda', _total, 'Venda ' || v_numero, v_venda_id, v_uid, _operador_id, _terminal_id);

  IF _gerar_financeiro AND _status_pagamento IN ('pendente','parcial') AND _total > 0 THEN
    v_lanc_status := 'pendente'::lancamento_status;
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes, caixa_id
    ) VALUES (
      v_uid, 'receber'::lancamento_tipo,
      'Venda ' || v_numero, _total,
      CASE WHEN _status_pagamento = 'parcial' THEN COALESCE(_valor_recebido,0) ELSE 0 END,
      CURRENT_DATE, CURRENT_DATE,
      NULL, _cliente_id, v_venda_id, v_forma_principal, v_lanc_status,
      NULLIF(trim(_observacao),''), v_caixa_id
    );
  ELSIF _gerar_financeiro AND _status_pagamento = 'pago' AND _total > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes, caixa_id
    ) VALUES (
      v_uid, 'receber'::lancamento_tipo,
      'Venda ' || v_numero, _total, _total,
      CURRENT_DATE, CURRENT_DATE, CURRENT_DATE,
      _cliente_id, v_venda_id, v_forma_principal, 'recebido'::lancamento_status,
      NULLIF(trim(_observacao),''), v_caixa_id
    );
  END IF;

  RETURN v_venda_id;
END;
$function$;