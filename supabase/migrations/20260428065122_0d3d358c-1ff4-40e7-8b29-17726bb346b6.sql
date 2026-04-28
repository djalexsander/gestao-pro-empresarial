-- =====================================================================
-- 1) ENUM: adicionar novos rótulos canônicos (mantém antigos como sinônimo)
-- =====================================================================
ALTER TYPE public.assinatura_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE public.assinatura_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE public.assinatura_status ADD VALUE IF NOT EXISTS 'overdue';
ALTER TYPE public.assinatura_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.assinatura_status ADD VALUE IF NOT EXISTS 'canceled';

-- =====================================================================
-- 2) UNICIDADE de empresa_assinaturas (uma assinatura por empresa)
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='empresa_assinaturas_empresa_id_uniq'
  ) THEN
    CREATE UNIQUE INDEX empresa_assinaturas_empresa_id_uniq
      ON public.empresa_assinaturas(empresa_id);
  END IF;
END $$;

-- =====================================================================
-- 3) FIX: confirmar_pagamento_asaas
--    - usa status 'active' (antes tentava 'ativa', valor inválido)
--    - calcula data_expiracao por tipo_cobranca do plano
--    - faz UPSERT na assinatura (não duplica linhas)
--    - módulos herdam a data_expiracao do plano vigente do carrinho
-- =====================================================================
CREATE OR REPLACE FUNCTION public.confirmar_pagamento_asaas(
  _pagamento_id uuid,
  _data_pagamento date DEFAULT CURRENT_DATE,
  _forma_pagamento text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pg record;
  _plano record;
  _it record;
  _ativados jsonb := '[]'::jsonb;
  _has_itens boolean;
  _periodo_fim date;
  _modulo_fim date;
BEGIN
  SELECT * INTO _pg FROM public.pagamentos WHERE id = _pagamento_id FOR UPDATE;
  IF _pg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado');
  END IF;

  IF _pg.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'ja_processado', true, 'pagamento_id', _pg.id);
  END IF;

  UPDATE public.pagamentos
     SET status = 'pago',
         data_pagamento = COALESCE(_data_pagamento, CURRENT_DATE),
         forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento)
   WHERE id = _pg.id;

  SELECT EXISTS(SELECT 1 FROM public.pagamento_itens WHERE pagamento_id = _pg.id) INTO _has_itens;

  -- Determina ciclo: se há plano no carrinho/pagamento, usa tipo_cobranca dele
  IF _has_itens THEN
    SELECT p.* INTO _plano
      FROM public.pagamento_itens pi
      JOIN public.planos p ON p.id = pi.plano_id
     WHERE pi.pagamento_id = _pg.id AND pi.tipo = 'plano'
     LIMIT 1;
  ELSIF _pg.referencia_tipo = 'plano' AND _pg.plano_id IS NOT NULL THEN
    SELECT * INTO _plano FROM public.planos WHERE id = _pg.plano_id;
  END IF;

  IF _plano.id IS NOT NULL THEN
    _periodo_fim := CASE
      WHEN _plano.tipo_cobranca = 'mensal' THEN CURRENT_DATE + INTERVAL '30 days'
      WHEN _plano.tipo_cobranca = 'anual'  THEN CURRENT_DATE + INTERVAL '365 days'
      ELSE NULL  -- vitalicio
    END;
  END IF;

  -- Para módulos: herda data_expiracao do plano vigente (carrinho ou já contratado)
  IF _periodo_fim IS NOT NULL THEN
    _modulo_fim := _periodo_fim;
  ELSE
    SELECT data_expiracao INTO _modulo_fim
      FROM public.empresa_assinaturas
     WHERE empresa_id = _pg.empresa_id
       AND status IN ('active','ativo','trial')
     LIMIT 1;
    IF _modulo_fim IS NULL OR _modulo_fim < CURRENT_DATE THEN
      _modulo_fim := CURRENT_DATE + INTERVAL '30 days';
    END IF;
  END IF;

  -- Ativa plano (UPSERT — uma assinatura por empresa)
  IF _plano.id IS NOT NULL THEN
    INSERT INTO public.empresa_assinaturas (
      empresa_id, plano_id, status, data_inicio, data_expiracao, observacoes
    ) VALUES (
      _pg.empresa_id, _plano.id, 'active', CURRENT_DATE, _periodo_fim,
      'Ativada via Asaas (' || _pg.id::text || ')'
    )
    ON CONFLICT (empresa_id) DO UPDATE
      SET plano_id = EXCLUDED.plano_id,
          status = 'active',
          data_inicio = CURRENT_DATE,
          data_expiracao = EXCLUDED.data_expiracao,
          observacoes = EXCLUDED.observacoes,
          updated_at = now();
    _ativados := _ativados || jsonb_build_object('tipo','plano','id',_plano.id);
  END IF;

  -- Ativa módulos (consolidado ou simples)
  IF _has_itens THEN
    FOR _it IN
      SELECT * FROM public.pagamento_itens
       WHERE pagamento_id = _pg.id AND tipo = 'modulo' AND modulo_id IS NOT NULL
    LOOP
      INSERT INTO public.empresa_modulos (
        empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes
      ) VALUES (
        _pg.empresa_id, _it.modulo_id, 'ativo', CURRENT_DATE, _modulo_fim,
        'Ativado via Asaas (' || _pg.id::text || ')'
      )
      ON CONFLICT (empresa_id, modulo_id) DO UPDATE
        SET status = 'ativo',
            data_inicio = CURRENT_DATE,
            data_expiracao = EXCLUDED.data_expiracao,
            observacoes = EXCLUDED.observacoes,
            updated_at = now();
      _ativados := _ativados || jsonb_build_object('tipo','modulo','id',_it.modulo_id);
    END LOOP;
  ELSIF _pg.referencia_tipo = 'modulo' AND _pg.modulo_id IS NOT NULL THEN
    INSERT INTO public.empresa_modulos (
      empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes
    ) VALUES (
      _pg.empresa_id, _pg.modulo_id, 'ativo', CURRENT_DATE, _modulo_fim,
      'Ativado via Asaas'
    )
    ON CONFLICT (empresa_id, modulo_id) DO UPDATE
      SET status = 'ativo',
          data_inicio = CURRENT_DATE,
          data_expiracao = EXCLUDED.data_expiracao,
          observacoes = EXCLUDED.observacoes,
          updated_at = now();
    _ativados := _ativados || jsonb_build_object('tipo','modulo','id',_pg.modulo_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'pagamento_id', _pg.id,
    'data_expiracao', _periodo_fim,
    'itens', _ativados
  );
END;
$function$;

-- =====================================================================
-- 4) Status efetivo refinado: distingue active/pending_payment/overdue/expired
-- =====================================================================
CREATE OR REPLACE FUNCTION public.assinatura_status_efetivo(_empresa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD;
  v_efetivo text;
  v_readonly boolean := false;
  v_limited boolean := false;
  v_dias_restantes int := 0;
  v_dias_atraso int := 0;
  v_tem_pendente boolean := false;
  v_grace_days int := 7;
BEGIN
  SELECT * INTO a FROM public.empresa_assinaturas WHERE empresa_id = _empresa_id;

  IF a.id IS NULL THEN
    RETURN jsonb_build_object(
      'status','expired','readonly',true,'limited',false,
      'dias_restantes',0,'dias_atraso',0,
      'plano_id',NULL,'data_expiracao',NULL,'tem_pendente',false
    );
  END IF;

  -- Existe pagamento pendente?
  SELECT EXISTS(
    SELECT 1 FROM public.pagamentos
     WHERE empresa_id = _empresa_id AND status = 'pendente'
  ) INTO v_tem_pendente;

  -- Normaliza valor canônico
  v_efetivo := CASE a.status::text
    WHEN 'ativo' THEN 'active'
    WHEN 'vencido' THEN 'expired'
    WHEN 'cancelado' THEN 'canceled'
    ELSE a.status::text
  END;

  -- Recalcula vencimento on-the-fly para active/trial
  IF v_efetivo IN ('active','trial')
     AND a.data_expiracao IS NOT NULL THEN
    IF a.data_expiracao < CURRENT_DATE THEN
      v_dias_atraso := CURRENT_DATE - a.data_expiracao;
      IF v_dias_atraso <= v_grace_days THEN
        v_efetivo := 'overdue';
      ELSE
        v_efetivo := 'expired';
      END IF;
    END IF;
  END IF;

  v_readonly := (v_efetivo IN ('expired','canceled'));
  v_limited  := (v_efetivo = 'overdue');
  v_dias_restantes := COALESCE(a.data_expiracao - CURRENT_DATE, 0);

  RETURN jsonb_build_object(
    'status', v_efetivo,
    'readonly', v_readonly,
    'limited', v_limited,
    'dias_restantes', v_dias_restantes,
    'dias_atraso', v_dias_atraso,
    'plano_id', a.plano_id,
    'data_inicio', a.data_inicio,
    'data_expiracao', a.data_expiracao,
    'tem_pendente', v_tem_pendente
  );
END;
$function$;

-- =====================================================================
-- 5) Cobrança pendente atual (para retomar Pix)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cobranca_pendente_atual()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid;
  v_pg record;
  v_itens jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_emp FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1;
  IF v_emp IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_pg
    FROM public.pagamentos
   WHERE empresa_id = v_emp AND status = 'pendente'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_pg.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tipo', pi.tipo, 'plano_id', pi.plano_id, 'modulo_id', pi.modulo_id,
    'descricao', pi.descricao, 'valor', pi.valor
  )), '[]'::jsonb) INTO v_itens
  FROM public.pagamento_itens pi
  WHERE pi.pagamento_id = v_pg.id;

  RETURN jsonb_build_object(
    'pagamento_id', v_pg.id,
    'valor', v_pg.valor,
    'descricao', v_pg.descricao,
    'data_vencimento', v_pg.data_vencimento,
    'asaas_payment_id', v_pg.asaas_payment_id,
    'invoice_url', v_pg.asaas_invoice_url,
    'pix_qrcode', v_pg.asaas_pix_qrcode,
    'pix_copia_cola', v_pg.asaas_pix_copia_cola,
    'created_at', v_pg.created_at,
    'itens', v_itens
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cobranca_pendente_atual() TO authenticated;

-- =====================================================================
-- 6) Job diário: marca overdue/expired automaticamente
-- =====================================================================
CREATE OR REPLACE FUNCTION public.marcar_assinaturas_overdue_expired()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_overdue int := 0;
  v_expired int := 0;
  v_grace int := 7;
BEGIN
  -- active/trial vencido há ≤ grace → overdue
  WITH upd AS (
    UPDATE public.empresa_assinaturas
       SET status = 'overdue', updated_at = now()
     WHERE status::text IN ('active','ativo','trial')
       AND data_expiracao IS NOT NULL
       AND data_expiracao < CURRENT_DATE
       AND CURRENT_DATE - data_expiracao <= v_grace
     RETURNING 1
  ) SELECT count(*) INTO v_overdue FROM upd;

  -- overdue/active vencido > grace → expired
  WITH upd AS (
    UPDATE public.empresa_assinaturas
       SET status = 'expired', updated_at = now()
     WHERE status::text IN ('overdue','active','ativo','trial','vencido')
       AND data_expiracao IS NOT NULL
       AND data_expiracao < CURRENT_DATE
       AND CURRENT_DATE - data_expiracao > v_grace
     RETURNING 1
  ) SELECT count(*) INTO v_expired FROM upd;

  RETURN jsonb_build_object('overdue', v_overdue, 'expired', v_expired);
END;
$function$;

-- =====================================================================
-- 7) pg_cron: roda diariamente às 03:00 UTC
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marcar-assinaturas-vencidas') THEN
    PERFORM cron.unschedule('marcar-assinaturas-vencidas');
  END IF;
  PERFORM cron.schedule(
    'marcar-assinaturas-vencidas',
    '0 3 * * *',
    $sql$ SELECT public.marcar_assinaturas_overdue_expired(); $sql$
  );
END $$;