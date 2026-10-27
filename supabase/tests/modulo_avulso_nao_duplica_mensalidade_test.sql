-- Cobertura para 20261027120000_modulo_avulso_nao_duplica_mensalidade.sql.
-- Rode com `supabase test db` contra um banco que contenha todas as migrations.
--
-- Exercita o RPC REAL solicitar_contratacao_modulo() como o dono da empresa
-- (request.jwt.claim.sub) e solicitar_mensalidade(). Cobre:
--   A. modulo ja contratado (vigente e vencido) nao gera cobranca avulsa;
--   B. modulo novo gera uma cobranca; repeticao reaproveita (pendente e atrasada);
--   C. modulo cancelado pode ser contratado de novo; so o modulo ativo e barrado;
--   D. indice unico por empresa e modulo; outra empresa nao e afetada;
--   E. a mensalidade segue incluindo o modulo ativo e nao e afetada pela avulsa atrasada.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO public.planos (id, nome, valor, tipo_cobranca, ativo) VALUES
  ('d7100000-0000-4000-8000-000000000001', '__mav_plano__', 50, 'mensal', true);

INSERT INTO public.modulos (id, nome, chave, valor, ativo, aplica_restricao) VALUES
  ('d7900000-0000-4000-8000-000000000001', '__mav_fin__', '__mav_fin__', 30, true, true),
  ('d7900000-0000-4000-8000-000000000002', '__mav_rel__', '__mav_rel__', 10, true, true),
  ('d7900000-0000-4000-8000-000000000003', '__mav_exp__', '__mav_exp__', 5, true, true);

INSERT INTO public.empresas (id, owner_id, nome) VALUES
  ('d7200000-0000-4000-8000-000000000001', 'd7300000-0000-4000-8000-000000000001', '__mav_empresa_1__'),
  ('d7200000-0000-4000-8000-000000000002', 'd7300000-0000-4000-8000-000000000002', '__mav_empresa_2__');

CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;

CREATE FUNCTION pg_temp.contratar(_dono int, _modulo text) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ('d7300000-0000-4000-8000-00000000000' || _dono)::text, true);
  v_id := public.solicitar_contratacao_modulo(('d7900000-0000-4000-8000-00000000000' || _modulo)::uuid);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_id;
END
$fn$;

-- Assinatura ativa da empresa 1 (a linha de trial ja existe) e modulos ativos.
UPDATE public.empresa_assinaturas
   SET plano_id = 'd7100000-0000-4000-8000-000000000001', status = 'active',
       data_expiracao = CURRENT_DATE + 20, dia_ancora = 19
 WHERE empresa_id = 'd7200000-0000-4000-8000-000000000001';

-- fin: contratado e VENCIDO (o caso real); rel: contratado e vigente.
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, data_inicio, data_expiracao) VALUES
  ('d7200000-0000-4000-8000-000000000001', 'd7900000-0000-4000-8000-000000000001', 'ativo', CURRENT_DATE - 40, CURRENT_DATE - 2),
  ('d7200000-0000-4000-8000-000000000001', 'd7900000-0000-4000-8000-000000000002', 'ativo', CURRENT_DATE - 10, CURRENT_DATE + 20);

-- A. modulo contratado nao gera cobranca avulsa
SELECT throws_ok(
  $$ SELECT pg_temp.contratar(1, '1') $$, 'P0001', NULL,
  'A1: modulo contratado e VENCIDO (caso real) e recusado'
);
SELECT throws_ok(
  $$ SELECT pg_temp.contratar(1, '2') $$, 'P0001', NULL,
  'A2: modulo contratado e vigente e recusado'
);
SELECT is(
  (SELECT count(*)::int FROM public.pagamentos
    WHERE empresa_id = 'd7200000-0000-4000-8000-000000000001' AND referencia_tipo = 'modulo'),
  0, 'A3: nenhuma cobranca avulsa foi criada'
);
SELECT is(
  (SELECT status::text FROM public.empresa_modulos
    WHERE empresa_id = 'd7200000-0000-4000-8000-000000000001' AND modulo_id = 'd7900000-0000-4000-8000-000000000001'),
  'ativo', 'A4: o modulo contratado segue ativo, intocado'
);

-- B. modulo novo: uma cobranca, reaproveitada
INSERT INTO _ids SELECT 'novo', pg_temp.contratar(1, '3');
SELECT is(
  (SELECT valor FROM public.pagamentos WHERE id = (SELECT id FROM _ids WHERE k = 'novo')),
  5::numeric, 'B1: modulo ainda nao contratado gera a cobranca avulsa'
);
SELECT is(
  pg_temp.contratar(1, '3'), (SELECT id FROM _ids WHERE k = 'novo'),
  'B2: pedir de novo reaproveita a cobranca pendente'
);
UPDATE public.pagamentos SET status = 'atrasado' WHERE id = (SELECT id FROM _ids WHERE k = 'novo');
SELECT is(
  pg_temp.contratar(1, '3'), (SELECT id FROM _ids WHERE k = 'novo'),
  'B3: cobranca atrasada tambem e reaproveitada (nao cria segunda)'
);
SELECT is(
  (SELECT count(*)::int FROM public.pagamentos
    WHERE empresa_id = 'd7200000-0000-4000-8000-000000000001' AND modulo_id = 'd7900000-0000-4000-8000-000000000003'),
  1, 'B4: uma unica cobranca do modulo'
);

-- D. indice unico
SELECT throws_ok(
  $$ INSERT INTO public.pagamentos (empresa_id, referencia_tipo, modulo_id, descricao, valor, status)
     VALUES ('d7200000-0000-4000-8000-000000000001', 'modulo', 'd7900000-0000-4000-8000-000000000003', 'dup', 5, 'pendente') $$,
  '23505', NULL, 'D1: o indice impede segunda cobranca avulsa aberta do mesmo modulo'
);
SELECT lives_ok(
  $$ SELECT pg_temp.contratar(2, '3') $$,
  'D2: outra empresa contrata o mesmo modulo normalmente'
);

-- C. cancelada libera nova contratacao
UPDATE public.pagamentos SET status = 'cancelado' WHERE id = (SELECT id FROM _ids WHERE k = 'novo');
UPDATE public.empresa_modulos SET status = 'cancelado'
 WHERE empresa_id = 'd7200000-0000-4000-8000-000000000001' AND modulo_id = 'd7900000-0000-4000-8000-000000000003';
SELECT isnt(
  pg_temp.contratar(1, '3'), (SELECT id FROM _ids WHERE k = 'novo'),
  'C1: modulo cancelado pode ser contratado de novo (nova cobranca)'
);

-- E. a mensalidade inclui os modulos ativos (fin vencido + rel) e ignora a avulsa
CREATE FUNCTION pg_temp.mensalidade() RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'd7300000-0000-4000-8000-000000000001', true);
  v_id := public.solicitar_mensalidade();
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_id;
END
$fn$;
INSERT INTO _ids SELECT 'mens', pg_temp.mensalidade();
SELECT is(
  (SELECT count(*)::int FROM public.pagamento_itens
    WHERE pagamento_id = (SELECT id FROM _ids WHERE k = 'mens') AND tipo = 'modulo'
      AND modulo_id IN ('d7900000-0000-4000-8000-000000000001', 'd7900000-0000-4000-8000-000000000002')),
  2, 'E1: a mensalidade cobra os dois modulos ativos (incluindo o vencido)'
);
SELECT is(
  (SELECT valor FROM public.pagamentos WHERE id = (SELECT id FROM _ids WHERE k = 'mens')),
  90::numeric, 'E2: mensalidade = plano 50 + fin 30 + rel 10'
);

SELECT * FROM finish();
ROLLBACK;
