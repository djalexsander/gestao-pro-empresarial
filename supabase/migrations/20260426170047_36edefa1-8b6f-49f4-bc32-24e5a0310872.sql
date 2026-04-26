-- =====================================================================
-- Atualiza caixa_resumo: adiciona total_ifood e total_fiado como blocos
-- separados. iFood e Fiado contam em total_vendas, mas NÃO entram no
-- valor_esperado em dinheiro (apenas dinheiro entra no físico).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.caixa_resumo(_caixa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_caixa RECORD;
  v_total_dinheiro NUMERIC(14,2) := 0;
  v_total_pix NUMERIC(14,2) := 0;
  v_total_debito NUMERIC(14,2) := 0;
  v_total_credito NUMERIC(14,2) := 0;
  v_total_boleto NUMERIC(14,2) := 0;
  v_total_ifood NUMERIC(14,2) := 0;
  v_total_fiado NUMERIC(14,2) := 0;
  v_total_outros NUMERIC(14,2) := 0;
  v_total_vendas NUMERIC(14,2) := 0;
  v_qtd_vendas INT := 0;
  v_total_sangrias NUMERIC(14,2) := 0;
  v_total_suprimentos NUMERIC(14,2) := 0;
  v_valor_esperado NUMERIC(14,2) := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT * INTO v_caixa FROM public.caixas
  WHERE id = _caixa_id AND owner_id = v_uid;
  IF v_caixa.id IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;

  -- Soma os valores de venda_pagamentos por forma. Vendas canceladas ficam fora.
  -- Para Fiado/iFood, o valor é registrado mesmo se a venda estiver pendente
  -- (porque o cliente DEVE essa quantia — vira contas a receber).
  WITH pgs AS (
    SELECT
      vp.forma_pagamento,
      CASE
        WHEN v.status_pagamento = 'pago' THEN vp.valor
        WHEN v.status_pagamento = 'parcial' THEN COALESCE(vp.valor_recebido, vp.valor)
        WHEN v.status_pagamento = 'pendente' AND vp.forma_pagamento::text IN ('fiado','ifood','boleto') THEN vp.valor
        ELSE 0
      END AS valor_efetivo
    FROM public.venda_pagamentos vp
    JOIN public.vendas v ON v.id = vp.venda_id
    WHERE v.caixa_id = _caixa_id
      AND v.owner_id = v_uid
      AND v.status <> 'cancelada'
  )
  SELECT
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'dinheiro'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'pix'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'cartao_debito'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'cartao_credito'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'boleto'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'ifood'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text = 'fiado'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento::text NOT IN ('dinheiro','pix','cartao_debito','cartao_credito','boleto','ifood','fiado')), 0)
  INTO v_total_dinheiro, v_total_pix, v_total_debito, v_total_credito, v_total_boleto, v_total_ifood, v_total_fiado, v_total_outros
  FROM pgs;

  SELECT COUNT(*), COALESCE(SUM(total), 0)
    INTO v_qtd_vendas, v_total_vendas
  FROM public.vendas
  WHERE caixa_id = _caixa_id AND owner_id = v_uid AND status <> 'cancelada';

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'sangria'), 0),
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'suprimento'), 0)
  INTO v_total_sangrias, v_total_suprimentos
  FROM public.caixa_movimentos
  WHERE caixa_id = _caixa_id AND owner_id = v_uid;

  -- Valor esperado em DINHEIRO físico:
  -- inicial + dinheiro recebido + suprimentos - sangrias.
  -- iFood e Fiado NÃO entram aqui — não são dinheiro físico no caixa.
  v_valor_esperado := v_caixa.valor_inicial
                    + v_total_dinheiro
                    + v_total_suprimentos
                    - v_total_sangrias;

  RETURN jsonb_build_object(
    'caixa_id', v_caixa.id,
    'status', v_caixa.status,
    'data_abertura', v_caixa.data_abertura,
    'data_fechamento', v_caixa.data_fechamento,
    'valor_inicial', v_caixa.valor_inicial,
    'qtd_vendas', v_qtd_vendas,
    'total_vendas', v_total_vendas,
    'total_dinheiro', v_total_dinheiro,
    'total_pix', v_total_pix,
    'total_debito', v_total_debito,
    'total_credito', v_total_credito,
    'total_boleto', v_total_boleto,
    'total_ifood', v_total_ifood,
    'total_fiado', v_total_fiado,
    'total_outros', v_total_outros,
    'total_sangrias', v_total_sangrias,
    'total_suprimentos', v_total_suprimentos,
    'valor_esperado', v_valor_esperado,
    'valor_informado', v_caixa.valor_informado,
    'diferenca', v_caixa.diferenca
  );
END;
$function$;

-- =====================================================================
-- Atualiza fechar_caixa: persiste total_ifood / total_fiado nas colunas
-- da tabela caixas e gera lançamentos financeiros corretos:
--   - dinheiro/pix/débito/crédito/boleto -> 'recebido'
--   - ifood -> 'pendente' (a receber até repasse da plataforma)
--   - fiado -> 'pendente' (cliente paga depois)
-- =====================================================================
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
  v_mov RECORD;
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
    observacao_fechamento = NULLIF(trim(_observacao), '')
  WHERE id = _caixa_id;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id)
  VALUES (v_uid, _caixa_id, 'fechamento', _valor_informado,
    'Fechamento de caixa. Diferença: ' || v_diferenca::text, v_uid);

  -- Lançamentos no Financeiro por forma de pagamento
  IF v_total_dinheiro > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas em dinheiro — fechamento de caixa',
      v_total_dinheiro, v_total_dinheiro, v_data_fech, v_data_fech, v_data_fech, 'dinheiro', 'recebido');
  END IF;

  IF v_total_pix > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas em PIX — fechamento de caixa',
      v_total_pix, v_total_pix, v_data_fech, v_data_fech, v_data_fech, 'pix', 'recebido');
  END IF;

  IF v_total_debito > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas em cartão de débito — fechamento de caixa',
      v_total_debito, v_total_debito, v_data_fech, v_data_fech, v_data_fech, 'cartao_debito', 'recebido');
  END IF;

  IF v_total_credito > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas em cartão de crédito — fechamento de caixa',
      v_total_credito, v_total_credito, v_data_fech, v_data_fech, v_data_fech, 'cartao_credito', 'recebido');
  END IF;

  IF v_total_boleto > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas em boleto — fechamento de caixa',
      v_total_boleto, v_total_boleto, v_data_fech, v_data_fech, v_data_fech, 'boleto', 'recebido');
  END IF;

  -- iFood: pendente até repasse da plataforma. Vencimento em D+30 (estimativa
  -- comum de repasse). Não soma como recebido imediato.
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

  -- Suprimentos individuais (entradas)
  FOR v_mov IN
    SELECT valor, motivo, created_at
    FROM public.caixa_movimentos
    WHERE caixa_id = _caixa_id AND tipo = 'suprimento'
  LOOP
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber',
      'Suprimento de caixa' || COALESCE(' — ' || NULLIF(trim(v_mov.motivo), ''), ''),
      v_mov.valor, v_mov.valor, v_data_fech, v_data_fech, v_data_fech, 'dinheiro', 'recebido');
  END LOOP;

  -- Sangrias individuais (saídas)
  FOR v_mov IN
    SELECT valor, motivo, created_at
    FROM public.caixa_movimentos
    WHERE caixa_id = _caixa_id AND tipo = 'sangria'
  LOOP
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'pagar',
      'Sangria de caixa' || COALESCE(' — ' || NULLIF(trim(v_mov.motivo), ''), ''),
      v_mov.valor, v_mov.valor, v_data_fech, v_data_fech, v_data_fech, 'dinheiro', 'pago');
  END LOOP;

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