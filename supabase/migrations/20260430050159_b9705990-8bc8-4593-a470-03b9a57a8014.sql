-- ============================================================================
-- HARDENING DO MÓDULO DE CAIXA — preparação multi-terminal (LAN)
-- ============================================================================

-- 1) Impedir caixa aberto duplicado por TERMINAL e por OPERADOR
--    (índices parciais funcionam em postgres e cobrem a race condition do TOCTOU)
CREATE UNIQUE INDEX IF NOT EXISTS caixas_owner_terminal_aberto_uniq
  ON public.caixas (owner_id, terminal_id)
  WHERE status = 'aberto' AND terminal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS caixas_owner_operador_aberto_uniq
  ON public.caixas (owner_id, COALESCE(operador_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'aberto';

-- 2) Idempotência de sangria/suprimento
ALTER TABLE public.caixa_movimentos
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS caixa_movimentos_owner_client_uuid_uniq
  ON public.caixa_movimentos (owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 3) abrir_caixa — captura violações dos índices únicos com mensagem amigável
CREATE OR REPLACE FUNCTION public.abrir_caixa(
  _valor_inicial numeric,
  _observacao text DEFAULT NULL,
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
  v_caixa_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _valor_inicial IS NULL OR _valor_inicial < 0 THEN
    RAISE EXCEPTION 'Valor inicial inválido';
  END IF;

  IF _operador_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.funcionarios
      WHERE id = _operador_id AND owner_id = v_uid AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Operador inválido';
    END IF;
  END IF;

  IF _terminal_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.terminais
      WHERE id = _terminal_id AND owner_id = v_uid AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Terminal inválido ou inativo';
    END IF;
  END IF;

  -- Insere e deixa o índice único parcial proteger contra concorrência real.
  BEGIN
    INSERT INTO public.caixas (
      owner_id, usuario_id, operador_id, terminal_id,
      valor_inicial, observacao, status
    )
    VALUES (
      v_uid, v_uid, _operador_id, _terminal_id,
      _valor_inicial, NULLIF(trim(_observacao), ''), 'aberto'
    )
    RETURNING id INTO v_caixa_id;
  EXCEPTION WHEN unique_violation THEN
    IF _terminal_id IS NOT NULL THEN
      RAISE EXCEPTION 'Já existe um caixa aberto neste terminal. Feche o atual antes de abrir outro.';
    ELSE
      RAISE EXCEPTION 'Já existe um caixa aberto para este operador. Feche o atual antes de abrir outro.';
    END IF;
  END;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id)
  VALUES (v_uid, v_caixa_id, 'abertura', _valor_inicial, 'Abertura de caixa', v_uid);

  RETURN v_caixa_id;
END;
$function$;

-- 4) caixa_registrar_movimento — aceita client_uuid (idempotente)
CREATE OR REPLACE FUNCTION public.caixa_registrar_movimento(
  _caixa_id uuid,
  _tipo text,
  _valor numeric,
  _motivo text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status public.caixa_status;
  v_mov_id UUID;
  v_existing_id UUID;
  v_tipo public.caixa_movimento_tipo;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido. Use sangria ou suprimento.';
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero';
  END IF;

  -- Idempotência: se reenvio com mesmo UUID, retorna o existente
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.caixa_movimentos
    WHERE owner_id = v_uid AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.caixas WHERE id = _caixa_id;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Sem permissão sobre este caixa'; END IF;
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'Caixa precisa estar aberto'; END IF;

  v_tipo := _tipo::public.caixa_movimento_tipo;

  BEGIN
    INSERT INTO public.caixa_movimentos
      (owner_id, caixa_id, tipo, valor, motivo, usuario_id, client_uuid)
    VALUES (v_uid, _caixa_id, v_tipo, _valor, NULLIF(trim(_motivo), ''), v_uid, _client_uuid)
    RETURNING id INTO v_mov_id;
  EXCEPTION WHEN unique_violation THEN
    -- Corrida: outra request com mesmo UUID acabou de gravar
    SELECT id INTO v_mov_id
    FROM public.caixa_movimentos
    WHERE owner_id = v_uid AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_mov_id IS NULL THEN RAISE; END IF;
  END;

  RETURN v_mov_id;
END;
$function$;

-- 5) fechar_caixa — SELECT FOR UPDATE para impedir fechamento concorrente
CREATE OR REPLACE FUNCTION public.fechar_caixa(
  _caixa_id uuid,
  _valor_informado numeric,
  _observacao text DEFAULT NULL
)
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

  -- Lock pessimista: impede 2 fechamentos concorrentes do mesmo caixa
  SELECT owner_id, status INTO v_owner, v_status
  FROM public.caixas WHERE id = _caixa_id
  FOR UPDATE;

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

  IF v_total_ifood > 0 THEN
    INSERT INTO public.financeiro_lancamentos
      (owner_id, caixa_id, tipo, descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, forma_pagamento, status)
    VALUES (v_owner, _caixa_id, 'receber', 'Vendas iFood — aguardando repasse',
      v_total_ifood, 0, v_data_fech, v_data_fech + INTERVAL '30 days', NULL, 'ifood', 'pendente');
  END IF;

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
  -- São movimentos OPERACIONAIS de dinheiro físico (entrada/saída de gaveta).
  -- Permanecem só em public.caixa_movimentos.

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