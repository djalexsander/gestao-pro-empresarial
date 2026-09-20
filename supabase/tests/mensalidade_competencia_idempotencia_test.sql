-- Cobertura para 20260918160000_mensalidade_competencia_idempotencia.sql.
-- Rode com `supabase test db` contra um banco que contenha todas as migrations.
--
-- Exercita os RPCs REAIS solicitar_mensalidade() (como o dono da empresa, via
-- request.jwt.claim.sub) e confirmar_pagamento_asaas() (como a Edge Function),
-- alem do indice unico e do backfill. Cobre:
--   A. competencia derivada da assinatura (mesma mensalidade pedida duas vezes,
--      cobranca aberta reutilizada, estabilidade, trial, sem vencimento);
--   B. protecao de unicidade no banco (indice, cancelada, empresas diferentes,
--      linhas redundantes, CHECK);
--   C. confirmacao: competencia paga nao recriada, dois pagamentos distintos da
--      mesma competencia, reentrega, plano divergente (sem reiniciar o ciclo),
--      troca de plano sem competencia preservada, cadeia sem deriva;
--   D. mensal atrasada (nao acumula competencias);
--   E. anual: primeira ativacao, renovacao antecipada preservando dias, atrasada;
--   F. idempotencia (reentregas, empresas independentes, locks por empresa);
--   G. historico antigo sem competencia (nao quebra) e backfill;
--   H. ACL e definicoes; modulos da mensalidade intactos.
--
-- Datas de pagamento FIXAS NO PASSADO: o RPC nunca aceita pagamento no futuro
-- (limita a hoje em Sao Paulo). A concorrencia real (duas conexoes) nao cabe em
-- pgTAP: aqui ficam o indice unico (barreira final) e as chaves de lock.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. Fixtures e auxiliares
-- ----------------------------------------------------------------------------
INSERT INTO public.planos (id, nome, valor, tipo_cobranca, ativo) VALUES
  ('d6100000-0000-4000-8000-000000000001', '__comp_mensal_a__', 100,  'mensal', true),
  ('d6100000-0000-4000-8000-000000000002', '__comp_mensal_b__', 200,  'mensal', true),
  ('d6100000-0000-4000-8000-000000000003', '__comp_anual__',    1000, 'anual',  true);

INSERT INTO public.modulos (id, nome, chave, valor, ativo, aplica_restricao) VALUES
  ('d6900000-0000-4000-8000-000000000001', '__comp_modulo__', '__comp_modulo__', 30, true, false);

-- 60 empresas isoladas (cada INSERT dispara o trial, como no cadastro real).
INSERT INTO public.empresas (id, owner_id, nome)
SELECT
  ('d6200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('d6300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '__comp_empresa_' || lpad(n::text, 2, '0') || '__'
FROM generate_series(1, 60) AS n;

CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _j (k text, n integer, j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _e (k text PRIMARY KEY, code text, msg text) ON COMMIT DROP;
CREATE TEMP TABLE _s (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.emp(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d6200000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

CREATE FUNCTION pg_temp.dono(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d6300000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

CREATE FUNCTION pg_temp.pl(_k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (CASE _k
    WHEN 'A'     THEN 'd6100000-0000-4000-8000-000000000001'
    WHEN 'B'     THEN 'd6100000-0000-4000-8000-000000000002'
    WHEN 'ANUAL' THEN 'd6100000-0000-4000-8000-000000000003'
  END)::uuid
$fn$;

-- Estado da assinatura da empresa (a linha de trial ja existe).
CREATE FUNCTION pg_temp.assina(_n integer, _plano text, _status text, _exp date, _ancora integer)
RETURNS void LANGUAGE sql AS $fn$
  UPDATE public.empresa_assinaturas
     SET plano_id = pg_temp.pl(_plano),
         status = _status::public.assinatura_status,
         data_expiracao = _exp,
         dia_ancora = _ancora
   WHERE empresa_id = pg_temp.emp(_n)
$fn$;

-- solicitar_mensalidade() como o dono da empresa.
CREATE FUNCTION pg_temp.sol(_n integer) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.dono(_n)::text, true);
  v_id := public.solicitar_mensalidade();
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_id;
END
$fn$;

-- Pede a mensalidade e registra o id sob a chave _k.
CREATE FUNCTION pg_temp.novo(_k text, _n integer) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  v_id := pg_temp.sol(_n);
  INSERT INTO _ids VALUES (_k, v_id);
  RETURN v_id;
END
$fn$;

-- Cobranca criada "a mao" (historico, cancelada, lancamento direto), com item de plano.
CREATE FUNCTION pg_temp.cobr(_k text, _n integer, _plano text, _status text, _comp date, _desc text DEFAULT 'Mensalidade Plano teste')
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia)
  VALUES (pg_temp.emp(_n), 'outro', _desc, 100, _status::public.pagamento_status, _comp)
  RETURNING id INTO v_id;
  INSERT INTO public.pagamento_itens (pagamento_id, tipo, plano_id, descricao, valor)
  VALUES (v_id, 'plano', pg_temp.pl(_plano), 'Plano teste', 100);
  INSERT INTO _ids VALUES (_k, v_id);
  RETURN v_id;
END
$fn$;

-- confirmar_pagamento_asaas() sobre o pagamento _k; guarda a resposta (k, n).
CREATE FUNCTION pg_temp.conf(_k text, _data date) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_j jsonb; v_n integer;
BEGIN
  v_j := public.confirmar_pagamento_asaas((SELECT id FROM _ids WHERE k = _k), _data, 'PIX');
  SELECT COALESCE(max(n), 0) + 1 INTO v_n FROM _j WHERE k = _k;
  INSERT INTO _j VALUES (_k, v_n, v_j);
  RETURN v_j;
END
$fn$;

CREATE FUNCTION pg_temp.j(_k text, _n integer, _campo text) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT j ->> _campo FROM _j WHERE k = _k AND n = _n
$fn$;

CREATE FUNCTION pg_temp.pid(_k text) RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT id FROM _ids WHERE k = _k
$fn$;

-- Resumo do estado da assinatura e "foto" fisica (ctid) para provar que nao foi reescrita.
CREATE FUNCTION pg_temp.st(_n integer) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT 'exp=' || COALESCE(a.data_expiracao::text, 'NULL') || ' ancora=' || COALESCE(a.dia_ancora::text, 'NULL')
    FROM public.empresa_assinaturas AS a WHERE a.empresa_id = pg_temp.emp(_n)
$fn$;

CREATE FUNCTION pg_temp.snap(_n integer) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT a.ctid::text || '|' || COALESCE(a.plano_id::text, '-') || '|' || a.status::text || '|'
      || COALESCE(a.data_expiracao::text, '-') || '|' || COALESCE(a.dia_ancora::text, '-') || '|' || a.data_inicio::text
    FROM public.empresa_assinaturas AS a WHERE a.empresa_id = pg_temp.emp(_n)
$fn$;

-- Executa um comando que DEVE falhar e guarda SQLSTATE + mensagem.
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

CREATE FUNCTION pg_temp.tem_lock(_chave text) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM pg_locks AS l,
           (SELECT hashtextextended(_chave, 0) AS k) AS s
     WHERE l.locktype = 'advisory'
       AND l.granted
       AND l.objsubid = 1
       AND l.classid::bigint = ((s.k >> 32) & 4294967295)
       AND l.objid::bigint = (s.k & 4294967295)
  )
$fn$;

CREATE FUNCTION pg_temp.validas(_n integer, _comp date) RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::integer FROM public.pagamentos
   WHERE empresa_id = pg_temp.emp(_n) AND competencia = _comp
     AND competencia_duplicada_de IS NULL AND status IN ('pendente', 'atrasado', 'pago')
$fn$;

CREATE FUNCTION pg_temp.qtd(_n integer) RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::integer FROM public.pagamentos WHERE empresa_id = pg_temp.emp(_n)
$fn$;

-- ----------------------------------------------------------------------------
-- A. solicitar_mensalidade(): competencia derivada da assinatura
-- ----------------------------------------------------------------------------
-- A1/A2/A3/A4 (empresa 1): assinatura ativa, ancora 10, vence 10/fev/2025.
SELECT pg_temp.assina(1, 'A', 'active', DATE '2025-02-10', 10);
INSERT INTO _s VALUES ('A1_antes', pg_temp.snap(1));
SELECT pg_temp.novo('A1', 1);

SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A1')), DATE '2025-02-10',
  'A1: competencia = vencimento que esta sendo renovado (data_expiracao da assinatura)');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 'pendente', 'A1: a cobranca nasce pendente');
SELECT is((SELECT referencia_tipo::text FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 'outro', 'A1: mensalidade continua com referencia_tipo = outro');
SELECT ok((SELECT descricao LIKE 'Mensalidade Plano %' FROM public.pagamentos WHERE id = pg_temp.pid('A1')),
  'A1: a descricao continua "Mensalidade Plano ..." (o frontend depende desse texto)');
SELECT is((SELECT valor::numeric FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 100.00::numeric, 'A1: valor = preco do plano');
SELECT is((SELECT count(*)::integer FROM public.pagamento_itens WHERE pagamento_id = pg_temp.pid('A1') AND tipo = 'plano'), 1,
  'A1: um item de plano');
SELECT is(pg_temp.snap(1), (SELECT v FROM _s WHERE k = 'A1_antes'),
  'A1: solicitar a mensalidade NAO altera a assinatura (vencimento, ancora, plano, status, data_inicio e a mesma linha): nao reinicia ciclo');

-- A2: a mesma mensalidade solicitada duas vezes devolve a MESMA cobranca.
INSERT INTO _ids VALUES ('A2', pg_temp.sol(1));
SELECT is(pg_temp.pid('A2'), pg_temp.pid('A1'), 'A2: segunda solicitacao devolve a mesma cobranca');
INSERT INTO _ids VALUES ('A2b', pg_temp.sol(1));
SELECT is(pg_temp.pid('A2b'), pg_temp.pid('A1'), 'A2: terceira solicitacao tambem');
SELECT is(pg_temp.qtd(1), 1, 'A2: existe exatamente uma cobranca para a empresa');
SELECT is(pg_temp.validas(1, DATE '2025-02-10'), 1, 'A2: exatamente uma cobranca valida para a competencia');
SELECT is((SELECT count(*)::integer FROM public.pagamento_itens WHERE pagamento_id = pg_temp.pid('A1')), 1,
  'A2: a reutilizacao nao duplica os itens');

-- A3: cobranca aberta REUTILIZADA mesmo com Pix ja gerado e mesmo atrasada.
UPDATE public.pagamentos
   SET asaas_payment_id = 'pay_comp_a1', asaas_pix_qrcode = 'qr', asaas_pix_copia_cola = 'copia'
 WHERE id = pg_temp.pid('A1');
INSERT INTO _ids VALUES ('A3', pg_temp.sol(1));
SELECT is(pg_temp.pid('A3'), pg_temp.pid('A1'), 'A3: cobranca aberta com Pix gerado e reutilizada (nao cria outra)');
UPDATE public.pagamentos SET status = 'atrasado' WHERE id = pg_temp.pid('A1');
INSERT INTO _ids VALUES ('A3b', pg_temp.sol(1));
SELECT is(pg_temp.pid('A3b'), pg_temp.pid('A1'), 'A3: cobranca ATRASADA continua sendo a cobranca aberta da competencia');
SELECT is(pg_temp.qtd(1), 1, 'A3: continua uma unica cobranca');

-- A4: a competencia de uma cobranca aberta fica ESTAVEL, mesmo que o vencimento mude.
UPDATE public.pagamentos SET status = 'pendente' WHERE id = pg_temp.pid('A1');
UPDATE public.empresa_assinaturas SET data_expiracao = DATE '2025-03-10' WHERE empresa_id = pg_temp.emp(1);
INSERT INTO _ids VALUES ('A4', pg_temp.sol(1));
SELECT is(pg_temp.pid('A4'), pg_temp.pid('A1'), 'A4: vencimento alterado com cobranca aberta: a mesma cobranca continua sendo devolvida');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A1')), DATE '2025-02-10',
  'A4: a competencia gravada nunca e recalculada enquanto a cobranca esta aberta');
SELECT is(pg_temp.qtd(1), 1, 'A4: nenhuma cobranca nova foi criada');

-- A5: assinatura em trial: a competencia e o fim do trial (vencimento renovado).
SELECT pg_temp.assina(2, 'A', 'trial', DATE '2025-01-25', NULL);
SELECT pg_temp.novo('A5', 2);
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A5')), DATE '2025-01-25',
  'A5: trial: competencia = data de fim do trial');

-- A6: assinatura sem vencimento: sem competencia (comportamento anterior), ainda idempotente.
SELECT pg_temp.assina(3, 'A', 'active', NULL, NULL);
SELECT pg_temp.novo('A6', 3);
INSERT INTO _ids VALUES ('A6b', pg_temp.sol(3));
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A6')), NULL::date,
  'A6: sem vencimento nao ha competencia a derivar (NULL, como o historico)');
SELECT is(pg_temp.pid('A6b'), pg_temp.pid('A6'), 'A6: sem competencia a reutilizacao da cobranca aberta continua funcionando');
SELECT is(pg_temp.qtd(3), 1, 'A6: uma unica cobranca');

-- A7: mensalidade com modulo ativo: composicao intacta.
SELECT pg_temp.assina(4, 'A', 'active', DATE '2025-02-10', 10);
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, data_expiracao)
VALUES (pg_temp.emp(4), 'd6900000-0000-4000-8000-000000000001', 'ativo', DATE '2025-02-10');
SELECT pg_temp.novo('A7', 4);
SELECT is((SELECT valor::numeric FROM public.pagamentos WHERE id = pg_temp.pid('A7')), 130.00::numeric, 'A7: valor = plano (100) + modulo ativo (30)');
SELECT is((SELECT count(*)::integer FROM public.pagamento_itens WHERE pagamento_id = pg_temp.pid('A7')), 2, 'A7: itens = plano + modulo');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A7')), DATE '2025-02-10', 'A7: competencia = vencimento do plano');

-- A8: sem autenticacao.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.err('A8', $$ SELECT public.solicitar_mensalidade() $$);
SELECT is((SELECT code FROM _e WHERE k = 'A8'), 'P0001', 'A8: sem usuario autenticado a RPC recusa');
SELECT ok((SELECT msg LIKE '%autenticado%' FROM _e WHERE k = 'A8'), 'A8: mensagem de nao autenticado inalterada');

-- ----------------------------------------------------------------------------
-- B. Protecao de unicidade no banco
-- ----------------------------------------------------------------------------
-- Empresa 5: cobranca aberta da competencia 10/abr/2025.
SELECT pg_temp.assina(5, 'A', 'active', DATE '2025-04-10', 10);
SELECT pg_temp.novo('B0', 5);

-- B1: um segundo pagamento VALIDO da mesma competencia e barrado pelo indice,
-- mesmo inserido direto (sem passar pelo RPC) e sem "Mensalidade" na descricao.
SELECT pg_temp.err('B1', $$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia)
  VALUES ('d6200000-0000-4000-8000-000000000005', 'plano', 'insercao direta', 1, 'pendente', DATE '2025-04-10')
$$);
SELECT is((SELECT code FROM _e WHERE k = 'B1'), '23505', 'B1: segundo pagamento valido da mesma empresa+competencia viola a unicidade');
SELECT ok((SELECT msg LIKE '%uq_pagamentos_empresa_competencia%' FROM _e WHERE k = 'B1'),
  'B1: quem barra e o indice por competencia (nao depende de descricao)');

-- B2: cobranca CANCELADA nao bloqueia nova cobranca da mesma competencia.
UPDATE public.pagamentos SET status = 'cancelado' WHERE id = pg_temp.pid('B0');
SELECT pg_temp.novo('B2', 5);
SELECT isnt(pg_temp.pid('B2'), pg_temp.pid('B0'), 'B2: cancelada libera: a nova cobranca e outro pagamento');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('B2')), DATE '2025-04-10', 'B2: nova cobranca da MESMA competencia');
SELECT is(pg_temp.validas(5, DATE '2025-04-10'), 1, 'B2: continua exatamente uma cobranca valida na competencia');
SELECT is(pg_temp.qtd(5), 2, 'B2: a cancelada permanece no historico');

-- B2b: reabrir a cancelada com outra valida no lugar e barrado (o indice protege tambem o UPDATE).
SELECT pg_temp.err('B2b', $$ UPDATE public.pagamentos SET status = 'atrasado' WHERE id = '$$ || pg_temp.pid('B0')::text || $$' $$);
SELECT is((SELECT code FROM _e WHERE k = 'B2b'), '23505', 'B2b: reabrir cobranca cancelada cuja competencia ja tem cobranca valida viola a unicidade');

-- B3: cobranca PAGA tambem ocupa a competencia.
UPDATE public.pagamentos SET status = 'pago' WHERE id = pg_temp.pid('B2');
SELECT pg_temp.err('B3', $$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia)
  VALUES ('d6200000-0000-4000-8000-000000000005', 'plano', 'apos paga', 1, 'pendente', DATE '2025-04-10')
$$);
SELECT is((SELECT code FROM _e WHERE k = 'B3'), '23505', 'B3: competencia paga bloqueia nova cobranca');

-- B4: empresas DIFERENTES na mesma competencia.
SELECT pg_temp.assina(6, 'A', 'active', DATE '2025-04-10', 10);
SELECT pg_temp.assina(7, 'A', 'active', DATE '2025-04-10', 10);
SELECT pg_temp.novo('B4a', 6);
SELECT pg_temp.novo('B4b', 7);
SELECT isnt(pg_temp.pid('B4a'), pg_temp.pid('B4b'), 'B4: empresas diferentes com o mesmo vencimento tem cobrancas proprias');
SELECT is(
  (SELECT count(*)::integer FROM public.pagamentos WHERE competencia = DATE '2025-04-10' AND empresa_id IN (pg_temp.emp(6), pg_temp.emp(7))),
  2, 'B4: a unicidade e por empresa: 2 empresas, mesma competencia, 2 cobrancas validas');

-- B5: pagamentos SEM competencia nao sao limitados pelo indice novo.
SELECT lives_ok($$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status) VALUES
    ('d6200000-0000-4000-8000-000000000005', 'plano', 'sem competencia 1', 1, 'pendente'),
    ('d6200000-0000-4000-8000-000000000005', 'plano', 'sem competencia 2', 1, 'pendente')
$$, 'B5: varios pagamentos sem competencia na mesma empresa (carrinho, contratacao, historico) seguem livres');

-- B6: linhas redundantes (competencia_duplicada_de) ficam fora do indice.
SELECT lives_ok(format($$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia, competencia_duplicada_de) VALUES
    ('d6200000-0000-4000-8000-000000000005', 'outro', 'redundante paga', 1, 'pago', DATE '2025-04-10', %L),
    ('d6200000-0000-4000-8000-000000000005', 'outro', 'redundante cancelada', 1, 'cancelado', DATE '2025-04-10', %L)
$$, pg_temp.pid('B2'), pg_temp.pid('B2')), 'B6: pagamentos redundantes (duplicidade) nao entram na unicidade');

-- B7: CHECK: marcar redundancia exige competencia e nao pode apontar para si mesmo.
SELECT pg_temp.err('B7a', format($$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia_duplicada_de)
  VALUES ('d6200000-0000-4000-8000-000000000005', 'outro', 'sem competencia', 1, 'pago', %L)
$$, pg_temp.pid('B2')));
SELECT is((SELECT code FROM _e WHERE k = 'B7a'), '23514', 'B7: redundancia sem competencia e recusada (CHECK)');
SELECT pg_temp.err('B7b', $$
  INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, descricao, valor, status, competencia, competencia_duplicada_de)
  VALUES ('d6400000-0000-4000-8000-0000000000aa', 'd6200000-0000-4000-8000-000000000005', 'outro', 'auto', 1, 'pago', DATE '2025-04-10', 'd6400000-0000-4000-8000-0000000000aa')
$$);
SELECT is((SELECT code FROM _e WHERE k = 'B7b'), '23514', 'B7: um pagamento nao pode ser redundante de si mesmo (CHECK)');

-- B8: definicao do indice.
SELECT ok((SELECT indisunique FROM pg_index WHERE indexrelid = 'public.uq_pagamentos_empresa_competencia'::regclass), 'B8: uq_pagamentos_empresa_competencia e unico');
SELECT ok(
  (SELECT position('competencia IS NOT NULL' IN pg_get_indexdef(indexrelid)) > 0
      AND position('competencia_duplicada_de IS NULL' IN pg_get_indexdef(indexrelid)) > 0
      AND position('cancelado' IN pg_get_indexdef(indexrelid)) = 0
      AND position('descricao' IN pg_get_indexdef(indexrelid)) = 0
     FROM pg_index WHERE indexrelid = 'public.uq_pagamentos_empresa_competencia'::regclass),
  'B8: parcial (competencia informada, nao redundante, so status validos) e sem depender de descricao');
SELECT ok(
  (SELECT pg_get_indexdef(indexrelid) LIKE '%(empresa_id, competencia)%'
     FROM pg_index WHERE indexrelid = 'public.uq_pagamentos_empresa_competencia'::regclass),
  'B8: chave (empresa_id, competencia)');
SELECT ok(to_regclass('public.uq_pagamentos_mensalidade_pendente') IS NOT NULL,
  'B8: o indice antigo (uma mensalidade aberta por empresa) foi mantido como rede de seguranca do historico');

-- ----------------------------------------------------------------------------
-- C. Confirmacao: competencia paga, pagamentos distintos, reentrega, plano divergente
-- ----------------------------------------------------------------------------
-- C1 (empresa 8): renovacao ANTECIPADA de uma mensalidade com competencia.
SELECT pg_temp.assina(8, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C1', 8);
SELECT pg_temp.conf('C1', DATE '2025-02-01');
SELECT is(pg_temp.j('C1', 1, 'ciclo'), 'renovacao', 'C1: mensalidade do mesmo plano e RENOVACAO (nao reinicia o ciclo)');
SELECT is(pg_temp.j('C1', 1, 'competencia'), '2025-02-10', 'C1: a resposta informa a competencia quitada');
SELECT is(pg_temp.st(8), 'exp=2025-03-10 ancora=10', 'C1: vence 10/mar (GREATEST(10/fev, 01/fev) -> proximo mes pela ancora 10); ancora intacta');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid('C1')), 'pago', 'C1: pagamento pago');
SELECT is((SELECT competencia_duplicada_de FROM public.pagamentos WHERE id = pg_temp.pid('C1')), NULL::uuid, 'C1: o pagamento que quita a competencia NAO e redundante');

-- C1b: pagamento confirmado libera a PROXIMA competencia (o novo vencimento), nunca a mesma.
SELECT pg_temp.novo('C1b', 8);
SELECT isnt(pg_temp.pid('C1b'), pg_temp.pid('C1'), 'C1b: depois de paga, a solicitacao gera a cobranca da PROXIMA competencia');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C1b')), DATE '2025-03-10', 'C1b: nova competencia = novo vencimento (10/mar)');
SELECT is(pg_temp.qtd(8), 2, 'C1b: duas cobrancas, uma por competencia');

-- C2: competencia PAGA nao e recriada, mesmo com o vencimento voltando (ajuste manual).
UPDATE public.empresa_assinaturas SET data_expiracao = DATE '2025-02-10' WHERE empresa_id = pg_temp.emp(8);
SELECT pg_temp.err('C2', $$ SELECT pg_temp.sol(8) $$);
SELECT is((SELECT code FROM _e WHERE k = 'C2'), 'P0001', 'C2: competencia ja paga: a RPC recusa criar outra cobranca');
SELECT ok((SELECT msg LIKE '%consta como paga%' FROM _e WHERE k = 'C2'), 'C2: mensagem clara para o usuario');
SELECT ok((SELECT msg LIKE '%10/02/2025%' FROM _e WHERE k = 'C2'), 'C2: a mensagem informa a competencia (10/02/2025)');
SELECT is(pg_temp.qtd(8), 2, 'C2: nenhuma cobranca nova foi criada');
SELECT set_config('request.jwt.claim.sub', '', true);

-- C3 (empresa 9): dois payment_ids DISTINTOS da MESMA competencia.
SELECT pg_temp.assina(9, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C3a', 9);
UPDATE public.pagamentos SET status = 'cancelado' WHERE id = pg_temp.pid('C3a');
SELECT pg_temp.novo('C3b', 9);
SELECT isnt(pg_temp.pid('C3b'), pg_temp.pid('C3a'), 'C3: cobranca cancelada permite NOVA cobranca da mesma competencia (outro payment_id)');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), DATE '2025-02-10', 'C3: mesma competencia nas duas');

-- A primeira a ser CONFIRMADA (a cancelada, que o cliente pagou no Asaas) quita a competencia...
SELECT pg_temp.conf('C3a', DATE '2025-02-05');
SELECT is(pg_temp.j('C3a', 1, 'ciclo'), 'renovacao', 'C3: a primeira confirmacao da competencia e aplicada (renovacao)');
SELECT is(pg_temp.st(9), 'exp=2025-03-10 ancora=10', 'C3: vencimento avancou UMA vez: 10/mar');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), 'cancelado',
  'C3: a cobranca aberta da mesma competencia passa a redundante (cancelada automaticamente)');
SELECT is((SELECT competencia_duplicada_de FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), pg_temp.pid('C3a'),
  'C3: e aponta o pagamento que quitou a competencia');
SELECT ok((SELECT observacoes LIKE '%Cancelada automaticamente%' FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), 'C3: com observacao explicando');

-- ...e a segunda (a que estava aberta e depois foi paga) e registrada em DUPLICIDADE.
INSERT INTO _s VALUES ('C3_antes', pg_temp.snap(9));
SELECT pg_temp.conf('C3b', DATE '2025-02-06');
SELECT is(pg_temp.j('C3b', 1, 'duplicada'), 'true', 'C3: segundo pagamento da mesma competencia: resposta duplicada = true');
SELECT is(pg_temp.j('C3b', 1, 'assinatura_alterada'), 'false', 'C3: resposta assinatura_alterada = false');
SELECT is(pg_temp.j('C3b', 1, 'ok'), 'true', 'C3: ok = true (o webhook nao falha nem reentrega em loop)');
SELECT is(pg_temp.j('C3b', 1, 'pagamento_original_id'), pg_temp.pid('C3a')::text, 'C3: aponta o pagamento original');
SELECT is(pg_temp.snap(9), (SELECT v FROM _s WHERE k = 'C3_antes'),
  'C3: a assinatura NAO foi alterada pelo pagamento duplicado (mesma linha, mesmo vencimento, ancora e plano)');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), 'pago', 'C3: o dinheiro recebido e registrado: status pago');
SELECT is((SELECT data_pagamento FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), DATE '2025-02-06', 'C3: data do pagamento duplicado registrada');
SELECT is((SELECT forma_pagamento FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), 'PIX', 'C3: forma de pagamento registrada');
SELECT is((SELECT competencia_duplicada_de FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), pg_temp.pid('C3a'), 'C3: marcado como redundante do original');
SELECT ok((SELECT observacoes LIKE '%duplicidade%' AND observacoes LIKE '%requer estorno%' FROM public.pagamentos WHERE id = pg_temp.pid('C3b')),
  'C3: observacao clara (duplicidade, requer estorno ou credito manual)');
SELECT is(pg_temp.validas(9, DATE '2025-02-10'), 1, 'C3: a competencia continua com UM unico pagamento valido');

-- C3 reentregas: o mesmo payment_id nunca reprocessa, inclusive o duplicado.
SELECT pg_temp.conf('C3b', DATE '2025-02-07');
SELECT is(pg_temp.j('C3b', 2, 'ja_processado'), 'true', 'C3: reentrega do pagamento duplicado: ja_processado');
SELECT is(pg_temp.j('C3b', 2, 'duplicada'), 'true', 'C3: e continua identificado como duplicado');
SELECT pg_temp.conf('C3a', DATE '2025-02-08');
SELECT is(pg_temp.j('C3a', 2, 'ja_processado'), 'true', 'C3: reentrega do pagamento original: ja_processado');
SELECT is(pg_temp.snap(9), (SELECT v FROM _s WHERE k = 'C3_antes'), 'C3: as reentregas nao reescreveram a assinatura');
SELECT is((SELECT data_pagamento FROM public.pagamentos WHERE id = pg_temp.pid('C3b')), DATE '2025-02-06', 'C3: reentrega nao regrava a data do duplicado');

-- A proxima competencia continua disponivel.
SELECT pg_temp.novo('C3c', 9);
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C3c')), DATE '2025-03-10', 'C3: a competencia seguinte (10/mar) pode ser cobrada normalmente');

-- C4 (empresa 10): ordem inversa. A original e paga primeiro; uma cobranca ja
-- cancelada da mesma competencia e paga depois no Asaas.
SELECT pg_temp.assina(10, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C4a', 10);
SELECT pg_temp.conf('C4a', DATE '2025-02-10');
SELECT is(pg_temp.st(10), 'exp=2025-03-10 ancora=10', 'C4: original paga: 10/mar');
SELECT pg_temp.cobr('C4b', 10, 'A', 'cancelado', DATE '2025-02-10');
INSERT INTO _s VALUES ('C4_antes', pg_temp.snap(10));
SELECT pg_temp.conf('C4b', DATE '2025-02-12');
SELECT is(pg_temp.j('C4b', 1, 'duplicada'), 'true', 'C4: pagamento de cobranca cancelada de competencia ja paga: duplicidade');
SELECT is(pg_temp.snap(10), (SELECT v FROM _s WHERE k = 'C4_antes'), 'C4: a assinatura nao avanca duas vezes (continua 10/mar)');
SELECT is((SELECT competencia_duplicada_de FROM public.pagamentos WHERE id = pg_temp.pid('C4b')), pg_temp.pid('C4a'), 'C4: aponta a original');

-- C5 (empresa 11): cobranca cancelada de competencia LIVRE e confirmada como antes.
SELECT pg_temp.assina(11, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C5', 11);
UPDATE public.pagamentos SET status = 'cancelado' WHERE id = pg_temp.pid('C5');
SELECT pg_temp.conf('C5', DATE '2025-02-10');
SELECT is(pg_temp.j('C5', 1, 'ciclo'), 'renovacao', 'C5: cancelada sem outra cobranca na competencia: confirma e renova (comportamento anterior preservado)');
SELECT is(pg_temp.st(11), 'exp=2025-03-10 ancora=10', 'C5: avancou uma vez');

-- C6: plano DIVERGENTE (troca de plano depois da cobranca gerada): nao reinicia o ciclo.
SELECT pg_temp.assina(13, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C6', 13);
UPDATE public.empresa_assinaturas SET plano_id = pg_temp.pl('B') WHERE empresa_id = pg_temp.emp(13);
INSERT INTO _s VALUES ('C6_antes', pg_temp.snap(13));
SELECT pg_temp.conf('C6', DATE '2025-02-05');
SELECT is(pg_temp.j('C6', 1, 'aplicado'), 'false', 'C6: cobranca do plano antigo nao e aplicada');
SELECT is(pg_temp.j('C6', 1, 'motivo'), 'plano_divergente', 'C6: motivo registrado');
SELECT is(pg_temp.j('C6', 1, 'assinatura_alterada'), 'false', 'C6: assinatura_alterada = false');
SELECT is(pg_temp.snap(13), (SELECT v FROM _s WHERE k = 'C6_antes'),
  'C6: a assinatura (plano B, vencimento, ancora) permanece exatamente como estava: nao troca o plano nem reinicia o ciclo');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid('C6')), 'pago', 'C6: o recebimento fica registrado (pago)');
SELECT ok((SELECT observacoes LIKE '%aplicado%' AND observacoes LIKE '%manual%' FROM public.pagamentos WHERE id = pg_temp.pid('C6')),
  'C6: observacao clara para conferencia manual');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C6')), NULL::date,
  'C6: o pagamento NAO aplicado nao ocupa a competencia (fica so na observacao)');
SELECT ok((SELECT observacoes LIKE '%10/02/2025%' FROM public.pagamentos WHERE id = pg_temp.pid('C6')),
  'C6: a competencia original continua legivel na observacao');
-- a cobranca correta (plano atual, B) da mesma competencia pode ser gerada e paga
SELECT pg_temp.novo('C6b', 13);
SELECT isnt(pg_temp.pid('C6b'), pg_temp.pid('C6'), 'C6: a competencia ficou livre: nova cobranca (plano atual)');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C6b')), DATE '2025-02-10', 'C6: nova cobranca da mesma competencia');
SELECT is((SELECT plano_id FROM public.pagamento_itens WHERE pagamento_id = pg_temp.pid('C6b') AND tipo = 'plano'), pg_temp.pl('B'),
  'C6: a nova cobranca e do plano atual (B)');
SELECT pg_temp.conf('C6b', DATE '2025-02-08');
SELECT is(pg_temp.j('C6b', 1, 'ciclo'), 'renovacao', 'C6: a cobranca correta renova normalmente (plano B, ancora preservada)');
SELECT is(pg_temp.st(13), 'exp=2025-03-10 ancora=10', 'C6: 10/mar, ancora 10 (uma unica renovacao)');

-- C6c (empresa 41): pagamento de plano antigo, JA CANCELADO, pago depois que a
-- cobranca do plano novo (mesma competencia) foi gerada: nao pode violar o
-- indice nem quebrar o webhook; a cobranca aberta correta continua valida.
SELECT pg_temp.assina(41, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C6c_velha', 41);
UPDATE public.pagamentos SET status = 'cancelado' WHERE id = pg_temp.pid('C6c_velha');
UPDATE public.empresa_assinaturas SET plano_id = pg_temp.pl('B') WHERE empresa_id = pg_temp.emp(41);
SELECT pg_temp.novo('C6c_nova', 41);
INSERT INTO _s VALUES ('C6c_antes', pg_temp.snap(41));
SELECT pg_temp.conf('C6c_velha', DATE '2025-02-05');
SELECT is(pg_temp.j('C6c_velha', 1, 'motivo'), 'plano_divergente', 'C6c: o pagamento do plano antigo e registrado sem aplicar (e sem erro de unicidade)');
SELECT is(pg_temp.snap(41), (SELECT v FROM _s WHERE k = 'C6c_antes'), 'C6c: a assinatura nao mudou');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid('C6c_nova')), 'pendente', 'C6c: a cobranca aberta do plano atual continua valida');
SELECT pg_temp.conf('C6c_nova', DATE '2025-02-08');
SELECT is(pg_temp.st(41), 'exp=2025-03-10 ancora=10', 'C6c: e quando paga renova uma unica vez (10/mar)');
SELECT is(pg_temp.validas(41, DATE '2025-02-10'), 1, 'C6c: um unico pagamento valido na competencia');

-- C7: troca de plano SEM competencia continua como antes (nao implementada aqui) e
-- a mensalidade antiga que ficou aberta depois nao a desfaz.
SELECT pg_temp.assina(14, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C7a', 14);
SELECT set_config('request.jwt.claim.sub', pg_temp.dono(14)::text, true);
INSERT INTO _ids VALUES ('C7b', public.solicitar_contratacao_plano(pg_temp.pl('B')));
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C7b')), NULL::date, 'C7: a contratacao/troca de plano nao tem competencia');
SELECT pg_temp.conf('C7b', DATE '2025-02-20');
SELECT is(pg_temp.j('C7b', 1, 'ciclo'), 'troca_de_plano', 'C7: troca de plano continua reiniciando o ciclo como antes (nao implementada nesta etapa)');
SELECT is(pg_temp.st(14), 'exp=2025-03-20 ancora=20', 'C7: nova ancora = dia do pagamento (comportamento anterior)');
INSERT INTO _s VALUES ('C7_antes', pg_temp.snap(14));
SELECT pg_temp.conf('C7a', DATE '2025-02-25');
SELECT is(pg_temp.j('C7a', 1, 'motivo'), 'plano_divergente', 'C7: a mensalidade antiga (plano A) nao e aplicada depois da troca');
SELECT is(pg_temp.snap(14), (SELECT v FROM _s WHERE k = 'C7_antes'), 'C7: ela nao desfaz a troca de plano nem reinicia o ciclo de novo');

-- C8: cadeia com ancora 31 pedindo e pagando cada mensalidade: a competencia
-- acompanha o vencimento, sem deriva e sem repetir.
SELECT pg_temp.assina(15, 'A', 'active', DATE '2025-01-31', 31);
SELECT pg_temp.novo('C8a', 15);
SELECT pg_temp.conf('C8a', DATE '2025-01-31');
SELECT pg_temp.novo('C8b', 15);
SELECT pg_temp.conf('C8b', DATE '2025-02-28');
SELECT pg_temp.novo('C8c', 15);
SELECT pg_temp.conf('C8c', DATE '2025-03-31');
SELECT is(
  (SELECT array_agg(competencia ORDER BY competencia) FROM public.pagamentos WHERE empresa_id = pg_temp.emp(15)),
  ARRAY[DATE '2025-01-31', DATE '2025-02-28', DATE '2025-03-31'],
  'C8: as competencias acompanham o vencimento (31/jan, 28/fev, 31/mar), uma por mes');
SELECT is(pg_temp.st(15), 'exp=2025-04-30 ancora=31', 'C8: ancora 31 sem deriva: 31/jan -> 28/fev -> 31/mar -> 30/abr');
SELECT is((SELECT count(DISTINCT competencia)::integer FROM public.pagamentos WHERE empresa_id = pg_temp.emp(15)), 3, 'C8: nenhuma competencia repetida');

-- ----------------------------------------------------------------------------
-- D. Mensal atrasada: nao acumula competencias
-- ----------------------------------------------------------------------------
SELECT pg_temp.assina(16, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('D1', 16);
SELECT pg_temp.conf('D1', DATE '2025-05-20');   -- 3+ meses de atraso
SELECT is(pg_temp.st(16), 'exp=2025-06-10 ancora=10', 'D1: varios meses de atraso (vence 10/fev, paga 20/mai) -> 10/jun: a referencia e o pagamento');
SELECT is(pg_temp.j('D1', 1, 'competencia'), '2025-02-10', 'D1: a competencia quitada continua sendo a do vencimento atrasado (10/fev)');
SELECT pg_temp.novo('D1b', 16);
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('D1b')), DATE '2025-06-10', 'D1: a proxima cobranca e a do novo vencimento (10/jun)');
SELECT is(pg_temp.qtd(16), 2, 'D1: so DUAS cobrancas: as competencias de mar, abr e mai nunca foram geradas (atraso nao acumula)');
SELECT is(
  (SELECT count(*)::integer FROM public.pagamentos WHERE empresa_id = pg_temp.emp(16)
     AND competencia IN (DATE '2025-03-10', DATE '2025-04-10', DATE '2025-05-10')),
  0, 'D1: nenhuma competencia intermediaria');

SELECT pg_temp.assina(17, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('D2', 17);
SELECT pg_temp.conf('D2', DATE '2025-02-25');   -- atrasada, mesmo mes
SELECT is(pg_temp.st(17), 'exp=2025-03-10 ancora=10', 'D2: atrasada no mesmo mes (paga 25/fev) -> 10/mar');

SELECT pg_temp.assina(18, 'A', 'active', DATE '2025-02-28', 31);
SELECT pg_temp.novo('D3', 18);
SELECT pg_temp.conf('D3', DATE '2025-03-01');   -- 1 dia de atraso, vencimento clampado
SELECT is(pg_temp.st(18), 'exp=2025-04-30 ancora=31', 'D3: ancora 31, vence 28/fev, paga 01/mar -> 30/abr (regra vigente do Backstage)');

-- ----------------------------------------------------------------------------
-- E. Anual: renovacao antecipada preserva os dias; primeira ativacao nao
-- ----------------------------------------------------------------------------
-- E1: trial -> primeira ativacao anual = pagamento + 1 ano (dias do trial nao contam).
SELECT pg_temp.assina(19, 'ANUAL', 'trial', DATE '2025-06-01', NULL);
SELECT pg_temp.novo('E1', 19);
SELECT pg_temp.conf('E1', DATE '2025-01-10');
SELECT is(pg_temp.j('E1', 1, 'ciclo'), 'anual', 'E1: primeira ativacao anual');
SELECT is(pg_temp.st(19), 'exp=2026-01-10 ancora=NULL', 'E1: 10/jan/2025 + 1 ano = 10/jan/2026 (trial ate 01/jun nao e somado); sem ancora');

-- E2: renovacao ANTECIPADA (pagou 5 dias antes): preserva os dias restantes.
SELECT pg_temp.assina(20, 'ANUAL', 'active', DATE '2025-03-15', NULL);
SELECT pg_temp.novo('E2', 20);
SELECT pg_temp.conf('E2', DATE '2025-03-10');
SELECT is(pg_temp.j('E2', 1, 'ciclo'), 'anual_renovacao', 'E2: mesmo plano anual vigente = renovacao anual');
SELECT is(pg_temp.st(20), 'exp=2026-03-15 ancora=NULL', 'E2: GREATEST(15/mar/2025, 10/mar/2025) + 1 ano = 15/mar/2026 (os 5 dias restantes foram preservados)');

SELECT pg_temp.assina(21, 'ANUAL', 'active', DATE '2025-03-15', NULL);
SELECT pg_temp.novo('E2b', 21);
SELECT pg_temp.conf('E2b', DATE '2025-01-01');   -- 73 dias antes
SELECT is(pg_temp.st(21), 'exp=2026-03-15 ancora=NULL', 'E2b: 73 dias de antecedencia: o novo vencimento continua 15/mar/2026 (nenhum dia perdido)');

-- E3: paga NO vencimento.
SELECT pg_temp.assina(22, 'ANUAL', 'active', DATE '2025-03-15', NULL);
SELECT pg_temp.novo('E3', 22);
SELECT pg_temp.conf('E3', DATE '2025-03-15');
SELECT is(pg_temp.st(22), 'exp=2026-03-15 ancora=NULL', 'E3: paga no vencimento -> +1 ano exato');

-- E4: renovacao ATRASADA: a referencia e a data do pagamento.
SELECT pg_temp.assina(23, 'ANUAL', 'active', DATE '2025-03-15', NULL);
SELECT pg_temp.novo('E4', 23);
SELECT pg_temp.conf('E4', DATE '2025-04-20');
SELECT is(pg_temp.j('E4', 1, 'ciclo'), 'anual_renovacao', 'E4: renovacao atrasada tambem e renovacao');
SELECT is(pg_temp.st(23), 'exp=2026-04-20 ancora=NULL', 'E4: atrasada (vence 15/mar, paga 20/abr) -> 20/abr/2026: sem acumular o periodo em atraso');

-- E5: vencimento em 29/fev (bissexto) antecipado.
SELECT pg_temp.assina(24, 'ANUAL', 'active', DATE '2024-02-29', NULL);
SELECT pg_temp.novo('E5', 24);
SELECT pg_temp.conf('E5', DATE '2024-02-20');
SELECT is(pg_temp.st(24), 'exp=2025-02-28 ancora=NULL', 'E5: GREATEST(29/fev/2024, 20/fev/2024) + 1 ano = 28/fev/2025 (ano-calendario, nao 365 dias)');

-- E6: trocar de MENSAL para ANUAL nao e renovacao: a referencia e o pagamento.
SELECT pg_temp.assina(25, 'A', 'active', DATE '2025-03-15', 15);
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, plano_id, descricao, valor, status)
VALUES ('d6400000-0000-4000-8000-000000000025', pg_temp.emp(25), 'plano', pg_temp.pl('ANUAL'), 'Contratacao solicitada: anual', 1000, 'pendente');
INSERT INTO _ids VALUES ('E6', 'd6400000-0000-4000-8000-000000000025');
SELECT pg_temp.conf('E6', DATE '2025-03-01');
SELECT is(pg_temp.j('E6', 1, 'ciclo'), 'anual', 'E6: mensal -> anual e inicio de ciclo anual (nao renovacao)');
SELECT is(pg_temp.st(25), 'exp=2026-03-01 ancora=15', 'E6: a partir do pagamento (01/mar/2026, e nao 15/mar); a ancora mensal anterior nao e apagada');

-- E7: cadeia anual pedindo e pagando cada mensalidade.
SELECT pg_temp.assina(26, 'ANUAL', 'active', DATE '2025-03-15', NULL);
SELECT pg_temp.novo('E7a', 26);
SELECT pg_temp.conf('E7a', DATE '2025-03-10');
SELECT pg_temp.novo('E7b', 26);
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('E7b')), DATE '2026-03-15', 'E7: a competencia do segundo ano e o novo vencimento (15/mar/2026)');
SELECT pg_temp.conf('E7b', DATE '2026-03-01');
SELECT is(pg_temp.st(26), 'exp=2027-03-15 ancora=NULL', 'E7: segunda renovacao antecipada (14 dias): 15/mar/2027, sem perder dias');

-- E8: vencida (expired) ha meses: a referencia e o pagamento (o mesmo que primeira ativacao).
SELECT pg_temp.assina(27, 'ANUAL', 'expired', DATE '2025-01-01', NULL);
SELECT pg_temp.novo('E8', 27);
SELECT pg_temp.conf('E8', DATE '2025-06-01');
SELECT is(pg_temp.st(27), 'exp=2026-06-01 ancora=NULL', 'E8: anual vencida ha 5 meses e paga em 01/jun -> 01/jun/2026');

-- E9: o "+365 dias" nao existe mais: intervalo que atravessa 29/fev/2024 tem 366 dias.
SELECT pg_temp.assina(28, 'ANUAL', 'active', DATE '2023-06-30', NULL);
SELECT pg_temp.novo('E9', 28);
SELECT pg_temp.conf('E9', DATE '2023-06-30');
SELECT is((SELECT data_expiracao - DATE '2023-06-30' FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(28)), 366,
  'E9: 30/jun/2023 -> 30/jun/2024 dura 366 dias (ano-calendario), nao 365');

-- ----------------------------------------------------------------------------
-- F. Idempotencia e concorrencia (o que cabe numa sessao)
-- ----------------------------------------------------------------------------
-- F1: o mesmo pagamento entregue varias vezes (CONFIRMED, RECEIVED, retries).
SELECT pg_temp.assina(29, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('F1', 29);
SELECT pg_temp.conf('F1', DATE '2025-02-01');
INSERT INTO _s VALUES ('F1_antes', pg_temp.snap(29));
SELECT pg_temp.conf('F1', DATE '2025-02-01');
SELECT pg_temp.conf('F1', DATE '2025-02-05');
SELECT pg_temp.conf('F1', DATE '2025-03-01');
SELECT pg_temp.conf('F1', NULL);
SELECT is((SELECT count(*)::integer FROM _j WHERE k = 'F1' AND j ->> 'ja_processado' = 'true'), 4, 'F1: as 4 reentregas responderam ja_processado');
SELECT is(pg_temp.snap(29), (SELECT v FROM _s WHERE k = 'F1_antes'), 'F1: 5 entregas do mesmo pagamento avancaram o vencimento UMA vez (mesma linha, 10/mar)');
SELECT is((SELECT data_pagamento FROM public.pagamentos WHERE id = pg_temp.pid('F1')), DATE '2025-02-01', 'F1: a data do pagamento nao e regravada');

-- F2: empresas independentes na mesma competencia avancam cada uma uma vez.
SELECT pg_temp.assina(30, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.assina(31, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('F2a', 30);
SELECT pg_temp.novo('F2b', 31);
SELECT pg_temp.conf('F2a', DATE '2025-02-10');
SELECT pg_temp.conf('F2b', DATE '2025-02-10');
SELECT is(pg_temp.st(30) || ' / ' || pg_temp.st(31), 'exp=2025-03-10 ancora=10 / exp=2025-03-10 ancora=10',
  'F2: duas empresas, mesma competencia: cada assinatura avancou exatamente uma vez');
SELECT is((SELECT count(*)::integer FROM public.pagamentos WHERE competencia = DATE '2025-02-10' AND status = 'pago'
            AND empresa_id IN (pg_temp.emp(30), pg_temp.emp(31))), 2, 'F2: um pagamento pago por empresa');

-- F3: chaves de advisory lock por empresa (serializam solicitacao e confirmacao).
SELECT pg_temp.assina(32, 'A', 'active', DATE '2025-02-10', 10);
SELECT ok(NOT pg_temp.tem_lock('mensalidade:' || pg_temp.emp(32)::text) AND NOT pg_temp.tem_lock('assinatura:' || pg_temp.emp(32)::text),
  'F3: antes de qualquer chamada nao ha lock da empresa 32 (a verificacao abaixo nao e vacua)');
SELECT pg_temp.novo('F3', 32);
SELECT ok(pg_temp.tem_lock('mensalidade:' || pg_temp.emp(32)::text), 'F3: solicitar_mensalidade toma o lock "mensalidade:<empresa>" (duplo clique)');
SELECT ok(pg_temp.tem_lock('assinatura:' || pg_temp.emp(32)::text),
  'F3: solicitar_mensalidade toma o mesmo lock "assinatura:<empresa>" da confirmacao (competencia coerente com o vencimento)');
SELECT pg_temp.assina(33, 'A', 'active', DATE '2025-02-10', 10);
SELECT pg_temp.cobr('F3b', 33, 'A', 'pendente', NULL);
SELECT ok(NOT pg_temp.tem_lock('assinatura:' || pg_temp.emp(33)::text), 'F3: empresa 33 ainda sem lock');
SELECT pg_temp.conf('F3b', DATE '2025-02-10');
SELECT ok(pg_temp.tem_lock('assinatura:' || pg_temp.emp(33)::text), 'F3: confirmar_pagamento_asaas toma o lock "assinatura:<empresa>" antes de ler o estado');

-- ----------------------------------------------------------------------------
-- G. Historico antigo sem competencia nao quebra; backfill
-- ----------------------------------------------------------------------------
-- G1: mensalidade PAGA antiga (sem competencia) nao bloqueia a proxima cobranca.
SELECT pg_temp.assina(34, 'A', 'active', DATE '2025-05-10', 10);
SELECT pg_temp.cobr('G1_hist', 34, 'A', 'pago', NULL, 'Mensalidade Plano historico');
SELECT pg_temp.novo('G1', 34);
SELECT isnt(pg_temp.pid('G1'), pg_temp.pid('G1_hist'), 'G1: o historico pago sem competencia nao impede a nova cobranca');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('G1')), DATE '2025-05-10', 'G1: a nova cobranca ja nasce com competencia');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('G1_hist')), NULL::date, 'G1: o historico continua sem competencia');

-- G2: mensalidade ABERTA antiga (sem competencia) e reutilizada e confirma como antes.
SELECT pg_temp.assina(35, 'A', 'active', DATE '2025-05-10', 10);
SELECT pg_temp.cobr('G2', 35, 'A', 'pendente', NULL, 'Mensalidade Plano historico aberto');
SELECT pg_temp.novo('G2b', 35);
SELECT is(pg_temp.pid('G2b'), pg_temp.pid('G2'), 'G2: mensalidade aberta do historico (sem competencia) e reutilizada, nao duplicada');
SELECT is(pg_temp.qtd(35), 1, 'G2: nenhuma cobranca nova');
SELECT pg_temp.conf('G2', DATE '2025-05-05');
SELECT is(pg_temp.j('G2', 1, 'ciclo'), 'renovacao', 'G2: o historico sem competencia confirma normalmente (renovacao)');
SELECT is(pg_temp.st(35), 'exp=2025-06-10 ancora=10', 'G2: e avanca como antes');
SELECT is(pg_temp.j('G2', 1, 'competencia'), NULL, 'G2: resposta sem competencia (NULL)');

-- G3: pagamentos SEM competencia continuam sem trava (carrinho/legado): dois avancam dois meses, como antes.
SELECT pg_temp.assina(36, 'A', 'active', DATE '2025-05-10', 10);
SELECT pg_temp.cobr('G3a', 36, 'A', 'pendente', NULL, 'Carrinho: 1 plano(s) e 0 modulo(s)');
SELECT pg_temp.cobr('G3b', 36, 'A', 'pendente', NULL, 'Carrinho: 1 plano(s) e 0 modulo(s) bis');
SELECT pg_temp.conf('G3a', DATE '2025-05-10');
SELECT pg_temp.conf('G3b', DATE '2025-05-11');
SELECT is(pg_temp.st(36), 'exp=2025-07-10 ancora=10', 'G3: sem competencia nao ha o que comparar: comportamento anterior preservado (ver F3 da etapa anterior)');

-- G4: backfill das mensalidades ABERTAS do historico.
SELECT pg_temp.assina(37, 'A', 'active', DATE '2025-06-10', 10);
SELECT pg_temp.cobr('G4_aberta', 37, 'A', 'pendente', NULL, 'Mensalidade Plano historico aberto');
SELECT pg_temp.cobr('G4_paga', 37, 'A', 'pago', NULL, 'Mensalidade Plano historico pago');
SELECT pg_temp.cobr('G4_cancelada', 37, 'A', 'cancelado', NULL, 'Mensalidade Plano historico cancelado');
SELECT pg_temp.assina(38, 'A', 'active', NULL, NULL);
SELECT pg_temp.cobr('G4_sem_venc', 38, 'A', 'pendente', NULL, 'Mensalidade Plano sem vencimento');
SELECT pg_temp.assina(39, 'A', 'active', DATE '2025-06-10', 10);
SELECT pg_temp.cobr('G4_carrinho', 39, 'A', 'pendente', NULL, 'Carrinho: 1 plano(s) e 0 modulo(s)');
SELECT is(public.preencher_competencia_mensalidades(pg_temp.emp(37), true), 1, 'G4: simulacao conta 1 mensalidade aberta a estampar');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('G4_aberta')), NULL::date, 'G4: a simulacao nao altera nada');
SELECT is(public.preencher_competencia_mensalidades(pg_temp.emp(37)), 1, 'G4: backfill estampa a mensalidade aberta');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('G4_aberta')), DATE '2025-06-10', 'G4: competencia = vencimento vigente da empresa');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('G4_paga')), NULL::date, 'G4: mensalidade paga antiga NAO e tocada');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('G4_cancelada')), NULL::date, 'G4: mensalidade cancelada antiga NAO e tocada');
SELECT is(public.preencher_competencia_mensalidades(pg_temp.emp(37)), 0, 'G4: idempotente (segunda execucao nao encontra nada)');
SELECT is(public.preencher_competencia_mensalidades(pg_temp.emp(38)), 0, 'G4: assinatura sem vencimento: nada a estampar');
SELECT is(public.preencher_competencia_mensalidades(pg_temp.emp(39)), 0, 'G4: carrinho (descricao que nao e Mensalidade) nao e estampado');
SELECT pg_temp.novo('G4_sol', 37);
SELECT is(pg_temp.pid('G4_sol'), pg_temp.pid('G4_aberta'), 'G4: depois do backfill a solicitacao reaproveita a mesma cobranca (mesma competencia)');
SELECT is(pg_temp.qtd(37), 3, 'G4: nenhuma cobranca nova');

-- ----------------------------------------------------------------------------
-- H. ACL, definicoes e modulos da mensalidade
-- ----------------------------------------------------------------------------
SELECT ok(has_function_privilege('authenticated', 'public.solicitar_mensalidade()', 'EXECUTE'), 'H1: authenticated executa solicitar_mensalidade');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.solicitar_mensalidade()'::regprocedure), true, 'H1: solicitar_mensalidade continua SECURITY DEFINER');
SELECT is((SELECT proconfig FROM pg_proc WHERE oid = 'public.solicitar_mensalidade()'::regprocedure), ARRAY['search_path=public']::text[], 'H1: search_path = public');
SELECT is((SELECT prorettype::regtype::text FROM pg_proc WHERE oid = 'public.solicitar_mensalidade()'::regprocedure), 'uuid', 'H1: continua devolvendo o uuid do pagamento (contrato com o frontend)');
SELECT ok(NOT has_function_privilege('anon', 'public.confirmar_pagamento_asaas(uuid, date, text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.confirmar_pagamento_asaas(uuid, date, text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.confirmar_pagamento_asaas(uuid, date, text)', 'EXECUTE'),
  'H2: confirmar_pagamento_asaas continua so para service_role');
SELECT ok(NOT has_function_privilege('anon', 'public.preencher_competencia_mensalidades(uuid, boolean)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.preencher_competencia_mensalidades(uuid, boolean)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.preencher_competencia_mensalidades(uuid, boolean)', 'EXECUTE'),
  'H3: o backfill so executa como service_role');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure), true, 'H2: continua SECURITY DEFINER');
SELECT is((SELECT proconfig FROM pg_proc WHERE oid = 'public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure), ARRAY['search_path=public']::text[], 'H2: search_path = public');
SELECT ok(position('_data_pagamento date DEFAULT NULL' IN pg_get_function_arguments('public.confirmar_pagamento_asaas(uuid, date, text)'::regprocedure)) > 0,
  'H2: assinatura (uuid, date, text) e default NULL da etapa anterior preservados (a Edge chama por nome)');
SELECT is((SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pagamentos' AND column_name = 'competencia')::text, 'date',
  'H4: competencia e do tipo date (o vencimento renovado)');
SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conrelid = 'public.pagamentos'::regclass AND contype = 'f'
             AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.pagamentos'::regclass AND attname = 'competencia_duplicada_de')]),
  'n', 'H4: competencia_duplicada_de referencia pagamentos(id) ON DELETE SET NULL');

-- H5: modulos da mensalidade: a confirmacao aplicada continua co-terminando o modulo com o plano...
SELECT pg_temp.conf('A7', DATE '2025-02-10');
SELECT is(pg_temp.j('A7', 1, 'ciclo'), 'renovacao', 'H5: mensalidade com modulo: renovacao');
SELECT is((SELECT data_expiracao FROM public.empresa_modulos WHERE empresa_id = pg_temp.emp(4) AND modulo_id = 'd6900000-0000-4000-8000-000000000001'),
  DATE '2025-03-10', 'H5: o modulo herda o novo vencimento do plano (comportamento de modulos inalterado)');
-- ...e um pagamento DUPLICADO nao mexe nos modulos.
SELECT pg_temp.cobr('H5b', 4, 'A', 'cancelado', DATE '2025-02-10');
INSERT INTO public.pagamento_itens (pagamento_id, tipo, modulo_id, descricao, valor)
VALUES (pg_temp.pid('H5b'), 'modulo', 'd6900000-0000-4000-8000-000000000001', 'Modulo', 30);
UPDATE public.empresa_modulos SET data_expiracao = DATE '2025-03-01' WHERE empresa_id = pg_temp.emp(4);
SELECT pg_temp.conf('H5b', DATE '2025-02-12');
SELECT is(pg_temp.j('H5b', 1, 'duplicada'), 'true', 'H5: pagamento duplicado de mensalidade com modulo');
SELECT is((SELECT data_expiracao FROM public.empresa_modulos WHERE empresa_id = pg_temp.emp(4) AND modulo_id = 'd6900000-0000-4000-8000-000000000001'),
  DATE '2025-03-01', 'H5: o pagamento duplicado nao renova modulo algum');
SELECT is(pg_temp.st(4), 'exp=2025-03-10 ancora=10', 'H5: nem a assinatura');

-- H6: pagamento inexistente e bug pre-existente do modulo avulso: respostas inalteradas.
SELECT is(
  public.confirmar_pagamento_asaas('d6400000-0000-4000-8000-0000000000ff'::uuid, DATE '2025-01-31', 'PIX'),
  jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado'),
  'H6: pagamento inexistente: resposta inalterada');
INSERT INTO public.pagamentos (id, empresa_id, referencia_tipo, modulo_id, descricao, valor, status)
VALUES ('d6400000-0000-4000-8000-000000000006', pg_temp.emp(40), 'modulo', 'd6900000-0000-4000-8000-000000000001', 'Contratacao solicitada: modulo', 30, 'pendente');
SELECT throws_ok(
  $$ SELECT public.confirmar_pagamento_asaas('d6400000-0000-4000-8000-000000000006'::uuid, DATE '2025-01-31', 'PIX') $$,
  '55000', 'record "_plano" is not assigned yet',
  'H6: LEGADO PRESERVADO (bug pre-existente do modulo avulso sem itens): continua falhando como antes; modulos fora de escopo');
SELECT is((SELECT status::text FROM public.pagamentos WHERE id = 'd6400000-0000-4000-8000-000000000006'), 'pendente', 'H6: e a falha reverte tudo');

SELECT * FROM finish();
ROLLBACK;
