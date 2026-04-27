-- 1) Remover lançamentos legados criados por fechamentos anteriores
--    para suprimento/sangria (eram inseridos como 'receber'/'pagar' com
--    descrição começando por 'Suprimento de caixa' ou 'Sangria de caixa').
DELETE FROM public.financeiro_lancamentos
WHERE caixa_id IS NOT NULL
  AND venda_id IS NULL
  AND (
    descricao ILIKE 'Suprimento de caixa%'
    OR descricao ILIKE 'Sangria de caixa%'
  );

-- 2) Recriar fechar_caixa sem inserir suprimento/sangria no financeiro.
CREATE OR REPLACE FUNCTION public.fechar_caixa(_caixa_id uuid, _valor_informado numeric, _observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status public.caixa_status;
  v_resumo JSONB;
  v_diferenca NUMERIC(14,2);
  v_valor_esperado NUMERIC(14,2);
  v_data_fech DATE := CURRENT_DATE;
  v_total_dinheiro NUMERIC(14,2);
  v_total_pix NUMERIC(14,2);
  v_total_debito NUMERIC(14,2);
  v_total_credito NUMERIC(14,2);
  v_total_boleto NUMERIC(14,2);
  v_total_ifood NUMERIC(14,2);
  v_total_fiado NUMERIC(14,2);
  v_total_outros NUMERIC(14,2);
  v_total_sangrias NUMERIC(14,2);
  v_total_suprimentos NUMERIC(14,2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _valor_informado IS NULL OR _valor_informado < 0 THEN
    RAISE EXCEPTION 'Informe o valor contado em dinheiro';
  END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.caixas WHERE id = _caixa_id;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Sem permissão sobre este caixa'; END IF;
  IF v_status = 'fechado' THEN RAISE EXCEPTION 'Caixa já está fechado'; END IF;

  v_resumo := public.caixa_resumo(_caixa_id);
  v_valor_esperado := (v_resumo->>'valor_esperado')::NUMERIC;
  v_diferenca := _valor_informado - v_valor_esperado;

  IF ABS(v_diferenca) > 0.009 AND COALESCE(NULLIF(trim(_observacao), ''), '') = '' THEN
    RAISE EXCEPTION 'Há diferença no caixa (% ). Informe uma justificativa.', v_diferenca;
  END IF;

  v_total_dinheiro     := (v_resumo->>'total_dinheiro')::NUMERIC;
  v_total_pix          := (v_resumo->>'total_pix')::NUMERIC;
  v_total_debito       := (v_resumo->>'total_debito')::NUMERIC;
  v_total_credito      := (v_resumo->>'total_credito')::NUMERIC;
  v_total_boleto       := (v_resumo->>'total_boleto')::NUMERIC;
  v_total_ifood        := COALESCE((v_resumo->>'total_ifood')::NUMERIC, 0);
  v_total_fiado        := COALESCE((v_resumo->>'total_fiado')::NUMERIC, 0);
  v_total_outros       := (v_resumo->>'total_outros')::NUMERIC;
  v_total_sangrias     := (v_resumo->>'total_sangrias')::NUMERIC;
  v_total_suprimentos  := (v_resumo->>'total_suprimentos')::NUMERIC;

  UPDATE public.caixas SET
    status = 'fechado',
    data_fechamento = now(),
    total_vendas = (v_resumo->>'total_vendas')::NUMERIC,
    qtd_vendas = (v_resumo->>'qtd_vendas')::INT,
    total_dinheiro = v_total_dinheiro,
    total_pix = v_total_pix,
    total_debito = v_total_debito,
    total_credito = v_total_credito,
    total_boleto = v_total_boleto,
    total_ifood = v_total_ifood,
    total_fiado = v_total_fiado,
    total_outros = v_total_outros,
    total_sangrias = v_total_sangrias,
    total_suprimentos = v_total_suprimentos,
    valor_esperado = v_valor_esperado,
    valor_informado = _valor_informado,
    diferenca = v_diferenca,
    observacao_fechamento = NULLIF(trim(_observacao), ''),
    updated_at = now()
  WHERE id = _caixa_id;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id)
  VALUES (v_owner, _caixa_id, 'fechamento', _valor_informado,
    CASE WHEN ABS(v_diferenca) > 0.009
      THEN 'Fechamento — diferença ' || to_char(v_diferenca, 'FM999G990D00')
      ELSE 'Fechamento de caixa' END,
    v_uid);

  -- iFood: pendente até repasse da plataforma. Vencimento em D+30.
  IF v_total_ifood > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas iFood — aguardando repasse',
      v_total_ifood, 0, v_data_fech, v_data_fech + INTERVAL '30 days', NULL, 'ifood', 'pendente');
  END IF;

  -- Fiado: pendente, cliente vai pagar depois. Vencimento padrão D+30.
  IF v_total_fiado > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas no fiado — a receber',
      v_total_fiado, 0, v_data_fech, v_data_fech + INTERVAL '30 days', NULL, 'fiado', 'pendente');
  END IF;

  IF v_total_outros > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas em outras formas — fechamento de caixa',
      v_total_outros, v_total_outros, v_data_fech, v_data_fech, v_data_fech, 'outro', 'recebido');
  END IF;

  -- IMPORTANTE: Suprimento e sangria NÃO geram lançamentos no Financeiro.
  -- Eles são movimentos OPERACIONAIS de dinheiro físico do caixa
  -- (entrada/saída de cédulas da gaveta) — não são receita nem despesa.
  -- Permanecem registrados apenas em public.caixa_movimentos, que é a
  -- fonte canônica usada pelo fluxo de caixa operacional.

  PERFORM public.registrar_audit_log(
    'caixa.fechar', 'caixa', _caixa_id::text,
    jsonb_build_object(
      'valor_esperado', v_valor_esperado,
      'valor_informado', _valor_informado,
      'diferenca', v_diferenca
    )
  );

  RETURN jsonb_build_object(
    'caixa_id', _caixa_id,
    'valor_esperado', v_valor_esperado,
    'valor_informado', _valor_informado,
    'diferenca', v_diferenca,
    'fechado_em', now()
  );
END;
$function$;