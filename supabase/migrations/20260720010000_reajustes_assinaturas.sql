BEGIN;

ALTER TABLE public.empresa_assinaturas
  ADD COLUMN IF NOT EXISTS valor_contratado numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_personalizado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proximo_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS reajuste_vigencia date,
  ADD COLUMN IF NOT EXISTS reajuste_na_renovacao boolean NOT NULL DEFAULT true;

ALTER TABLE public.empresa_modulos
  ADD COLUMN IF NOT EXISTS valor_contratado numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_personalizado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proximo_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS reajuste_vigencia date,
  ADD COLUMN IF NOT EXISTS reajuste_na_renovacao boolean NOT NULL DEFAULT true;

UPDATE public.empresa_assinaturas a
SET valor_contratado = p.valor
FROM public.planos p
WHERE p.id = a.plano_id AND a.valor_contratado IS NULL;

UPDATE public.empresa_modulos em
SET valor_contratado = m.valor
FROM public.modulos m
WHERE m.id = em.modulo_id AND em.valor_contratado IS NULL;

CREATE TABLE IF NOT EXISTS public.reajuste_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('plano','modulo')),
  plano_id uuid REFERENCES public.planos(id) ON DELETE SET NULL,
  modulo_id uuid REFERENCES public.modulos(id) ON DELETE SET NULL,
  valor_anterior numeric(14,2) NOT NULL,
  valor_novo numeric(14,2) NOT NULL,
  vigencia date NOT NULL,
  modo_aplicacao text NOT NULL CHECK (modo_aplicacao IN ('imediato','proxima_renovacao')),
  motivo text,
  alterado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aplicado_em timestamptz,
  CONSTRAINT reajuste_historico_item_chk CHECK (
    (tipo = 'plano' AND plano_id IS NOT NULL AND modulo_id IS NULL) OR
    (tipo = 'modulo' AND modulo_id IS NOT NULL AND plano_id IS NULL)
  )
);

ALTER TABLE public.reajuste_historico ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.empresa_assinaturas
  ADD COLUMN IF NOT EXISTS reajuste_historico_id uuid REFERENCES public.reajuste_historico(id) ON DELETE SET NULL;
ALTER TABLE public.empresa_modulos
  ADD COLUMN IF NOT EXISTS reajuste_historico_id uuid REFERENCES public.reajuste_historico(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reajuste_hist_empresa ON public.reajuste_historico(empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_assin_reajuste_vigencia ON public.empresa_assinaturas(reajuste_vigencia) WHERE proximo_valor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mod_reajuste_vigencia ON public.empresa_modulos(reajuste_vigencia) WHERE proximo_valor IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_reajustes_catalogo()
RETURNS TABLE (
  tipo text, item_id uuid, nome text, preco_catalogo numeric,
  preco_futuro numeric, empresas_ativas bigint, valor_medio_contratado numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT 'plano'::text, p.id, p.nome, p.valor,
         max(a.proximo_valor), count(a.id),
         round(avg(COALESCE(a.valor_contratado, p.valor)), 2)
  FROM public.planos p
  LEFT JOIN public.empresa_assinaturas a ON a.plano_id = p.id
    AND a.status::text IN ('ativo','active','trial','overdue','pending_payment')
  GROUP BY p.id, p.nome, p.valor
  UNION ALL
  SELECT 'modulo'::text, m.id, m.nome, m.valor,
         max(em.proximo_valor), count(em.id),
         round(avg(COALESCE(em.valor_contratado, m.valor)), 2)
  FROM public.modulos m
  LEFT JOIN public.empresa_modulos em ON em.modulo_id = m.id AND em.status::text = 'ativo'
  GROUP BY m.id, m.nome, m.valor
  ORDER BY 1, 3;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reajuste_empresas(_tipo text, _item_id uuid)
RETURNS TABLE (
  empresa_id uuid, empresa_nome text, plano_nome text,
  valor_contratado numeric, valor_personalizado boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _tipo = 'plano' THEN
    RETURN QUERY
    SELECT e.id, e.nome, p.nome, COALESCE(a.valor_contratado, p.valor), a.valor_personalizado
    FROM public.empresa_assinaturas a
    JOIN public.empresas e ON e.id = a.empresa_id
    JOIN public.planos p ON p.id = a.plano_id
    WHERE a.plano_id = _item_id
      AND a.status::text IN ('ativo','active','trial','overdue','pending_payment')
    ORDER BY e.nome;
  ELSIF _tipo = 'modulo' THEN
    RETURN QUERY
    SELECT e.id, e.nome, p.nome, COALESCE(em.valor_contratado, m.valor), em.valor_personalizado
    FROM public.empresa_modulos em
    JOIN public.empresas e ON e.id = em.empresa_id
    JOIN public.modulos m ON m.id = em.modulo_id
    LEFT JOIN public.empresa_assinaturas a ON a.empresa_id = e.id
    LEFT JOIN public.planos p ON p.id = a.plano_id
    WHERE em.modulo_id = _item_id AND em.status::text = 'ativo'
    ORDER BY e.nome;
  ELSE
    RAISE EXCEPTION 'Tipo inválido';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_aplicar_reajuste(
  _tipo text, _item_id uuid, _novo_valor numeric, _escopo text,
  _empresas uuid[] DEFAULT ARRAY[]::uuid[], _vigencia date DEFAULT CURRENT_DATE,
  _modo text DEFAULT 'proxima_renovacao', _motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record; v_hist uuid; v_count int := 0; v_aplicar_agora boolean;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _tipo NOT IN ('plano','modulo') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF _novo_valor IS NULL OR _novo_valor < 0 THEN RAISE EXCEPTION 'Novo valor inválido'; END IF;
  IF _escopo NOT IN ('novos','todos_ativos','empresas','plano_base','premium') THEN RAISE EXCEPTION 'Escopo inválido'; END IF;
  IF _modo NOT IN ('imediato','proxima_renovacao') THEN RAISE EXCEPTION 'Modo inválido'; END IF;
  IF _vigencia IS NULL THEN RAISE EXCEPTION 'Data de vigência obrigatória'; END IF;

  IF _tipo = 'plano' THEN UPDATE public.planos SET valor = _novo_valor WHERE id = _item_id;
  ELSE UPDATE public.modulos SET valor = _novo_valor WHERE id = _item_id; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do catálogo não encontrado'; END IF;
  IF _escopo = 'novos' THEN RETURN jsonb_build_object('ok', true, 'afetadas', 0); END IF;

  v_aplicar_agora := _modo = 'imediato' AND _vigencia <= CURRENT_DATE;
  FOR r IN
    SELECT x.* FROM (
      SELECT a.empresa_id, a.id vinculo_id, COALESCE(a.valor_contratado,p.valor) valor_anterior,
             a.plano_id, NULL::uuid modulo_id, p.nome plano_nome
      FROM public.empresa_assinaturas a JOIN public.planos p ON p.id=a.plano_id
      WHERE _tipo='plano' AND a.plano_id=_item_id AND NOT a.valor_personalizado
        AND a.status::text IN ('ativo','active','trial','overdue','pending_payment')
      UNION ALL
      SELECT em.empresa_id, em.id, COALESCE(em.valor_contratado,m.valor),
             a.plano_id, em.modulo_id, p.nome
      FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
      LEFT JOIN public.empresa_assinaturas a ON a.empresa_id=em.empresa_id
      LEFT JOIN public.planos p ON p.id=a.plano_id
      WHERE _tipo='modulo' AND em.modulo_id=_item_id AND NOT em.valor_personalizado
        AND em.status::text='ativo'
    ) x
    WHERE (_escopo='todos_ativos')
       OR (_escopo='empresas' AND x.empresa_id=ANY(COALESCE(_empresas,ARRAY[]::uuid[])))
       OR (_escopo='plano_base' AND lower(COALESCE(x.plano_nome,'')) LIKE '%base%')
       OR (_escopo='premium' AND lower(COALESCE(x.plano_nome,'')) LIKE '%premium%')
  LOOP
    INSERT INTO public.reajuste_historico(
      empresa_id,tipo,plano_id,modulo_id,valor_anterior,valor_novo,vigencia,
      modo_aplicacao,motivo,alterado_por,aplicado_em
    ) VALUES (
      r.empresa_id,_tipo,CASE WHEN _tipo='plano' THEN _item_id END,
      CASE WHEN _tipo='modulo' THEN _item_id END,r.valor_anterior,_novo_valor,_vigencia,
      _modo,NULLIF(trim(_motivo),''),auth.uid(),CASE WHEN v_aplicar_agora THEN now() END
    ) RETURNING id INTO v_hist;
    IF _tipo='plano' THEN
      UPDATE public.empresa_assinaturas SET
        valor_contratado=CASE WHEN v_aplicar_agora THEN _novo_valor ELSE valor_contratado END,
        proximo_valor=CASE WHEN v_aplicar_agora THEN NULL ELSE _novo_valor END,
        reajuste_vigencia=CASE WHEN v_aplicar_agora THEN NULL ELSE _vigencia END,
        reajuste_na_renovacao=(_modo='proxima_renovacao'),
        reajuste_historico_id=CASE WHEN v_aplicar_agora THEN NULL ELSE v_hist END
      WHERE id=r.vinculo_id;
    ELSE
      UPDATE public.empresa_modulos SET
        valor_contratado=CASE WHEN v_aplicar_agora THEN _novo_valor ELSE valor_contratado END,
        proximo_valor=CASE WHEN v_aplicar_agora THEN NULL ELSE _novo_valor END,
        reajuste_vigencia=CASE WHEN v_aplicar_agora THEN NULL ELSE _vigencia END,
        reajuste_na_renovacao=(_modo='proxima_renovacao'),
        reajuste_historico_id=CASE WHEN v_aplicar_agora THEN NULL ELSE v_hist END
      WHERE id=r.vinculo_id;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'afetadas',v_count,'aplicado_agora',v_aplicar_agora);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reajuste_historico(_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid, empresa_nome text, tipo text, item_nome text, valor_anterior numeric,
  valor_novo numeric, vigencia date, modo_aplicacao text, motivo text,
  alterado_por uuid, criado_em timestamptz, aplicado_em timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY SELECT h.id,e.nome,h.tipo,COALESCE(p.nome,m.nome),h.valor_anterior,h.valor_novo,
    h.vigencia,h.modo_aplicacao,h.motivo,h.alterado_por,h.criado_em,h.aplicado_em
  FROM public.reajuste_historico h JOIN public.empresas e ON e.id=h.empresa_id
  LEFT JOIN public.planos p ON p.id=h.plano_id LEFT JOIN public.modulos m ON m.id=h.modulo_id
  ORDER BY h.criado_em DESC LIMIT LEAST(GREATEST(_limit,1),500);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_obter_preco_assinatura(_empresa_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT valor_contratado,valor_personalizado,proximo_valor,reajuste_vigencia INTO r
  FROM public.empresa_assinaturas WHERE empresa_id=_empresa_id;
  RETURN to_jsonb(r);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_preco_assinatura(
  _empresa_id uuid,_valor numeric,_personalizado boolean,_motivo text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a record; v_hist uuid; BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _valor IS NULL OR _valor<0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  SELECT * INTO a FROM public.empresa_assinaturas WHERE empresa_id=_empresa_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Assinatura não encontrada'; END IF;
  IF COALESCE(a.valor_contratado,0)<>_valor THEN
    INSERT INTO public.reajuste_historico(empresa_id,tipo,plano_id,valor_anterior,valor_novo,
      vigencia,modo_aplicacao,motivo,alterado_por,aplicado_em)
    VALUES(_empresa_id,'plano',a.plano_id,COALESCE(a.valor_contratado,0),_valor,CURRENT_DATE,
      'imediato',NULLIF(trim(_motivo),''),auth.uid(),now()) RETURNING id INTO v_hist;
  END IF;
  UPDATE public.empresa_assinaturas SET valor_contratado=_valor,valor_personalizado=_personalizado,
    proximo_valor=NULL,reajuste_vigencia=NULL,reajuste_historico_id=NULL WHERE id=a.id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_preco_modulo(
  _empresa_id uuid,_modulo_id uuid,_valor numeric,_personalizado boolean,_motivo text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a record; v_hist uuid; BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _valor IS NULL OR _valor<0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  SELECT * INTO a FROM public.empresa_modulos WHERE empresa_id=_empresa_id AND modulo_id=_modulo_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Módulo da empresa não encontrado'; END IF;
  IF COALESCE(a.valor_contratado,0)<>_valor THEN
    INSERT INTO public.reajuste_historico(empresa_id,tipo,modulo_id,valor_anterior,valor_novo,
      vigencia,modo_aplicacao,motivo,alterado_por,aplicado_em)
    VALUES(_empresa_id,'modulo',_modulo_id,COALESCE(a.valor_contratado,0),_valor,CURRENT_DATE,
      'imediato',NULLIF(trim(_motivo),''),auth.uid(),now()) RETURNING id INTO v_hist;
  END IF;
  UPDATE public.empresa_modulos SET valor_contratado=_valor,valor_personalizado=_personalizado,
    proximo_valor=NULL,reajuste_vigencia=NULL,reajuste_historico_id=NULL WHERE id=a.id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_obter_precos_modulos(_empresa_id uuid)
RETURNS TABLE(
  modulo_id uuid,
  valor_contratado numeric,
  valor_personalizado boolean,
  proximo_valor numeric,
  reajuste_vigencia date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT em.modulo_id,COALESCE(em.valor_contratado,m.valor),em.valor_personalizado,
    em.proximo_valor,em.reajuste_vigencia
  FROM public.empresa_modulos em
  JOIN public.modulos m ON m.id=em.modulo_id
  WHERE em.empresa_id=_empresa_id;
END; $$;

REVOKE ALL ON FUNCTION public.admin_reajustes_catalogo() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_reajuste_empresas(text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_aplicar_reajuste(text,uuid,numeric,text,uuid[],date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_reajuste_historico(int) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_obter_preco_assinatura(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_set_preco_assinatura(uuid,numeric,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_set_preco_modulo(uuid,uuid,numeric,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_obter_precos_modulos(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_reajustes_catalogo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reajuste_empresas(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_aplicar_reajuste(text,uuid,numeric,text,uuid[],date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reajuste_historico(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_obter_preco_assinatura(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_preco_assinatura(uuid,numeric,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_preco_modulo(uuid,uuid,numeric,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_obter_precos_modulos(uuid) TO authenticated;

-- A renovação aplica preços programados elegíveis e usa os valores contratados.
CREATE OR REPLACE FUNCTION public.solicitar_mensalidade()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_empresa uuid; v_assin record; v_pag uuid; v_total numeric:=0; v_desc text; v_mod record; v_qtd int:=0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_empresa:=public.current_empresa_id(); IF v_empresa IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  SELECT a.*,p.nome,p.tipo_cobranca,p.valor valor_catalogo INTO v_assin
  FROM public.empresa_assinaturas a JOIN public.planos p ON p.id=a.plano_id
  WHERE a.empresa_id=v_empresa AND a.status::text IN ('active','ativo','trial','overdue','pending_payment','expired')
  ORDER BY a.updated_at DESC LIMIT 1;
  IF v_assin.id IS NULL THEN RAISE EXCEPTION 'Nenhum plano associado à empresa'; END IF;

  IF v_assin.proximo_valor IS NOT NULL AND v_assin.reajuste_vigencia<=CURRENT_DATE THEN
    UPDATE public.reajuste_historico SET aplicado_em=COALESCE(aplicado_em,now()) WHERE id=v_assin.reajuste_historico_id;
    UPDATE public.empresa_assinaturas SET valor_contratado=proximo_valor,proximo_valor=NULL,
      reajuste_vigencia=NULL,reajuste_historico_id=NULL WHERE id=v_assin.id;
    v_assin.valor_contratado:=v_assin.proximo_valor;
  END IF;
  UPDATE public.reajuste_historico h SET aplicado_em=COALESCE(h.aplicado_em,now())
  FROM public.empresa_modulos em WHERE em.empresa_id=v_empresa AND em.proximo_valor IS NOT NULL
    AND em.reajuste_vigencia<=CURRENT_DATE AND h.id=em.reajuste_historico_id;
  UPDATE public.empresa_modulos SET valor_contratado=proximo_valor,proximo_valor=NULL,
    reajuste_vigencia=NULL,reajuste_historico_id=NULL
  WHERE empresa_id=v_empresa AND proximo_valor IS NOT NULL AND reajuste_vigencia<=CURRENT_DATE;

  SELECT id INTO v_pag FROM public.pagamentos WHERE empresa_id=v_empresa AND referencia_tipo='outro'
    AND status='pendente' AND descricao LIKE 'Mensalidade%' AND asaas_payment_id IS NULL
    ORDER BY created_at DESC LIMIT 1;
  IF v_pag IS NOT NULL THEN RETURN v_pag; END IF;

  v_total:=COALESCE(v_assin.valor_contratado,v_assin.valor_catalogo,0);
  FOR v_mod IN SELECT m.id,m.nome,COALESCE(em.valor_contratado,m.valor) valor
    FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
    WHERE em.empresa_id=v_empresa AND em.status='ativo' AND COALESCE(em.valor_contratado,m.valor)>0
  LOOP v_total:=v_total+v_mod.valor; v_qtd:=v_qtd+1; END LOOP;
  v_desc:='Mensalidade Plano '||v_assin.nome||CASE WHEN v_qtd>0 THEN ' + '||v_qtd||' módulo(s)' ELSE '' END;
  INSERT INTO public.pagamentos(empresa_id,referencia_tipo,descricao,valor,status,registrado_por)
  VALUES(v_empresa,'outro',v_desc,v_total,'pendente',auth.uid()) RETURNING id INTO v_pag;
  INSERT INTO public.pagamento_itens(pagamento_id,tipo,plano_id,descricao,valor)
  VALUES(v_pag,'plano',v_assin.plano_id,'Plano '||v_assin.nome,COALESCE(v_assin.valor_contratado,v_assin.valor_catalogo,0));
  FOR v_mod IN SELECT m.id,m.nome,COALESCE(em.valor_contratado,m.valor) valor
    FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
    WHERE em.empresa_id=v_empresa AND em.status='ativo' AND COALESCE(em.valor_contratado,m.valor)>0
  LOOP INSERT INTO public.pagamento_itens(pagamento_id,tipo,modulo_id,descricao,valor)
    VALUES(v_pag,'modulo',v_mod.id,'Módulo '||v_mod.nome,v_mod.valor); END LOOP;
  RETURN v_pag;
END; $$;
GRANT EXECUTE ON FUNCTION public.solicitar_mensalidade() TO authenticated;

-- Captura o valor efetivamente pago na ativação existente, sem alterar a RPC do webhook.
CREATE OR REPLACE FUNCTION public.set_valor_contratado_assinatura()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_valor numeric;
BEGIN
  IF TG_OP='UPDATE' AND OLD.valor_personalizado AND OLD.plano_id IS NOT DISTINCT FROM NEW.plano_id THEN
    NEW.valor_contratado:=OLD.valor_contratado; NEW.valor_personalizado:=true; RETURN NEW;
  END IF;
  SELECT pi.valor INTO v_valor FROM public.pagamento_itens pi
  JOIN public.pagamentos pg ON pg.id=pi.pagamento_id
  WHERE pg.empresa_id=NEW.empresa_id AND pg.status='pago' AND pi.tipo='plano' AND pi.plano_id=NEW.plano_id
  ORDER BY pg.data_pagamento DESC NULLS LAST,pg.created_at DESC LIMIT 1;
  IF v_valor IS NULL THEN SELECT valor INTO v_valor FROM public.planos WHERE id=NEW.plano_id; END IF;
  NEW.valor_contratado:=COALESCE(v_valor,NEW.valor_contratado,0);
  IF TG_OP='INSERT' OR OLD.plano_id IS DISTINCT FROM NEW.plano_id THEN NEW.valor_personalizado:=false; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_assin_valor_contratado ON public.empresa_assinaturas;
CREATE TRIGGER trg_assin_valor_contratado BEFORE INSERT OR UPDATE OF plano_id,status,data_inicio
ON public.empresa_assinaturas FOR EACH ROW EXECUTE FUNCTION public.set_valor_contratado_assinatura();

CREATE OR REPLACE FUNCTION public.set_valor_contratado_modulo()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_valor numeric;
BEGIN
  IF TG_OP='UPDATE' AND OLD.valor_personalizado AND OLD.modulo_id=NEW.modulo_id THEN
    NEW.valor_contratado:=OLD.valor_contratado; NEW.valor_personalizado:=true; RETURN NEW;
  END IF;
  SELECT pi.valor INTO v_valor FROM public.pagamento_itens pi
  JOIN public.pagamentos pg ON pg.id=pi.pagamento_id
  WHERE pg.empresa_id=NEW.empresa_id AND pg.status='pago' AND pi.tipo='modulo' AND pi.modulo_id=NEW.modulo_id
  ORDER BY pg.data_pagamento DESC NULLS LAST,pg.created_at DESC LIMIT 1;
  IF v_valor IS NULL THEN SELECT valor INTO v_valor FROM public.modulos WHERE id=NEW.modulo_id; END IF;
  NEW.valor_contratado:=COALESCE(v_valor,NEW.valor_contratado,0);
  IF TG_OP='INSERT' THEN NEW.valor_personalizado:=false; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_modulo_valor_contratado ON public.empresa_modulos;
CREATE TRIGGER trg_modulo_valor_contratado BEFORE INSERT OR UPDATE OF modulo_id,status,data_inicio
ON public.empresa_modulos FOR EACH ROW EXECUTE FUNCTION public.set_valor_contratado_modulo();

COMMIT;
