
-- 1) Fix mutable search_path
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public;
ALTER FUNCTION public.set_autorizacao_cartao_updated_at() SET search_path = public;

-- 2) Authorization log: block direct writes from clients
REVOKE INSERT, UPDATE, DELETE ON public.autorizacoes_log FROM authenticated, anon;

DROP POLICY IF EXISTS "Bloquear insert autorizacoes_log" ON public.autorizacoes_log;
CREATE POLICY "Bloquear insert autorizacoes_log" ON public.autorizacoes_log
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "Bloquear update autorizacoes_log" ON public.autorizacoes_log;
CREATE POLICY "Bloquear update autorizacoes_log" ON public.autorizacoes_log
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Bloquear delete autorizacoes_log" ON public.autorizacoes_log;
CREATE POLICY "Bloquear delete autorizacoes_log" ON public.autorizacoes_log
  FOR DELETE TO authenticated USING (false);

-- 3) Restrict user_roles management to super_admin only
DROP POLICY IF EXISTS "Admins gerenciam papéis" ON public.user_roles;
CREATE POLICY "Super admins gerenciam papéis" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- 4) Hide pareamento_token column from non-admins via column grants
REVOKE SELECT ON public.terminais FROM authenticated;
GRANT SELECT (
  id, owner_id, nome, descricao, ativo, identificador_dispositivo,
  ultimo_uso, created_at, updated_at, papel, heartbeat_at,
  operador_atual_id, operador_atual_nome, user_agent, ip_local,
  pode_pdv, pode_erp, pode_financeiro, pode_configuracoes,
  pode_relatorios, pode_cadastros
) ON public.terminais TO authenticated;

CREATE OR REPLACE FUNCTION public.terminal_obter_pareamento_token(_terminal_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.pareamento_token
  FROM public.terminais t
  WHERE t.id = _terminal_id
    AND (
      t.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.empresa_membros m
        JOIN public.empresas e ON e.id = m.empresa_id
        WHERE m.user_id = auth.uid()
          AND e.owner_id = t.owner_id
          AND m.papel IN ('owner'::empresa_papel, 'admin'::empresa_papel)
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.terminal_obter_pareamento_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_obter_pareamento_token(uuid) TO authenticated;
