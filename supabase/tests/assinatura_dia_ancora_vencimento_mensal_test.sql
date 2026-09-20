-- Cobertura para 20260918140000_assinatura_dia_ancora_vencimento_mensal.sql.
-- Rode com `supabase test db` contra um banco que contenha todas as migrations.
--
-- Cobre:
--   1. estrutura (coluna, CHECK, atributos e privilegios das funcoes);
--   2. next_monthly_due_date() em casos nomeados para as ancoras 28/29/30/31,
--      inclusive fevereiro bissexto e as regras de seculo (1900/2000/2100/2400);
--   3. propriedades exaustivas (1900-2200 x ancoras 1..31) contra um oraculo
--      independente (aritmetica de interval), mais cadeias de 20 anos sem deriva;
--   4. independencia de TimeZone/DateStyle;
--   5. entradas invalidas (falha alto, nunca NULL silencioso);
--   6. contrato de renovacao decidido: GREATEST(vencimento, pagamento) e proximo
--      mes pela ancora, sem acumular competencias (ainda nao usado por nenhum
--      fluxo: e a composicao que o webhook fara na etapa seguinte);
--   7. backfill sobre assinaturas de cada tipo (mensal ativa, trial, vencida com
--      e sem historico pago, anual, vitalicio, cancelada, sem plano...).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 1. Estrutura
-- ----------------------------------------------------------------------------

-- (information_schema usa dominios como character_data: cast para text para
-- que is(anyelement, anyelement) unifique os tipos.)
SELECT is(
  (SELECT data_type::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'empresa_assinaturas'
      AND column_name = 'dia_ancora'),
  'smallint',
  'empresa_assinaturas.dia_ancora existe e e smallint'
);
SELECT is(
  (SELECT is_nullable::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'empresa_assinaturas'
      AND column_name = 'dia_ancora'),
  'YES',
  'dia_ancora aceita NULL (NULL = sem ancora)'
);
SELECT is(
  (SELECT column_default::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'empresa_assinaturas'
      AND column_name = 'dia_ancora'),
  NULL::text,
  'dia_ancora nao tem DEFAULT: nada e ancorado implicitamente'
);

SELECT is(
  (SELECT provolatile::text FROM pg_proc
    WHERE oid = 'public.next_monthly_due_date(date, integer)'::regprocedure),
  'i',
  'next_monthly_due_date e IMMUTABLE'
);
SELECT is(
  (SELECT proparallel::text FROM pg_proc
    WHERE oid = 'public.next_monthly_due_date(date, integer)'::regprocedure),
  's',
  'next_monthly_due_date e PARALLEL SAFE'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.next_monthly_due_date(date, integer)'::regprocedure),
  false,
  'next_monthly_due_date nao e SECURITY DEFINER'
);
SELECT is(
  (SELECT proconfig FROM pg_proc
    WHERE oid = 'public.next_monthly_due_date(date, integer)'::regprocedure),
  ARRAY['search_path=pg_catalog']::text[],
  'next_monthly_due_date fixa search_path = pg_catalog'
);
SELECT is(
  (SELECT prorettype::regtype::text FROM pg_proc
    WHERE oid = 'public.next_monthly_due_date(date, integer)'::regprocedure),
  'date',
  'next_monthly_due_date devolve date'
);

-- Prova funcional de IMMUTABLE: o PostgreSQL so aceita a funcao em uma coluna
-- gerada se ela for imutavel.
CREATE TEMP TABLE _ancora_gerada (
  d date,
  a integer,
  prox date GENERATED ALWAYS AS (public.next_monthly_due_date(d, a)) STORED
);
INSERT INTO _ancora_gerada (d, a) VALUES (DATE '2028-01-31', 31);
SELECT is(
  (SELECT prox FROM _ancora_gerada),
  DATE '2028-02-29',
  'a funcao e aceita em coluna gerada (IMMUTABLE) e calcula 31/jan/2028 -> 29/fev/2028'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.next_monthly_due_date(date, integer)', 'EXECUTE'),
  'anon nao executa next_monthly_due_date'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.next_monthly_due_date(date, integer)', 'EXECUTE'),
  'authenticated nao executa next_monthly_due_date'
);
SELECT ok(
  has_function_privilege('service_role', 'public.next_monthly_due_date(date, integer)', 'EXECUTE'),
  'service_role executa next_monthly_due_date'
);
SELECT ok(
  (SELECT proacl IS NOT NULL FROM pg_proc
    WHERE oid = 'public.next_monthly_due_date(date, integer)'::regprocedure)
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) AS acl
     WHERE p.oid = 'public.next_monthly_due_date(date, integer)'::regprocedure
       AND acl.grantee = 0
  ),
  'PUBLIC nao tem EXECUTE em next_monthly_due_date'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.preencher_dia_ancora_assinaturas(uuid, boolean)', 'EXECUTE'),
  'anon nao executa o backfill'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.preencher_dia_ancora_assinaturas(uuid, boolean)', 'EXECUTE'),
  'authenticated nao executa o backfill'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.preencher_dia_ancora_assinaturas(uuid, boolean)', 'EXECUTE'),
  'service_role nao executa o backfill (so o dono do banco)'
);
SELECT ok(
  (SELECT proacl IS NOT NULL FROM pg_proc
    WHERE oid = 'public.preencher_dia_ancora_assinaturas(uuid, boolean)'::regprocedure)
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) AS acl
     WHERE p.oid = 'public.preencher_dia_ancora_assinaturas(uuid, boolean)'::regprocedure
       AND acl.grantee = 0
  ),
  'PUBLIC nao tem EXECUTE no backfill'
);

-- ----------------------------------------------------------------------------
-- 2. next_monthly_due_date() - casos nomeados
-- ----------------------------------------------------------------------------

-- Ancora 31, ano nao bissexto (2026): cadeia completa, sem perder a ancora.
SELECT is(
  public.next_monthly_due_date(v.d, 31), v.esperado,
  'ancora 31: ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '2026-01-31', DATE '2026-02-28'),
  (DATE '2026-02-28', DATE '2026-03-31'),
  (DATE '2026-03-31', DATE '2026-04-30'),
  (DATE '2026-04-30', DATE '2026-05-31'),
  (DATE '2026-05-31', DATE '2026-06-30'),
  (DATE '2026-06-30', DATE '2026-07-31'),
  (DATE '2026-07-31', DATE '2026-08-31'),
  (DATE '2026-08-31', DATE '2026-09-30'),
  (DATE '2026-09-30', DATE '2026-10-31'),
  (DATE '2026-10-31', DATE '2026-11-30'),
  (DATE '2026-11-30', DATE '2026-12-31'),
  (DATE '2026-12-31', DATE '2027-01-31')
) AS v(d, esperado);

-- Ancora 31 em fevereiro bissexto (2028) e nao bissexto (2027).
SELECT is(
  public.next_monthly_due_date(v.d, 31), v.esperado,
  'ancora 31 (bissexto): ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '2028-01-31', DATE '2028-02-29'),
  (DATE '2028-02-29', DATE '2028-03-31'),
  (DATE '2027-01-31', DATE '2027-02-28'),
  (DATE '2027-02-28', DATE '2027-03-31')
) AS v(d, esperado);

-- Ancora 30.
SELECT is(
  public.next_monthly_due_date(v.d, 30), v.esperado,
  'ancora 30: ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '2026-01-30', DATE '2026-02-28'),
  (DATE '2026-02-28', DATE '2026-03-30'),
  (DATE '2026-03-30', DATE '2026-04-30'),
  (DATE '2026-04-30', DATE '2026-05-30'),
  (DATE '2026-05-30', DATE '2026-06-30'),
  (DATE '2026-12-30', DATE '2027-01-30'),
  (DATE '2028-01-30', DATE '2028-02-29'),
  (DATE '2028-02-29', DATE '2028-03-30')
) AS v(d, esperado);

-- Ancora 29: fevereiro so tem dia 29 em ano bissexto.
SELECT is(
  public.next_monthly_due_date(v.d, 29), v.esperado,
  'ancora 29: ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '2026-01-29', DATE '2026-02-28'),
  (DATE '2026-02-28', DATE '2026-03-29'),
  (DATE '2026-03-29', DATE '2026-04-29'),
  (DATE '2027-01-29', DATE '2027-02-28'),
  (DATE '2028-01-29', DATE '2028-02-29'),
  (DATE '2028-02-29', DATE '2028-03-29'),
  (DATE '2029-01-29', DATE '2029-02-28'),
  (DATE '2032-01-29', DATE '2032-02-29')
) AS v(d, esperado);

-- Ancora 28: nunca sofre clamp, nem em fevereiro bissexto.
SELECT is(
  public.next_monthly_due_date(v.d, 28), v.esperado,
  'ancora 28: ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '2026-01-28', DATE '2026-02-28'),
  (DATE '2026-02-28', DATE '2026-03-28'),
  (DATE '2028-01-28', DATE '2028-02-28'),
  (DATE '2028-02-28', DATE '2028-03-28'),
  (DATE '2028-02-29', DATE '2028-03-28'),
  (DATE '2026-12-28', DATE '2027-01-28')
) AS v(d, esperado);

-- Regras gregorianas de seculo: 1900/2100/2200 nao sao bissextos; 2000/2400 sao.
SELECT is(
  public.next_monthly_due_date(v.d, v.ancora), v.esperado,
  'seculo: ancora ' || v.ancora || ', ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '1900-01-31', 31, DATE '1900-02-28'),
  (DATE '2000-01-31', 31, DATE '2000-02-29'),
  (DATE '2100-01-31', 31, DATE '2100-02-28'),
  (DATE '2200-01-31', 31, DATE '2200-02-28'),
  (DATE '2400-01-31', 31, DATE '2400-02-29'),
  (DATE '1900-01-29', 29, DATE '1900-02-28'),
  (DATE '2000-01-29', 29, DATE '2000-02-29'),
  (DATE '2100-01-29', 29, DATE '2100-02-28'),
  (DATE '2400-01-29', 29, DATE '2400-02-29'),
  (DATE '2100-01-28', 28, DATE '2100-02-28')
) AS v(d, ancora, esperado);

-- Ancoras baixas, fronteiras (1 e 31) e virada de ano.
SELECT is(
  public.next_monthly_due_date(v.d, v.ancora), v.esperado,
  'ancora ' || v.ancora || ': ' || v.d || ' -> ' || v.esperado
)
FROM (VALUES
  (DATE '2026-01-15', 1,  DATE '2026-02-01'),
  (DATE '2026-12-20', 1,  DATE '2027-01-01'),
  (DATE '2026-01-31', 1,  DATE '2026-02-01'),
  (DATE '2026-10-16', 16, DATE '2026-11-16'),
  (DATE '2026-11-16', 16, DATE '2026-12-16'),
  (DATE '2026-09-19', 19, DATE '2026-10-19'),
  (DATE '2026-12-15', 15, DATE '2027-01-15'),
  (DATE '2026-12-31', 31, DATE '2027-01-31'),
  (DATE '2026-12-31', 30, DATE '2027-01-30')
) AS v(d, ancora, esperado);

-- O dia de _from e irrelevante: so mes/ano contam.
SELECT is(
  public.next_monthly_due_date(v.d, v.ancora), v.esperado,
  'dia de _from ignorado: ' || v.d || ' (ancora ' || v.ancora || ') -> ' || v.esperado
)
FROM (VALUES
  (DATE '2026-03-01', 10, DATE '2026-04-10'),
  (DATE '2026-03-05', 10, DATE '2026-04-10'),
  (DATE '2026-03-31', 10, DATE '2026-04-10'),
  (DATE '2026-01-31', 30, DATE '2026-02-28'),
  (DATE '2026-02-01', 31, DATE '2026-03-31'),
  (DATE '2026-02-14', 31, DATE '2026-03-31'),
  (DATE '2026-02-28', 31, DATE '2026-03-31')
) AS v(d, ancora, esperado);

-- ----------------------------------------------------------------------------
-- 3. Propriedades exaustivas contra um oraculo independente
-- ----------------------------------------------------------------------------
-- O oraculo usa aritmetica de interval sobre timestamps sem fuso (algoritmo
-- diferente da funcao, que usa aritmetica inteira): primeiro dia do mes
-- seguinte + (ancora - 1), limitado ao ultimo dia desse mes.

CREATE TEMP TABLE _ancora_oraculo ON COMMIT DROP AS
SELECT
  m.primeiro_dia,
  an.a AS ancora,
  -- o dia de referencia varia entre 1 e 28 para provar que nao influencia
  public.next_monthly_due_date(m.primeiro_dia + ((an.a - 1) % 28), an.a) AS obtido,
  LEAST(
    (m.primeiro_dia + interval '1 month')::date + (an.a - 1),
    (m.primeiro_dia + interval '2 month')::date - 1
  ) AS esperado
FROM (
  SELECT g::date AS primeiro_dia
    FROM generate_series('1900-01-01'::timestamp, '2200-12-01'::timestamp, interval '1 month') AS g
) AS m
CROSS JOIN (SELECT generate_series(1, 31) AS a) AS an;

SELECT is(
  (SELECT count(*)::integer FROM _ancora_oraculo),
  111972,
  'oraculo: 301 anos x 12 meses x 31 ancoras = 111972 combinacoes avaliadas'
);
SELECT is(
  (SELECT count(*)::integer FROM _ancora_oraculo WHERE obtido IS DISTINCT FROM esperado),
  0,
  'oraculo: nenhuma divergencia entre a funcao e a aritmetica de interval (1900-2200, ancoras 1..31)'
);
SELECT is(
  (SELECT count(*)::integer FROM _ancora_oraculo
    WHERE obtido <= primeiro_dia + ((ancora - 1) % 28)
       OR obtido > primeiro_dia + ((ancora - 1) % 28) + 62),
  0,
  'oraculo: o proximo vencimento e sempre posterior e a menos de 62 dias da referencia'
);

-- Cadeia de 20 anos alimentando a saida como proxima entrada: sem deriva,
-- exatamente um mes-calendario por passo, sempre no dia LEAST(ancora, ultimo dia).
CREATE TEMP TABLE _ancora_cadeia ON COMMIT DROP AS
WITH RECURSIVE cadeia(a, n, d) AS (
  SELECT an.a, 0, DATE '2026-01-01' FROM (SELECT generate_series(28, 31) AS a) AS an
  UNION ALL
  SELECT a, n + 1, public.next_monthly_due_date(d, a) FROM cadeia WHERE n < 240
)
SELECT a, n, d FROM cadeia WHERE n >= 1;

SELECT is(
  (SELECT count(*)::integer FROM _ancora_cadeia),
  960,
  'cadeia: 4 ancoras (28..31) x 240 meses encadeados'
);
SELECT is(
  (SELECT count(*)::integer FROM _ancora_cadeia
    WHERE (EXTRACT(YEAR FROM d)::integer * 12 + EXTRACT(MONTH FROM d)::integer)
          <> (2026 * 12 + 1 + n)),
  0,
  'cadeia: cada passo avanca exatamente um mes-calendario (sem pular fevereiro)'
);
SELECT is(
  (SELECT count(*)::integer FROM _ancora_cadeia
    WHERE EXTRACT(DAY FROM d)::integer
          <> LEAST(
               a,
               EXTRACT(DAY FROM (date_trunc('month', d::timestamp) + interval '1 month' - interval '1 day'))::integer
             )),
  0,
  'cadeia: o dia e sempre LEAST(ancora, ultimo dia do mes): a ancora nunca se perde apos um mes curto'
);

-- ----------------------------------------------------------------------------
-- 4. Independencia de TimeZone e DateStyle
-- ----------------------------------------------------------------------------

SET LOCAL TimeZone = 'America/Sao_Paulo';
SELECT is(public.next_monthly_due_date(DATE '2028-01-31', 31), DATE '2028-02-29', 'TimeZone America/Sao_Paulo');
SET LOCAL TimeZone = 'UTC';
SELECT is(public.next_monthly_due_date(DATE '2028-01-31', 31), DATE '2028-02-29', 'TimeZone UTC');
SET LOCAL TimeZone = 'Pacific/Kiritimati';
SELECT is(public.next_monthly_due_date(DATE '2028-01-31', 31), DATE '2028-02-29', 'TimeZone Pacific/Kiritimati (UTC+14)');
SET LOCAL TimeZone = 'Pacific/Pago_Pago';
SELECT is(public.next_monthly_due_date(DATE '2028-01-31', 31), DATE '2028-02-29', 'TimeZone Pacific/Pago_Pago (UTC-11)');
SET LOCAL TimeZone = 'Asia/Kolkata';
SELECT is(public.next_monthly_due_date(DATE '2026-12-31', 31), DATE '2027-01-31', 'TimeZone Asia/Kolkata (UTC+5:30), virada de ano');
-- 01/out/2017 00:00 nao existe em America/Asuncion (DST comeca a meia-noite).
SET LOCAL TimeZone = 'America/Asuncion';
SELECT is(public.next_monthly_due_date(DATE '2017-09-20', 1), DATE '2017-10-01', 'TimeZone America/Asuncion: dia 1 em que a meia-noite nao existe');
SET LOCAL DateStyle = 'SQL, DMY';
SELECT is(public.next_monthly_due_date(DATE '2028-01-31', 31), DATE '2028-02-29', 'DateStyle SQL, DMY');
SET LOCAL DateStyle = 'Postgres, MDY';
SELECT is(public.next_monthly_due_date(DATE '2028-01-31', 31), DATE '2028-02-29', 'DateStyle Postgres, MDY');
RESET TimeZone;
RESET DateStyle;

-- ----------------------------------------------------------------------------
-- 5. Entradas invalidas: falha alto, nunca devolve NULL nem data errada
-- ----------------------------------------------------------------------------
-- (NULL em data_expiracao significa "sem vencimento": um NULL silencioso aqui
-- concederia acesso permanente.)

SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date(NULL::date, 10) $$,
  '22004', 'next_monthly_due_date: _from e _anchor_day sao obrigatorios',
  '_from NULL e rejeitado'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date(DATE '2026-03-10', NULL::integer) $$,
  '22004', 'next_monthly_due_date: _from e _anchor_day sao obrigatorios',
  '_anchor_day NULL e rejeitado'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date(DATE '2026-03-10', 0) $$,
  '22023', 'next_monthly_due_date: _anchor_day deve estar entre 1 e 31 (recebido 0)',
  'ancora 0 e rejeitada'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date(DATE '2026-03-10', 32) $$,
  '22023', 'next_monthly_due_date: _anchor_day deve estar entre 1 e 31 (recebido 32)',
  'ancora 32 e rejeitada'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date(DATE '2026-03-10', -5) $$,
  '22023', 'next_monthly_due_date: _anchor_day deve estar entre 1 e 31 (recebido -5)',
  'ancora negativa e rejeitada'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date('infinity'::date, 10) $$,
  '22008', 'next_monthly_due_date: _from infinito nao e suportado',
  'data infinity e rejeitada'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date('-infinity'::date, 10) $$,
  '22008', 'next_monthly_due_date: _from infinito nao e suportado',
  'data -infinity e rejeitada'
);
SELECT throws_ok(
  $$ SELECT public.next_monthly_due_date(DATE '0044-03-15 BC', 10) $$,
  '22008', 'next_monthly_due_date: datas a.C. nao sao suportadas (ano -44)',
  'data a.C. e rejeitada'
);

-- ----------------------------------------------------------------------------
-- 6. Contrato de renovacao decidido: GREATEST(vencimento, pagamento) + ancora
-- ----------------------------------------------------------------------------
-- Ainda nao ha fluxo que use isto: e a composicao que o webhook fara na etapa
-- seguinte. Os casos fixam a regra vigente do Backstage adotada aqui.

-- Ancora 10, sem deriva; adiantado e em dia.
SELECT is(
  public.next_monthly_due_date(GREATEST(v.venc, v.pago), v.ancora), v.esperado,
  v.descr
)
FROM (VALUES
  (DATE '2026-03-10', DATE '2026-03-01', 10, DATE '2026-04-10', 'renovacao adiantada (10/mar, pago 01/mar) -> 10/abr, sem perder dias'),
  (DATE '2026-03-10', DATE '2026-03-10', 10, DATE '2026-04-10', 'renovacao em dia (10/mar, pago 10/mar) -> 10/abr'),
  (DATE '2026-03-10', DATE '2026-02-10', 10, DATE '2026-04-10', 'pago com mais de um mes de antecedencia ainda avanca um unico mes a partir do vencimento'),
  -- Atraso: novo vencimento = dia-ancora do mes seguinte ao mes do PAGAMENTO.
  (DATE '2026-02-10', DATE '2026-02-12', 10, DATE '2026-03-10', 'atraso no mesmo mes (10/fev, pago 12/fev) -> 10/mar'),
  (DATE '2026-02-10', DATE '2026-02-28', 10, DATE '2026-03-10', 'atraso no mesmo mes (10/fev, pago 28/fev) -> 10/mar'),
  (DATE '2026-02-10', DATE '2026-03-01', 10, DATE '2026-04-10', 'atraso cruzando o mes (10/fev, pago 01/mar) -> 10/abr'),
  (DATE '2026-02-10', DATE '2026-03-15', 10, DATE '2026-04-10', 'atraso de um mes (10/fev, pago 15/mar) -> 10/abr'),
  -- Nao acumula competencias atrasadas: um pagamento avanca um unico proximo vencimento.
  (DATE '2026-01-10', DATE '2026-05-20', 10, DATE '2026-06-10', 'quatro meses de atraso (10/jan, pago 20/mai) -> 10/jun: competencias atrasadas nao acumulam'),
  (DATE '2026-02-10', DATE '2026-04-05', 10, DATE '2026-05-10', 'dois meses de atraso (10/fev, pago 05/abr) -> 10/mai')
) AS v(venc, pago, ancora, esperado, descr);

-- Ancora 31 com clamp.
SELECT is(
  public.next_monthly_due_date(GREATEST(v.venc, v.pago), v.ancora), v.esperado,
  v.descr
)
FROM (VALUES
  (DATE '2026-01-31', DATE '2026-01-31', 31, DATE '2026-02-28', 'ancora 31: em dia 31/jan -> 28/fev'),
  (DATE '2026-02-28', DATE '2026-02-27', 31, DATE '2026-03-31', 'ancora 31: 28/fev pago 27/fev (adiantado) -> 31/mar, nao 28/mar'),
  (DATE '2026-02-28', DATE '2026-02-28', 31, DATE '2026-03-31', 'ancora 31: 28/fev pago no dia -> 31/mar'),
  (DATE '2026-02-28', DATE '2026-03-01', 31, DATE '2026-04-30', 'ancora 31: 28/fev pago 01/mar (1 dia de atraso) -> 30/abr (regra do Backstage: mes do pagamento)'),
  (DATE '2026-03-31', DATE '2026-03-31', 31, DATE '2026-04-30', 'ancora 31: 31/mar -> 30/abr'),
  (DATE '2028-02-29', DATE '2028-02-20', 31, DATE '2028-03-31', 'ancora 31 bissexto: 29/fev pago 20/fev -> 31/mar'),
  (DATE '2028-01-31', DATE '2028-01-31', 31, DATE '2028-02-29', 'ancora 31 bissexto: 31/jan -> 29/fev'),
  (DATE '2026-01-31', DATE '2026-01-25', 30, DATE '2026-02-28', 'ancora 30: 31/jan (vencimento atual) pago 25/jan -> 28/fev')
) AS v(venc, pago, ancora, esperado, descr);

-- Primeira ativacao paga: a ancora e o dia da ativacao; o primeiro vencimento
-- e um mes-calendario a frente (nao +30 dias).
SELECT is(
  public.next_monthly_due_date(v.ativacao, EXTRACT(DAY FROM v.ativacao)::integer), v.esperado,
  v.descr
)
FROM (VALUES
  (DATE '2026-01-31', DATE '2026-02-28', 'primeira ativacao 31/jan -> 28/fev (e nao 02/mar, como +30 dias)'),
  (DATE '2026-01-30', DATE '2026-02-28', 'primeira ativacao 30/jan -> 28/fev (e nao 01/mar)'),
  (DATE '2026-01-29', DATE '2026-02-28', 'primeira ativacao 29/jan -> 28/fev'),
  (DATE '2026-01-15', DATE '2026-02-15', 'primeira ativacao 15/jan -> 15/fev'),
  (DATE '2028-01-30', DATE '2028-02-29', 'primeira ativacao 30/jan/2028 (bissexto) -> 29/fev'),
  (DATE '2026-12-31', DATE '2027-01-31', 'primeira ativacao 31/dez -> 31/jan (virada de ano)')
) AS v(ativacao, esperado, descr);

-- ----------------------------------------------------------------------------
-- 7. Backfill sobre assinaturas reais
-- ----------------------------------------------------------------------------
-- Fixtures isoladas: planos/empresas proprios (UUIDs d4...). Inserir a empresa
-- dispara trg_empresa_trial (assinatura trial) e trg_add_owner_as_member; em
-- seguida cada assinatura e ajustada ao cenario. Tudo e desfeito no ROLLBACK.

INSERT INTO public.planos (id, nome, valor, tipo_cobranca, ativo) VALUES
  ('d4100000-0000-4000-8000-000000000001', '__ancora_plano_mensal__',    100,  'mensal',    true),
  ('d4100000-0000-4000-8000-000000000002', '__ancora_plano_anual__',     1000, 'anual',     true),
  ('d4100000-0000-4000-8000-000000000003', '__ancora_plano_vitalicio__', 0,    'vitalicio', true);

INSERT INTO public.empresas (id, owner_id, nome)
SELECT
  ('d4200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('d4300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '__ancora_empresa_' || lpad(n::text, 2, '0') || '__'
FROM generate_series(1, 17) AS n;

SELECT is(
  (SELECT count(*)::integer FROM public.empresa_assinaturas
    WHERE empresa_id::text LIKE 'd4200000-0000-4000-8000-0000000000%'
      AND dia_ancora IS NULL AND status::text = 'trial'),
  17,
  'fixtures: cada empresa nasce com assinatura trial e sem ancora'
);

-- Cenarios (empresa NN):
--   01 A mensal ativa                       exp 2026-10-24
--   02 B mensal 'ativo' (status legado)     exp 2026-11-30
--   03 C mensal ativa                       exp 2026-10-31
--   04 D mensal TRIAL                       exp 2026-09-25
--   05 E mensal overdue SEM pagamento pago (so um pendente)   exp 2026-09-10
--   06 F mensal expired COM pagamento pago de plano           exp 2026-08-12
--   07 G mensal expired COM mensalidade paga (item de plano)  exp 2026-07-07
--   08 H mensal expired com pagamento pago SO de modulo       exp 2026-07-09
--   09 I ANUAL ativa                        exp 2027-03-15
--   10 J VITALICIO ativa                    sem vencimento
--   11 K mensal ativa SEM data_expiracao
--   12 L mensal CANCELADA                   exp 2026-10-20
--   13 M mensal ativa com ancora ja definida (5)              exp 2026-10-24
--   14 N SEM PLANO, ativa                   exp 2026-10-15
--   15 P mensal 'vencido' (legado) COM pagamento pago         exp 2026-06-18
--   16 Q mensal pending_payment SEM historico pago            exp 2026-10-09
--   17 R mensal pending_payment COM historico pago            exp 2026-10-27
UPDATE public.empresa_assinaturas AS a
   SET plano_id = f.plano_id,
       status = f.status::public.assinatura_status,
       data_expiracao = f.expira,
       dia_ancora = f.ancora_previa
  FROM (VALUES
    ('d4200000-0000-4000-8000-000000000001'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'active',          DATE '2026-10-24', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000002'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'ativo',           DATE '2026-11-30', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000003'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'active',          DATE '2026-10-31', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000004'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'trial',           DATE '2026-09-25', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000005'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'overdue',         DATE '2026-09-10', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000006'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'expired',         DATE '2026-08-12', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000007'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'expired',         DATE '2026-07-07', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000008'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'expired',         DATE '2026-07-09', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000009'::uuid, 'd4100000-0000-4000-8000-000000000002'::uuid, 'active',          DATE '2027-03-15', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000010'::uuid, 'd4100000-0000-4000-8000-000000000003'::uuid, 'active',          NULL::date,        NULL::smallint),
    ('d4200000-0000-4000-8000-000000000011'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'active',          NULL::date,        NULL::smallint),
    ('d4200000-0000-4000-8000-000000000012'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'cancelado',       DATE '2026-10-20', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000013'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'active',          DATE '2026-10-24', 5::smallint),
    ('d4200000-0000-4000-8000-000000000014'::uuid, NULL::uuid,                                   'active',          DATE '2026-10-15', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000015'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'vencido',         DATE '2026-06-18', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000016'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'pending_payment', DATE '2026-10-09', NULL::smallint),
    ('d4200000-0000-4000-8000-000000000017'::uuid, 'd4100000-0000-4000-8000-000000000001'::uuid, 'pending_payment', DATE '2026-10-27', NULL::smallint)
  ) AS f(empresa_id, plano_id, status, expira, ancora_previa)
 WHERE a.empresa_id = f.empresa_id;

-- Historico de pagamentos.
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, plano_id, descricao, valor, status) VALUES
  ('d4400000-0000-4000-8000-000000000001', 'd4200000-0000-4000-8000-000000000006', 'plano',  'd4100000-0000-4000-8000-000000000001', 'fixture F: plano pago',            100, 'pago'),
  ('d4400000-0000-4000-8000-000000000002', 'd4200000-0000-4000-8000-000000000007', 'outro',  NULL,                                   'Mensalidade Plano fixture G',      100, 'pago'),
  ('d4400000-0000-4000-8000-000000000003', 'd4200000-0000-4000-8000-000000000008', 'modulo', NULL,                                   'fixture H: so modulo pago',        50,  'pago'),
  ('d4400000-0000-4000-8000-000000000004', 'd4200000-0000-4000-8000-000000000015', 'plano',  'd4100000-0000-4000-8000-000000000001', 'fixture P: plano pago',            100, 'pago'),
  ('d4400000-0000-4000-8000-000000000005', 'd4200000-0000-4000-8000-000000000017', 'plano',  'd4100000-0000-4000-8000-000000000001', 'fixture R: plano pago',            100, 'pago'),
  ('d4400000-0000-4000-8000-000000000006', 'd4200000-0000-4000-8000-000000000005', 'plano',  'd4100000-0000-4000-8000-000000000001', 'fixture E: plano so pendente',     100, 'pendente');
INSERT INTO public.pagamento_itens (pagamento_id, tipo, plano_id, descricao, valor) VALUES
  ('d4400000-0000-4000-8000-000000000002', 'plano', 'd4100000-0000-4000-8000-000000000001', 'Plano fixture G', 100);

-- Valor distintivo: se o backfill disparasse trg_assin_valor_contratado (que so
-- reage a UPDATE OF plano_id/status/data_inicio e, com valor_personalizado =
-- false, recalcula valor_contratado para o preco do plano), 12.34 desapareceria.
-- Este UPDATE em si nao dispara o trigger (so mexe em valor_contratado).
UPDATE public.empresa_assinaturas
   SET valor_contratado = 12.34
 WHERE empresa_id::text LIKE 'd4200000-0000-4000-8000-0000000000%';

-- Controle do tripwire: UPDATE OF status dispara o trigger mesmo sem mudar o
-- valor, e ele recalcula valor_contratado (I e anual: preco do plano = 1000).
-- Isto prova que a checagem "o trigger nao disparou" seria capaz de detectar.
UPDATE public.empresa_assinaturas SET status = status
 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000009';
SELECT is(
  (SELECT valor_contratado::numeric FROM public.empresa_assinaturas
    WHERE empresa_id = 'd4200000-0000-4000-8000-000000000009'),
  1000.00::numeric,
  'controle: um UPDATE OF status dispara trg_assin_valor_contratado e recalcula valor_contratado'
);
UPDATE public.empresa_assinaturas SET valor_contratado = 12.34
 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000009';

CREATE TEMP TABLE _ancora_antes ON COMMIT DROP AS
SELECT empresa_id, status::text AS status, plano_id, data_inicio, data_expiracao,
       valor_contratado, valor_personalizado, proximo_valor, observacoes
  FROM public.empresa_assinaturas
 WHERE empresa_id::text LIKE 'd4200000-0000-4000-8000-0000000000%';

-- CHECK 1..31 (linha D e uma assinatura trial sem ancora).
SELECT throws_ok(
  $$ UPDATE public.empresa_assinaturas SET dia_ancora = 0 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000004' $$,
  '23514', NULL,
  'CHECK: dia_ancora = 0 e rejeitado'
);
SELECT throws_ok(
  $$ UPDATE public.empresa_assinaturas SET dia_ancora = 32 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000004' $$,
  '23514', NULL,
  'CHECK: dia_ancora = 32 e rejeitado'
);
SELECT throws_ok(
  $$ UPDATE public.empresa_assinaturas SET dia_ancora = -1 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000004' $$,
  '23514', NULL,
  'CHECK: dia_ancora negativo e rejeitado'
);
SELECT lives_ok(
  $$ UPDATE public.empresa_assinaturas SET dia_ancora = 1 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000004' $$,
  'CHECK: dia_ancora = 1 e aceito'
);
SELECT lives_ok(
  $$ UPDATE public.empresa_assinaturas SET dia_ancora = 31 WHERE empresa_id = 'd4200000-0000-4000-8000-000000000004' $$,
  'CHECK: dia_ancora = 31 e aceito'
);
SELECT lives_ok(
  $$ UPDATE public.empresa_assinaturas SET dia_ancora = NULL WHERE empresa_id = 'd4200000-0000-4000-8000-000000000004' $$,
  'CHECK: dia_ancora NULL e aceito'
);

-- Simulacao: conta sem gravar.
SELECT is(
  public.preencher_dia_ancora_assinaturas('d4200000-0000-4000-8000-000000000001'::uuid, true),
  1,
  'simulacao: A (mensal ativa) seria preenchida'
);
SELECT is(
  (SELECT dia_ancora::integer FROM public.empresa_assinaturas
    WHERE empresa_id = 'd4200000-0000-4000-8000-000000000001'),
  NULL::integer,
  'simulacao: nada foi gravado em A'
);

-- Execucao escopada.
SELECT is(
  public.preencher_dia_ancora_assinaturas('d4200000-0000-4000-8000-000000000001'::uuid),
  1,
  'escopo A: uma linha preenchida'
);
SELECT is(
  (SELECT dia_ancora::integer FROM public.empresa_assinaturas
    WHERE empresa_id = 'd4200000-0000-4000-8000-000000000001'),
  24,
  'escopo A: ancora = dia de data_expiracao (24/out)'
);
SELECT is(
  public.preencher_dia_ancora_assinaturas('d4200000-0000-4000-8000-000000000004'::uuid),
  0,
  'escopo D (trial): nada preenchido'
);
SELECT is(
  public.preencher_dia_ancora_assinaturas('d4200000-0000-4000-8000-000000000013'::uuid),
  0,
  'escopo M (ancora ja definida): nada preenchido'
);

-- Execucao completa; os resultados por linha sao verificados a seguir.
CREATE TEMP TABLE _ancora_execucao ON COMMIT DROP AS
SELECT public.preencher_dia_ancora_assinaturas() AS preenchidas;

-- Elegiveis restantes entre as fixtures: B, C, F, G, P, R (A ja foi preenchida).
-- (>= porque um banco real pode ter outras assinaturas elegiveis.)
SELECT ok(
  (SELECT preenchidas FROM _ancora_execucao) >= 6,
  'execucao completa preenche as demais elegiveis (B, C, F, G, P, R)'
);

SELECT is(
  (SELECT a.dia_ancora::integer FROM public.empresa_assinaturas AS a WHERE a.empresa_id = v.empresa_id),
  v.esperado,
  v.descr
)
FROM (VALUES
  ('d4200000-0000-4000-8000-000000000001'::uuid, 24,           'A: mensal ativa -> 24'),
  ('d4200000-0000-4000-8000-000000000002'::uuid, 30,           'B: mensal com status legado ativo -> 30'),
  ('d4200000-0000-4000-8000-000000000003'::uuid, 31,           'C: mensal ativa vencendo dia 31 -> 31 (o clamp fica para o calculo, a ancora guarda 31)'),
  ('d4200000-0000-4000-8000-000000000004'::uuid, NULL::integer, 'D: trial nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000005'::uuid, NULL::integer, 'E: overdue sem pagamento pago (trial vencido, mesmo com um pendente) nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000006'::uuid, 12,           'F: expired com pagamento pago de plano -> 12'),
  ('d4200000-0000-4000-8000-000000000007'::uuid, 7,            'G: expired com mensalidade paga (item de plano) -> 7'),
  ('d4200000-0000-4000-8000-000000000008'::uuid, NULL::integer, 'H: expired com pagamento pago so de modulo nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000009'::uuid, NULL::integer, 'I: plano anual nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000010'::uuid, NULL::integer, 'J: plano vitalicio nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000011'::uuid, NULL::integer, 'K: sem data_expiracao nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000012'::uuid, NULL::integer, 'L: cancelada nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000013'::uuid, 5,            'M: ancora ja definida nunca e sobrescrita (fica 5, nao 24)'),
  ('d4200000-0000-4000-8000-000000000014'::uuid, NULL::integer, 'N: sem plano nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000015'::uuid, 18,           'P: status legado vencido com pagamento pago -> 18'),
  ('d4200000-0000-4000-8000-000000000016'::uuid, NULL::integer, 'Q: pending_payment sem historico pago nao recebe ancora'),
  ('d4200000-0000-4000-8000-000000000017'::uuid, 27,           'R: pending_payment com historico pago -> 27')
) AS v(empresa_id, esperado, descr);

-- Idempotencia: nova execucao nao encontra nada elegivel.
SELECT is(
  public.preencher_dia_ancora_assinaturas(),
  0,
  'idempotente: a segunda execucao completa nao preenche nada'
);

-- Seguranca: so dia_ancora mudou nas fixtures (status, plano, datas e valores intactos).
SELECT is(
  (SELECT count(*)::integer
     FROM _ancora_antes AS b
     JOIN public.empresa_assinaturas AS a USING (empresa_id)
    WHERE (b.status, b.plano_id, b.data_inicio, b.data_expiracao,
           b.valor_contratado, b.valor_personalizado, b.proximo_valor, b.observacoes)
          IS DISTINCT FROM
          (a.status::text, a.plano_id, a.data_inicio, a.data_expiracao,
           a.valor_contratado, a.valor_personalizado, a.proximo_valor, a.observacoes)),
  0,
  'seguranca: o backfill alterou somente dia_ancora (status, plano, datas e valores intactos)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.empresa_assinaturas
    WHERE empresa_id::text LIKE 'd4200000-0000-4000-8000-0000000000%'
      AND valor_contratado = 12.34),
  17,
  'seguranca: trg_assin_valor_contratado nao disparou (valor_contratado preservado nas 17 fixtures)'
);

-- Integracao: a coluna smallint alimenta a funcao sem cast (C: vence 31/out, ancora 31).
SELECT is(
  (SELECT public.next_monthly_due_date(a.data_expiracao, a.dia_ancora)
     FROM public.empresa_assinaturas AS a
    WHERE a.empresa_id = 'd4200000-0000-4000-8000-000000000003'),
  DATE '2026-11-30',
  'integracao: next_monthly_due_date(data_expiracao, dia_ancora) para C (31/out, ancora 31) -> 30/nov'
);

SELECT * FROM finish();
ROLLBACK;
