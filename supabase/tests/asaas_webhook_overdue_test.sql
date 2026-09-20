-- Cobertura de banco para o ramo OVERDUE do asaas-webhook
-- (supabase/functions/asaas-webhook/index.ts) contra os indices unicos REAIS.
-- Rode com `supabase test db` contra um banco que contenha todas as migrations.
--
-- O webhook faz, via PostgREST (supabase-js):
--   .from("pagamentos").update({ status: "atrasado" }).eq("id", ID).in("status", ["pendente", "atrasado"])
-- que vira:
--   UPDATE pagamentos SET status = 'atrasado' WHERE id = ID AND status IN ('pendente', 'atrasado')
-- (pg_temp.overdue abaixo). Antes era `.neq("status", "pago")` -> `status <> 'pago'`
-- (pg_temp.overdue_antigo), que tambem reabria `cancelado`. Cada cenario com dois
-- pagamentos tem um CONTROLE NEGATIVO: o predicado antigo levanta 23505 no mesmo cenario,
-- o que prova que o cenario exercita o indice e que o teste detectaria a regressao.
--
-- O teste do handler (Node/vitest) esta em supabase/functions/asaas-webhook/index.test.ts.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. Fixtures e auxiliares
-- ----------------------------------------------------------------------------
INSERT INTO public.empresas (id, owner_id, nome)
SELECT
  ('d7200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('d7300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '__ovd_empresa_' || lpad(n::text, 2, '0') || '__'
FROM generate_series(1, 6) AS n;

CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _e (k text PRIMARY KEY, code text, msg text) ON COMMIT DROP;
CREATE TEMP TABLE _s (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.emp(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d7200000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

-- Cria um pagamento (como solicitar_mensalidade / carrinho) e o registra sob a chave _k.
CREATE FUNCTION pg_temp.pag(
  _k text, _emp integer, _status text, _comp date DEFAULT NULL, _desc text DEFAULT 'Carrinho: 1 plano(s) e 0 modulo(s)'
) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia, asaas_payment_id, data_pagamento)
  VALUES (
    pg_temp.emp(_emp), 'outro', _desc, 150, _status::public.pagamento_status, _comp, 'pay_' || _k,
    CASE WHEN _status = 'pago' THEN DATE '2025-02-05' END
  )
  RETURNING id INTO v_id;
  INSERT INTO _ids VALUES (_k, v_id);
  RETURN v_id;
END
$fn$;

CREATE FUNCTION pg_temp.pid(_k text) RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT id FROM _ids WHERE k = _k
$fn$;

-- SQL que o PostgREST gera para o filtro NOVO do webhook.
CREATE FUNCTION pg_temp.overdue(_k text) RETURNS void LANGUAGE sql AS $fn$
  UPDATE public.pagamentos SET status = 'atrasado'
   WHERE id = pg_temp.pid(_k) AND status IN ('pendente', 'atrasado')
$fn$;

-- SQL do filtro ANTIGO (`.neq("status", "pago")`): so para os controles negativos.
CREATE FUNCTION pg_temp.overdue_antigo(_k text) RETURNS void LANGUAGE sql AS $fn$
  UPDATE public.pagamentos SET status = 'atrasado'
   WHERE id = pg_temp.pid(_k) AND status <> 'pago'
$fn$;

-- Estado e "versao fisica" da linha: o ctid muda em qualquer UPDATE que reescreve a linha.
CREATE FUNCTION pg_temp.st(_k text) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid(_k)
$fn$;

CREATE FUNCTION pg_temp.pos(_k text) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT ctid::text FROM public.pagamentos WHERE id = pg_temp.pid(_k)
$fn$;

-- Executa um comando e guarda SQLSTATE + mensagem (ou 'sem erro').
CREATE FUNCTION pg_temp.err(_k text, _sql text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE _sql;
    INSERT INTO _e VALUES (_k, 'sem erro', NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _e VALUES (_k, SQLSTATE, SQLERRM);
  END;
END
$fn$;

-- ----------------------------------------------------------------------------
-- A. Estados: so pendente/atrasado ficam/viram atrasado (cenarios 1 a 4)
-- ----------------------------------------------------------------------------
SELECT pg_temp.pag('a_pendente',  1, 'pendente');
SELECT pg_temp.pag('a_atrasado',  1, 'atrasado');
SELECT pg_temp.pag('a_cancelado', 1, 'cancelado');
SELECT pg_temp.pag('a_pago',      1, 'pago');
INSERT INTO _s VALUES
  ('pos_cancelado', pg_temp.pos('a_cancelado')),
  ('pos_pago',      pg_temp.pos('a_pago'));

SELECT pg_temp.overdue(k) FROM (VALUES ('a_pendente'), ('a_atrasado'), ('a_cancelado'), ('a_pago')) AS v(k);

SELECT is(pg_temp.st('a_pendente'), 'atrasado', '1) pendente + OVERDUE -> atrasado');
SELECT is(pg_temp.st('a_atrasado'), 'atrasado', '2) atrasado + OVERDUE -> continua atrasado');
SELECT is(pg_temp.st('a_cancelado'), 'cancelado', '3) cancelado + OVERDUE -> continua cancelado (nao e reaberto)');
SELECT is(pg_temp.pos('a_cancelado'), (SELECT v FROM _s WHERE k = 'pos_cancelado'), '3) e a linha do cancelado nem foi reescrita');
SELECT is(pg_temp.st('a_pago'), 'pago', '4) pago + OVERDUE -> continua pago (nao regride)');
SELECT is(pg_temp.pos('a_pago'), (SELECT v FROM _s WHERE k = 'pos_pago'), '4) e a linha do pago nem foi reescrita');
SELECT is((SELECT data_pagamento FROM public.pagamentos WHERE id = pg_temp.pid('a_pago')), DATE '2025-02-05', '4) data_pagamento do pago intacta');

-- 2) idempotente: repetir o OVERDUE nao muda o resultado
SELECT pg_temp.overdue('a_pendente');
SELECT pg_temp.overdue('a_atrasado');
SELECT is(pg_temp.st('a_pendente'), 'atrasado', '2) OVERDUE repetido continua atrasado');
SELECT is(pg_temp.st('a_atrasado'), 'atrasado', '2) OVERDUE repetido continua atrasado (ja estava)');

-- Rede de seguranca: o filtro e uma LISTA DE PERMISSAO. Se surgir um estado novo no enum,
-- este teste falha para lembrar de revisar o webhook (estado final nao pode regredir).
SELECT is(
  enum_range(NULL::public.pagamento_status)::text[],
  ARRAY['pago', 'pendente', 'atrasado', 'cancelado'],
  'os unicos estados sao pago, pendente, atrasado e cancelado (pago e cancelado sao os finais)'
);

-- ----------------------------------------------------------------------------
-- B. Indices que tornavam o filtro antigo perigoso existem e sao unicos
-- ----------------------------------------------------------------------------
SELECT ok(
  (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.uq_pagamentos_empresa_competencia'::regclass),
  'uq_pagamentos_empresa_competencia existe e e unico');
SELECT ok(
  (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.uq_pagamentos_mensalidade_pendente'::regclass),
  'uq_pagamentos_mensalidade_pendente existe e e unico');

-- ----------------------------------------------------------------------------
-- C. Cenario 5a: cancelada da competencia + nova PENDENTE da mesma competencia
--    (mensalidades: os DOIS indices estariam em jogo)
-- ----------------------------------------------------------------------------
SELECT pg_temp.pag('c_antiga', 2, 'cancelado', DATE '2025-02-10', 'Mensalidade Plano A');
SELECT pg_temp.pag('c_nova',   2, 'pendente',  DATE '2025-02-10', 'Mensalidade Plano A');
INSERT INTO _s VALUES ('pos_c_antiga', pg_temp.pos('c_antiga')), ('pos_c_nova', pg_temp.pos('c_nova'));

SELECT pg_temp.err('c_antigo', $$ SELECT pg_temp.overdue_antigo('c_antiga') $$);
SELECT is((SELECT code FROM _e WHERE k = 'c_antigo'), '23505', '5a) CONTROLE: o filtro antigo reabriria a cancelada e violaria a unicidade (23505)');

SELECT pg_temp.err('c_novo', $$ SELECT pg_temp.overdue('c_antiga') $$);
SELECT is((SELECT code FROM _e WHERE k = 'c_novo'), 'sem erro', '5a) filtro novo: OVERDUE da cancelada antiga NAO gera 23505');
SELECT is(pg_temp.st('c_antiga'), 'cancelado', '5a) a antiga continua cancelada');
SELECT is(pg_temp.pos('c_antiga'), (SELECT v FROM _s WHERE k = 'pos_c_antiga'), '5a) e nao foi reescrita');
SELECT is(pg_temp.st('c_nova'), 'pendente', '5a) a nova cobranca continua pendente');
SELECT is(pg_temp.pos('c_nova'), (SELECT v FROM _s WHERE k = 'pos_c_nova'), '5a) e a nova cobranca nao foi alterada');

-- ----------------------------------------------------------------------------
-- D. Cenario 5b: cancelada + nova PAGA da mesma competencia (so o indice de competencia)
-- ----------------------------------------------------------------------------
SELECT pg_temp.pag('d_antiga', 3, 'cancelado', DATE '2025-02-10', 'Mensalidade Plano A');
SELECT pg_temp.pag('d_nova',   3, 'pago',      DATE '2025-02-10', 'Mensalidade Plano A');
INSERT INTO _s VALUES ('pos_d_nova', pg_temp.pos('d_nova'));

SELECT pg_temp.err('d_antigo', $$ SELECT pg_temp.overdue_antigo('d_antiga') $$);
SELECT is((SELECT code FROM _e WHERE k = 'd_antigo'), '23505', '5b) CONTROLE: filtro antigo -> 23505');
SELECT ok((SELECT msg LIKE '%uq_pagamentos_empresa_competencia%' FROM _e WHERE k = 'd_antigo'), '5b) CONTROLE: quem barra e o indice por competencia');

SELECT pg_temp.err('d_novo', $$ SELECT pg_temp.overdue('d_antiga') $$);
SELECT is((SELECT code FROM _e WHERE k = 'd_novo'), 'sem erro', '5b) filtro novo: sem 23505');
SELECT is(pg_temp.st('d_antiga'), 'cancelado', '5b) a antiga continua cancelada');
SELECT is(pg_temp.st('d_nova'), 'pago', '5b) a cobranca paga continua paga');
SELECT is(pg_temp.pos('d_nova'), (SELECT v FROM _s WHERE k = 'pos_d_nova'), '5b) e a paga nao foi reescrita');

-- ----------------------------------------------------------------------------
-- E. Cenario 5c: historico SEM competencia (so o indice antigo, uma mensalidade aberta por empresa)
-- ----------------------------------------------------------------------------
SELECT pg_temp.pag('e_antiga', 4, 'cancelado', NULL, 'Mensalidade Plano A');
SELECT pg_temp.pag('e_nova',   4, 'pendente',  NULL, 'Mensalidade Plano A');
INSERT INTO _s VALUES ('pos_e_nova', pg_temp.pos('e_nova'));

SELECT pg_temp.err('e_antigo', $$ SELECT pg_temp.overdue_antigo('e_antiga') $$);
SELECT is((SELECT code FROM _e WHERE k = 'e_antigo'), '23505', '5c) CONTROLE: filtro antigo -> 23505');
SELECT ok((SELECT msg LIKE '%uq_pagamentos_mensalidade_pendente%' FROM _e WHERE k = 'e_antigo'), '5c) CONTROLE: quem barra e o indice antigo por descricao');

SELECT pg_temp.err('e_novo', $$ SELECT pg_temp.overdue('e_antiga') $$);
SELECT is((SELECT code FROM _e WHERE k = 'e_novo'), 'sem erro', '5c) filtro novo: sem 23505');
SELECT is(pg_temp.st('e_antiga'), 'cancelado', '5c) a antiga continua cancelada');
SELECT is(pg_temp.st('e_nova'), 'pendente', '5c) a nova continua pendente');
SELECT is(pg_temp.pos('e_nova'), (SELECT v FROM _s WHERE k = 'pos_e_nova'), '5c) e a nova nao foi alterada');

-- ----------------------------------------------------------------------------
-- F. O OVERDUE legitimo continua funcionando com a competencia em jogo
-- ----------------------------------------------------------------------------
-- A cobranca aberta e unica da competencia vira atrasado normalmente (nao ha conflito consigo mesma).
SELECT pg_temp.pag('f_aberta', 5, 'pendente', DATE '2025-02-10', 'Mensalidade Plano A');
SELECT pg_temp.err('f_ovd', $$ SELECT pg_temp.overdue('f_aberta') $$);
SELECT is((SELECT code FROM _e WHERE k = 'f_ovd'), 'sem erro', 'a cobranca aberta da competencia vira atrasado sem erro');
SELECT is(pg_temp.st('f_aberta'), 'atrasado', 'e fica atrasada (continua ocupando a competencia)');

-- ----------------------------------------------------------------------------
-- G. Reentrega: a idempotencia do evento e o indice unico de event_id
-- ----------------------------------------------------------------------------
-- O webhook insere o evento; se o INSERT falha com 23505 le processado_em: preenchido => duplicate
-- (nada e reprocessado); nulo => evento nao concluido, reprocessa (o OVERDUE e idempotente, ver A).
INSERT INTO public.asaas_webhook_eventos (event_id, evento, payment_id, status, payload)
VALUES ('evt_ovd_1', 'PAYMENT_OVERDUE', 'pay_f_aberta', 'OVERDUE', '{}'::jsonb);
SELECT pg_temp.err('g_dup', $$
  INSERT INTO public.asaas_webhook_eventos (event_id, evento, payment_id, status, payload)
  VALUES ('evt_ovd_1', 'PAYMENT_OVERDUE', 'pay_f_aberta', 'OVERDUE', '{}'::jsonb)
$$);
SELECT is((SELECT code FROM _e WHERE k = 'g_dup'), '23505', 'reentrega do mesmo event_id: o INSERT viola a unicidade (o webhook entao le processado_em)');
SELECT is((SELECT processado_em IS NULL FROM public.asaas_webhook_eventos WHERE event_id = 'evt_ovd_1'), true, 'evento ainda nao concluido: processado_em nulo (reprocessavel)');
UPDATE public.asaas_webhook_eventos SET processado_em = now() WHERE event_id = 'evt_ovd_1';
SELECT is((SELECT processado_em IS NOT NULL FROM public.asaas_webhook_eventos WHERE event_id = 'evt_ovd_1'), true, 'evento concluido: processado_em preenchido (proxima entrega responde duplicate)');
SELECT is((SELECT count(*)::integer FROM public.asaas_webhook_eventos WHERE event_id = 'evt_ovd_1'), 1, 'um unico registro por event_id');

SELECT * FROM finish();
ROLLBACK;
