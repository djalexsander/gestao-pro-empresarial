-- Cobertura para 20260918150000_confirmar_pagamento_mes_calendario.sql (e para
-- o ajuste do plano ANUAL de 20260918160000: a renovacao do mesmo plano anual
-- preserva os dias restantes; os casos D5 e D6 abaixo refletem essa regra).
-- Rode com `supabase test db` contra um banco que contenha todas as migrations.
--
-- Exercita o RPC REAL confirmar_pagamento_asaas() de ponta a ponta (cobranca
-- criada como fazem solicitar_mensalidade / solicitar_contratacao_plano,
-- confirmacao pelo RPC, leitura de empresa_assinaturas). Cobre:
--   A. primeira ativacao mensal (dias 28/29/30/31; fevereiro normal e bissexto);
--   B. renovacao mensal (adiantada, no vencimento, atrasada no mesmo mes,
--      atrasada cruzando o mes, varios meses de atraso);
--   C. ancora 28/29/30/31 encadeada por 13 meses, sem deriva (2024 bissexto ->
--      2025 normal) e o efeito da regra do Backstage no atraso;
--   D. plano anual: ano-calendario (+1 year), nunca +365 dias;
--   E. contratacao / troca de plano / renovacao (comportamento preservado);
--   F. idempotencia (mesmo pagamento nao avanca duas vezes; lock por empresa);
--   G. data do pagamento (data do evento, hoje em Sao Paulo, sem futuro);
--   H. compatibilidade e seguranca (ACL, cancelado, modulos, bug preservado);
--   I. ponta a ponta com os criadores reais de cobranca.
--
-- IMPORTANTE: os cenarios usam datas FIXAS NO PASSADO. O RPC nunca aceita uma
-- data de pagamento posterior a hoje (Sao Paulo); por isso o fevereiro
-- bissexto e exercitado com 2024 (bissexto) e 2025 (normal), e o limite de
-- data futura e testado com uma data dinamica (hoje + 10).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. Fixtures e auxiliares
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (id, nome, valor, tipo_cobranca, ativo) VALUES
  ('d5100000-0000-4000-8000-000000000001', '__mescal_mensal_a__',  100,  'mensal',    true),
  ('d5100000-0000-4000-8000-000000000002', '__mescal_mensal_b__',  200,  'mensal',    true),
  ('d5100000-0000-4000-8000-000000000003', '__mescal_anual__',     1000, 'anual',     true),
  ('d5100000-0000-4000-8000-000000000004', '__mescal_vitalicio__', 0,    'vitalicio', true);

INSERT INTO public.modulos (id, nome, chave, valor, ativo, aplica_restricao) VALUES
  ('d5900000-0000-4000-8000-000000000001', '__mescal_modulo__', '__mescal_modulo__', 30, true, false);

-- 80 empresas isoladas. Cada INSERT dispara trg_empresa_trial (assinatura
-- trial sem ancora) e trg_add_owner_as_member, como no cadastro real.
INSERT INTO public.empresas (id, owner_id, nome)
SELECT
  ('d5200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('d5300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '__mescal_empresa_' || lpad(n::text, 2, '0') || '__'
FROM generate_series(1, 80) AS n;

CREATE TEMP TABLE _res (
  cenario text,
  passo   integer,
  pago    date,
  exp     date,
  ancora  integer,
  ciclo   text,
  inicio  date,
  plano   uuid,
  status  text
) ON COMMIT DROP;

CREATE TEMP TABLE _ids (k text, id uuid) ON COMMIT DROP;

CREATE FUNCTION pg_temp.emp(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d5200000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

CREATE FUNCTION pg_temp.dono(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d5300000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

CREATE FUNCTION pg_temp.pl(_k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (CASE _k
    WHEN 'A'     THEN 'd5100000-0000-4000-8000-000000000001'
    WHEN 'B'     THEN 'd5100000-0000-4000-8000-000000000002'
    WHEN 'ANUAL' THEN 'd5100000-0000-4000-8000-000000000003'
    WHEN 'VIT'   THEN 'd5100000-0000-4000-8000-000000000004'
  END)::uuid
$fn$;

-- Cria a cobranca como os RPCs reais e a confirma pelo RPC real:
--   'mensalidade' -> como solicitar_mensalidade(): referencia 'outro' + item de plano;
--   'plano'       -> como solicitar_contratacao_plano(): referencia 'plano', sem itens.
-- Registra o resultado em _res e devolve o id do pagamento.
CREATE FUNCTION pg_temp.passo(
  _cenario text, _empresa integer, _plano text, _data date, _modo text DEFAULT 'mensalidade'
) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE
  v_emp uuid := pg_temp.emp(_empresa);
  v_id uuid;
  v_res jsonb;
BEGIN
  IF _modo = 'plano' THEN
    INSERT INTO public.pagamentos (empresa_id, referencia_tipo, plano_id, descricao, valor, status)
    VALUES (v_emp, 'plano', pg_temp.pl(_plano), 'Contratacao solicitada: teste', 100, 'pendente')
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status)
    VALUES (v_emp, 'outro', 'Mensalidade Plano teste', 100, 'pendente')
    RETURNING id INTO v_id;
    INSERT INTO public.pagamento_itens (pagamento_id, tipo, plano_id, descricao, valor)
    VALUES (v_id, 'plano', pg_temp.pl(_plano), 'Plano teste', 100);
  END IF;

  v_res := public.confirmar_pagamento_asaas(v_id, _data, 'PIX');

  INSERT INTO _res
  SELECT _cenario,
         COALESCE((SELECT max(r.passo) FROM _res AS r WHERE r.cenario = _cenario), 0) + 1,
         _data, a.data_expiracao, a.dia_ancora::integer, v_res->>'ciclo',
         a.data_inicio, a.plano_id, a.status::text
    FROM public.empresa_assinaturas AS a
   WHERE a.empresa_id = v_emp;
  RETURN v_id;
END
$fn$;

-- Ativacao em _inicio e (_passos - 1) renovacoes, cada uma paga NO VENCIMENTO
-- anterior (a data de pagamento e o proprio vencimento atual).
CREATE FUNCTION pg_temp.cadeia(
  _cenario text, _empresa integer, _plano text, _inicio date, _passos integer
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_data date := _inicio;
BEGIN
  FOR i IN 1.._passos LOOP
    PERFORM pg_temp.passo(_cenario, _empresa, _plano, v_data);
    v_data := (SELECT r.exp FROM _res AS r WHERE r.cenario = _cenario AND r.passo = i);
  END LOOP;
END
$fn$;

-- Resumo textual do passo: vencimento, ancora e ciclo.
CREATE FUNCTION pg_temp.r(_cenario text, _passo integer) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT 'exp=' || COALESCE(exp::text, 'NULL')
      || ' ancora=' || COALESCE(ancora::text, 'NULL')
      || ' ciclo=' || COALESCE(ciclo, 'NULL')
    FROM _res WHERE cenario = _cenario AND passo = _passo
$fn$;

-- ----------------------------------------------------------------------------
-- A. Primeira ativacao mensal: ancora = dia do pagamento; vence no proximo
--    mes-calendario, com clamp (fevereiro normal 2025 e bissexto 2024).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.passo('A1',  1, 'A', DATE '2025-01-28');
  PERFORM pg_temp.passo('A2',  2, 'A', DATE '2025-01-29');
  PERFORM pg_temp.passo('A3',  3, 'A', DATE '2025-01-30');
  PERFORM pg_temp.passo('A4',  4, 'A', DATE '2025-01-31');
  PERFORM pg_temp.passo('A5',  5, 'A', DATE '2024-01-28');
  PERFORM pg_temp.passo('A6',  6, 'A', DATE '2024-01-29');
  PERFORM pg_temp.passo('A7',  7, 'A', DATE '2024-01-30');
  PERFORM pg_temp.passo('A8',  8, 'A', DATE '2024-01-31');
  PERFORM pg_temp.passo('A9',  9, 'A', DATE '2025-12-31');
  PERFORM pg_temp.passo('A10', 10, 'A', DATE '2025-03-15');
  PERFORM pg_temp.passo('A11', 11, 'A', DATE '2025-05-31');
END
$$;

SELECT is(pg_temp.r(v.c, 1), v.esperado, v.descr)
FROM (VALUES
  ('A1',  'exp=2025-02-28 ancora=28 ciclo=primeira_ativacao', 'primeira ativacao dia 28 (jan/2025, fevereiro normal) -> 28/fev, ancora 28'),
  ('A2',  'exp=2025-02-28 ancora=29 ciclo=primeira_ativacao', 'primeira ativacao dia 29 (jan/2025, fevereiro normal) -> 28/fev (clamp), ancora 29'),
  ('A3',  'exp=2025-02-28 ancora=30 ciclo=primeira_ativacao', 'primeira ativacao dia 30 (jan/2025, fevereiro normal) -> 28/fev (clamp), ancora 30'),
  ('A4',  'exp=2025-02-28 ancora=31 ciclo=primeira_ativacao', 'primeira ativacao dia 31 (jan/2025, fevereiro normal) -> 28/fev (clamp), ancora 31'),
  ('A5',  'exp=2024-02-28 ancora=28 ciclo=primeira_ativacao', 'primeira ativacao dia 28 (jan/2024, fevereiro BISSEXTO) -> 28/fev, ancora 28'),
  ('A6',  'exp=2024-02-29 ancora=29 ciclo=primeira_ativacao', 'primeira ativacao dia 29 (jan/2024, fevereiro BISSEXTO) -> 29/fev, ancora 29'),
  ('A7',  'exp=2024-02-29 ancora=30 ciclo=primeira_ativacao', 'primeira ativacao dia 30 (jan/2024, fevereiro BISSEXTO) -> 29/fev (clamp), ancora 30'),
  ('A8',  'exp=2024-02-29 ancora=31 ciclo=primeira_ativacao', 'primeira ativacao dia 31 (jan/2024, fevereiro BISSEXTO) -> 29/fev (clamp), ancora 31'),
  ('A9',  'exp=2026-01-31 ancora=31 ciclo=primeira_ativacao', 'primeira ativacao 31/dez/2025 -> 31/jan/2026 (virada de ano)'),
  ('A10', 'exp=2025-04-15 ancora=15 ciclo=primeira_ativacao', 'primeira ativacao 15/mar -> 15/abr'),
  ('A11', 'exp=2025-06-30 ancora=31 ciclo=primeira_ativacao', 'primeira ativacao 31/mai -> 30/jun (clamp), ancora 31')
) AS v(c, esperado, descr);

-- Guarda de cardinalidade: as checagens "count = 0" abaixo nao podem passar vazias.
SELECT is((SELECT count(*)::integer FROM _res WHERE cenario LIKE 'A%'), 11, 'A: as 11 primeiras ativacoes foram registradas');

-- O "+30 dias" foi eliminado: nestes casos a regra antiga daria outra data.
SELECT is(
  (SELECT count(*)::integer FROM _res
    WHERE cenario IN ('A1', 'A3', 'A4', 'A5', 'A6', 'A8', 'A9', 'A10') AND exp = pago + 30),
  0,
  'a primeira ativacao nao usa mais data_pagamento + 30 dias (31/jan: 28/fev, e nao 02/mar)'
);
SELECT is(
  (SELECT count(*)::integer FROM _res WHERE cenario LIKE 'A%' AND (inicio IS DISTINCT FROM pago OR status <> 'active')),
  0,
  'primeira ativacao: data_inicio = data efetiva do pagamento e status = active'
);
SELECT is(
  (SELECT valor_contratado::numeric FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(1)),
  100.00::numeric,
  'o trigger de valor contratado continua rodando na ativacao (captura o item pago)'
);

-- ----------------------------------------------------------------------------
-- B. Renovacao mensal (ancora 10; ativacao 10/jan/2025 -> vence 10/fev/2025)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.passo('B1', 12, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('B1', 12, 'A', DATE '2025-02-01');  -- adiantada
  PERFORM pg_temp.passo('B2', 13, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('B2', 13, 'A', DATE '2025-02-10');  -- no vencimento
  PERFORM pg_temp.passo('B3', 14, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('B3', 14, 'A', DATE '2025-02-25');  -- atrasada, mesmo mes
  PERFORM pg_temp.passo('B4', 15, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('B4', 15, 'A', DATE '2025-03-05');  -- atrasada, atravessando o mes
  PERFORM pg_temp.passo('B5', 16, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('B5', 16, 'A', DATE '2025-06-20');  -- varios meses de atraso
  PERFORM pg_temp.passo('B6', 17, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('B6', 17, 'A', DATE '2025-01-20');  -- semanas de antecedencia
END
$$;

SELECT is(pg_temp.r(v.c, 1), 'exp=2025-02-10 ancora=10 ciclo=primeira_ativacao', 'B: ativacao 10/jan -> vence 10/fev, ancora 10 (' || v.c || ')')
FROM (VALUES ('B1'), ('B2'), ('B3'), ('B4'), ('B5'), ('B6')) AS v(c);

SELECT is(pg_temp.r(v.c, 2), v.esperado, v.descr)
FROM (VALUES
  ('B1', 'exp=2025-03-10 ancora=10 ciclo=renovacao', 'renovacao ANTECIPADA (vence 10/fev, paga 01/fev) -> 10/mar, sem perder dias'),
  ('B2', 'exp=2025-03-10 ancora=10 ciclo=renovacao', 'renovacao NO VENCIMENTO (paga 10/fev) -> 10/mar'),
  ('B3', 'exp=2025-03-10 ancora=10 ciclo=renovacao', 'renovacao ATRASADA no mesmo mes (paga 25/fev) -> 10/mar, ancora preservada'),
  ('B4', 'exp=2025-04-10 ancora=10 ciclo=renovacao', 'renovacao ATRASADA atravessando o mes (paga 05/mar) -> 10/abr'),
  ('B5', 'exp=2025-07-10 ancora=10 ciclo=renovacao', 'VARIOS MESES de atraso (vence 10/fev, paga 20/jun) -> 10/jul: nao acumula competencias'),
  ('B6', 'exp=2025-03-10 ancora=10 ciclo=renovacao', 'renovacao com semanas de antecedencia (paga 20/jan) -> 10/mar')
) AS v(c, esperado, descr);

SELECT is((SELECT count(*)::integer FROM _res WHERE cenario LIKE 'B%'), 12, 'B: 6 cenarios x 2 passos (ativacao + renovacao) registrados');
SELECT is(
  (SELECT count(*)::integer FROM _res WHERE cenario LIKE 'B%' AND passo = 2
     AND (inicio IS DISTINCT FROM pago OR status <> 'active' OR ancora <> 10)),
  0,
  'renovacao: dia_ancora nunca muda, status active, data_inicio = data do pagamento'
);
SELECT is(
  (SELECT count(*)::integer FROM _res WHERE cenario LIKE 'B%' AND passo = 2 AND exp = pago + 30),
  0,
  'renovacao: nenhum resultado e data_pagamento + 30 dias'
);

-- ----------------------------------------------------------------------------
-- C. Ancoras 28/29/30/31 encadeadas por 13 meses (ativacao + 12 renovacoes
--    pagas no vencimento), de 2024 (bissexto) a 2025 (normal): sem deriva.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.cadeia('C31', 20, 'A', DATE '2024-01-31', 13);
  PERFORM pg_temp.cadeia('C30', 21, 'A', DATE '2024-01-30', 13);
  PERFORM pg_temp.cadeia('C29', 22, 'A', DATE '2024-01-29', 13);
  PERFORM pg_temp.cadeia('C28', 23, 'A', DATE '2024-01-28', 13);
END
$$;

SELECT is(
  (SELECT array_agg(exp ORDER BY passo) FROM _res WHERE cenario = 'C31'),
  ARRAY[DATE '2024-02-29', DATE '2024-03-31', DATE '2024-04-30', DATE '2024-05-31',
        DATE '2024-06-30', DATE '2024-07-31', DATE '2024-08-31', DATE '2024-09-30',
        DATE '2024-10-31', DATE '2024-11-30', DATE '2024-12-31', DATE '2025-01-31',
        DATE '2025-02-28'],
  'ancora 31: 31/jan -> 29/fev(2024) -> 31/mar -> 30/abr -> ... -> 31/jan -> 28/fev(2025), sem deriva'
);
SELECT is(
  (SELECT array_agg(exp ORDER BY passo) FROM _res WHERE cenario = 'C30'),
  ARRAY[DATE '2024-02-29', DATE '2024-03-30', DATE '2024-04-30', DATE '2024-05-30',
        DATE '2024-06-30', DATE '2024-07-30', DATE '2024-08-30', DATE '2024-09-30',
        DATE '2024-10-30', DATE '2024-11-30', DATE '2024-12-30', DATE '2025-01-30',
        DATE '2025-02-28'],
  'ancora 30: 29/fev(2024) -> 30/mar -> ... -> 28/fev(2025), sem deriva'
);
SELECT is(
  (SELECT array_agg(exp ORDER BY passo) FROM _res WHERE cenario = 'C29'),
  ARRAY[DATE '2024-02-29', DATE '2024-03-29', DATE '2024-04-29', DATE '2024-05-29',
        DATE '2024-06-29', DATE '2024-07-29', DATE '2024-08-29', DATE '2024-09-29',
        DATE '2024-10-29', DATE '2024-11-29', DATE '2024-12-29', DATE '2025-01-29',
        DATE '2025-02-28'],
  'ancora 29: 29/fev(2024) -> 29/mar -> ... -> 28/fev(2025), sem deriva'
);
SELECT is(
  (SELECT array_agg(exp ORDER BY passo) FROM _res WHERE cenario = 'C28'),
  ARRAY[DATE '2024-02-28', DATE '2024-03-28', DATE '2024-04-28', DATE '2024-05-28',
        DATE '2024-06-28', DATE '2024-07-28', DATE '2024-08-28', DATE '2024-09-28',
        DATE '2024-10-28', DATE '2024-11-28', DATE '2024-12-28', DATE '2025-01-28',
        DATE '2025-02-28'],
  'ancora 28: nunca sofre clamp, nem no fevereiro bissexto'
);
SELECT is((SELECT count(*)::integer FROM _res WHERE cenario IN ('C31', 'C30', 'C29', 'C28')), 52, 'C: 4 cadeias x 13 passos registrados');
SELECT is(
  (SELECT count(*)::integer FROM _res
    WHERE cenario IN ('C31', 'C30', 'C29', 'C28')
      AND ancora IS DISTINCT FROM (SELECT ancora FROM _res AS p WHERE p.cenario = _res.cenario AND p.passo = 1)),
  0,
  'a ancora nao muda em nenhuma das 52 confirmacoes (4 cadeias x 13 passos)'
);
SELECT is(
  (SELECT count(*)::integer FROM _res
    WHERE cenario IN ('C31', 'C30', 'C29', 'C28')
      AND EXTRACT(DAY FROM exp)::integer
          <> LEAST(
               ancora,
               EXTRACT(DAY FROM (date_trunc('month', exp::timestamp) + interval '1 month' - interval '1 day'))::integer
             )),
  0,
  'o dia do vencimento e sempre LEAST(ancora, ultimo dia do mes): a ancora nunca se perde apos um mes curto'
);
SELECT is(
  (SELECT count(*)::integer FROM _res AS c
    WHERE cenario IN ('C31', 'C30', 'C29', 'C28')
      AND (EXTRACT(YEAR FROM exp)::integer * 12 + EXTRACT(MONTH FROM exp)::integer)
          <> (SELECT EXTRACT(YEAR FROM p.pago)::integer * 12 + EXTRACT(MONTH FROM p.pago)::integer
                FROM _res AS p WHERE p.cenario = c.cenario AND p.passo = 1) + c.passo),
  0,
  'cada confirmacao avanca exatamente um mes-calendario (fevereiro nao e pulado)'
);

-- Regra vigente do Backstage adotada para o atraso: GREATEST(vencimento, pagamento)
-- e depois o mes seguinte pela ancora. Pagar 1 dia depois de um vencimento
-- clampado (28/fev, ancora 31) pula 31/mar e cai em 30/abr.
DO $$
BEGIN
  PERFORM pg_temp.passo('C31a', 24, 'A', DATE '2025-01-31');  -- vence 28/fev
  PERFORM pg_temp.passo('C31a', 24, 'A', DATE '2025-03-01');  -- 1 dia de atraso
  PERFORM pg_temp.passo('C31b', 25, 'A', DATE '2025-01-31');
  PERFORM pg_temp.passo('C31b', 25, 'A', DATE '2025-02-27');  -- adiantada
END
$$;
SELECT is(pg_temp.r('C31a', 2), 'exp=2025-04-30 ancora=31 ciclo=renovacao',
  'ancora 31: vence 28/fev, paga 01/mar (1 dia de atraso) -> 30/abr (regra do Backstage: mes do pagamento)');
SELECT is(pg_temp.r('C31b', 2), 'exp=2025-03-31 ancora=31 ciclo=renovacao',
  'ancora 31: vence 28/fev, paga 27/fev (adiantada) -> 31/mar, e nao 28/mar');

-- ----------------------------------------------------------------------------
-- D. Plano anual: ano-calendario (+1 year), nunca +365 dias
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.passo('D1', 30, 'ANUAL', DATE '2025-03-15');
  PERFORM pg_temp.passo('D2', 31, 'ANUAL', DATE '2024-02-29');
  PERFORM pg_temp.passo('D3', 32, 'ANUAL', DATE '2023-03-15');
  PERFORM pg_temp.passo('D4', 33, 'ANUAL', DATE '2025-02-28');
  PERFORM pg_temp.passo('D5', 34, 'ANUAL', DATE '2024-03-15', 'plano');
  PERFORM pg_temp.passo('D5', 34, 'ANUAL', DATE '2025-03-10', 'plano');  -- renovacao antecipada
  PERFORM pg_temp.passo('D6', 35, 'ANUAL', DATE '2024-03-15', 'plano');
  PERFORM pg_temp.passo('D6', 35, 'ANUAL', DATE '2025-04-20', 'plano');  -- renovacao atrasada
  PERFORM pg_temp.passo('D7', 36, 'VIT',   DATE '2025-03-15', 'plano');
  -- anual sobre uma assinatura mensal ja ancorada: a ancora e preservada (nao e apagada)
  PERFORM pg_temp.passo('D8', 37, 'A',     DATE '2025-01-10');
  PERFORM pg_temp.passo('D8', 37, 'ANUAL', DATE '2025-02-01', 'plano');
  -- intervalos que atravessam 29/fev/2024: +1 ano-calendario dura 366 dias
  PERFORM pg_temp.passo('D9',  38, 'ANUAL', DATE '2024-01-15');
  PERFORM pg_temp.passo('D10', 39, 'ANUAL', DATE '2023-06-30');
END
$$;

SELECT is(pg_temp.r(v.c, v.p), v.esperado, v.descr)
FROM (VALUES
  ('D1', 1, 'exp=2026-03-15 ancora=NULL ciclo=anual', 'anual: primeira ativacao 15/mar/2025 -> 15/mar/2026, sem ancora'),
  ('D2', 1, 'exp=2025-02-28 ancora=NULL ciclo=anual', 'anual: 29/fev/2024 + 1 ano -> 28/fev/2025'),
  ('D3', 1, 'exp=2024-03-15 ancora=NULL ciclo=anual', 'anual: 15/mar/2023 -> 15/mar/2024'),
  ('D4', 1, 'exp=2026-02-28 ancora=NULL ciclo=anual', 'anual: 28/fev/2025 -> 28/fev/2026'),
  ('D5', 1, 'exp=2025-03-15 ancora=NULL ciclo=anual', 'anual (contratacao): 15/mar/2024 -> 15/mar/2025'),
  -- Regra ajustada em 20260918160000: a renovacao do MESMO plano anual preserva os
  -- dias restantes (GREATEST(vencimento atual, pagamento) + 1 ano). Antes a
  -- referencia era so a data do pagamento (10/mar/2026 e os 5 dias restantes se perdiam).
  ('D5', 2, 'exp=2026-03-15 ancora=NULL ciclo=anual_renovacao', 'anual: renovacao self-service antecipada (vence 15/mar/2025, paga 10/mar/2025) -> 15/mar/2026: preserva os dias restantes'),
  ('D6', 2, 'exp=2026-04-20 ancora=NULL ciclo=anual_renovacao', 'anual: renovacao self-service atrasada (paga 20/abr/2025) -> 20/abr/2026: a referencia e a data do pagamento'),
  ('D7', 1, 'exp=NULL ancora=NULL ciclo=vitalicio',   'vitalicio: sem vencimento e sem ancora'),
  ('D8', 2, 'exp=2026-02-01 ancora=10 ciclo=anual',   'anual sobre assinatura mensal ancorada: +1 ano a partir do pagamento e a ancora 10 e preservada'),
  ('D9',  1, 'exp=2025-01-15 ancora=NULL ciclo=anual', 'anual: 15/jan/2024 -> 15/jan/2025'),
  ('D10', 1, 'exp=2024-06-30 ancora=NULL ciclo=anual', 'anual: 30/jun/2023 -> 30/jun/2024')
) AS v(c, p, esperado, descr);

-- Ano-CALENDARIO, nao 365 dias: quando o intervalo atravessa 29/fev/2024 o
-- resultado tem 366 dias e a regra antiga (+365) cairia um dia antes.
SELECT is(
  (SELECT exp - pago FROM _res WHERE cenario = v.c AND passo = 1),
  366,
  'anual e ano-calendario: ' || v.descr || ' dura 366 dias (atravessa 29/fev/2024), nao 365'
)
FROM (VALUES
  ('D3',  '15/mar/2023 -> 15/mar/2024'),
  ('D9',  '15/jan/2024 -> 15/jan/2025'),
  ('D10', '30/jun/2023 -> 30/jun/2024')
) AS v(c, descr);
SELECT is((SELECT count(*)::integer FROM _res WHERE cenario LIKE 'D%'), 13, 'D: 13 passos anuais/vitalicio registrados');
SELECT is(
  (SELECT count(*)::integer FROM _res WHERE cenario IN ('D3', 'D9', 'D10') AND exp = pago + 365),
  0,
  'anual: nos intervalos que atravessam 29/fev/2024 o resultado difere de data_pagamento + 365 dias'
);
SELECT is(
  (SELECT count(*)::integer FROM _res WHERE cenario IN ('D1', 'D2', 'D3', 'D4', 'D9', 'D10') AND ancora IS NOT NULL),
  0,
  'anual: primeira ativacao nao grava dia_ancora'
);

-- ----------------------------------------------------------------------------
-- E. Contratacao / troca de plano / renovacao (comportamento preservado)
-- ----------------------------------------------------------------------------
-- E3: trial da mesma empresa e plano; E5: linha ativa legada SEM ancora;
-- E6: a mesma linha legada depois da virada (backfill); E4: sem linha previa.
UPDATE public.empresa_assinaturas
   SET plano_id = pg_temp.pl('A'), status = 'trial', data_expiracao = DATE '2025-01-25', dia_ancora = NULL
 WHERE empresa_id = pg_temp.emp(42);
UPDATE public.empresa_assinaturas
   SET plano_id = pg_temp.pl('A'), status = 'active', data_expiracao = DATE '2025-02-10', dia_ancora = NULL
 WHERE empresa_id IN (pg_temp.emp(44), pg_temp.emp(45));
DELETE FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(43);
SELECT is(
  public.preencher_dia_ancora_assinaturas(pg_temp.emp(45)),
  1,
  'virada: o backfill ancora a linha ativa legada de E6 (dia do vencimento atual = 10)'
);

DO $$
BEGIN
  -- E1: troca de plano mensal A -> B (assinatura ancorada em 10)
  PERFORM pg_temp.passo('E1', 40, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('E1', 40, 'B', DATE '2025-01-20', 'plano');
  -- E2: contratar o MESMO plano por 'plano' em assinatura ancorada = renovacao
  PERFORM pg_temp.passo('E2', 41, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('E2', 41, 'A', DATE '2025-02-01', 'plano');
  -- E3: trial -> pago (mesmo plano)
  PERFORM pg_temp.passo('E3', 42, 'A', DATE '2025-01-20');
  -- E4: cadastro pago, sem linha previa em empresa_assinaturas
  PERFORM pg_temp.passo('E4', 43, 'A', DATE '2025-03-05', 'plano');
  -- E5: linha ativa legada SEM ancora (fora do backfill de virada)
  PERFORM pg_temp.passo('E5', 44, 'A', DATE '2025-02-01');
  -- E6: a mesma linha legada, mas ancorada pela virada
  PERFORM pg_temp.passo('E6', 45, 'A', DATE '2025-02-01');
  -- E7: anual -> mensal
  PERFORM pg_temp.passo('E7', 46, 'ANUAL', DATE '2024-03-15', 'plano');
  PERFORM pg_temp.passo('E7', 46, 'A',     DATE '2025-01-20');
END
$$;

SELECT is(pg_temp.r(v.c, v.p), v.esperado, v.descr)
FROM (VALUES
  ('E1', 2, 'exp=2025-02-20 ancora=20 ciclo=troca_de_plano',    'troca de plano mensal (A -> B): recomeca o ciclo no pagamento (comportamento anterior); nova ancora = 20'),
  ('E2', 2, 'exp=2025-03-10 ancora=10 ciclo=renovacao',         'contratar o mesmo plano por "plano" em assinatura ancorada e renovacao: ancora 10 preservada'),
  ('E3', 1, 'exp=2025-02-20 ancora=20 ciclo=primeira_ativacao', 'trial -> pago (mesmo plano): primeira ativacao; o fim do trial nao entra na conta'),
  ('E4', 1, 'exp=2025-04-05 ancora=5 ciclo=primeira_ativacao',  'cadastro pago sem linha previa: cria a assinatura na primeira ativacao'),
  ('E5', 1, 'exp=2025-03-01 ancora=1 ciclo=primeira_ativacao',  'LEGADO sem ancora (fora do backfill): tratada como primeira ativacao (por isso a virada ancora as existentes)'),
  ('E6', 1, 'exp=2025-03-10 ancora=10 ciclo=renovacao',         'apos a virada (backfill) a mesma linha legada renova a partir do vencimento atual: 10/mar, ancora 10'),
  ('E7', 1, 'exp=2025-03-15 ancora=NULL ciclo=anual',           'anual: 15/mar/2024 -> 15/mar/2025'),
  ('E7', 2, 'exp=2025-02-20 ancora=20 ciclo=primeira_ativacao', 'anual -> mensal: primeira ativacao mensal (nao ha ancora); ancora = dia do pagamento')
) AS v(c, p, esperado, descr);

SELECT is(
  (SELECT plano FROM _res WHERE cenario = 'E1' AND passo = 2),
  pg_temp.pl('B'),
  'troca de plano: o plano da assinatura passa a ser o novo (B)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(43)),
  1,
  'cadastro pago: exatamente uma linha de assinatura criada'
);

-- ----------------------------------------------------------------------------
-- F. Idempotencia
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO _ids VALUES ('F1', pg_temp.passo('F1', 50, 'A', DATE '2025-01-31'));
  PERFORM pg_temp.passo('F2', 51, 'A', DATE '2025-01-10');
  INSERT INTO _ids VALUES ('F2', pg_temp.passo('F2', 51, 'A', DATE '2025-02-10'));
  -- F3: tres pagamentos DISTINTOS em sequencia (pre-pagamento)
  PERFORM pg_temp.passo('F3', 52, 'A', DATE '2025-01-10');
  PERFORM pg_temp.passo('F3', 52, 'A', DATE '2025-01-11');
  PERFORM pg_temp.passo('F3', 52, 'A', DATE '2025-01-12');
  -- F4: so para observar o lock
  PERFORM pg_temp.passo('F4', 53, 'A', DATE '2025-01-10');
END
$$;

-- F1: reentrega do MESMO pagamento (ativacao) com outra data
CREATE TEMP TABLE _f1 ON COMMIT DROP AS
SELECT ctid::text AS pos, data_expiracao, dia_ancora, data_inicio, status::text AS status, plano_id
  FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(50);
CREATE TEMP TABLE _f1_ret ON COMMIT DROP AS
SELECT public.confirmar_pagamento_asaas((SELECT id FROM _ids WHERE k = 'F1'), DATE '2025-02-10', 'PIX') AS r;

SELECT is((SELECT r->>'ja_processado' FROM _f1_ret), 'true', 'reentrega do mesmo pagamento: responde ja_processado');
SELECT is((SELECT (r->>'ok')::boolean FROM _f1_ret), true, 'reentrega do mesmo pagamento: ok = true (o webhook nao falha)');
SELECT is(
  (SELECT count(*)::integer
     FROM _f1 AS b
     JOIN public.empresa_assinaturas AS a ON a.empresa_id = pg_temp.emp(50)
    WHERE b.pos = a.ctid::text AND b.data_expiracao = a.data_expiracao AND b.dia_ancora = a.dia_ancora
      AND b.data_inicio = a.data_inicio AND b.status = a.status::text AND b.plano_id = a.plano_id),
  1,
  'reentrega: a assinatura nao foi reescrita (mesma versao da linha, mesmo vencimento, ancora e data_inicio)'
);
SELECT is(
  (SELECT data_pagamento FROM public.pagamentos WHERE id = (SELECT id FROM _ids WHERE k = 'F1')),
  DATE '2025-01-31',
  'reentrega com outra data nao regrava pagamentos.data_pagamento'
);

-- F2: reentrega de uma RENOVACAO (o caso em que um avanco duplo seria visivel)
CREATE TEMP TABLE _f2 ON COMMIT DROP AS
SELECT ctid::text AS pos, data_expiracao FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(51);
CREATE TEMP TABLE _f2_ret ON COMMIT DROP AS
SELECT public.confirmar_pagamento_asaas((SELECT id FROM _ids WHERE k = 'F2'), DATE '2025-03-01', 'PIX') AS r;
SELECT is(pg_temp.r('F2', 2), 'exp=2025-03-10 ancora=10 ciclo=renovacao', 'F2: a renovacao avancou para 10/mar');
SELECT is(
  (SELECT data_expiracao FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(51)),
  DATE '2025-03-10',
  'webhook repetido (CONFIRMED e depois RECEIVED) nao avanca a renovacao duas vezes: continua 10/mar'
);
SELECT is(
  (SELECT count(*)::integer FROM _f2 AS b JOIN public.empresa_assinaturas AS a ON a.empresa_id = pg_temp.emp(51)
    WHERE b.pos = a.ctid::text AND b.data_expiracao = a.data_expiracao),
  1,
  'renovacao repetida: nenhuma reescrita da assinatura'
);
SELECT is((SELECT r->>'ja_processado' FROM _f2_ret), 'true', 'renovacao repetida: responde ja_processado');

-- F3: consequencia da regra nova, registrada de proposito: cada pagamento
-- DISTINTO confirmado SEM COMPETENCIA (aqui inseridos direto, como carrinho,
-- contratacao ou historico anterior) avanca um mes (pre-pagamento). Antes, o
-- segundo nao estendia nada porque o resultado dependia so de "hoje". A trava
-- por competencia (20260918160000) cobre as mensalidades geradas por
-- solicitar_mensalidade(): ver mensalidade_competencia_idempotencia_test.sql,
-- onde dois pagamentos da MESMA competencia nunca avancam duas vezes.
SELECT is(pg_temp.r('F3', 1), 'exp=2025-02-10 ancora=10 ciclo=primeira_ativacao', 'F3 passo 1: ativacao -> 10/fev');
SELECT is(pg_temp.r('F3', 2), 'exp=2025-03-10 ancora=10 ciclo=renovacao', 'F3 passo 2: segundo pagamento distinto -> 10/mar');
SELECT is(pg_temp.r('F3', 3), 'exp=2025-04-10 ancora=10 ciclo=renovacao', 'F3 passo 3: terceiro pagamento distinto -> 10/abr (cada pagamento confirmado avanca um mes)');

-- F4: o RPC serializa as confirmacoes da mesma empresa (advisory lock por empresa).
-- (Sem filtrar por pid: o lock e exclusivo, entao um lock CONCEDIDO com esta
-- chave, especifica desta empresa de teste, so pode ser o da nossa transacao.
-- Alem disso, alguns builds single-user reportam pid NULL em pg_locks.)
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_locks AS l,
           (SELECT hashtextextended('assinatura:' || pg_temp.emp(53)::text, 0) AS k) AS s
     WHERE l.locktype = 'advisory'
       AND l.granted
       AND l.objsubid = 1
       AND l.classid::bigint = ((s.k >> 32) & 4294967295)
       AND l.objid::bigint = (s.k & 4294967295)
  ),
  'o RPC mantem o advisory lock por empresa (regra le-e-escreve: confirmacoes concorrentes nao perdem avanco)'
);

SELECT is(
  public.confirmar_pagamento_asaas('d5400000-0000-4000-8000-0000000000ff'::uuid, DATE '2025-01-31', 'PIX'),
  jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado'),
  'pagamento inexistente: resposta inalterada'
);

-- ----------------------------------------------------------------------------
-- G. Data do pagamento
-- ----------------------------------------------------------------------------
-- G1/G2: sem data (NULL, e a chamada de 1 argumento com o default) o RPC usa
-- HOJE EM SAO PAULO, independentemente do TimeZone da sessao. Em qualquer
-- instante pelo menos uma das duas zonas abaixo esta em outro dia que Sao
-- Paulo, entao uma implementacao baseada em CURRENT_DATE falharia numa delas.
CREATE TEMP TABLE _g (k text, pagamento_id uuid) ON COMMIT DROP;

SET LOCAL TimeZone = 'Pacific/Kiritimati';
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, plano_id, descricao, valor, status)
  VALUES (pg_temp.emp(60), 'plano', pg_temp.pl('A'), 'G1 kiritimati', 100, 'pendente') RETURNING id INTO v_id;
  PERFORM public.confirmar_pagamento_asaas(v_id, NULL, 'PIX');
  INSERT INTO _g VALUES ('null_kiritimati', v_id);
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, plano_id, descricao, valor, status)
  VALUES (pg_temp.emp(61), 'plano', pg_temp.pl('A'), 'G2 kiritimati', 100, 'pendente') RETURNING id INTO v_id;
  PERFORM public.confirmar_pagamento_asaas(v_id);
  INSERT INTO _g VALUES ('default_kiritimati', v_id);
END
$$;
SET LOCAL TimeZone = 'Pacific/Pago_Pago';
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, plano_id, descricao, valor, status)
  VALUES (pg_temp.emp(62), 'plano', pg_temp.pl('A'), 'G1 pago_pago', 100, 'pendente') RETURNING id INTO v_id;
  PERFORM public.confirmar_pagamento_asaas(v_id, NULL, 'PIX');
  INSERT INTO _g VALUES ('null_pago_pago', v_id);
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, plano_id, descricao, valor, status)
  VALUES (pg_temp.emp(63), 'plano', pg_temp.pl('A'), 'G2 pago_pago', 100, 'pendente') RETURNING id INTO v_id;
  PERFORM public.confirmar_pagamento_asaas(v_id);
  INSERT INTO _g VALUES ('default_pago_pago', v_id);
END
$$;
RESET TimeZone;

SELECT is(
  (SELECT p.data_pagamento FROM public.pagamentos AS p WHERE p.id = g.pagamento_id),
  public.data_sao_paulo(now()),
  'sem data (' || g.k || '): data efetiva = hoje em Sao Paulo, e nao CURRENT_DATE da sessao'
)
FROM _g AS g;

SELECT is(
  (SELECT a.data_inicio FROM public.empresa_assinaturas AS a WHERE a.empresa_id = pg_temp.emp(60)),
  public.data_sao_paulo(now()),
  'sem data: data_inicio da assinatura = hoje em Sao Paulo'
);
SELECT is(
  (SELECT a.data_expiracao FROM public.empresa_assinaturas AS a WHERE a.empresa_id = pg_temp.emp(60)),
  public.next_monthly_due_date(public.data_sao_paulo(now()), EXTRACT(DAY FROM public.data_sao_paulo(now()))::integer),
  'sem data: primeira ativacao vence no proximo mes pela ancora do dia de hoje em Sao Paulo'
);

-- G3: uma data de pagamento no futuro e limitada a hoje (Sao Paulo).
CREATE TEMP TABLE _g3 (id uuid) ON COMMIT DROP;
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, plano_id, descricao, valor, status)
  VALUES (pg_temp.emp(64), 'plano', pg_temp.pl('A'), 'G3 futuro', 100, 'pendente') RETURNING id INTO v_id;
  PERFORM public.confirmar_pagamento_asaas(v_id, public.data_sao_paulo(now()) + 10, 'PIX');
  INSERT INTO _g3 VALUES (v_id);
END
$$;
SELECT is(
  (SELECT data_pagamento FROM public.pagamentos WHERE id = (SELECT id FROM _g3)),
  public.data_sao_paulo(now()),
  'data de pagamento no futuro (hoje + 10) e limitada a hoje em Sao Paulo'
);
SELECT is(
  (SELECT data_inicio FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(64)),
  public.data_sao_paulo(now()),
  'data no futuro: o ciclo tambem usa hoje, e nao a data futura'
);

-- G4: a data informada (data do evento) governa o ciclo e e gravada como veio.
SELECT is(
  (SELECT p.data_pagamento FROM public.pagamentos AS p WHERE p.id = (SELECT id FROM _ids WHERE k = 'F1')),
  DATE '2025-01-31',
  'a data do evento (31/jan/2025) foi gravada em pagamentos.data_pagamento e governou o ciclo, nao o dia da confirmacao'
);

-- G5: conversao instante -> data de negocio em America/Sao_Paulo.
SELECT is(public.data_sao_paulo(v.ts), v.esperado, v.descr)
FROM (VALUES
  (TIMESTAMPTZ '2026-01-31 23:30:00-03', DATE '2026-01-31', '23:30 de 31/jan em Sao Paulo continua sendo 31/jan (UTC ja e 01/fev)'),
  (TIMESTAMPTZ '2026-02-01 02:59:59+00', DATE '2026-01-31', '02:59:59 UTC = 23:59:59 em Sao Paulo: ainda 31/jan'),
  (TIMESTAMPTZ '2026-02-01 03:00:00+00', DATE '2026-02-01', '03:00:00 UTC = meia-noite em Sao Paulo: 01/fev'),
  (TIMESTAMPTZ '2026-02-01 00:00:00-03', DATE '2026-02-01', 'meia-noite de 01/fev em Sao Paulo'),
  (TIMESTAMPTZ '2024-02-29 23:59:59-03', DATE '2024-02-29', '29/fev/2024 (bissexto) 23:59:59 em Sao Paulo'),
  (TIMESTAMPTZ '2025-12-31 22:30:00-03', DATE '2025-12-31', '31/dez 22:30 em Sao Paulo (UTC ja e o ano seguinte)')
) AS v(ts, esperado, descr);
SET LOCAL TimeZone = 'Pacific/Kiritimati';
SELECT is(public.data_sao_paulo(TIMESTAMPTZ '2026-01-31 23:30:00-03'), DATE '2026-01-31', 'data_sao_paulo independe do TimeZone da sessao (Kiritimati)');
SET LOCAL TimeZone = 'Pacific/Pago_Pago';
SELECT is(public.data_sao_paulo(TIMESTAMPTZ '2026-02-01 03:00:00+00'), DATE '2026-02-01', 'data_sao_paulo independe do TimeZone da sessao (Pago Pago)');
RESET TimeZone;
SELECT is(
  (SELECT provolatile::text FROM pg_proc WHERE oid = 'public.data_sao_paulo(timestamptz)'::regprocedure),
  'i',
  'data_sao_paulo e IMMUTABLE'
);

-- ----------------------------------------------------------------------------
-- H. Compatibilidade e seguranca
-- ----------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public.confirmar_pagamento_asaas(uuid, date, text)', 'EXECUTE'),
  'anon nao executa confirmar_pagamento_asaas');
SELECT ok(NOT has_function_privilege('authenticated', 'public.confirmar_pagamento_asaas(uuid, date, text)', 'EXECUTE'),
  'authenticated nao executa confirmar_pagamento_asaas (so a Edge Function com service_role)');
SELECT ok(has_function_privilege('service_role', 'public.confirmar_pagamento_asaas(uuid, date, text)', 'EXECUTE'),
  'service_role executa confirmar_pagamento_asaas');
SELECT ok(
  (SELECT proacl IS NOT NULL FROM pg_proc WHERE oid = 'public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure)
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) AS acl
     WHERE p.oid = 'public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure AND acl.grantee = 0
  ),
  'PUBLIC nao tem EXECUTE em confirmar_pagamento_asaas'
);
SELECT ok(NOT has_function_privilege('anon', 'public.data_sao_paulo(timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.data_sao_paulo(timestamptz)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.data_sao_paulo(timestamptz)', 'EXECUTE'),
  'data_sao_paulo: so service_role executa');
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure),
  true,
  'confirmar_pagamento_asaas continua SECURITY DEFINER'
);
SELECT is(
  (SELECT proconfig FROM pg_proc WHERE oid = 'public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure),
  ARRAY['search_path=public']::text[],
  'confirmar_pagamento_asaas continua com search_path = public'
);
SELECT ok(
  position('_data_pagamento date DEFAULT NULL' IN pg_get_function_arguments('public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure)) > 0,
  'assinatura preservada (uuid, date, text); o default de _data_pagamento agora e NULL (resolvido em Sao Paulo dentro do RPC)'
);

-- H2: pagamento CANCELADO nao ganha comportamento novo: continua sendo confirmado como antes.
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, plano_id, descricao, valor, status)
VALUES ('d5400000-0000-4000-8000-000000000002', pg_temp.emp(65), 'plano', pg_temp.pl('A'), 'H2 cancelado', 100, 'cancelado');
SELECT is(
  (public.confirmar_pagamento_asaas('d5400000-0000-4000-8000-000000000002'::uuid, DATE '2025-01-31', 'PIX'))->>'ciclo',
  'primeira_ativacao',
  'pagamento cancelado: comportamento inalterado (ainda confirma e ativa; nada novo nesta etapa)'
);
SELECT is(
  (SELECT status::text FROM public.pagamentos WHERE id = 'd5400000-0000-4000-8000-000000000002'),
  'pago',
  'pagamento cancelado: ficou pago, como antes'
);

-- H3: carrinho com plano + modulo: o modulo acompanha o vencimento novo do plano.
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, descricao, valor, status)
VALUES ('d5400000-0000-4000-8000-000000000003', pg_temp.emp(66), 'outro', 'Carrinho: 1 plano(s) e 1 modulo(s)', 130, 'pendente');
INSERT INTO public.pagamento_itens (pagamento_id, tipo, plano_id, descricao, valor)
VALUES ('d5400000-0000-4000-8000-000000000003', 'plano', pg_temp.pl('A'), 'Plano', 100);
INSERT INTO public.pagamento_itens (pagamento_id, tipo, modulo_id, descricao, valor)
VALUES ('d5400000-0000-4000-8000-000000000003', 'modulo', 'd5900000-0000-4000-8000-000000000001', 'Modulo', 30);
SELECT is(
  (public.confirmar_pagamento_asaas('d5400000-0000-4000-8000-000000000003'::uuid, DATE '2025-01-31', 'PIX'))->>'data_expiracao',
  '2025-02-28',
  'carrinho plano + modulo: primeira ativacao 31/jan -> 28/fev'
);
SELECT is(
  (SELECT data_expiracao FROM public.empresa_modulos
    WHERE empresa_id = pg_temp.emp(66) AND modulo_id = 'd5900000-0000-4000-8000-000000000001'),
  DATE '2025-02-28',
  'o modulo do carrinho herda o vencimento novo do plano (28/fev), como antes herdava o +30'
);

-- H4: carrinho SO de modulo com plano vigente: herda o vencimento do plano (inalterado).
UPDATE public.empresa_assinaturas SET plano_id = pg_temp.pl('A'), status = 'active', data_expiracao = CURRENT_DATE + 40
 WHERE empresa_id = pg_temp.emp(67);
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, descricao, valor, status)
VALUES ('d5400000-0000-4000-8000-000000000004', pg_temp.emp(67), 'outro', 'Carrinho: 0 plano(s) e 1 modulo(s)', 30, 'pendente');
INSERT INTO public.pagamento_itens (pagamento_id, tipo, modulo_id, descricao, valor)
VALUES ('d5400000-0000-4000-8000-000000000004', 'modulo', 'd5900000-0000-4000-8000-000000000001', 'Modulo', 30);
DO $$
BEGIN
  PERFORM public.confirmar_pagamento_asaas('d5400000-0000-4000-8000-000000000004'::uuid, NULL, 'PIX');
END
$$;
SELECT is(
  (SELECT data_expiracao FROM public.empresa_modulos
    WHERE empresa_id = pg_temp.emp(67) AND modulo_id = 'd5900000-0000-4000-8000-000000000001'),
  (SELECT data_expiracao FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(67)),
  'modulo avulso com plano vigente: continua herdando o vencimento do plano'
);
SELECT is(
  (SELECT data_expiracao FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(67)),
  CURRENT_DATE + 40,
  'modulo avulso nao altera a assinatura (vencimento e ancora do plano intactos)'
);

-- H5: carrinho SO de modulo SEM plano valido: o fallback "CURRENT_DATE + 30 dias"
-- do MODULO permanece (modulos estao fora do escopo desta etapa).
UPDATE public.empresa_assinaturas SET plano_id = pg_temp.pl('A'), status = 'expired', data_expiracao = DATE '2025-01-01'
 WHERE empresa_id = pg_temp.emp(68);
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, descricao, valor, status)
VALUES ('d5400000-0000-4000-8000-000000000005', pg_temp.emp(68), 'outro', 'Carrinho: 0 plano(s) e 1 modulo(s)', 30, 'pendente');
INSERT INTO public.pagamento_itens (pagamento_id, tipo, modulo_id, descricao, valor)
VALUES ('d5400000-0000-4000-8000-000000000005', 'modulo', 'd5900000-0000-4000-8000-000000000001', 'Modulo', 30);
DO $$
BEGIN
  PERFORM public.confirmar_pagamento_asaas('d5400000-0000-4000-8000-000000000005'::uuid, NULL, 'PIX');
END
$$;
SELECT is(
  (SELECT data_expiracao FROM public.empresa_modulos
    WHERE empresa_id = pg_temp.emp(68) AND modulo_id = 'd5900000-0000-4000-8000-000000000001'),
  CURRENT_DATE + 30,
  'modulo sem plano valido: fallback CURRENT_DATE + 30 dias PRESERVADO (fora do escopo desta etapa)'
);

-- H6: BUG PRE-EXISTENTE, PRESERVADO DE PROPOSITO. Modulo avulso (referencia_tipo
-- = modulo, SEM itens, como solicitar_contratacao_modulo cria) nunca atribui
-- _plano e o RPC falha em `IF _plano.id IS NOT NULL`. Corrigir mudaria o
-- comportamento de modulos (fora do escopo); este teste apenas impede que a
-- mudanca aconteca sem querer. Se o bug for corrigido, ajuste este teste.
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, modulo_id, descricao, valor, status)
VALUES ('d5400000-0000-4000-8000-000000000006', pg_temp.emp(69), 'modulo', 'd5900000-0000-4000-8000-000000000001', 'Contratacao solicitada: modulo', 30, 'pendente');
SELECT throws_ok(
  $$ SELECT public.confirmar_pagamento_asaas('d5400000-0000-4000-8000-000000000006'::uuid, DATE '2025-01-31', 'PIX') $$,
  '55000', 'record "_plano" is not assigned yet',
  'LEGADO PRESERVADO (bug pre-existente): modulo avulso sem itens continua falhando ao confirmar, exatamente como antes'
);
SELECT is(
  (SELECT status::text FROM public.pagamentos WHERE id = 'd5400000-0000-4000-8000-000000000006'),
  'pendente',
  'e a falha reverte tudo: o pagamento continua pendente'
);

-- H7: valor efetivamente pago (item de 100) prevalece sobre o preco de catalogo do plano B (200).
DO $$
BEGIN
  PERFORM pg_temp.passo('H7', 70, 'B', DATE '2025-01-15');
END
$$;
SELECT is(
  (SELECT valor_contratado::numeric FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(70)),
  100.00::numeric,
  'trg_assin_valor_contratado: o valor do item pago (100) prevalece sobre o catalogo do plano (200)'
);

-- ----------------------------------------------------------------------------
-- I. Ponta a ponta com os criadores REAIS de cobranca
-- ----------------------------------------------------------------------------
-- I1: solicitar_mensalidade() como o dono da empresa, depois confirmar.
DO $$
BEGIN
  PERFORM pg_temp.passo('I1', 76, 'A', DATE '2025-01-10');
END
$$;
SELECT set_config('request.jwt.claim.sub', pg_temp.dono(76)::text, true);
CREATE TEMP TABLE _i1 ON COMMIT DROP AS SELECT public.solicitar_mensalidade() AS id;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is(
  (SELECT descricao FROM public.pagamentos WHERE id = (SELECT id FROM _i1)),
  'Mensalidade Plano __mescal_mensal_a__',
  'I1: solicitar_mensalidade() criou a cobranca real de mensalidade'
);
CREATE TEMP TABLE _i1_ret ON COMMIT DROP AS
SELECT public.confirmar_pagamento_asaas((SELECT id FROM _i1), DATE '2025-02-01', 'PIX') AS r;
SELECT is(
  (SELECT (r->>'ciclo') || ' ' || (r->>'data_expiracao') || ' ancora=' || (r->>'dia_ancora') FROM _i1_ret),
  'renovacao 2025-03-10 ancora=10',
  'I1: mensalidade real + confirmacao adiantada (01/fev) = renovacao para 10/mar, ancora 10 preservada'
);

-- I2: solicitar_contratacao_plano() como o dono (assinatura trial), depois confirmar.
SELECT set_config('request.jwt.claim.sub', pg_temp.dono(77)::text, true);
CREATE TEMP TABLE _i2 ON COMMIT DROP AS SELECT public.solicitar_contratacao_plano(pg_temp.pl('A')) AS id;
SELECT set_config('request.jwt.claim.sub', '', true);
CREATE TEMP TABLE _i2_ret ON COMMIT DROP AS
SELECT public.confirmar_pagamento_asaas((SELECT id FROM _i2), DATE '2025-01-31', 'PIX') AS r;
SELECT is(
  (SELECT (r->>'ciclo') || ' ' || (r->>'data_expiracao') || ' ancora=' || (r->>'dia_ancora') FROM _i2_ret),
  'primeira_ativacao 2025-02-28 ancora=31',
  'I2: contratacao real + confirmacao em 31/jan = primeira ativacao, vence 28/fev, ancora 31'
);

SELECT * FROM finish();
ROLLBACK;
