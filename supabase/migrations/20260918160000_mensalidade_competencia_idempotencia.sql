-- Competencia e idempotencia das mensalidades (renovacoes) do Gestao Pro.
--
-- Depende de 20260918140000 (dia_ancora, next_monthly_due_date) e de
-- 20260918150000 (data_sao_paulo, confirmar_pagamento_asaas com a regra de
-- mes-calendario). Esta migration recusa rodar sem elas.
--
-- OBJETIVO: uma empresa nunca pode ter dois pagamentos validos da MESMA
-- competencia avancando a assinatura duas vezes.
--
-- COMPETENCIA (pagamentos.competencia, tipo date)
--   E o VENCIMENTO QUE ESTA SENDO RENOVADO: a empresa_assinaturas.data_expiracao
--   vigente quando a mensalidade e solicitada (mesma ideia do Backstage Pro,
--   asaas_payments.renewal_competence). Formato: data completa (AAAA-MM-DD), a
--   mesma da assinatura; NAO e "mes/ano". Como o vencimento avanca um
--   mes-calendario por renovacao, ha uma competencia por mes.
--   - Estavel enquanto a cobranca esta aberta (pendente/atrasada): e gravada
--     na criacao e nunca recalculada; o atraso nao a desloca.
--   - Pagar a competencia avanca o vencimento; so entao a proxima competencia
--     (o novo vencimento) pode ser cobrada. A competencia paga nunca e cobrada
--     de novo.
--   - NULL = pagamento que nao e mensalidade gerada por solicitar_mensalidade()
--     (carrinho, contratacao de plano/modulo, lancamento manual) OU historico
--     anterior a esta migration. Esses pagamentos nao entram na trava e seguem
--     exatamente como antes.
--
-- UNICIDADE (uq_pagamentos_empresa_competencia)
--   Indice unico parcial (empresa_id, competencia) sobre cobrancas VALIDAS:
--   status pendente, atrasado ou pago, com competencia informada e que nao
--   sejam redundantes (competencia_duplicada_de IS NULL). 'cancelado' (no
--   webhook: cancelamento, estorno e chargeback) NAO bloqueia nova cobranca.
--   Nao depende de descricao. O indice antigo uq_pagamentos_mensalidade_pendente
--   (uma mensalidade aberta por empresa, por descricao) e MANTIDO como rede de
--   seguranca para o historico sem competencia.
--
-- DUPLICIDADE (pagamentos.competencia_duplicada_de)
--   Aponta o pagamento que quitou a competencia; marca esta linha como
--   REDUNDANTE (paga em duplicidade, ou cancelada por redundancia). O RPC
--   confirmar_pagamento_asaas() confirma o dinheiro recebido (status pago,
--   data e forma) mas NAO altera assinatura nem modulos, grava a observacao
--   e responde {duplicada: true, assinatura_alterada: false}. Nada de novo
--   para o webhook: ok = true (sem reentrega infinita).
--
-- CONCORRENCIA
--   Chave unica de advisory lock por empresa ('assinatura:<empresa_id>'),
--   tomada por solicitar_mensalidade() (alem da 'mensalidade:<empresa_id>' que
--   ja existia) e por confirmar_pagamento_asaas(), SEMPRE antes de qualquer
--   trava de linha (evita deadlock entre duas confirmacoes da mesma empresa).
--   O indice unico e a barreira final se algum caminho futuro nao tomar o lock.
--
-- TROCA DE PLANO: NAO implementada aqui. A competencia nunca entra no calculo
--   do vencimento (so o GREATEST(vencimento, pagamento) e a ancora, como na
--   etapa anterior), portanto nao reinicia ciclo. Um pagamento COM competencia
--   cujo plano difere do plano ATUAL da assinatura (plano trocado depois que a
--   cobranca foi gerada) nao e aplicado: e registrado como pago, sem alterar a
--   assinatura, para conferencia manual (mesma regra do Backstage: a renovacao
--   nao vale se o plano mudou depois da cobranca). Como nada foi aplicado, esse
--   pagamento libera a competencia (competencia = NULL, guardada na observacao):
--   a cobranca correta, do plano atual, pode ser gerada e paga sem esperar.
--   Pagamentos SEM competencia (contratacao/troca de plano, carrinho) seguem o
--   comportamento anterior.
--
-- ANUAL (ajuste): a renovacao do MESMO plano anual, com assinatura vigente
--   (nao trial) e vencimento definido, preserva os dias restantes:
--   referencia = GREATEST(data_expiracao atual, data_pagamento); novo
--   vencimento = referencia + 1 year. A primeira ativacao anual (trial, sem
--   assinatura, outro plano) continua data_pagamento + 1 year.
--
-- COMPATIBILIDADE COM O HISTORICO: nenhuma linha antiga e reescrita, exceto as
--   mensalidades ABERTAS (pendente/atrasada) com padrao de descricao
--   'Mensalidade%', que recebem a competencia = vencimento vigente da empresa
--   (uso unico da descricao, so para identificar historico). Pagas e canceladas
--   antigas ficam com competencia NULL.
--
-- FORA DE ESCOPO, INALTERADO: modulos (inclusive o fallback CURRENT_DATE + 30
--   dias e o bug pre-existente do modulo avulso sem itens), carrinho, frontend,
--   Edge Functions (criacao da cobranca no Asaas, reserva antes do POST),
--   carencia, troca de plano.

BEGIN;

-- ============================================================================
-- 0) PRE-CONDICOES
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.data_sao_paulo(timestamptz)') IS NULL
     OR to_regprocedure('public.next_monthly_due_date(date, integer)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'empresa_assinaturas'
         AND column_name = 'dia_ancora'
     ) THEN
    RAISE EXCEPTION 'Aplique antes 20260918140000_assinatura_dia_ancora_vencimento_mensal.sql e 20260918150000_confirmar_pagamento_mes_calendario.sql';
  END IF;
END;
$$;

-- ============================================================================
-- 1) COLUNAS
-- ============================================================================
ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS competencia date,
  ADD COLUMN IF NOT EXISTS competencia_duplicada_de uuid
    REFERENCES public.pagamentos (id) ON DELETE SET NULL;

ALTER TABLE public.pagamentos
  DROP CONSTRAINT IF EXISTS pagamentos_competencia_duplicada_chk;
ALTER TABLE public.pagamentos
  ADD CONSTRAINT pagamentos_competencia_duplicada_chk
  CHECK (
    competencia_duplicada_de IS NULL
    OR (competencia IS NOT NULL AND competencia_duplicada_de <> id)
  );

COMMENT ON COLUMN public.pagamentos.competencia IS
  'Vencimento (empresa_assinaturas.data_expiracao) que esta mensalidade renova, gravado na criacao por solicitar_mensalidade() e nunca recalculado. Data completa AAAA-MM-DD. NULL = pagamento que nao e mensalidade gerada por solicitar_mensalidade() (carrinho, contratacao, manual) ou historico anterior a competencia.';
COMMENT ON COLUMN public.pagamentos.competencia_duplicada_de IS
  'Pagamento que quitou a competencia deste. Preenchido quando esta cobranca ficou REDUNDANTE: recebida em duplicidade (status pago, assinatura NAO alterada, requer estorno/credito manual) ou cancelada automaticamente por redundancia. Linhas marcadas nao entram em uq_pagamentos_empresa_competencia.';

-- ============================================================================
-- 2) BACKFILL (historico aberto) - funcao reexecutavel
-- ============================================================================
-- Estampa a competencia nas mensalidades ABERTAS anteriores a esta migration
-- (competencia NULL, referencia 'outro', status pendente/atrasado, descricao
-- 'Mensalidade%'): competencia = vencimento vigente da empresa. Uma por empresa
-- (a mais recente). Pagas e canceladas antigas nao sao tocadas. Idempotente.
-- _simular = true apenas conta.
CREATE OR REPLACE FUNCTION public.preencher_competencia_mensalidades(
  _empresa_id uuid DEFAULT NULL,
  _simular boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH alvo AS (
    SELECT DISTINCT ON (p.empresa_id)
           p.id,
           a.data_expiracao AS competencia
      FROM public.pagamentos AS p
      JOIN public.empresa_assinaturas AS a ON a.empresa_id = p.empresa_id
     WHERE p.competencia IS NULL
       AND p.referencia_tipo = 'outro'
       AND p.status IN ('pendente', 'atrasado')
       AND p.descricao LIKE 'Mensalidade%'
       AND a.data_expiracao IS NOT NULL
       AND (_empresa_id IS NULL OR p.empresa_id = _empresa_id)
       AND NOT EXISTS (
         SELECT 1
           FROM public.pagamentos AS o
          WHERE o.empresa_id = p.empresa_id
            AND o.competencia = a.data_expiracao
            AND o.competencia_duplicada_de IS NULL
            AND o.status IN ('pendente', 'atrasado', 'pago')
            AND o.id <> p.id
       )
     ORDER BY p.empresa_id, p.created_at DESC, p.id DESC
  ),
  atualizado AS (
    UPDATE public.pagamentos AS p
       SET competencia = alvo.competencia
      FROM alvo
     WHERE p.id = alvo.id
       AND NOT _simular
    RETURNING p.id
  )
  SELECT CASE WHEN _simular
              THEN (SELECT count(*) FROM alvo)
              ELSE (SELECT count(*) FROM atualizado)
         END::integer
    INTO v_n;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.preencher_competencia_mensalidades(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preencher_competencia_mensalidades(uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public.preencher_competencia_mensalidades(uuid, boolean) IS
  'Backfill: estampa pagamentos.competencia (= vencimento vigente da empresa) nas mensalidades ABERTAS anteriores a competencia. Idempotente; uma por empresa; nao toca pagas/canceladas. _simular = true so conta. Somente service_role.';

DO $$
DECLARE
  v_estampadas integer;
BEGIN
  v_estampadas := public.preencher_competencia_mensalidades();
  RAISE NOTICE 'competencia estampada em % mensalidade(s) aberta(s) do historico', v_estampadas;
END;
$$;

-- ============================================================================
-- 3) UNICIDADE POR EMPRESA + COMPETENCIA
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_empresa_competencia
  ON public.pagamentos (empresa_id, competencia)
  WHERE competencia IS NOT NULL
    AND competencia_duplicada_de IS NULL
    AND status IN ('pendente', 'atrasado', 'pago');

COMMENT ON INDEX public.uq_pagamentos_empresa_competencia IS
  'No maximo uma cobranca VALIDA (pendente, atrasada ou paga) por empresa e competencia. Cancelada (cancelamento/estorno/chargeback) e linhas redundantes (competencia_duplicada_de) nao bloqueiam.';

-- ============================================================================
-- 4) solicitar_mensalidade(): competencia derivada da assinatura
-- ============================================================================
-- Igual a versao de 20260825120000 (reajustes, composicao, itens, retorno uuid)
-- exceto: lock 'assinatura:' (mesma chave do webhook), competencia, reaproveita
-- a cobranca aberta da competencia, recusa competencia ja paga e grava a
-- competencia no INSERT.
CREATE OR REPLACE FUNCTION public.solicitar_mensalidade()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_empresa uuid; v_assin record; v_pag uuid; v_total numeric:=0; v_desc text; v_mod record; v_qtd int:=0;
  v_competencia date; v_status public.pagamento_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_empresa:=public.current_empresa_id(); IF v_empresa IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  -- Serializa chamadas concorrentes para a MESMA empresa (duplo clique, retry,
  -- duas abas) e tambem contra a confirmacao do webhook: a competencia e
  -- derivada do vencimento, que a confirmacao move.
  PERFORM pg_advisory_xact_lock(hashtextextended('mensalidade:' || v_empresa::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('assinatura:' || v_empresa::text, 0));

  SELECT a.*,p.nome,p.tipo_cobranca,p.valor valor_catalogo INTO v_assin
  FROM public.empresa_assinaturas a JOIN public.planos p ON p.id=a.plano_id
  WHERE a.empresa_id=v_empresa AND a.status::text IN ('active','ativo','trial','overdue','pending_payment','expired')
  ORDER BY a.updated_at DESC LIMIT 1;
  IF v_assin.id IS NULL THEN RAISE EXCEPTION 'Nenhum plano associado à empresa'; END IF;

  IF v_assin.proximo_valor IS NOT NULL AND v_assin.reajuste_vigencia<=CURRENT_DATE THEN
    UPDATE public.reajuste_historico SET aplicado_em=COALESCE(aplicado_em,now()) WHERE id=v_assin.reajuste_historico_id;
    UPDATE public.empresa_assinaturas SET valor_contratado=proximo_valor,proximo_valor=NULL,
      reajuste_vigencia=NULL,reajuste_historico_id=NULL WHERE id=v_assin.id;
    v_assin.valor_contratado:=v_assin.proximo_valor;
  END IF;
  UPDATE public.reajuste_historico h SET aplicado_em=COALESCE(h.aplicado_em,now())
  FROM public.empresa_modulos em WHERE em.empresa_id=v_empresa AND em.proximo_valor IS NOT NULL
    AND em.reajuste_vigencia<=CURRENT_DATE AND h.id=em.reajuste_historico_id;
  UPDATE public.empresa_modulos SET valor_contratado=proximo_valor,proximo_valor=NULL,
    reajuste_vigencia=NULL,reajuste_historico_id=NULL
  WHERE empresa_id=v_empresa AND proximo_valor IS NOT NULL AND reajuste_vigencia<=CURRENT_DATE;

  -- Competencia = o vencimento que esta sendo renovado. NULL (assinatura sem
  -- vencimento) cai no comportamento anterior, sem competencia.
  v_competencia := v_assin.data_expiracao;

  IF v_competencia IS NOT NULL THEN
    SELECT p.id, p.status INTO v_pag, v_status
      FROM public.pagamentos AS p
     WHERE p.empresa_id = v_empresa
       AND p.competencia = v_competencia
       AND p.competencia_duplicada_de IS NULL
       AND p.status IN ('pendente', 'atrasado', 'pago')
     LIMIT 1;
    IF v_pag IS NOT NULL THEN
      IF v_status = 'pago' THEN
        -- Competencia quitada: nunca cria outra cobranca para ela.
        RAISE EXCEPTION 'A mensalidade com vencimento em % já consta como paga. Se a assinatura não foi atualizada, entre em contato com o suporte.',
          to_char(v_competencia, 'DD/MM/YYYY');
      END IF;
      RETURN v_pag;  -- cobranca aberta da competencia: reaproveita (mesmo com Pix gerado)
    END IF;
  END IF;

  -- Outra mensalidade aberta da empresa (competencia anterior ou historico sem
  -- competencia): a cobranca aberta permanece estavel e e reaproveitada, como
  -- antes. So o historico sem competencia depende do padrao de descricao.
  SELECT id INTO v_pag FROM public.pagamentos WHERE empresa_id=v_empresa AND referencia_tipo='outro'
    AND status IN ('pendente', 'atrasado') AND (competencia IS NOT NULL OR descricao LIKE 'Mensalidade%')
    ORDER BY created_at DESC LIMIT 1;
  IF v_pag IS NOT NULL THEN RETURN v_pag; END IF;

  v_total:=COALESCE(v_assin.valor_contratado,v_assin.valor_catalogo,0);
  FOR v_mod IN SELECT m.id,m.nome,COALESCE(em.valor_contratado,m.valor) valor
    FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
    WHERE em.empresa_id=v_empresa AND em.status='ativo' AND COALESCE(em.valor_contratado,m.valor)>0
  LOOP v_total:=v_total+v_mod.valor; v_qtd:=v_qtd+1; END LOOP;
  v_desc:='Mensalidade Plano '||v_assin.nome||CASE WHEN v_qtd>0 THEN ' + '||v_qtd||' módulo(s)' ELSE '' END;

  BEGIN
    INSERT INTO public.pagamentos(empresa_id,referencia_tipo,descricao,valor,status,registrado_por,competencia)
    VALUES(v_empresa,'outro',v_desc,v_total,'pendente',auth.uid(),v_competencia) RETURNING id INTO v_pag;
  EXCEPTION WHEN unique_violation THEN
    -- Defesa extra: se por algum motivo o lock nao evitou a corrida (caminho
    -- futuro sem lock), os indices unicos barram o 2o INSERT. Devolve a
    -- cobranca que ja existe; competencia ja paga continua sendo recusada.
    v_pag := NULL;
    IF v_competencia IS NOT NULL THEN
      SELECT p.id, p.status INTO v_pag, v_status
        FROM public.pagamentos AS p
       WHERE p.empresa_id = v_empresa
         AND p.competencia = v_competencia
         AND p.competencia_duplicada_de IS NULL
         AND p.status IN ('pendente', 'atrasado', 'pago')
       LIMIT 1;
      IF v_pag IS NOT NULL AND v_status = 'pago' THEN
        RAISE EXCEPTION 'A mensalidade com vencimento em % já consta como paga. Se a assinatura não foi atualizada, entre em contato com o suporte.',
          to_char(v_competencia, 'DD/MM/YYYY');
      END IF;
    END IF;
    IF v_pag IS NULL THEN
      SELECT id INTO v_pag FROM public.pagamentos WHERE empresa_id=v_empresa AND referencia_tipo='outro'
        AND status IN ('pendente', 'atrasado') AND (competencia IS NOT NULL OR descricao LIKE 'Mensalidade%')
        ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF v_pag IS NULL THEN RAISE; END IF;
    RETURN v_pag;
  END;

  INSERT INTO public.pagamento_itens(pagamento_id,tipo,plano_id,descricao,valor)
  VALUES(v_pag,'plano',v_assin.plano_id,'Plano '||v_assin.nome,COALESCE(v_assin.valor_contratado,v_assin.valor_catalogo,0));
  FOR v_mod IN SELECT m.id,m.nome,COALESCE(em.valor_contratado,m.valor) valor
    FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
    WHERE em.empresa_id=v_empresa AND em.status='ativo' AND COALESCE(em.valor_contratado,m.valor)>0
  LOOP INSERT INTO public.pagamento_itens(pagamento_id,tipo,modulo_id,descricao,valor)
    VALUES(v_pag,'modulo',v_mod.id,'Módulo '||v_mod.nome,v_mod.valor); END LOOP;
  RETURN v_pag;
END; $$;
GRANT EXECUTE ON FUNCTION public.solicitar_mensalidade() TO authenticated;

COMMENT ON FUNCTION public.solicitar_mensalidade() IS
  'Gera (ou reaproveita) a cobranca da mensalidade da empresa. Competencia = vencimento vigente da assinatura: reaproveita a cobranca aberta (pendente/atrasada) da competencia, recusa competencia ja paga e nunca recalcula a competencia de uma cobranca aberta. Lock por empresa (mensalidade + assinatura). Retorna o id do pagamento.';

-- ============================================================================
-- 5) confirmar_pagamento_asaas(): competencia, duplicidade e anual
-- ============================================================================
-- Corpo de 20260918150000 com: lock por empresa antes das travas de linha;
-- guarda de competencia (duplicidade, plano divergente, cobrancas redundantes);
-- renovacao ANUAL com GREATEST(vencimento, pagamento) + 1 ano; retorno com
-- 'competencia'. Modulos, itens, data efetiva e demais respostas intactos.
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
