-- Integra a regra de MES-CALENDARIO (dia-ancora) ao fluxo real de confirmacao
-- de pagamento: elimina o "+30 dias" mensal e o "+365 dias" anual de
-- confirmar_pagamento_asaas() (migration 20260428065122).
--
-- Depende de 20260918140000_assinatura_dia_ancora_vencimento_mensal.sql
-- (coluna empresa_assinaturas.dia_ancora, next_monthly_due_date(date, integer)
-- e preencher_dia_ancora_assinaturas()); esta migration recusa rodar sem ela.
--
-- CAMINHO Edge Function -> RPC (verificado, sem alteracao na Edge):
--   supabase/functions/asaas-webhook/index.ts chama
--   confirmar_pagamento_asaas(_pagamento_id, _data_pagamento, _forma_pagamento)
--   com _data_pagamento = dateOnly(paymentDate ?? confirmedDate ??
--   clientPaymentDate) do pagamento verificado no Asaas: uma DATA (AAAA-MM-DD,
--   calendario do Brasil), ou NULL se o Asaas nao informar nenhuma. Ate aqui o
--   RPC gravava essa data em pagamentos.data_pagamento mas calculava o ciclo com
--   CURRENT_DATE (data do servidor, UTC). Agora a data efetiva do pagamento
--   governa o ciclo.
--
-- REGRA (pagamento que contem um item de plano):
--   MENSAL - PRIMEIRA ATIVACAO (sem assinatura, ou sem dia_ancora: trial,
--     nunca paga, cancelada...):
--       dia_ancora     = dia da data efetiva do pagamento;
--       data_expiracao = next_monthly_due_date(data_pagamento, dia_ancora).
--   MENSAL - RENOVACAO (assinatura existente, MESMO plano, dia_ancora definido):
--       dia_ancora NUNCA muda;
--       referencia     = GREATEST(data_expiracao atual, data_pagamento);
--       data_expiracao = next_monthly_due_date(referencia, dia_ancora).
--     Pagamento adiantado nao perde dias; pagamento atrasado nao acumula
--     competencias anteriores (regra vigente do Backstage Pro).
--   MENSAL - TROCA DE PLANO (plano diferente e assinatura ja ancorada):
--     preserva o comportamento atual de RECOMECAR o ciclo a partir do pagamento
--     (nova ancora = dia do pagamento). NAO e o desenho final: a troca devera
--     preservar ancora/vencimento numa etapa futura; aqui so o calculo deixou
--     de ser "+30 dias".
--   ANUAL: data efetiva do pagamento + 1 ano-calendario (antes: +365 dias);
--     dia_ancora inalterado (anual nao usa ancora). A referencia continua sendo
--     a data do pagamento, como ate hoje (nao ha GREATEST no anual).
--   VITALICIO: sem vencimento; dia_ancora inalterado.
--
-- DATA EFETIVA DO PAGAMENTO = _data_pagamento informada, ou, se NULL, a data de
-- HOJE em America/Sao_Paulo; nunca posterior a hoje em Sao Paulo (um pagamento
-- nao pode estar no futuro; protege o ciclo contra data invalida do provedor).
-- O default do parametro deixa de ser CURRENT_DATE (data UTC do servidor) e
-- passa a ser NULL, resolvido dentro do RPC pela data de Sao Paulo.
--
-- CONCORRENCIA: a regra nova le a assinatura antes de escrever (leitura-
-- modificacao-escrita), ao contrario do "+30 dias" que dependia so de hoje.
-- Por isso o RPC serializa as confirmacoes da MESMA empresa com
-- pg_advisory_xact_lock e trava a linha da assinatura (FOR UPDATE): dois
-- pagamentos simultaneos nao podem ler o mesmo vencimento e perder um avanco.
--
-- IDEMPOTENCIA PRESERVADA: o mesmo pagamento nunca avanca duas vezes (status
-- 'pago' -> 'ja_processado', sob o FOR UPDATE do pagamento). Nada novo para
-- pagamento cancelado: o RPC continua confirmando qualquer pagamento que nao
-- esteja 'pago'. Consequencia da regra nova (nao existia antes): dois
-- pagamentos DISTINTOS confirmados avancam dois meses (antes o segundo nao
-- estendia nada, pois o resultado dependia so de hoje); a trava por
-- competencia que impede a cobranca duplicada e assunto de etapa futura.
--
-- FORA DE ESCOPO, INALTERADO: modulos (inclusive o fallback CURRENT_DATE +
-- 30 dias de _modulo_fim quando nao ha plano valido para acompanhar), carrinho,
-- frontend, carencia, Edge Functions. Bug PRE-EXISTENTE preservado de
-- proposito: pagamento de modulo avulso (referencia_tipo = 'modulo', sem itens)
-- nao atribui _plano e falha em `IF _plano.id IS NOT NULL` com
-- 'record "_plano" is not assigned yet'; corrigir muda comportamento de modulos.

BEGIN;

-- ============================================================================
-- 0) PRE-CONDICOES
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.next_monthly_due_date(date, integer)') IS NULL
     OR to_regprocedure('public.preencher_dia_ancora_assinaturas(uuid, boolean)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'empresa_assinaturas'
         AND column_name = 'dia_ancora'
     ) THEN
    RAISE EXCEPTION 'Aplique antes 20260918140000_assinatura_dia_ancora_vencimento_mensal.sql (coluna dia_ancora, next_monthly_due_date e preencher_dia_ancora_assinaturas)';
  END IF;
END;
$$;

-- ============================================================================
-- 1) VIRADA: ancora as assinaturas mensais que ficaram sem dia_ancora
-- ============================================================================
-- Ativacoes feitas pelo fluxo antigo (+30 dias) depois da migration
-- 20260918140000 nasceram com dia_ancora NULL. Este e o momento de virada do
-- fluxo: reexecuta o backfill (idempotente; so preenche NULL; nunca
-- sobrescreve; mesma regra de elegibilidade da migration anterior).
DO $$
DECLARE
  v_preenchidas integer;
BEGIN
  v_preenchidas := public.preencher_dia_ancora_assinaturas();
  RAISE NOTICE 'virada: dia_ancora preenchido em % assinatura(s) mensal(is) remanescente(s)', v_preenchidas;
END;
$$;

-- ============================================================================
-- 2) CONVERSAO PARA A DATA DE NEGOCIO (America/Sao_Paulo)
-- ============================================================================
-- Data de calendario, em Sao Paulo, de um instante. Deterministica: nao depende
-- do TimeZone da sessao (o servidor Supabase roda em UTC; entre 21h e 23h59 de
-- Sao Paulo a data UTC ja e o dia seguinte).
CREATE OR REPLACE FUNCTION public.data_sao_paulo(_ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT (_ts AT TIME ZONE 'America/Sao_Paulo')::date
$$;

REVOKE ALL ON FUNCTION public.data_sao_paulo(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_sao_paulo(timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.data_sao_paulo(timestamptz) IS
  'Data de calendario em America/Sao_Paulo de um instante (timestamptz). Nao depende do TimeZone da sessao. Usar para converter instantes em datas de negocio antes de chamar next_monthly_due_date().';

-- ============================================================================
-- 3) confirmar_pagamento_asaas() com a regra de mes-calendario
-- ============================================================================
-- Corpo identico ao de 20260428065122 exceto: default de _data_pagamento (NULL),
-- data efetiva do pagamento, calculo do ciclo (mensal/anual), lock por empresa,
-- gravacao de dia_ancora e data_inicio = data efetiva, e chaves adicionais no
-- jsonb de retorno (dia_ancora, ciclo). Modulos, itens e idempotencia intactos.
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
  _plano record;
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
BEGIN
  SELECT * INTO _pg FROM public.pagamentos WHERE id = _pagamento_id FOR UPDATE;
  IF _pg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado');
  END IF;

  IF _pg.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'ja_processado', true, 'pagamento_id', _pg.id);
  END IF;

  -- Data efetiva do pagamento: a informada (data do evento no Asaas) ou hoje em
  -- Sao Paulo; nunca no futuro.
  v_data_pagamento := LEAST(COALESCE(_data_pagamento, v_hoje_sp), v_hoje_sp);

  UPDATE public.pagamentos
     SET status = 'pago',
         data_pagamento = v_data_pagamento,
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
    -- Serializa as confirmacoes da mesma empresa e trava a assinatura: a regra
    -- nova depende do estado atual (vencimento e ancora).
    PERFORM pg_advisory_xact_lock(hashtextextended('assinatura:' || _pg.empresa_id::text, 0));

    SELECT a.id, a.plano_id, a.data_expiracao, a.dia_ancora
      INTO _ass
      FROM public.empresa_assinaturas AS a
     WHERE a.empresa_id = _pg.empresa_id
     FOR UPDATE;

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
      _ciclo := 'anual';
      _dia_ancora := _ass.dia_ancora;
      _periodo_fim := (v_data_pagamento + INTERVAL '1 year')::date;
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

-- O comentario da coluna (20260918140000) dizia "hoje NENHUM fluxo le ou grava
-- esta coluna"; a partir daqui e confirmar_pagamento_asaas() que a le e grava.
COMMENT ON COLUMN public.empresa_assinaturas.dia_ancora IS
  'Dia do mes (1-31) que ancora o vencimento das cobrancas MENSAIS. Gravado por confirmar_pagamento_asaas() na primeira ativacao paga (dia da data efetiva do pagamento em America/Sao_Paulo) ou ao trocar para outro plano mensal, e preservado nas renovacoes; assinaturas mensais anteriores sao ancoradas por preencher_dia_ancora_assinaturas() (dia do vencimento atual). Proximo vencimento = next_monthly_due_date(GREATEST(data_expiracao, data_pagamento), dia_ancora), com clamp para o ultimo dia dos meses menores. NULL = sem ancora (trial, plano anual ou vitalicio, sem vencimento, ou ainda nao paga).';

COMMENT ON FUNCTION public.confirmar_pagamento_asaas(uuid, date, text) IS
  'Confirma um pagamento Asaas (idempotente por status pago) e ativa plano/modulos. Plano MENSAL por mes-calendario: primeira ativacao grava dia_ancora = dia da data efetiva do pagamento (America/Sao_Paulo) e vence em next_monthly_due_date(pagamento, ancora); renovacao (mesmo plano, ja ancorado) nunca muda a ancora e vence em next_monthly_due_date(GREATEST(vencimento atual, pagamento), ancora), sem acumular atrasos; troca de plano recomeca o ciclo (comportamento anterior). Plano ANUAL: data efetiva + 1 ano-calendario. Data efetiva = _data_pagamento (evento Asaas) ou hoje em Sao Paulo, nunca futura. Lock por empresa (advisory) e FOR UPDATE na assinatura. Modulos inalterados (fallback CURRENT_DATE + 30 dias preservado). Somente service_role.';

COMMIT;
