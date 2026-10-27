-- Corrige confirmar_pagamento_asaas() para modulo avulso (referencia_tipo = modulo, sem itens).
-- Antes: _plano era "record" e so recebia valor quando havia itens ou referencia_tipo = plano; para modulo
-- avulso o "IF _plano.id IS NOT NULL" falhava com 55000 (record "_plano" is not assigned yet) e o Pix pago
-- nunca ativava o modulo. Agora _plano e public.planos%ROWTYPE (sempre atribuido, com NULLs).
-- Unica mudanca no corpo; o restante e identico a 20260918160000. Nao ha pagamento de modulo avulso aberto
-- em producao (conferido antes da aplicacao), logo nenhuma ativacao retroativa.
BEGIN;

CREATE OR REPLACE FUNCTION public.confirmar_pagamento_asaas(
  _pagamento_id uuid,
  _data_pagamento date DEFAULT NULL,
  _forma_pagamento text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pg record;
  _plano public.planos%ROWTYPE;
  _it record;
  _ass record;
  _ativados jsonb := '[]'::jsonb;
  _has_itens boolean;
  _periodo_fim date;
  _modulo_fim date;
  _dia_ancora integer;
  _ciclo text;
  v_hoje_sp date := public.data_sao_paulo(now());
  v_data_pagamento date;
  v_empresa uuid;
  v_original uuid;
BEGIN
  -- Serializa as confirmacoes (e as solicitacoes de mensalidade) da MESMA empresa
  -- ANTES de qualquer trava de linha: duas confirmacoes nunca esperam uma pela
  -- linha da outra segurando o lock (sem deadlock).
  SELECT p.empresa_id INTO v_empresa FROM public.pagamentos AS p WHERE p.id = _pagamento_id;
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('assinatura:' || v_empresa::text, 0));

  SELECT * INTO _pg FROM public.pagamentos WHERE id = _pagamento_id FOR UPDATE;
  IF _pg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado');
  END IF;

  -- Idempotencia do MESMO pagamento (inclusive um pagamento ja registrado como
  -- duplicado): nao reprocessa nada.
  IF _pg.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'ja_processado', true, 'pagamento_id', _pg.id)
      || CASE WHEN _pg.competencia_duplicada_de IS NOT NULL
              THEN jsonb_build_object('duplicada', true, 'pagamento_original_id', _pg.competencia_duplicada_de)
              ELSE '{}'::jsonb
         END;
  END IF;

  -- Data efetiva do pagamento: a informada (data do evento no Asaas) ou hoje em
  -- Sao Paulo; nunca no futuro.
  v_data_pagamento := LEAST(COALESCE(_data_pagamento, v_hoje_sp), v_hoje_sp);

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
    -- Trava a assinatura: a regra depende do estado atual (vencimento, ancora, plano).
    SELECT a.id, a.plano_id, a.status, a.data_expiracao, a.dia_ancora
      INTO _ass
      FROM public.empresa_assinaturas AS a
     WHERE a.empresa_id = _pg.empresa_id
     FOR UPDATE;
  END IF;

  -- GUARDA DE COMPETENCIA (so pagamentos com competencia: mensalidades geradas
  -- por solicitar_mensalidade). Pagamentos sem competencia seguem como antes.
  IF _pg.competencia IS NOT NULL THEN
    -- (1) Competencia ja paga por OUTRO pagamento: registra o recebimento em
    -- duplicidade e NAO altera assinatura nem modulos.
    SELECT o.id INTO v_original
      FROM public.pagamentos AS o
     WHERE o.empresa_id = _pg.empresa_id
       AND o.competencia = _pg.competencia
       AND o.id <> _pg.id
       AND o.status = 'pago'
       AND o.competencia_duplicada_de IS NULL
     ORDER BY o.data_pagamento NULLS LAST, o.created_at, o.id
     LIMIT 1;

    IF v_original IS NOT NULL THEN
      UPDATE public.pagamentos
         SET status = 'pago',
             data_pagamento = v_data_pagamento,
             forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
             competencia_duplicada_de = v_original,
             observacoes = concat_ws(E'\n', observacoes,
               'Pagamento em duplicidade: a competência ' || to_char(_pg.competencia, 'DD/MM/YYYY')
               || ' já foi paga pelo pagamento ' || v_original::text
               || '. Assinatura não alterada; requer estorno ou crédito manual (recebido em '
               || to_char(v_data_pagamento, 'DD/MM/YYYY') || ').')
       WHERE id = _pg.id;
      RETURN jsonb_build_object(
        'ok', true,
        'duplicada', true,
        'assinatura_alterada', false,
        'pagamento_id', _pg.id,
        'pagamento_original_id', v_original,
        'competencia', _pg.competencia
      );
    END IF;

    -- (2) Plano da assinatura mudou depois que a cobranca foi gerada: a
    -- renovacao nao vale (nao reinicia ciclo nem troca o plano). Registra o
    -- recebimento sem alterar a assinatura, para conferencia manual. Como nada
    -- foi aplicado, este pagamento NAO ocupa a competencia (competencia = NULL,
    -- mantida na observacao): isso libera a cobranca correta (plano atual) e
    -- evita violar o indice se ela ja existir aberta.
    IF _plano.id IS NOT NULL THEN
      IF _ass.id IS NOT NULL AND _ass.plano_id IS DISTINCT FROM _plano.id THEN
        UPDATE public.pagamentos
           SET status = 'pago',
               data_pagamento = v_data_pagamento,
               forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
               competencia = NULL,
               observacoes = concat_ws(E'\n', observacoes,
                 'Pagamento recebido e NÃO aplicado: o plano da assinatura mudou depois que esta cobrança foi gerada (competência '
                 || to_char(_pg.competencia, 'DD/MM/YYYY')
                 || '). Assinatura não alterada; a competência ficou livre para nova cobrança. Requer conferência manual (estorno, crédito ou ajuste).')
         WHERE id = _pg.id;
        RETURN jsonb_build_object(
          'ok', true,
          'aplicado', false,
          'assinatura_alterada', false,
          'motivo', 'plano_divergente',
          'pagamento_id', _pg.id,
          'competencia', _pg.competencia
        );
      END IF;
    END IF;

    -- (3) Cobrancas ABERTAS da mesma competencia (so existem quando ESTE
    -- pagamento estava cancelado e foi cobrado de novo): passam a redundantes,
    -- para que a competencia tenha um unico pagamento valido.
    UPDATE public.pagamentos
       SET status = 'cancelado',
           competencia_duplicada_de = _pg.id,
           observacoes = concat_ws(E'\n', observacoes,
             'Cancelada automaticamente em ' || to_char(v_hoje_sp, 'DD/MM/YYYY')
             || ': a competência ' || to_char(_pg.competencia, 'DD/MM/YYYY')
             || ' foi quitada pelo pagamento ' || _pg.id::text || '.')
     WHERE empresa_id = _pg.empresa_id
       AND competencia = _pg.competencia
       AND id <> _pg.id
       AND competencia_duplicada_de IS NULL
       AND status IN ('pendente', 'atrasado');
  END IF;

  UPDATE public.pagamentos
     SET status = 'pago',
         data_pagamento = v_data_pagamento,
         forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
         competencia_duplicada_de = NULL
   WHERE id = _pg.id;

  IF _plano.id IS NOT NULL THEN
    IF _plano.tipo_cobranca = 'mensal' THEN
      IF _ass.id IS NOT NULL
         AND _ass.dia_ancora IS NOT NULL
         AND _ass.plano_id IS NOT DISTINCT FROM _plano.id THEN
        -- RENOVACAO: a ancora nunca muda; atraso nao acumula competencias.
        _ciclo := 'renovacao';
        _dia_ancora := _ass.dia_ancora;
        _periodo_fim := public.next_monthly_due_date(
          GREATEST(_ass.data_expiracao, v_data_pagamento),
          _dia_ancora
        );
      ELSE
        -- PRIMEIRA ATIVACAO (sem ancora) ou TROCA DE PLANO (ja ancorada, plano
        -- diferente): o ciclo comeca no pagamento, com ancora no dia dele.
        _ciclo := CASE
          WHEN _ass.dia_ancora IS NOT NULL THEN 'troca_de_plano'
          ELSE 'primeira_ativacao'
        END;
        _dia_ancora := EXTRACT(DAY FROM v_data_pagamento)::integer;
        _periodo_fim := public.next_monthly_due_date(v_data_pagamento, _dia_ancora);
      END IF;
    ELSIF _plano.tipo_cobranca = 'anual' THEN
      _dia_ancora := _ass.dia_ancora;
      IF _ass.id IS NOT NULL
         AND _ass.plano_id IS NOT DISTINCT FROM _plano.id
         AND _ass.data_expiracao IS NOT NULL
         AND _ass.status::text <> 'trial' THEN
        -- RENOVACAO ANUAL do mesmo plano: preserva os dias restantes.
        _ciclo := 'anual_renovacao';
        _periodo_fim := (GREATEST(_ass.data_expiracao, v_data_pagamento) + INTERVAL '1 year')::date;
      ELSE
        -- PRIMEIRA ATIVACAO ANUAL (trial, sem assinatura, outro plano): a partir do pagamento.
        _ciclo := 'anual';
        _periodo_fim := (v_data_pagamento + INTERVAL '1 year')::date;
      END IF;
    ELSE
      _ciclo := 'vitalicio';  -- vitalicio
      _dia_ancora := _ass.dia_ancora;
      _periodo_fim := NULL;
    END IF;
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
      empresa_id, plano_id, status, data_inicio, data_expiracao, dia_ancora, observacoes
    ) VALUES (
      _pg.empresa_id, _plano.id, 'active', v_data_pagamento, _periodo_fim, _dia_ancora,
      'Ativada via Asaas (' || _pg.id::text || ')'
    )
    ON CONFLICT (empresa_id) DO UPDATE
      SET plano_id = EXCLUDED.plano_id,
          status = 'active',
          data_inicio = EXCLUDED.data_inicio,
          data_expiracao = EXCLUDED.data_expiracao,
          dia_ancora = EXCLUDED.dia_ancora,
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
    'dia_ancora', _dia_ancora,
    'ciclo', _ciclo,
    'competencia', _pg.competencia,
    'itens', _ativados
  );
END;
$function$;

-- CREATE OR REPLACE preserva as permissoes; reafirma o contrato de
-- 20260428055600 (somente service_role, via Edge Function asaas-webhook).
REVOKE ALL ON FUNCTION public.confirmar_pagamento_asaas(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pagamento_asaas(uuid, date, text)
  TO service_role;

COMMENT ON FUNCTION public.confirmar_pagamento_asaas(uuid, date, text) IS
  'Confirma um pagamento Asaas (idempotente por status pago) e ativa plano/modulos. Plano MENSAL por mes-calendario: primeira ativacao grava dia_ancora = dia da data efetiva do pagamento (America/Sao_Paulo); renovacao (mesmo plano, ja ancorado) nunca muda a ancora e vence em next_monthly_due_date(GREATEST(vencimento atual, pagamento), ancora). Plano ANUAL: primeira ativacao = pagamento + 1 ano; renovacao do mesmo plano = GREATEST(vencimento atual, pagamento) + 1 ano. Competencia: pagamento de competencia ja paga por outro pagamento e registrado em duplicidade (competencia_duplicada_de) SEM alterar assinatura nem modulos; renovacao de plano que mudou depois da cobranca nao e aplicada. Lock por empresa (advisory, antes das travas de linha). Modulos inalterados (fallback CURRENT_DATE + 30 dias preservado). Somente service_role.';

COMMIT;
