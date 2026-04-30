-- =========================================================
-- IDEMPOTÊNCIA DE VENDAS (client_uuid)
-- =========================================================

-- 1) Coluna client_uuid em vendas (nullable para compatibilidade)
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

-- 2) Contador de reenvios (auditoria interna)
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS idempotent_replay_count integer NOT NULL DEFAULT 0;

-- 3) Índice único parcial: por owner, client_uuid não-nulo
CREATE UNIQUE INDEX IF NOT EXISTS vendas_owner_client_uuid_uniq
  ON public.vendas (owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

COMMENT ON COLUMN public.vendas.client_uuid IS
  'UUID gerado pelo PDV (cliente) para a transação de venda. Garante idempotência: reenvio com mesmo client_uuid retorna a venda existente sem duplicar.';
COMMENT ON COLUMN public.vendas.idempotent_replay_count IS
  'Quantas vezes esta venda foi reenviada com o mesmo client_uuid (auditoria interna). Em operação normal = 0.';

-- =========================================================
-- 4) Nova sobrecarga de finalizar_venda_pdv com _client_uuid
--    (mantém as 4 sobrecargas anteriores intactas para
--     compatibilidade durante o rollout)
-- =========================================================
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
  _terminal_id uuid DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
) RETURNS uuid
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  -- ===== IDEMPOTÊNCIA: short-circuit se client_uuid já existe =====
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.vendas
    WHERE owner_id = v_uid AND client_uuid = _client_uuid
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Reenvio detectado: incrementa contador, NÃO duplica nada
      UPDATE public.vendas
        SET idempotent_replay_count = idempotent_replay_count + 1
        WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
  END IF;

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

  -- ===== INSERT com proteção contra race condition =====
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
    -- Race condition: duas chamadas simultâneas com mesmo client_uuid.
    -- A outra venceu; retornamos o id dela e incrementamos o contador.
    SELECT id INTO v_existing_id
      FROM public.vendas
     WHERE owner_id = v_uid AND client_uuid = _client_uuid
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.vendas
        SET idempotent_replay_count = idempotent_replay_count + 1
        WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
    RAISE; -- não deveria acontecer; relança se algo estranho
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