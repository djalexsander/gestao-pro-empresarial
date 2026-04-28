-- Colunas Asaas em pagamentos
ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS asaas_payment_id text,
  ADD COLUMN IF NOT EXISTS asaas_customer_id text,
  ADD COLUMN IF NOT EXISTS external_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_asaas_payment_id
  ON public.pagamentos (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;

-- Garante coluna event_id única em asaas_webhook_eventos para idempotência
ALTER TABLE public.asaas_webhook_eventos
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS processado_em timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_asaas_webhook_event_id
  ON public.asaas_webhook_eventos (event_id)
  WHERE event_id IS NOT NULL;

-- Função de confirmação (idempotente). SECURITY DEFINER para uso por webhook (service role).
CREATE OR REPLACE FUNCTION public.confirmar_pagamento_asaas(
  _pagamento_id uuid,
  _data_pagamento date DEFAULT CURRENT_DATE,
  _forma_pagamento text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _pg record;
  _plano record;
  _resultado jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO _pg FROM public.pagamentos WHERE id = _pagamento_id FOR UPDATE;
  IF _pg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado');
  END IF;

  -- Idempotência: se já está pago, retorna sem reprocessar
  IF _pg.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'ja_processado', true, 'pagamento_id', _pg.id);
  END IF;

  UPDATE public.pagamentos
  SET status = 'pago',
      data_pagamento = COALESCE(_data_pagamento, CURRENT_DATE),
      forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento)
  WHERE id = _pg.id;

  IF _pg.referencia_tipo = 'plano' AND _pg.plano_id IS NOT NULL THEN
    SELECT * INTO _plano FROM public.planos WHERE id = _pg.plano_id;

    -- upsert assinatura ativa
    INSERT INTO public.empresa_assinaturas (
      empresa_id, plano_id, status, data_inicio, data_expiracao, observacoes
    ) VALUES (
      _pg.empresa_id, _pg.plano_id, 'ativa', CURRENT_DATE,
      CASE
        WHEN _plano.tipo_cobranca = 'mensal' THEN CURRENT_DATE + INTERVAL '30 days'
        WHEN _plano.tipo_cobranca = 'anual'  THEN CURRENT_DATE + INTERVAL '365 days'
        ELSE NULL
      END,
      'Ativada automaticamente via Asaas'
    );

    _resultado := jsonb_build_object('tipo', 'plano', 'plano_id', _pg.plano_id);

  ELSIF _pg.referencia_tipo = 'modulo' AND _pg.modulo_id IS NOT NULL THEN
    INSERT INTO public.empresa_modulos (
      empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes
    ) VALUES (
      _pg.empresa_id, _pg.modulo_id, 'ativo', CURRENT_DATE,
      CURRENT_DATE + INTERVAL '30 days',
      'Ativado automaticamente via Asaas'
    )
    ON CONFLICT (empresa_id, modulo_id) DO UPDATE
      SET status = 'ativo',
          data_inicio = CURRENT_DATE,
          data_expiracao = CURRENT_DATE + INTERVAL '30 days',
          observacoes = 'Ativado automaticamente via Asaas';

    _resultado := jsonb_build_object('tipo', 'modulo', 'modulo_id', _pg.modulo_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'pagamento_id', _pg.id,
    'empresa_id', _pg.empresa_id,
    'ativacao', _resultado
  );
END;
$$;

-- Garante unicidade do par empresa+modulo para o ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_modulo
  ON public.empresa_modulos (empresa_id, modulo_id);