-- =====================================================
-- ENUMS
-- =====================================================
DO $$ BEGIN
  CREATE TYPE public.plano_tipo_cobranca AS ENUM ('mensal','anual','vitalicio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assinatura_status AS ENUM ('trial','ativo','vencido','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.empresa_modulo_status AS ENUM ('ativo','pendente','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pagamento_status AS ENUM ('pago','pendente','atrasado','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pagamento_referencia AS ENUM ('plano','modulo','outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- PLANOS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  tipo_cobranca public.plano_tipo_cobranca NOT NULL DEFAULT 'mensal',
  limite_usuarios int,
  limite_produtos int,
  ativo boolean NOT NULL DEFAULT true,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin gerencia planos" ON public.planos;
CREATE POLICY "Super admin gerencia planos" ON public.planos
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Todos autenticados leem planos ativos" ON public.planos;
CREATE POLICY "Todos autenticados leem planos ativos" ON public.planos
  FOR SELECT TO authenticated
  USING (ativo = true OR public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_planos_updated ON public.planos;
CREATE TRIGGER trg_planos_updated BEFORE UPDATE ON public.planos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- MODULOS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  chave text NOT NULL UNIQUE,
  descricao text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  aplica_restricao boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.modulos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin gerencia modulos" ON public.modulos;
CREATE POLICY "Super admin gerencia modulos" ON public.modulos
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Todos autenticados leem modulos ativos" ON public.modulos;
CREATE POLICY "Todos autenticados leem modulos ativos" ON public.modulos
  FOR SELECT TO authenticated
  USING (ativo = true OR public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_modulos_updated ON public.modulos;
CREATE TRIGGER trg_modulos_updated BEFORE UPDATE ON public.modulos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- CONFIG COMERCIAL (singleton)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.config_comercial (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  dias_trial int NOT NULL DEFAULT 7,
  permitir_modulos_no_trial boolean NOT NULL DEFAULT true,
  plano_padrao_id uuid REFERENCES public.planos(id) ON DELETE SET NULL,
  valor_padrao_sistema numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.config_comercial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin gerencia config comercial" ON public.config_comercial;
CREATE POLICY "Super admin gerencia config comercial" ON public.config_comercial
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Todos autenticados leem config comercial" ON public.config_comercial;
CREATE POLICY "Todos autenticados leem config comercial" ON public.config_comercial
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.config_comercial (id) VALUES (true) ON CONFLICT DO NOTHING;

-- =====================================================
-- EMPRESA_ASSINATURAS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.empresa_assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  plano_id uuid REFERENCES public.planos(id) ON DELETE SET NULL,
  status public.assinatura_status NOT NULL DEFAULT 'trial',
  data_inicio date NOT NULL DEFAULT CURRENT_DATE,
  data_expiracao date,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id)
);
CREATE INDEX IF NOT EXISTS idx_emp_assin_empresa ON public.empresa_assinaturas(empresa_id);
ALTER TABLE public.empresa_assinaturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin gerencia assinaturas" ON public.empresa_assinaturas;
CREATE POLICY "Super admin gerencia assinaturas" ON public.empresa_assinaturas
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Empresa le sua assinatura" ON public.empresa_assinaturas;
CREATE POLICY "Empresa le sua assinatura" ON public.empresa_assinaturas
  FOR SELECT TO authenticated
  USING (
    empresa_id IN (SELECT id FROM public.empresas WHERE owner_id = auth.uid())
  );

DROP TRIGGER IF EXISTS trg_assin_updated ON public.empresa_assinaturas;
CREATE TRIGGER trg_assin_updated BEFORE UPDATE ON public.empresa_assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- EMPRESA_MODULOS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.empresa_modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  modulo_id uuid NOT NULL REFERENCES public.modulos(id) ON DELETE CASCADE,
  status public.empresa_modulo_status NOT NULL DEFAULT 'pendente',
  data_inicio date NOT NULL DEFAULT CURRENT_DATE,
  data_expiracao date,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, modulo_id)
);
CREATE INDEX IF NOT EXISTS idx_emp_mod_empresa ON public.empresa_modulos(empresa_id);
ALTER TABLE public.empresa_modulos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin gerencia empresa modulos" ON public.empresa_modulos;
CREATE POLICY "Super admin gerencia empresa modulos" ON public.empresa_modulos
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Empresa le seus modulos" ON public.empresa_modulos;
CREATE POLICY "Empresa le seus modulos" ON public.empresa_modulos
  FOR SELECT TO authenticated
  USING (
    empresa_id IN (SELECT id FROM public.empresas WHERE owner_id = auth.uid())
  );

DROP TRIGGER IF EXISTS trg_emp_mod_updated ON public.empresa_modulos;
CREATE TRIGGER trg_emp_mod_updated BEFORE UPDATE ON public.empresa_modulos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- PAGAMENTOS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  referencia_tipo public.pagamento_referencia NOT NULL DEFAULT 'plano',
  plano_id uuid REFERENCES public.planos(id) ON DELETE SET NULL,
  modulo_id uuid REFERENCES public.modulos(id) ON DELETE SET NULL,
  descricao text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  status public.pagamento_status NOT NULL DEFAULT 'pendente',
  forma_pagamento text,
  data_vencimento date,
  data_pagamento date,
  observacoes text,
  registrado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pag_empresa ON public.pagamentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pag_status ON public.pagamentos(status);
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin gerencia pagamentos" ON public.pagamentos;
CREATE POLICY "Super admin gerencia pagamentos" ON public.pagamentos
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Empresa le seus pagamentos" ON public.pagamentos;
CREATE POLICY "Empresa le seus pagamentos" ON public.pagamentos
  FOR SELECT TO authenticated
  USING (
    empresa_id IN (SELECT id FROM public.empresas WHERE owner_id = auth.uid())
  );

DROP TRIGGER IF EXISTS trg_pag_updated ON public.pagamentos;
CREATE TRIGGER trg_pag_updated BEFORE UPDATE ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- TRIAL AUTOMÁTICO ao criar empresa
-- =====================================================
CREATE OR REPLACE FUNCTION public.criar_assinatura_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias int;
  v_plano uuid;
BEGIN
  SELECT dias_trial, plano_padrao_id INTO v_dias, v_plano
  FROM public.config_comercial WHERE id = true;

  IF v_dias IS NULL THEN v_dias := 7; END IF;

  INSERT INTO public.empresa_assinaturas (
    empresa_id, plano_id, status, data_inicio, data_expiracao
  ) VALUES (
    NEW.id, v_plano, 'trial', CURRENT_DATE, CURRENT_DATE + v_dias
  )
  ON CONFLICT (empresa_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresa_trial ON public.empresas;
CREATE TRIGGER trg_empresa_trial
  AFTER INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.criar_assinatura_trial();

-- Backfill: empresas existentes sem assinatura ganham trial
INSERT INTO public.empresa_assinaturas (empresa_id, plano_id, status, data_inicio, data_expiracao)
SELECT e.id, NULL, 'trial', CURRENT_DATE, CURRENT_DATE + 7
FROM public.empresas e
LEFT JOIN public.empresa_assinaturas a ON a.empresa_id = e.id
WHERE a.id IS NULL;

-- =====================================================
-- STATUS EFETIVO DA ASSINATURA
-- =====================================================
CREATE OR REPLACE FUNCTION public.assinatura_status_efetivo(_empresa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a RECORD;
  v_efetivo public.assinatura_status;
  v_readonly boolean := false;
  v_dias_restantes int;
BEGIN
  SELECT * INTO a FROM public.empresa_assinaturas WHERE empresa_id = _empresa_id;

  IF a.id IS NULL THEN
    RETURN jsonb_build_object(
      'status','vencido','readonly',true,'dias_restantes',0,
      'plano_id',NULL,'data_expiracao',NULL
    );
  END IF;

  v_efetivo := a.status;
  IF a.status IN ('trial','ativo')
     AND a.data_expiracao IS NOT NULL
     AND a.data_expiracao < CURRENT_DATE THEN
    v_efetivo := 'vencido';
  END IF;

  v_readonly := (v_efetivo = 'vencido' OR v_efetivo = 'cancelado');
  v_dias_restantes := COALESCE((a.data_expiracao - CURRENT_DATE), 0);

  RETURN jsonb_build_object(
    'status', v_efetivo,
    'readonly', v_readonly,
    'dias_restantes', v_dias_restantes,
    'plano_id', a.plano_id,
    'data_inicio', a.data_inicio,
    'data_expiracao', a.data_expiracao
  );
END;
$$;

-- Helper para o ERP do usuário logado
CREATE OR REPLACE FUNCTION public.minha_assinatura_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','vencido','readonly',true);
  END IF;
  SELECT id INTO v_emp FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1;
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('status','ativo','readonly',false,'sem_empresa',true);
  END IF;
  RETURN public.assinatura_status_efetivo(v_emp);
END;
$$;

-- =====================================================
-- RPCs ADMIN — PLANOS
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_planos()
RETURNS SETOF public.planos
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  RETURN QUERY SELECT * FROM public.planos ORDER BY ordem, nome;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_plano(
  _id uuid, _nome text, _descricao text, _valor numeric,
  _tipo_cobranca text, _limite_usuarios int, _limite_produtos int,
  _ativo boolean, _ordem int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.planos (nome, descricao, valor, tipo_cobranca, limite_usuarios, limite_produtos, ativo, ordem)
    VALUES (_nome, _descricao, COALESCE(_valor,0), _tipo_cobranca::public.plano_tipo_cobranca,
            _limite_usuarios, _limite_produtos, COALESCE(_ativo,true), COALESCE(_ordem,0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.planos SET
      nome = COALESCE(_nome,nome),
      descricao = _descricao,
      valor = COALESCE(_valor,valor),
      tipo_cobranca = COALESCE(_tipo_cobranca::public.plano_tipo_cobranca, tipo_cobranca),
      limite_usuarios = _limite_usuarios,
      limite_produtos = _limite_produtos,
      ativo = COALESCE(_ativo,ativo),
      ordem = COALESCE(_ordem,ordem)
    WHERE id = _id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_delete_plano(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  DELETE FROM public.planos WHERE id = _id;
END;$$;

-- =====================================================
-- RPCs ADMIN — MODULOS
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_modulos()
RETURNS SETOF public.modulos
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY SELECT * FROM public.modulos ORDER BY ordem, nome;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_modulo(
  _id uuid, _nome text, _chave text, _descricao text,
  _valor numeric, _ativo boolean, _aplica_restricao boolean, _ordem int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.modulos (nome, chave, descricao, valor, ativo, aplica_restricao, ordem)
    VALUES (_nome, lower(trim(_chave)), _descricao, COALESCE(_valor,0),
            COALESCE(_ativo,true), COALESCE(_aplica_restricao,false), COALESCE(_ordem,0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.modulos SET
      nome = COALESCE(_nome,nome),
      chave = COALESCE(lower(trim(_chave)),chave),
      descricao = _descricao,
      valor = COALESCE(_valor,valor),
      ativo = COALESCE(_ativo,ativo),
      aplica_restricao = COALESCE(_aplica_restricao,aplica_restricao),
      ordem = COALESCE(_ordem,ordem)
    WHERE id = _id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_delete_modulo(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  DELETE FROM public.modulos WHERE id = _id;
END;$$;

-- =====================================================
-- RPCs ADMIN — ASSINATURAS
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_assinaturas()
RETURNS TABLE(
  id uuid, empresa_id uuid, empresa_nome text, empresa_status text,
  plano_id uuid, plano_nome text, plano_valor numeric, plano_tipo text,
  status public.assinatura_status, status_efetivo text,
  data_inicio date, data_expiracao date, dias_restantes int,
  modulos_ativos int, observacoes text, updated_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT
    a.id, e.id, e.nome, e.status,
    p.id, p.nome, p.valor, p.tipo_cobranca::text,
    a.status,
    CASE
      WHEN a.status IN ('trial','ativo') AND a.data_expiracao IS NOT NULL AND a.data_expiracao < CURRENT_DATE
        THEN 'vencido'
      ELSE a.status::text
    END,
    a.data_inicio, a.data_expiracao,
    COALESCE(a.data_expiracao - CURRENT_DATE, 0),
    (SELECT COUNT(*)::int FROM public.empresa_modulos em WHERE em.empresa_id = e.id AND em.status = 'ativo'),
    a.observacoes, a.updated_at
  FROM public.empresas e
  LEFT JOIN public.empresa_assinaturas a ON a.empresa_id = e.id
  LEFT JOIN public.planos p ON p.id = a.plano_id
  ORDER BY e.nome;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_set_assinatura(
  _empresa_id uuid, _plano_id uuid, _status text,
  _data_inicio date, _data_expiracao date, _observacoes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  INSERT INTO public.empresa_assinaturas (empresa_id, plano_id, status, data_inicio, data_expiracao, observacoes)
  VALUES (_empresa_id, _plano_id, _status::public.assinatura_status,
          COALESCE(_data_inicio, CURRENT_DATE), _data_expiracao, _observacoes)
  ON CONFLICT (empresa_id) DO UPDATE SET
    plano_id = EXCLUDED.plano_id,
    status = EXCLUDED.status,
    data_inicio = EXCLUDED.data_inicio,
    data_expiracao = EXCLUDED.data_expiracao,
    observacoes = EXCLUDED.observacoes
  RETURNING id INTO v_id;
  RETURN v_id;
END;$$;

-- =====================================================
-- RPCs ADMIN — EMPRESA_MODULOS
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_empresa_modulos(_empresa_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, empresa_id uuid, empresa_nome text,
  modulo_id uuid, modulo_nome text, modulo_chave text,
  modulo_valor numeric, aplica_restricao boolean,
  status public.empresa_modulo_status,
  data_inicio date, data_expiracao date, observacoes text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT em.id, em.empresa_id, e.nome,
         m.id, m.nome, m.chave, m.valor, m.aplica_restricao,
         em.status, em.data_inicio, em.data_expiracao, em.observacoes
  FROM public.empresa_modulos em
  JOIN public.empresas e ON e.id = em.empresa_id
  JOIN public.modulos m ON m.id = em.modulo_id
  WHERE _empresa_id IS NULL OR em.empresa_id = _empresa_id
  ORDER BY e.nome, m.ordem, m.nome;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_set_empresa_modulo(
  _empresa_id uuid, _modulo_id uuid, _status text,
  _data_inicio date, _data_expiracao date, _observacoes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes)
  VALUES (_empresa_id, _modulo_id, _status::public.empresa_modulo_status,
          COALESCE(_data_inicio, CURRENT_DATE), _data_expiracao, _observacoes)
  ON CONFLICT (empresa_id, modulo_id) DO UPDATE SET
    status = EXCLUDED.status,
    data_inicio = EXCLUDED.data_inicio,
    data_expiracao = EXCLUDED.data_expiracao,
    observacoes = EXCLUDED.observacoes
  RETURNING id INTO v_id;
  RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_remover_empresa_modulo(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  DELETE FROM public.empresa_modulos WHERE id = _id;
END;$$;

-- =====================================================
-- RPCs ADMIN — PAGAMENTOS
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_pagamentos(_empresa_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, empresa_id uuid, empresa_nome text,
  referencia_tipo public.pagamento_referencia,
  plano_id uuid, plano_nome text,
  modulo_id uuid, modulo_nome text,
  descricao text, valor numeric, status public.pagamento_status,
  forma_pagamento text, data_vencimento date, data_pagamento date,
  observacoes text, created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT pg.id, pg.empresa_id, e.nome,
         pg.referencia_tipo,
         pg.plano_id, p.nome, pg.modulo_id, m.nome,
         pg.descricao, pg.valor, pg.status, pg.forma_pagamento,
         pg.data_vencimento, pg.data_pagamento, pg.observacoes, pg.created_at
  FROM public.pagamentos pg
  JOIN public.empresas e ON e.id = pg.empresa_id
  LEFT JOIN public.planos p ON p.id = pg.plano_id
  LEFT JOIN public.modulos m ON m.id = pg.modulo_id
  WHERE _empresa_id IS NULL OR pg.empresa_id = _empresa_id
  ORDER BY pg.created_at DESC;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento(
  _id uuid, _empresa_id uuid, _referencia_tipo text,
  _plano_id uuid, _modulo_id uuid, _descricao text,
  _valor numeric, _status text, _forma_pagamento text,
  _data_vencimento date, _data_pagamento date, _observacoes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.pagamentos (
      empresa_id, referencia_tipo, plano_id, modulo_id, descricao,
      valor, status, forma_pagamento, data_vencimento, data_pagamento,
      observacoes, registrado_por
    ) VALUES (
      _empresa_id, _referencia_tipo::public.pagamento_referencia, _plano_id, _modulo_id, _descricao,
      COALESCE(_valor,0), COALESCE(_status,'pendente')::public.pagamento_status,
      _forma_pagamento, _data_vencimento, _data_pagamento, _observacoes, auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.pagamentos SET
      empresa_id = COALESCE(_empresa_id, empresa_id),
      referencia_tipo = COALESCE(_referencia_tipo::public.pagamento_referencia, referencia_tipo),
      plano_id = _plano_id, modulo_id = _modulo_id,
      descricao = _descricao,
      valor = COALESCE(_valor, valor),
      status = COALESCE(_status::public.pagamento_status, status),
      forma_pagamento = _forma_pagamento,
      data_vencimento = _data_vencimento,
      data_pagamento = _data_pagamento,
      observacoes = _observacoes
    WHERE id = _id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_delete_pagamento(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  DELETE FROM public.pagamentos WHERE id = _id;
END;$$;

-- =====================================================
-- RPCs ADMIN — CONFIG COMERCIAL
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_get_config_comercial()
RETURNS public.config_comercial
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE c public.config_comercial;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT * INTO c FROM public.config_comercial WHERE id = true;
  RETURN c;
END;$$;

CREATE OR REPLACE FUNCTION public.admin_set_config_comercial(
  _dias_trial int, _permitir_modulos_no_trial boolean,
  _plano_padrao_id uuid, _valor_padrao_sistema numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE public.config_comercial SET
    dias_trial = COALESCE(_dias_trial, dias_trial),
    permitir_modulos_no_trial = COALESCE(_permitir_modulos_no_trial, permitir_modulos_no_trial),
    plano_padrao_id = _plano_padrao_id,
    valor_padrao_sistema = COALESCE(_valor_padrao_sistema, valor_padrao_sistema),
    updated_at = now()
  WHERE id = true;
END;$$;