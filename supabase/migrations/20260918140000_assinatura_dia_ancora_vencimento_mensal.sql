-- Base de banco para vencimento mensal por MES-CALENDARIO (dia-ancora).
--
-- Problema atual: confirmar_pagamento_asaas() renova com
-- CURRENT_DATE + INTERVAL '30 days' (migration 20260428065122). Dias corridos
-- fazem o vencimento derivar ao longo do ano, pular fevereiro (31/jan + 30d =
-- 02/mar) e deslocar todas as datas futuras quando o pagamento atrasa.
--
-- Regra adotada (a mesma do Backstage Pro, migration
-- 20260916180000_fix_monthly_vencimento_calendar_anchor.sql):
--   * o plano mensal tem um DIA-ANCORA = dia da primeira ativacao paga;
--   * a ancora permanece fixa nas renovacoes;
--   * proximo vencimento = mes-calendario seguinte, no dia-ancora, com clamp
--     para o ultimo dia dos meses menores: 31/jan -> 28/fev -> 31/mar -> 30/abr;
--   * pagamento atrasado: GREATEST(vencimento atual, data do pagamento) e
--     depois o proximo mes pela ancora; competencias atrasadas NAO acumulam.
--
-- ESCOPO: somente a BASE DE BANCO. Nada aqui altera o fluxo de cobranca:
-- confirmar_pagamento_asaas(), solicitar_mensalidade(), a Edge Function
-- asaas-webhook, o cron marcar-assinaturas-vencidas e o frontend continuam
-- exatamente como estao e AINDA NAO leem nem gravam a coluna nova.
--
-- Adiciona:
--   1. empresa_assinaturas.dia_ancora (smallint, 1..31; NULL = sem ancora);
--   2. next_monthly_due_date(date, integer): calculo puro e deterministico;
--   3. preencher_dia_ancora_assinaturas(uuid, boolean): backfill idempotente,
--      executado uma vez ao final desta migration.
--
-- Diferencas propositais em relacao ao Backstage:
--   * `date` em vez de timestamptz (empresa_assinaturas.data_expiracao e date;
--     nao ha hora do dia a preservar). Quem chamar com um instante
--     (timestamptz) deve converter explicitamente para a data de negocio,
--     por exemplo (ts AT TIME ZONE 'America/Sao_Paulo')::date. A funcao em si
--     nao depende de TimeZone nem de DateStyle.
--   * valida entradas (ancora fora de 1..31, NULL, infinito, a.C.) em vez de
--     devolver uma data errada ou NULL. Aqui NULL em data_expiracao significa
--     "sem vencimento" (vitalicio), entao um NULL silencioso concederia acesso
--     permanente; falhar alto e o comportamento seguro.

BEGIN;

-- ============================================================================
-- 1) COLUNA
-- ============================================================================
ALTER TABLE public.empresa_assinaturas
  ADD COLUMN IF NOT EXISTS dia_ancora smallint
  CONSTRAINT empresa_assinaturas_dia_ancora_chk CHECK (dia_ancora BETWEEN 1 AND 31);

COMMENT ON COLUMN public.empresa_assinaturas.dia_ancora IS
  'Dia do mes (1-31) que ancora o vencimento das cobrancas MENSAIS: dia da primeira ativacao paga, mantido fixo nas renovacoes. Proximo vencimento = next_monthly_due_date(GREATEST(data_expiracao, data_pagamento), dia_ancora), com clamp para o ultimo dia dos meses menores. NULL = sem ancora (trial, plano anual ou vitalicio, sem vencimento, ou ainda nao ativada/paga). Hoje NENHUM fluxo le ou grava esta coluna.';

-- ============================================================================
-- 2) CALCULO DO PROXIMO VENCIMENTO
-- ============================================================================
-- Devolve a ocorrencia de _anchor_day no mes-calendario SEGUINTE ao mes de
-- _from, com clamp para o ultimo dia desse mes. Somente mes/ano de _from
-- importam: o dia de _from e ignorado, e o clamp e sempre recalculado a partir
-- da ancora (nunca do vencimento anterior ja ajustado), entao a ancora nao se
-- perde apos um mes curto: 31/jan -> 28/fev -> 31/mar -> 30/abr.
--
-- Aritmetica inteira sobre (ano, mes) e regra gregoriana explicita: sem
-- interval, sem timestamp, sem timestamptz. IMMUTABLE de verdade: o resultado
-- nao muda com TimeZone, DateStyle ou search_path da sessao.
--
-- Uso previsto na renovacao (etapa futura):
--   next_monthly_due_date(GREATEST(data_expiracao, data_pagamento), dia_ancora)
-- Ao chamar com EXTRACT(DAY ...), converter: EXTRACT(DAY FROM d)::integer.
CREATE OR REPLACE FUNCTION public.next_monthly_due_date(
  _from date,
  _anchor_day integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_year integer;
  v_month integer;
  v_last_day integer;
BEGIN
  IF _from IS NULL OR _anchor_day IS NULL THEN
    RAISE EXCEPTION 'next_monthly_due_date: _from e _anchor_day sao obrigatorios'
      USING ERRCODE = '22004';
  END IF;

  IF _anchor_day < 1 OR _anchor_day > 31 THEN
    RAISE EXCEPTION 'next_monthly_due_date: _anchor_day deve estar entre 1 e 31 (recebido %)', _anchor_day
      USING ERRCODE = '22023';
  END IF;

  IF _from = 'infinity'::date OR _from = '-infinity'::date THEN
    RAISE EXCEPTION 'next_monthly_due_date: _from infinito nao e suportado'
      USING ERRCODE = '22008';
  END IF;

  v_year := EXTRACT(YEAR FROM _from)::integer;
  IF v_year < 1 THEN
    RAISE EXCEPTION 'next_monthly_due_date: datas a.C. nao sao suportadas (ano %)', v_year
      USING ERRCODE = '22008';
  END IF;
  v_month := EXTRACT(MONTH FROM _from)::integer;

  -- Avanca um mes-calendario.
  IF v_month = 12 THEN
    v_year := v_year + 1;
    v_month := 1;
  ELSE
    v_month := v_month + 1;
  END IF;

  v_last_day := CASE
    WHEN v_month = 2 THEN
      CASE
        WHEN (v_year % 4 = 0 AND v_year % 100 <> 0) OR v_year % 400 = 0 THEN 29
        ELSE 28
      END
    WHEN v_month IN (4, 6, 9, 11) THEN 30
    ELSE 31
  END;

  RETURN make_date(v_year, v_month, LEAST(_anchor_day, v_last_day));
END;
$$;

REVOKE ALL ON FUNCTION public.next_monthly_due_date(date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_monthly_due_date(date, integer)
  TO service_role;

COMMENT ON FUNCTION public.next_monthly_due_date(date, integer) IS
  'Ocorrencia de _anchor_day no mes-calendario seguinte ao mes de _from, com clamp para o ultimo dia desse mes (31/jan -> 28/fev -> 31/mar -> 30/abr; 29/fev em ano bissexto). Puro e deterministico: aritmetica inteira sobre ano/mes, sem dependencia de TimeZone, DateStyle ou search_path. Falha (22004/22023/22008) em NULL, ancora fora de 1..31, data infinita ou a.C. Equivalente em date do next_monthly_due_date(timestamptz, integer) do Backstage Pro.';

-- ============================================================================
-- 3) BACKFILL DAS ASSINATURAS EXISTENTES
-- ============================================================================
-- Preenche dia_ancora = dia de data_expiracao SOMENTE onde ha um ciclo mensal
-- real e a ancora ainda e NULL. Regras:
--
--   Elegivel se TODAS:
--     * dia_ancora IS NULL                    (nunca sobrescreve uma ancora);
--     * data_expiracao IS NOT NULL            (sem vencimento nao ha ciclo);
--     * plano com tipo_cobranca = 'mensal'    (anual usa +1 ano; vitalicio nao
--                                              vence; nenhum dos dois usa dia);
--     * status 'active'/'ativo'               (ciclo vigente) OU
--       status 'overdue'/'expired'/'vencido'/'pending_payment' COM historico
--       de pagamento de plano ja confirmado (pagamentos.status = 'pago' com
--       referencia_tipo = 'plano' ou item de plano em pagamento_itens).
--
--   Nunca ancora:
--     * 'trial': o dia do fim do trial nao e o dia da primeira ativacao paga;
--     * overdue/expired SEM historico pago: e um trial vencido (o cron
--       marcar_assinaturas_overdue_expired troca trial -> overdue -> expired e
--       perde a origem). Ancorar aqui faria a primeira ativacao paga herdar o
--       dia do fim do trial em vez do dia do pagamento;
--     * cancelado/canceled, anual, vitalicio, sem plano, sem data_expiracao.
--
--   Valor escolhido: o dia do vencimento ATUAL. Nao ha como recuperar a
--   "primeira ativacao paga" (data_inicio e sobrescrito a cada renovacao), e
--   usar o dia atual garante que o primeiro ciclo pela regra nova dure
--   exatamente um mes, sem mudar a data de ninguem no momento da virada.
--
-- Efeitos colaterais: o UPDATE toca apenas dia_ancora. O trigger
-- trg_assin_updated (BEFORE UPDATE, set_updated_at) atualiza updated_at das
-- linhas preenchidas; trg_assin_valor_contratado NAO dispara (so reage a
-- UPDATE OF plano_id, status, data_inicio). data_expiracao, status, plano e
-- valores nao mudam.
--
-- _simular = true: devolve quantas linhas seriam preenchidas SEM gravar nada.
-- _empresa_id: restringe a uma empresa (util para conferir um caso).
--
-- Reexecutavel: enquanto o fluxo antigo (+30 dias) estiver ativo, ativacoes
-- novas continuam nascendo com dia_ancora NULL. Reexecute
--   SELECT public.preencher_dia_ancora_assinaturas();
-- imediatamente antes de ativar o fluxo novo. So preenche NULL; nao realinha
-- ancoras ja derivadas (isso, se necessario, e um UPDATE explicito da virada).
CREATE OR REPLACE FUNCTION public.preencher_dia_ancora_assinaturas(
  _empresa_id uuid DEFAULT NULL,
  _simular boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_elegiveis integer;
BEGIN
  WITH elegiveis AS MATERIALIZED (
    SELECT
      a.id,
      EXTRACT(DAY FROM a.data_expiracao)::smallint AS dia
    FROM public.empresa_assinaturas AS a
    JOIN public.planos AS p ON p.id = a.plano_id
    WHERE a.dia_ancora IS NULL
      AND a.data_expiracao IS NOT NULL
      AND p.tipo_cobranca = 'mensal'
      AND (_empresa_id IS NULL OR a.empresa_id = _empresa_id)
      AND (
        a.status::text IN ('active', 'ativo')
        OR (
          a.status::text IN ('overdue', 'expired', 'vencido', 'pending_payment')
          AND EXISTS (
            SELECT 1
            FROM public.pagamentos AS pg
            WHERE pg.empresa_id = a.empresa_id
              AND pg.status = 'pago'
              AND (
                pg.referencia_tipo = 'plano'
                OR EXISTS (
                  SELECT 1
                  FROM public.pagamento_itens AS pi
                  WHERE pi.pagamento_id = pg.id
                    AND pi.tipo = 'plano'
                )
              )
          )
        )
      )
  ),
  atualizadas AS (
    UPDATE public.empresa_assinaturas AS a
       SET dia_ancora = e.dia
      FROM elegiveis AS e
     WHERE a.id = e.id
       AND NOT _simular
    RETURNING a.id
  )
  SELECT count(*)::integer INTO v_elegiveis FROM elegiveis;

  RETURN v_elegiveis;
END;
$$;

REVOKE ALL ON FUNCTION public.preencher_dia_ancora_assinaturas(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.preencher_dia_ancora_assinaturas(uuid, boolean) IS
  'Backfill idempotente de empresa_assinaturas.dia_ancora: dia de data_expiracao para assinaturas MENSAIS com ciclo real (ativas, ou vencidas com pagamento de plano confirmado); nunca trial, anual, vitalicio, cancelada, sem plano ou sem data_expiracao; nunca sobrescreve. _simular=true so conta. Devolve quantas linhas foram (ou seriam) preenchidas. Execucao restrita ao dono do banco.';

DO $$
DECLARE
  v_preenchidas integer;
BEGIN
  v_preenchidas := public.preencher_dia_ancora_assinaturas();
  RAISE NOTICE 'dia_ancora preenchido em % assinatura(s) mensal(is)', v_preenchidas;
END;
$$;

COMMIT;
