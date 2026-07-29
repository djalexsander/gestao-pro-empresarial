-- Consolida a assinatura comercial como fonte oficial do plano exibido.
-- empresas.plano permanece apenas como fallback legado/free.

CREATE OR REPLACE FUNCTION public.status_assinatura_pt(_status text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE lower(COALESCE(_status, ''))
    WHEN 'active' THEN 'ativo'
    WHEN 'ativo' THEN 'ativo'
    WHEN 'pending' THEN 'pendente'
    WHEN 'pending_payment' THEN 'pendente'
    WHEN 'canceled' THEN 'cancelado'
    WHEN 'cancelled' THEN 'cancelado'
    WHEN 'cancelado' THEN 'cancelado'
    WHEN 'expired' THEN 'expirado'
    WHEN 'vencido' THEN 'expirado'
    WHEN 'trial' THEN 'período de teste'
    WHEN 'blocked' THEN 'bloqueado'
    WHEN 'bloqueado' THEN 'bloqueado'
    WHEN 'overdue' THEN 'atrasado'
    ELSE COALESCE(NULLIF(_status, ''), 'sem assinatura')
  END
$$;

DROP FUNCTION IF EXISTS public.admin_listar_empresas();
CREATE FUNCTION public.admin_listar_empresas()
RETURNS TABLE (
  id uuid, owner_id uuid, nome text, email text, telefone text, documento text,
  status text, plano text, observacoes text,
  created_at timestamptz, updated_at timestamptz,
  total_usuarios bigint, total_produtos bigint, total_vendas bigint,
  total_compras bigint, total_movimentacoes bigint,
  volume_vendas numeric, volume_compras numeric,
  plano_id uuid, plano_nome text, assinatura_status text,
  valor_contratado numeric, data_expiracao date, modulos_ativos integer,
  plano_gerenciado_assinatura boolean
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
    e.status,
    CASE WHEN ef.status_efetivo IN ('active','trial') THEN COALESCE(p.nome, 'Free') ELSE 'Free' END,
    e.observacoes, e.created_at, e.updated_at,
    (1 + (SELECT COUNT(*) FROM public.empresa_membros mem WHERE mem.empresa_id=e.id))::bigint,
    (SELECT COUNT(*) FROM public.produtos pr WHERE pr.owner_id=e.owner_id),
    (SELECT COUNT(*) FROM public.vendas v WHERE v.owner_id=e.owner_id),
    (SELECT COUNT(*) FROM public.compras c WHERE c.owner_id=e.owner_id),
    (SELECT COUNT(*) FROM public.estoque_movimentacoes m WHERE m.owner_id=e.owner_id),
    (SELECT COALESCE(SUM(v.total),0) FROM public.vendas v WHERE v.owner_id=e.owner_id AND v.status<>'cancelada'),
    (SELECT COALESCE(SUM(c.total),0) FROM public.compras c WHERE c.owner_id=e.owner_id AND c.status<>'cancelada'),
    CASE WHEN ef.status_efetivo IN ('active','trial') THEN a.plano_id END,
    CASE WHEN ef.status_efetivo IN ('active','trial') THEN COALESCE(p.nome, 'Período de teste') ELSE 'Free' END,
    public.status_assinatura_pt(CASE WHEN ef.status_efetivo IN ('active','trial') THEN ef.status_efetivo ELSE 'expired' END),
    CASE WHEN ef.status_efetivo IN ('active','trial') THEN COALESCE(a.valor_contratado,p.valor) END,
    CASE WHEN ef.status_efetivo IN ('active','trial') THEN a.data_expiracao END,
    (SELECT COUNT(*)::int FROM public.empresa_modulos em
      WHERE em.empresa_id=e.id AND em.status='ativo'
        AND (em.data_expiracao IS NULL OR em.data_expiracao>=CURRENT_DATE)),
    (ef.status_efetivo IN ('active','trial'))
  FROM public.empresas e
  LEFT JOIN public.empresa_assinaturas a ON a.empresa_id=e.id
  LEFT JOIN public.planos p ON p.id=a.plano_id
  LEFT JOIN LATERAL (
    SELECT public.assinatura_status_efetivo(e.id)->>'status' AS status_efetivo
  ) ef ON true
  ORDER BY e.created_at DESC;
END
$$;

-- O cadastro comum nunca altera uma assinatura. Mudança comercial continua
-- exclusiva nas RPCs da tela de assinaturas, onde efeitos e preço são explícitos.
CREATE OR REPLACE FUNCTION public.admin_upsert_empresa(
  _id uuid, _nome text, _email text DEFAULT NULL, _telefone text DEFAULT NULL,
  _documento text DEFAULT NULL, _plano text DEFAULT NULL, _observacoes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE v_actor uuid:=auth.uid(); v_id uuid;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE public.empresas SET nome=COALESCE(NULLIF(trim(_nome),''),nome),
    email=_email, telefone=_telefone,
    documento=NULLIF(regexp_replace(COALESCE(_documento,''),'\D','','g'),''),
    observacoes=_observacoes
  WHERE id=_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,metadata)
  VALUES(v_actor,'empresa.update','empresa',_id::text,jsonb_build_object('nome',_nome));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_assinaturas()
RETURNS TABLE(
  id uuid, empresa_id uuid, empresa_nome text, empresa_status text,
  plano_id uuid, plano_nome text, plano_valor numeric, plano_tipo text,
  status public.assinatura_status, status_efetivo text,
  data_inicio date, data_expiracao date, dias_restantes int,
  modulos_ativos int, observacoes text, updated_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY SELECT a.id,e.id,e.nome,e.status,p.id,p.nome,
    COALESCE(a.valor_contratado,p.valor),p.tipo_cobranca::text,a.status,
    public.status_assinatura_pt(public.assinatura_status_efetivo(e.id)->>'status'),
    a.data_inicio,a.data_expiracao,COALESCE(a.data_expiracao-CURRENT_DATE,0),
    (SELECT COUNT(*)::int FROM public.empresa_modulos em WHERE em.empresa_id=e.id
      AND em.status='ativo' AND (em.data_expiracao IS NULL OR em.data_expiracao>=CURRENT_DATE)),
    a.observacoes,a.updated_at
  FROM public.empresas e
  LEFT JOIN public.empresa_assinaturas a ON a.empresa_id=e.id
  LEFT JOIN public.planos p ON p.id=a.plano_id
  ORDER BY e.nome;
END
$$;

-- Catálogo mínimo para o formulário antes da autenticação.
CREATE OR REPLACE FUNCTION public.catalogo_planos_cadastro()
RETURNS TABLE(id uuid,nome text,valor numeric,tipo_cobranca text,modulos text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT p.id,p.nome,p.valor,p.tipo_cobranca::text,ARRAY[]::text[]
  FROM public.planos p
  WHERE p.ativo
  ORDER BY p.ordem,p.nome
$$;
REVOKE ALL ON FUNCTION public.catalogo_planos_cadastro() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogo_planos_cadastro() TO anon,authenticated;

-- Metadados são copiados ao criar a empresa. Plano pago vira cobrança pendente;
-- não vira trial nem assinatura ativa.
CREATE OR REPLACE FUNCTION public.criar_assinatura_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $$
DECLARE v_dias int; v_padrao uuid; v_desejado uuid; v_valor numeric;
BEGIN
  SELECT NULLIF(raw_user_meta_data->>'plano_desejado_id','')::uuid
    INTO v_desejado FROM auth.users WHERE id=NEW.owner_id;
  SELECT valor INTO v_valor FROM public.planos WHERE id=v_desejado AND ativo;
  IF v_desejado IS NOT NULL AND COALESCE(v_valor,0)>0 THEN RETURN NEW; END IF;
  IF v_desejado IS NOT NULL AND COALESCE(v_valor,0)=0 THEN
    INSERT INTO public.empresa_assinaturas(empresa_id,plano_id,status,data_inicio,data_expiracao)
    VALUES(NEW.id,v_desejado,'active',CURRENT_DATE,NULL)
    ON CONFLICT(empresa_id) DO NOTHING;
    RETURN NEW;
  END IF;
  SELECT dias_trial,plano_padrao_id INTO v_dias,v_padrao FROM public.config_comercial WHERE id=true;
  INSERT INTO public.empresa_assinaturas(empresa_id,plano_id,status,data_inicio,data_expiracao)
  VALUES(NEW.id,COALESCE(v_desejado,v_padrao),'trial',CURRENT_DATE,CURRENT_DATE+COALESCE(v_dias,7))
  ON CONFLICT(empresa_id) DO NOTHING;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.finalizar_cadastro_inicial()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $$
DECLARE u record; e_id uuid; p_id uuid; p record; pg_id uuid;
BEGIN
  SELECT * INTO u FROM auth.users WHERE id=auth.uid();
  IF u.id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  p_id:=NULLIF(u.raw_user_meta_data->>'plano_desejado_id','')::uuid;
  PERFORM public.garantir_empresa_atual(u.raw_user_meta_data->>'empresa_nome');
  SELECT id INTO e_id FROM public.empresas WHERE owner_id=u.id;
  UPDATE public.empresas SET
    nome=COALESCE(NULLIF(trim(u.raw_user_meta_data->>'empresa_nome'),''),nome),
    email=u.email,telefone=NULLIF(trim(u.raw_user_meta_data->>'telefone'),''),
    documento=NULLIF(regexp_replace(COALESCE(u.raw_user_meta_data->>'documento',''),'\D','','g'),'')
  WHERE id=e_id;
  SELECT * INTO p FROM public.planos WHERE id=p_id AND ativo;
  IF p.id IS NULL OR COALESCE(p.valor,0)=0 THEN RETURN NULL; END IF;
  SELECT pg.id INTO pg_id FROM public.pagamentos pg
  JOIN public.pagamento_itens pi ON pi.pagamento_id=pg.id AND pi.plano_id=p.id
  WHERE pg.empresa_id=e_id AND pg.status='pendente' LIMIT 1;
  IF pg_id IS NULL THEN
    INSERT INTO public.pagamentos(empresa_id,referencia_tipo,plano_id,descricao,valor,status,registrado_por)
    VALUES(e_id,'plano',p.id,'Cadastro inicial: '||p.nome,p.valor,'pendente',u.id) RETURNING id INTO pg_id;
    INSERT INTO public.pagamento_itens(pagamento_id,tipo,plano_id,descricao,valor)
    VALUES(pg_id,'plano',p.id,p.nome,p.valor);
  END IF;
  RETURN pg_id;
END
$$;
GRANT EXECUTE ON FUNCTION public.finalizar_cadastro_inicial() TO authenticated;

-- Realtime já inclui assinatura; pagamentos e módulos disparam refresh imediato.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pagamentos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.empresa_modulos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
