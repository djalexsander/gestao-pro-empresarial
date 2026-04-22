-- =====================================================
-- PAINEL MASTER: tabela empresas + RPCs de gestão
-- =====================================================

-- 1) Tabela empresas
CREATE TABLE IF NOT EXISTS public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE,
  nome text NOT NULL,
  email text,
  telefone text,
  documento text,
  status text NOT NULL DEFAULT 'ativa',
  plano text NOT NULL DEFAULT 'free',
  observacoes text,
  bloqueada_em timestamptz,
  bloqueada_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresas_status_check CHECK (status IN ('ativa','inativa','bloqueada')),
  CONSTRAINT empresas_plano_check  CHECK (plano IN ('free','starter','pro','enterprise'))
);

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS empresas_set_updated_at ON public.empresas;
CREATE TRIGGER empresas_set_updated_at
BEFORE UPDATE ON public.empresas
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "Dono acessa sua empresa" ON public.empresas;
CREATE POLICY "Dono acessa sua empresa"
ON public.empresas FOR ALL
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Super admin acessa todas as empresas" ON public.empresas;
CREATE POLICY "Super admin acessa todas as empresas"
ON public.empresas FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- garante empresa do usuário atual
CREATE OR REPLACE FUNCTION public.garantir_empresa_atual(_nome text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT id INTO v_id FROM public.empresas WHERE owner_id = v_uid;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.empresas (owner_id, nome, email, status, plano)
  VALUES (
    v_uid,
    COALESCE(NULLIF(trim(_nome), ''), split_part(v_email, '@', 1), 'Minha Empresa'),
    v_email, 'ativa', 'free'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Backfill empresas
INSERT INTO public.empresas (owner_id, nome, email, status, plano)
SELECT u.id, COALESCE(split_part(u.email, '@', 1), 'Empresa'), u.email, 'ativa', 'free'
FROM auth.users u
LEFT JOIN public.empresas e ON e.owner_id = u.id
WHERE e.id IS NULL;

-- =====================================================
-- 2) DROPs prévios para permitir mudança de assinatura
-- =====================================================
DROP FUNCTION IF EXISTS public.admin_listar_usuarios();
DROP FUNCTION IF EXISTS public.admin_listar_empresas();
DROP FUNCTION IF EXISTS public.admin_serie_crescimento(integer);

-- =====================================================
-- 3) RPCs admin: empresas
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_empresas()
RETURNS TABLE (
  id uuid, owner_id uuid, nome text, email text, telefone text, documento text,
  status text, plano text, observacoes text,
  created_at timestamptz, updated_at timestamptz,
  total_usuarios bigint, total_produtos bigint, total_vendas bigint,
  total_compras bigint, total_movimentacoes bigint,
  volume_vendas numeric, volume_compras numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  RETURN QUERY
  SELECT
    e.id, e.owner_id, e.nome, e.email, e.telefone, e.documento,
    e.status, e.plano, e.observacoes, e.created_at, e.updated_at,
    1::bigint AS total_usuarios,
    (SELECT COUNT(*) FROM public.produtos p WHERE p.owner_id = e.owner_id) AS total_produtos,
    (SELECT COUNT(*) FROM public.vendas   v WHERE v.owner_id = e.owner_id) AS total_vendas,
    (SELECT COUNT(*) FROM public.compras  c WHERE c.owner_id = e.owner_id) AS total_compras,
    (SELECT COUNT(*) FROM public.estoque_movimentacoes m WHERE m.owner_id = e.owner_id) AS total_movimentacoes,
    (SELECT COALESCE(SUM(total),0) FROM public.vendas v WHERE v.owner_id = e.owner_id AND v.status <> 'cancelada') AS volume_vendas,
    (SELECT COALESCE(SUM(total),0) FROM public.compras c WHERE c.owner_id = e.owner_id AND c.status <> 'cancelada') AS volume_compras
  FROM public.empresas e
  ORDER BY e.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_empresa(
  _id uuid,
  _nome text,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _documento text DEFAULT NULL,
  _plano text DEFAULT 'free',
  _observacoes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_id uuid;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;
  IF _id IS NULL THEN RAISE EXCEPTION 'ID da empresa é obrigatório'; END IF;

  UPDATE public.empresas
     SET nome=COALESCE(_nome,nome), email=_email, telefone=_telefone,
         documento=_documento, plano=COALESCE(_plano,plano), observacoes=_observacoes
   WHERE id=_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id=v_actor;
  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, metadata)
  VALUES (v_actor, v_actor_email, 'empresa.update', 'empresa', _id::text,
          jsonb_build_object('nome',_nome,'plano',_plano));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_empresa_status(
  _id uuid, _status text, _motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;
  IF _status NOT IN ('ativa','inativa','bloqueada') THEN
    RAISE EXCEPTION 'Status inválido';
  END IF;

  UPDATE public.empresas
     SET status=_status,
         bloqueada_em=CASE WHEN _status='bloqueada' THEN now() ELSE NULL END,
         bloqueada_motivo=CASE WHEN _status='bloqueada' THEN _motivo ELSE NULL END
   WHERE id=_id;

  SELECT email INTO v_actor_email FROM auth.users WHERE id=v_actor;
  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, metadata)
  VALUES (v_actor, v_actor_email, 'empresa.status', 'empresa', _id::text,
          jsonb_build_object('status',_status,'motivo',_motivo));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_empresa(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_owner uuid;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;
  SELECT owner_id INTO v_owner FROM public.empresas WHERE id=_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  PERFORM public.admin_delete_user(v_owner);

  SELECT email INTO v_actor_email FROM auth.users WHERE id=v_actor;
  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, metadata)
  VALUES (v_actor, v_actor_email, 'empresa.delete', 'empresa', _id::text,
          jsonb_build_object('owner_id',v_owner));
END;
$$;

-- =====================================================
-- 4) Série temporal de crescimento
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_serie_crescimento(_dias integer DEFAULT 30)
RETURNS TABLE (
  data date, novos_usuarios bigint, novas_empresas bigint,
  total_usuarios_acum bigint, total_empresas_acum bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;
  RETURN QUERY
  WITH dias AS (
    SELECT generate_series(
      (CURRENT_DATE - (GREATEST(_dias,1) - 1) * INTERVAL '1 day')::date,
      CURRENT_DATE, INTERVAL '1 day'
    )::date AS d
  ),
  u AS (SELECT (created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*) AS c FROM auth.users GROUP BY 1),
  e AS (SELECT (created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*) AS c FROM public.empresas GROUP BY 1)
  SELECT
    dias.d, COALESCE(u.c,0), COALESCE(e.c,0),
    (SELECT COUNT(*) FROM auth.users      WHERE (created_at AT TIME ZONE 'UTC')::date <= dias.d),
    (SELECT COUNT(*) FROM public.empresas WHERE (created_at AT TIME ZONE 'UTC')::date <= dias.d)
  FROM dias
  LEFT JOIN u ON u.d=dias.d
  LEFT JOIN e ON e.d=dias.d
  ORDER BY dias.d;
END;
$$;

-- =====================================================
-- 5) admin_estatisticas_globais (atualizada)
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_estatisticas_globais()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  SELECT jsonb_build_object(
    'total_usuarios',         (SELECT COUNT(*) FROM auth.users),
    'usuarios_30d',           (SELECT COUNT(*) FROM auth.users WHERE created_at >= now() - interval '30 days'),
    'usuarios_7d',            (SELECT COUNT(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'usuarios_confirmados',   (SELECT COUNT(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL),
    'usuarios_ativos_30d',    (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'),
    'total_empresas',         (SELECT COUNT(*) FROM public.empresas),
    'empresas_ativas',        (SELECT COUNT(*) FROM public.empresas WHERE status='ativa'),
    'empresas_inativas',      (SELECT COUNT(*) FROM public.empresas WHERE status='inativa'),
    'empresas_bloqueadas',    (SELECT COUNT(*) FROM public.empresas WHERE status='bloqueada'),
    'empresas_30d',           (SELECT COUNT(*) FROM public.empresas WHERE created_at >= now() - interval '30 days'),
    'empresas_7d',            (SELECT COUNT(*) FROM public.empresas WHERE created_at >= now() - interval '7 days'),
    'total_produtos',         (SELECT COUNT(*) FROM public.produtos),
    'total_clientes',         (SELECT COUNT(*) FROM public.clientes),
    'total_fornecedores',     (SELECT COUNT(*) FROM public.fornecedores),
    'total_vendas',           (SELECT COUNT(*) FROM public.vendas),
    'total_compras',          (SELECT COUNT(*) FROM public.compras),
    'total_movimentacoes',    (SELECT COUNT(*) FROM public.estoque_movimentacoes),
    'volume_vendas_total',    (SELECT COALESCE(SUM(total),0) FROM public.vendas WHERE status<>'cancelada'),
    'volume_compras_total',   (SELECT COALESCE(SUM(total),0) FROM public.compras WHERE status<>'cancelada')
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- =====================================================
-- 6) admin_listar_usuarios (atualizada com empresa)
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_listar_usuarios()
RETURNS TABLE (
  user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  email_confirmed boolean, roles text[],
  empresa_id uuid, empresa_nome text, empresa_status text, empresa_plano text,
  total_produtos bigint, total_vendas bigint, total_compras bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;
  RETURN QUERY
  SELECT
    u.id, u.email::text, u.created_at, u.last_sign_in_at,
    (u.email_confirmed_at IS NOT NULL),
    COALESCE(
      (SELECT array_agg(ur.role::text ORDER BY ur.role) FROM public.user_roles ur WHERE ur.user_id=u.id),
      ARRAY[]::text[]
    ),
    e.id, e.nome, e.status, e.plano,
    (SELECT COUNT(*) FROM public.produtos p WHERE p.owner_id=u.id),
    (SELECT COUNT(*) FROM public.vendas v   WHERE v.owner_id=u.id),
    (SELECT COUNT(*) FROM public.compras c  WHERE c.owner_id=u.id)
  FROM auth.users u
  LEFT JOIN public.empresas e ON e.owner_id=u.id
  ORDER BY u.created_at DESC;
END;
$$;

-- =====================================================
-- 7) registrar_audit_log (do client autenticado)
-- =====================================================
CREATE OR REPLACE FUNCTION public.registrar_audit_log(
  _action text,
  _target_type text DEFAULT NULL,
  _target_id text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE v_actor uuid := auth.uid(); v_email text;
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id=v_actor;
  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, metadata)
  VALUES (v_actor, v_email, _action, _target_type, _target_id, COALESCE(_metadata,'{}'::jsonb));
END;
$$;