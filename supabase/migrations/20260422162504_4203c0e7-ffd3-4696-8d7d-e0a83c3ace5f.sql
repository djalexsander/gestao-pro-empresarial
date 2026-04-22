-- 2. Função para verificar se é super_admin (helper rápido)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

-- 3. Tabela de auditoria
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin lê audit logs" ON public.audit_logs;
CREATE POLICY "Super admin lê audit logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Usuário registra suas próprias ações" ON public.audit_logs;
CREATE POLICY "Usuário registra suas próprias ações"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- 4. Estatísticas globais agregadas (sem expor conteúdo)
CREATE OR REPLACE FUNCTION public.admin_estatisticas_globais()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  SELECT jsonb_build_object(
    'total_usuarios',         (SELECT COUNT(*) FROM auth.users),
    'usuarios_30d',           (SELECT COUNT(*) FROM auth.users WHERE created_at >= now() - interval '30 days'),
    'usuarios_7d',            (SELECT COUNT(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'usuarios_confirmados',   (SELECT COUNT(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL),
    'total_empresas',         (SELECT COUNT(DISTINCT owner_id) FROM public.produtos),
    'total_produtos',         (SELECT COUNT(*) FROM public.produtos),
    'total_clientes',         (SELECT COUNT(*) FROM public.clientes),
    'total_fornecedores',     (SELECT COUNT(*) FROM public.fornecedores),
    'total_vendas',           (SELECT COUNT(*) FROM public.vendas),
    'total_compras',          (SELECT COUNT(*) FROM public.compras),
    'total_movimentacoes',    (SELECT COUNT(*) FROM public.estoque_movimentacoes),
    'volume_vendas_total',    (SELECT COALESCE(SUM(total),0) FROM public.vendas WHERE status <> 'cancelada'),
    'volume_compras_total',   (SELECT COALESCE(SUM(total),0) FROM public.compras WHERE status <> 'cancelada')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 5. Listar usuários (sem acesso a conteúdo das empresas)
CREATE OR REPLACE FUNCTION public.admin_listar_usuarios()
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  roles text[],
  total_produtos bigint,
  total_vendas bigint,
  total_compras bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
    COALESCE(
      (SELECT array_agg(ur.role::text ORDER BY ur.role)
       FROM public.user_roles ur WHERE ur.user_id = u.id),
      ARRAY[]::text[]
    ) AS roles,
    (SELECT COUNT(*) FROM public.produtos p WHERE p.owner_id = u.id) AS total_produtos,
    (SELECT COUNT(*) FROM public.vendas v WHERE v.owner_id = u.id)   AS total_vendas,
    (SELECT COUNT(*) FROM public.compras c WHERE c.owner_id = u.id)  AS total_compras
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$;

-- 6. Atribuir / remover papel
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  _user_id uuid,
  _role app_role,
  _grant boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  -- não permitir auto-remoção de super_admin
  IF _role = 'super_admin' AND _grant = false AND _user_id = v_actor THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio papel super_admin';
  END IF;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;

  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, metadata)
  VALUES (
    v_actor, v_actor_email,
    CASE WHEN _grant THEN 'role.grant' ELSE 'role.revoke' END,
    'user', _user_id::text,
    jsonb_build_object('role', _role::text)
  );
END;
$$;

-- 7. Remover usuário (e tudo dele via cascade onde houver)
CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_target_email text;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  IF _user_id = v_actor THEN
    RAISE EXCEPTION 'Você não pode excluir sua própria conta';
  END IF;

  SELECT email INTO v_target_email FROM auth.users WHERE id = _user_id;
  SELECT email INTO v_actor_email  FROM auth.users WHERE id = v_actor;

  -- Limpa dados owned (caso não haja FK cascade)
  DELETE FROM public.user_roles            WHERE user_id  = _user_id;
  DELETE FROM public.estoque_movimentacoes WHERE owner_id = _user_id;
  DELETE FROM public.venda_itens           WHERE owner_id = _user_id;
  DELETE FROM public.compra_itens          WHERE owner_id = _user_id;
  DELETE FROM public.vendas                WHERE owner_id = _user_id;
  DELETE FROM public.compras               WHERE owner_id = _user_id;
  DELETE FROM public.financeiro_lancamentos WHERE owner_id = _user_id;
  DELETE FROM public.categorias_financeiras WHERE owner_id = _user_id;
  DELETE FROM public.lotes_produto         WHERE owner_id = _user_id;
  DELETE FROM public.produto_variacoes     WHERE owner_id = _user_id;
  DELETE FROM public.produtos              WHERE owner_id = _user_id;
  DELETE FROM public.categorias_produto    WHERE owner_id = _user_id;
  DELETE FROM public.clientes              WHERE owner_id = _user_id;
  DELETE FROM public.fornecedores          WHERE owner_id = _user_id;
  DELETE FROM public.configuracoes_empresa WHERE owner_id = _user_id;

  DELETE FROM auth.users WHERE id = _user_id;

  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, metadata)
  VALUES (
    v_actor, v_actor_email, 'user.delete', 'user', _user_id::text,
    jsonb_build_object('email', v_target_email)
  );
END;
$$;

-- 8. Listar audit logs (helper paginado)
CREATE OR REPLACE FUNCTION public.admin_listar_audit_logs(_limit int DEFAULT 200)
RETURNS SETOF public.audit_logs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas super administradores';
  END IF;

  RETURN QUERY
  SELECT * FROM public.audit_logs
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 1000));
END;
$$;
