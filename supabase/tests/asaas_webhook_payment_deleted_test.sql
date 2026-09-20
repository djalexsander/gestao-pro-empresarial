-- Cobertura de banco para o ramo PAYMENT_DELETED do asaas-webhook
-- (supabase/functions/asaas-webhook/index.ts) contra o schema, os indices unicos e os RPCs REAIS.
-- Rode com `supabase test db` contra um banco que contenha todas as migrations.
--
-- Problema: uma cobranca EXCLUIDA no Asaas (evento PAYMENT_DELETED) deixava a mensalidade local
-- `pendente`, com QR morto. O indice de mensalidade aberta e o de competencia impediam gerar outra
-- e "Pagar mensalidade"/"Ver QR Code / Pix" devolviam a cobranca morta ate alguem cancelar a mao.
--
-- O webhook agora faz, via PostgREST (supabase-js):
--   .from("pagamentos").update({ status: "cancelado" }).eq("id", ID).in("status", ["pendente", "atrasado"])
-- que vira:
--   UPDATE pagamentos SET status = 'cancelado' WHERE id = ID AND status IN ('pendente', 'atrasado')
-- (pg_temp.excluida abaixo). Nada alem de pagamentos.status e tocado.
--
-- Cobre, com os RPCs reais solicitar_mensalidade() (como o dono da empresa, via request.jwt.claim.sub),
-- cobranca_pendente_atual() (o que a tela consulta) e confirmar_pagamento_asaas():
--   A. pendente + exclusao -> cancelado; linha preservada; assinatura/modulos/empresa intactos; a tela
--      deixa de ver mensalidade pendente; a competencia fica livre; gerar de novo cria um NOVO pagamento
--      (sem asaas_payment_id => a Edge cria uma NOVA cobranca); a protecao contra duplicidade continua;
--      exclusao repetida e idempotente e nao toca na nova;
--   B. atrasado + exclusao -> cancelado;
--   C. pago + exclusao -> continua pago (linha nem reescrita), assinatura intacta;
--   D. competencia livre no proprio indice (INSERT direto), com CONTROLE antes do cancelamento;
--   E. lista de permissao dos estados e reentrega do evento (indice unico de event_id).
-- O estado ANTES da correcao (exclusao sem efeito) e o "controle" da secao A/D: a cobranca segue pendente,
-- e reaproveitada e ocupa a competencia. O teste do handler (Node/vitest) esta em
-- supabase/functions/asaas-webhook/index.test.ts.
--
-- Datas de pagamento FIXAS NO PASSADO: o RPC nunca aceita pagamento no futuro.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. Fixtures e auxiliares
-- ----------------------------------------------------------------------------
INSERT INTO public.planos (id, nome, valor, tipo_cobranca, ativo) VALUES
  ('d7500000-0000-4000-8000-000000000001', '__del_mensal__', 100, 'mensal', true);

INSERT INTO public.modulos (id, nome, chave, valor, ativo, aplica_restricao) VALUES
  ('d7900000-0000-4000-8000-000000000001', '__del_modulo__', '__del_modulo__', 30, true, false);

-- 6 empresas isoladas (cada INSERT dispara o trial, como no cadastro real).
INSERT INTO public.empresas (id, owner_id, nome)
SELECT
  ('d7600000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('d7700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '__del_empresa_' || lpad(n::text, 2, '0') || '__'
FROM generate_series(1, 6) AS n;

CREATE TEMP TABLE _ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _e (k text PRIMARY KEY, code text, msg text) ON COMMIT DROP;
CREATE TEMP TABLE _s (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.emp(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d7600000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

CREATE FUNCTION pg_temp.dono(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ('d7700000-0000-4000-8000-0000000000' || lpad(_n::text, 2, '0'))::uuid
$fn$;

-- Estado da assinatura da empresa (a linha de trial ja existe).
CREATE FUNCTION pg_temp.assina(_n integer, _status text, _exp date, _ancora integer)
RETURNS void LANGUAGE sql AS $fn$
  UPDATE public.empresa_assinaturas
     SET plano_id = 'd7500000-0000-4000-8000-000000000001'::uuid,
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

CREATE FUNCTION pg_temp.pid(_k text) RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT id FROM _ids WHERE k = _k
$fn$;

-- O que a Edge asaas-criar-cobranca grava ao criar a cobranca (ID externo, fatura, vencimento, QR).
CREATE FUNCTION pg_temp.edge(_k text, _pay text) RETURNS void LANGUAGE sql AS $fn$
  UPDATE public.pagamentos
     SET asaas_payment_id = _pay,
         asaas_invoice_url = 'https://www.asaas.com/i/' || _pay,
         asaas_billing_type = 'PIX',
         external_reference = 'gestaopro|pagamento|' || id::text,
         data_vencimento = DATE '2025-02-13',
         forma_pagamento = 'pix',
         asaas_pix_qrcode = 'QR-' || _pay,
         asaas_pix_copia_cola = 'PIX-' || _pay
   WHERE id = pg_temp.pid(_k)
$fn$;

-- SQL que o PostgREST gera para o UPDATE do ramo PAYMENT_DELETED. Devolve as linhas atingidas.
CREATE FUNCTION pg_temp.excluida(_k text) RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public.pagamentos SET status = 'cancelado'
   WHERE id = pg_temp.pid(_k) AND status IN ('pendente', 'atrasado');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- cobranca_pendente_atual() como o dono da empresa: e o que a tela consulta para decidir entre
-- "Ver QR Code / Pix" (ha mensalidade pendente com Pix) e "Pagar mensalidade".
CREATE FUNCTION pg_temp.pend(_n integer) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_j jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.dono(_n)::text, true);
  v_j := public.cobranca_pendente_atual();
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_j;
END
$fn$;

CREATE FUNCTION pg_temp.st(_k text) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT status::text FROM public.pagamentos WHERE id = pg_temp.pid(_k)
$fn$;

-- "Versao fisica" da linha: o ctid muda em qualquer UPDATE que a reescreve.
CREATE FUNCTION pg_temp.pos(_k text) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT ctid::text FROM public.pagamentos WHERE id = pg_temp.pid(_k)
$fn$;

-- "Foto" de tudo o que a exclusao NAO pode tocar: assinatura, modulos e empresa (conteudo + ctid).
CREATE FUNCTION pg_temp.snap(_n integer) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE((SELECT md5(a.ctid::text || to_jsonb(a)::text)
                     FROM public.empresa_assinaturas AS a WHERE a.empresa_id = pg_temp.emp(_n)), '-')
      || '|' || COALESCE((SELECT md5(string_agg(m.ctid::text || to_jsonb(m)::text, ',' ORDER BY m.modulo_id))
                     FROM public.empresa_modulos AS m WHERE m.empresa_id = pg_temp.emp(_n)), '-')
      || '|' || COALESCE((SELECT md5(e.ctid::text || to_jsonb(e)::text)
                     FROM public.empresas AS e WHERE e.id = pg_temp.emp(_n)), '-')
$fn$;

CREATE FUNCTION pg_temp.qtd(_n integer) RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::integer FROM public.pagamentos WHERE empresa_id = pg_temp.emp(_n)
$fn$;

CREATE FUNCTION pg_temp.validas(_n integer, _comp date) RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::integer FROM public.pagamentos
   WHERE empresa_id = pg_temp.emp(_n) AND competencia = _comp
     AND competencia_duplicada_de IS NULL AND status IN ('pendente', 'atrasado', 'pago')
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
-- A. Mensalidade pendente com Pix excluida no Asaas (empresa 1: plano 100 + modulo 30, vence 10/fev/2025)
-- ----------------------------------------------------------------------------
SELECT pg_temp.assina(1, 'active', DATE '2025-02-10', 10);
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, data_expiracao)
VALUES (pg_temp.emp(1), 'd7900000-0000-4000-8000-000000000001', 'ativo', DATE '2025-02-10');

SELECT pg_temp.novo('A1', 1);
SELECT pg_temp.edge('A1', 'pay_del_A1');

-- ANTES da exclusao (e, na versao antiga do webhook, DEPOIS dela): a cobranca pendente normal e reutilizada.
INSERT INTO _ids VALUES ('A1_de_novo', pg_temp.sol(1));
SELECT is(pg_temp.pid('A1_de_novo'), pg_temp.pid('A1'), 'A1) cobranca pendente normal: pedir de novo REUTILIZA a mesma (sem duplicidade)');
SELECT is(pg_temp.qtd(1), 1, 'A1) e continua uma unica linha em pagamentos');
SELECT is((SELECT valor::numeric FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 130.00::numeric, 'A1) mensalidade = plano (100) + modulo ativo (30)');
SELECT is((pg_temp.pend(1) ->> 'pagamento_id')::uuid, pg_temp.pid('A1'), 'A1) cobranca_pendente_atual() devolve essa mensalidade (a tela mostra "Ver QR Code / Pix")');
SELECT is(pg_temp.pend(1) ->> 'asaas_payment_id', 'pay_del_A1', 'A1) com o asaas_payment_id e o QR gravados pela Edge');
SELECT ok((pg_temp.pend(1) ->> 'descricao') LIKE 'Mensalidade%', 'A1) e a descricao comeca com "Mensalidade" (e o que a tela usa para reconhecer a mensalidade)');
SELECT is(pg_temp.validas(1, DATE '2025-02-10'), 1, 'A1) a competencia 10/fev/2025 esta ocupada por ela');

-- CONTROLE (o estado do bug): enquanto a cobranca excluida segue pendente, o banco barra outra da competencia.
SELECT pg_temp.err('A_ctrl', $$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia)
  VALUES ('d7600000-0000-4000-8000-000000000001', 'outro', 'Mensalidade direta', 1, 'pendente', DATE '2025-02-10')
$$);
SELECT is((SELECT code FROM _e WHERE k = 'A_ctrl'), '23505', 'A2) CONTROLE (estado do bug): com a excluida pendente a competencia fica ocupada e outra cobranca e barrada (23505)');

INSERT INTO _s VALUES ('A_snap', pg_temp.snap(1));

-- PAYMENT_DELETED chega: o UPDATE do webhook.
SELECT is(pg_temp.excluida('A1'), 1, 'A3) PAYMENT_DELETED: o UPDATE do webhook atinge exatamente 1 linha');
SELECT is(pg_temp.st('A1'), 'cancelado', 'A3) pendente + PAYMENT_DELETED -> cancelado');
SELECT is((SELECT count(*)::integer FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 1, 'A3) a linha continua no historico (nao foi excluida)');
SELECT is((SELECT asaas_payment_id FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 'pay_del_A1', 'A3) e mantem o asaas_payment_id da cobranca excluida (historico)');
SELECT is((SELECT asaas_pix_qrcode FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 'QR-pay_del_A1', 'A3) e o QR gravado');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A1')), DATE '2025-02-10', 'A3) e a competencia');
SELECT is((SELECT valor::numeric FROM public.pagamentos WHERE id = pg_temp.pid('A1')), 130.00::numeric, 'A3) e o valor');
SELECT is((SELECT count(*)::integer FROM public.pagamento_itens WHERE pagamento_id = pg_temp.pid('A1')), 2, 'A3) e os itens (plano + modulo)');
SELECT is(pg_temp.snap(1), (SELECT v FROM _s WHERE k = 'A_snap'), 'A4) assinatura, modulos e empresa NAO foram tocados (nem reescritos)');
SELECT is((SELECT data_expiracao FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(1)), DATE '2025-02-10', 'A4) vencimento da assinatura intacto');
SELECT is((SELECT dia_ancora::integer FROM public.empresa_assinaturas WHERE empresa_id = pg_temp.emp(1)), 10, 'A4) dia ancora intacto');
SELECT ok(pg_temp.pend(1) IS NULL, 'A4) cobranca_pendente_atual() = NULL: a tela deixa de ver mensalidade pendente ("Pagar mensalidade" volta)');
SELECT is(pg_temp.validas(1, DATE '2025-02-10'), 0, 'A4) a competencia ficou livre (cancelado nao participa dos indices)');
INSERT INTO _s VALUES ('A1_pos', pg_temp.pos('A1'));

-- Gerar de novo: NOVO pagamento (e, sem asaas_payment_id, a Edge cria uma NOVA cobranca no Asaas).
SELECT pg_temp.novo('A2', 1);
SELECT ok(pg_temp.pid('A2') <> pg_temp.pid('A1'), 'A5) gerar de novo cria um NOVO pagamento (id diferente do cancelado)');
SELECT is(pg_temp.st('A2'), 'pendente', 'A5) pendente');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('A2')), DATE '2025-02-10', 'A5) da MESMA competencia');
SELECT is((SELECT asaas_payment_id FROM public.pagamentos WHERE id = pg_temp.pid('A2')), NULL::text, 'A5) sem asaas_payment_id: a Edge criara uma cobranca NOVA no Asaas (nao reaproveita a excluida)');
SELECT is((SELECT valor::numeric FROM public.pagamentos WHERE id = pg_temp.pid('A2')), 130.00::numeric, 'A5) mesmo valor (plano + modulo)');
SELECT is((SELECT count(*)::integer FROM public.pagamento_itens WHERE pagamento_id = pg_temp.pid('A2')), 2, 'A5) e itens (plano + modulo)');
SELECT is(pg_temp.validas(1, DATE '2025-02-10'), 1, 'A5) a competencia tem exatamente UMA cobranca valida (a nova)');
SELECT is(pg_temp.qtd(1), 2, 'A5) o registro cancelado anterior permanece no historico ao lado da nova');

-- A protecao contra duplicidade continua valendo para a nova cobranca.
INSERT INTO _ids VALUES ('A2_de_novo', pg_temp.sol(1));
SELECT is(pg_temp.pid('A2_de_novo'), pg_temp.pid('A2'), 'A6) pedir de novo REUTILIZA a nova cobranca (sem duplicidade)');
SELECT is(pg_temp.qtd(1), 2, 'A6) continuam 2 linhas (cancelada + nova)');
SELECT pg_temp.edge('A2', 'pay_del_A2');
SELECT is((pg_temp.pend(1) ->> 'pagamento_id')::uuid, pg_temp.pid('A2'), 'A6) a tela passa a ver a NOVA cobranca');
SELECT is(pg_temp.pend(1) ->> 'asaas_payment_id', 'pay_del_A2', 'A6) com o novo ID do Asaas (nao o da excluida)');
INSERT INTO _s VALUES ('A2_pos', pg_temp.pos('A2'));

-- Idempotencia: PAYMENT_DELETED repetido (reentrega, outro event_id) nao muda nada e nao toca na nova.
SELECT is(pg_temp.excluida('A1'), 0, 'A7) PAYMENT_DELETED repetido: o UPDATE nao atinge nenhuma linha (ja cancelada)');
SELECT is(pg_temp.excluida('A1'), 0, 'A7) e de novo');
SELECT is(pg_temp.st('A1'), 'cancelado', 'A7) a antiga continua cancelada');
SELECT is(pg_temp.pos('A1'), (SELECT v FROM _s WHERE k = 'A1_pos'), 'A7) e nao foi reescrita');
SELECT is(pg_temp.st('A2'), 'pendente', 'A7) a nova cobranca continua pendente');
SELECT is(pg_temp.pos('A2'), (SELECT v FROM _s WHERE k = 'A2_pos'), 'A7) e nao foi reescrita');
SELECT is((pg_temp.pend(1) ->> 'pagamento_id')::uuid, pg_temp.pid('A2'), 'A7) a tela continua vendo a nova cobranca');

-- ----------------------------------------------------------------------------
-- B. atrasado + exclusao (empresa 2: vence 10/mar/2025)
-- ----------------------------------------------------------------------------
SELECT pg_temp.assina(2, 'active', DATE '2025-03-10', 10);
SELECT pg_temp.novo('B1', 2);
SELECT pg_temp.edge('B1', 'pay_del_B1');
-- o webhook OVERDUE leva a cobranca a "atrasado" (o Asaas segue mostrando OVERDUE apos a exclusao)
UPDATE public.pagamentos SET status = 'atrasado' WHERE id = pg_temp.pid('B1');

SELECT is((pg_temp.pend(2) ->> 'pagamento_id')::uuid, pg_temp.pid('B1'), 'B1) atrasado tambem e cobranca aberta para a tela');
INSERT INTO _ids VALUES ('B1_de_novo', pg_temp.sol(2));
SELECT is(pg_temp.pid('B1_de_novo'), pg_temp.pid('B1'), 'B1) atrasado e reutilizado (sem duplicidade)');
INSERT INTO _s VALUES ('B_snap', pg_temp.snap(2));

SELECT is(pg_temp.excluida('B1'), 1, 'B2) atrasado + PAYMENT_DELETED: 1 linha atingida');
SELECT is(pg_temp.st('B1'), 'cancelado', 'B2) atrasado + PAYMENT_DELETED -> cancelado');
SELECT is(pg_temp.snap(2), (SELECT v FROM _s WHERE k = 'B_snap'), 'B2) assinatura, modulos e empresa intactos');
SELECT ok(pg_temp.pend(2) IS NULL, 'B2) a tela deixa de ver mensalidade pendente');
SELECT is(pg_temp.validas(2, DATE '2025-03-10'), 0, 'B2) competencia livre');
SELECT pg_temp.novo('B2', 2);
SELECT ok(pg_temp.pid('B2') <> pg_temp.pid('B1'), 'B3) gerar de novo cria um NOVO pagamento');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('B2')), DATE '2025-03-10', 'B3) da mesma competencia');
SELECT is(pg_temp.validas(2, DATE '2025-03-10'), 1, 'B3) exatamente uma cobranca valida na competencia');

-- ----------------------------------------------------------------------------
-- C. pago + exclusao -> continua pago (empresa 3: vence 10/fev/2025, paga em 05/fev/2025)
-- ----------------------------------------------------------------------------
SELECT pg_temp.assina(3, 'active', DATE '2025-02-10', 10);
SELECT pg_temp.novo('C1', 3);
SELECT pg_temp.edge('C1', 'pay_del_C1');
SELECT is((public.confirmar_pagamento_asaas(pg_temp.pid('C1'), DATE '2025-02-05', 'PIX') ->> 'ok'), 'true', 'C1) a mensalidade e paga (RPC real de confirmacao)');
SELECT is(pg_temp.st('C1'), 'pago', 'C1) pago');
INSERT INTO _s VALUES ('C_snap', pg_temp.snap(3)), ('C1_pos', pg_temp.pos('C1'));

SELECT is(pg_temp.excluida('C1'), 0, 'C2) pago + PAYMENT_DELETED: o filtro (so pendente/atrasado) nao atinge nenhuma linha');
SELECT is(pg_temp.st('C1'), 'pago', 'C2) continua pago');
SELECT is(pg_temp.pos('C1'), (SELECT v FROM _s WHERE k = 'C1_pos'), 'C2) e a linha do pago nem foi reescrita');
SELECT is((SELECT data_pagamento FROM public.pagamentos WHERE id = pg_temp.pid('C1')), DATE '2025-02-05', 'C2) data_pagamento intacta');
SELECT is((SELECT competencia FROM public.pagamentos WHERE id = pg_temp.pid('C1')), DATE '2025-02-10', 'C2) competencia intacta');
SELECT is(pg_temp.snap(3), (SELECT v FROM _s WHERE k = 'C_snap'), 'C2) assinatura (ja renovada pelo pagamento), modulos e empresa intactos');
SELECT is(pg_temp.validas(3, DATE '2025-02-10'), 1, 'C2) a competencia paga continua ocupada pelo pagamento');

-- ----------------------------------------------------------------------------
-- D. A competencia fica livre no proprio indice (INSERT direto, nao so via RPC) - empresa 4
-- ----------------------------------------------------------------------------
SELECT pg_temp.assina(4, 'active', DATE '2025-04-10', 10);
SELECT pg_temp.novo('D1', 4);
SELECT pg_temp.edge('D1', 'pay_del_D1');

SELECT pg_temp.err('D_antes', $$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia)
  VALUES ('d7600000-0000-4000-8000-000000000004', 'outro', 'Mensalidade direta', 1, 'pendente', DATE '2025-04-10')
$$);
SELECT is((SELECT code FROM _e WHERE k = 'D_antes'), '23505', 'D1) CONTROLE: com a cobranca pendente, outra da mesma competencia e barrada (23505)');

SELECT is(pg_temp.excluida('D1'), 1, 'D2) PAYMENT_DELETED cancela a cobranca');
SELECT pg_temp.err('D_depois', $$
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, competencia)
  VALUES ('d7600000-0000-4000-8000-000000000004', 'outro', 'Mensalidade direta', 1, 'pendente', DATE '2025-04-10')
$$);
SELECT is((SELECT code FROM _e WHERE k = 'D_depois'), 'sem erro', 'D2) depois do cancelamento a competencia esta livre no proprio indice (o mesmo INSERT passa)');

-- ----------------------------------------------------------------------------
-- E. Lista de permissao dos estados e reentrega do evento
-- ----------------------------------------------------------------------------
-- Rede de seguranca: o filtro e uma LISTA DE PERMISSAO (pendente/atrasado). Se surgir um estado novo no
-- enum, este teste falha para lembrar de revisar o webhook (estado final nao pode regredir).
SELECT is(
  enum_range(NULL::public.pagamento_status)::text[],
  ARRAY['pago', 'pendente', 'atrasado', 'cancelado'],
  'os unicos estados sao pago, pendente, atrasado e cancelado (pago e cancelado sao os finais)'
);

-- O webhook insere o evento; se o INSERT falha com 23505 le processado_em: preenchido => duplicate
-- (nada e reprocessado); nulo => evento nao concluido, reprocessa (o cancelamento e idempotente, ver A7).
INSERT INTO public.asaas_webhook_eventos (event_id, evento, payment_id, status, payload)
VALUES ('evt_del_1', 'PAYMENT_DELETED', 'pay_del_A1', 'PENDING', '{}'::jsonb);
SELECT pg_temp.err('E_dup', $$
  INSERT INTO public.asaas_webhook_eventos (event_id, evento, payment_id, status, payload)
  VALUES ('evt_del_1', 'PAYMENT_DELETED', 'pay_del_A1', 'PENDING', '{}'::jsonb)
$$);
SELECT is((SELECT code FROM _e WHERE k = 'E_dup'), '23505', 'E1) reentrega do mesmo event_id: o INSERT viola a unicidade (o webhook entao le processado_em)');
SELECT is((SELECT processado_em IS NULL FROM public.asaas_webhook_eventos WHERE event_id = 'evt_del_1'), true, 'E1) evento ainda nao concluido: processado_em nulo (reprocessavel)');
UPDATE public.asaas_webhook_eventos SET processado_em = now() WHERE event_id = 'evt_del_1';
SELECT is((SELECT processado_em IS NOT NULL FROM public.asaas_webhook_eventos WHERE event_id = 'evt_del_1'), true, 'E1) evento concluido: processado_em preenchido (proxima entrega responde duplicate)');
SELECT is((SELECT count(*)::integer FROM public.asaas_webhook_eventos WHERE event_id = 'evt_del_1'), 1, 'E1) um unico registro por event_id');

SELECT * FROM finish();
ROLLBACK;
