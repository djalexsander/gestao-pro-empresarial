
CREATE TYPE public.autorizacao_metodo AS ENUM ('pin_funcionario', 'senha_master', 'codigo_qr');
CREATE TYPE public.autorizacao_status AS ENUM ('autorizado', 'negado');
CREATE TYPE public.autorizacao_acao AS ENUM (
  'fechar_caixa_divergencia','fechar_caixa_qualquer','remover_item_venda','cancelar_venda',
  'cancelar_compra','excluir_lancamento_financeiro','alterar_valor_confirmado','reabrir_caixa'
);

CREATE TABLE public.autorizacoes_config (
  owner_id uuid PRIMARY KEY,
  exigir_fechar_caixa_divergencia boolean NOT NULL DEFAULT true,
  exigir_fechar_caixa_qualquer boolean NOT NULL DEFAULT false,
  exigir_remover_item_venda boolean NOT NULL DEFAULT true,
  exigir_cancelar_venda boolean NOT NULL DEFAULT true,
  exigir_cancelar_compra boolean NOT NULL DEFAULT true,
  exigir_excluir_lancamento_financeiro boolean NOT NULL DEFAULT true,
  exigir_alterar_valor_confirmado boolean NOT NULL DEFAULT true,
  exigir_reabrir_caixa boolean NOT NULL DEFAULT true,
  metodo_pin_habilitado boolean NOT NULL DEFAULT true,
  metodo_senha_master_habilitado boolean NOT NULL DEFAULT false,
  metodo_codigo_qr_habilitado boolean NOT NULL DEFAULT false,
  senha_master_hash text,
  codigo_qr_hash text,
  codigo_qr_label text,
  papeis_autorizadores app_role[] NOT NULL DEFAULT ARRAY['admin','gerente']::app_role[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.autorizacoes_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa autorizacoes_config" ON public.autorizacoes_config FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros admin acessam autorizacoes_config" ON public.autorizacoes_config FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM empresa_membros m JOIN empresas e ON e.id=m.empresa_id WHERE m.user_id=auth.uid() AND e.owner_id=autorizacoes_config.owner_id AND m.papel IN ('owner','admin')))
  WITH CHECK (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM empresa_membros m JOIN empresas e ON e.id=m.empresa_id WHERE m.user_id=auth.uid() AND e.owner_id=autorizacoes_config.owner_id AND m.papel IN ('owner','admin')));

CREATE TRIGGER trg_autorizacoes_config_updated_at BEFORE UPDATE ON public.autorizacoes_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.autorizacoes_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  acao autorizacao_acao NOT NULL,
  metodo autorizacao_metodo NOT NULL,
  status autorizacao_status NOT NULL,
  solicitante_funcionario_id uuid,
  solicitante_user_id uuid,
  autorizador_funcionario_id uuid,
  autorizador_user_id uuid,
  autorizador_nome text,
  contexto text NOT NULL,
  contexto_dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  valor_envolvido numeric,
  diferenca_caixa numeric,
  referencia_tipo text,
  referencia_id text,
  motivo_negacao text,
  terminal_id uuid,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_autorizacoes_log_owner_created ON public.autorizacoes_log (owner_id, created_at DESC);
CREATE INDEX idx_autorizacoes_log_acao ON public.autorizacoes_log (owner_id, acao);

ALTER TABLE public.autorizacoes_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono le autorizacoes_log" ON public.autorizacoes_log FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM empresa_membros m JOIN empresas e ON e.id=m.empresa_id WHERE m.user_id=auth.uid() AND e.owner_id=autorizacoes_log.owner_id AND m.papel IN ('owner','admin')));

-- Helper: resolve owner_id para o usuário autenticado
CREATE OR REPLACE FUNCTION public._auth_owner_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT id FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1),
    (SELECT e.owner_id FROM public.empresa_membros m JOIN public.empresas e ON e.id=m.empresa_id WHERE m.user_id = auth.uid() LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.autorizacoes_config_obter()
RETURNS public.autorizacoes_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner uuid; v_row public.autorizacoes_config;
BEGIN
  SELECT COALESCE(
    (SELECT owner_id FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1),
    auth.uid()
  ) INTO v_owner;
  -- garante que é dono ou admin/membro com acesso a esse owner
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  -- usa owner_id real do auth (caso seja membro, busca empresa)
  SELECT COALESCE(
    (SELECT e.owner_id FROM public.empresas e WHERE e.owner_id = auth.uid() LIMIT 1),
    (SELECT e.owner_id FROM public.empresa_membros m JOIN public.empresas e ON e.id=m.empresa_id WHERE m.user_id=auth.uid() LIMIT 1)
  ) INTO v_owner;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa associada'; END IF;

  SELECT * INTO v_row FROM public.autorizacoes_config WHERE owner_id = v_owner;
  IF NOT FOUND THEN
    INSERT INTO public.autorizacoes_config (owner_id) VALUES (v_owner) RETURNING * INTO v_row;
  END IF;
  v_row.senha_master_hash := CASE WHEN v_row.senha_master_hash IS NOT NULL THEN '***' ELSE NULL END;
  v_row.codigo_qr_hash := CASE WHEN v_row.codigo_qr_hash IS NOT NULL THEN '***' ELSE NULL END;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.autorizacoes_config_salvar(_payload jsonb)
RETURNS public.autorizacoes_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_owner uuid; v_row public.autorizacoes_config; v_senha text; v_codigo text;
BEGIN
  SELECT COALESCE(
    (SELECT e.owner_id FROM public.empresas e WHERE e.owner_id = auth.uid() LIMIT 1),
    (SELECT e.owner_id FROM public.empresa_membros m JOIN public.empresas e ON e.id=m.empresa_id WHERE m.user_id=auth.uid() AND m.papel IN ('owner','admin') LIMIT 1)
  ) INTO v_owner;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sem permissão para alterar autorizações'; END IF;

  INSERT INTO public.autorizacoes_config (owner_id) VALUES (v_owner) ON CONFLICT (owner_id) DO NOTHING;

  v_senha := NULLIF(_payload->>'senha_master_nova','');
  v_codigo := NULLIF(_payload->>'codigo_qr_novo','');

  UPDATE public.autorizacoes_config SET
    exigir_fechar_caixa_divergencia = COALESCE((_payload->>'exigir_fechar_caixa_divergencia')::boolean, exigir_fechar_caixa_divergencia),
    exigir_fechar_caixa_qualquer = COALESCE((_payload->>'exigir_fechar_caixa_qualquer')::boolean, exigir_fechar_caixa_qualquer),
    exigir_remover_item_venda = COALESCE((_payload->>'exigir_remover_item_venda')::boolean, exigir_remover_item_venda),
    exigir_cancelar_venda = COALESCE((_payload->>'exigir_cancelar_venda')::boolean, exigir_cancelar_venda),
    exigir_cancelar_compra = COALESCE((_payload->>'exigir_cancelar_compra')::boolean, exigir_cancelar_compra),
    exigir_excluir_lancamento_financeiro = COALESCE((_payload->>'exigir_excluir_lancamento_financeiro')::boolean, exigir_excluir_lancamento_financeiro),
    exigir_alterar_valor_confirmado = COALESCE((_payload->>'exigir_alterar_valor_confirmado')::boolean, exigir_alterar_valor_confirmado),
    exigir_reabrir_caixa = COALESCE((_payload->>'exigir_reabrir_caixa')::boolean, exigir_reabrir_caixa),
    metodo_pin_habilitado = COALESCE((_payload->>'metodo_pin_habilitado')::boolean, metodo_pin_habilitado),
    metodo_senha_master_habilitado = COALESCE((_payload->>'metodo_senha_master_habilitado')::boolean, metodo_senha_master_habilitado),
    metodo_codigo_qr_habilitado = COALESCE((_payload->>'metodo_codigo_qr_habilitado')::boolean, metodo_codigo_qr_habilitado),
    senha_master_hash = CASE WHEN v_senha IS NOT NULL THEN extensions.crypt(v_senha, extensions.gen_salt('bf', 8)) ELSE senha_master_hash END,
    codigo_qr_hash   = CASE WHEN v_codigo IS NOT NULL THEN extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)) ELSE codigo_qr_hash END,
    codigo_qr_label  = COALESCE(_payload->>'codigo_qr_label', codigo_qr_label),
    papeis_autorizadores = COALESCE(
      (SELECT array_agg(value::app_role) FROM jsonb_array_elements_text(_payload->'papeis_autorizadores')),
      papeis_autorizadores
    )
  WHERE owner_id = v_owner
  RETURNING * INTO v_row;

  v_row.senha_master_hash := CASE WHEN v_row.senha_master_hash IS NOT NULL THEN '***' ELSE NULL END;
  v_row.codigo_qr_hash := CASE WHEN v_row.codigo_qr_hash IS NOT NULL THEN '***' ELSE NULL END;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.autorizacao_validar(
  _acao autorizacao_acao,
  _metodo autorizacao_metodo,
  _payload jsonb,
  _contexto text,
  _contexto_dados jsonb DEFAULT '{}'::jsonb,
  _valor_envolvido numeric DEFAULT NULL,
  _diferenca_caixa numeric DEFAULT NULL,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id text DEFAULT NULL,
  _solicitante_funcionario_id uuid DEFAULT NULL,
  _terminal_id uuid DEFAULT NULL,
  _user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_owner uuid; v_cfg public.autorizacoes_config; v_ok boolean := false;
  v_autorizador_funcionario_id uuid; v_autorizador_user_id uuid;
  v_autorizador_nome text; v_motivo text; v_funcionario record;
BEGIN
  SELECT COALESCE(
    (SELECT e.owner_id FROM public.empresas e WHERE e.owner_id = auth.uid() LIMIT 1),
    (SELECT e.owner_id FROM public.empresa_membros m JOIN public.empresas e ON e.id=m.empresa_id WHERE m.user_id=auth.uid() LIMIT 1)
  ) INTO v_owner;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa associada'; END IF;

  SELECT * INTO v_cfg FROM public.autorizacoes_config WHERE owner_id = v_owner;
  IF NOT FOUND THEN
    INSERT INTO public.autorizacoes_config (owner_id) VALUES (v_owner) RETURNING * INTO v_cfg;
  END IF;

  IF _metodo = 'pin_funcionario' THEN
    IF NOT v_cfg.metodo_pin_habilitado THEN
      v_motivo := 'Método PIN não habilitado';
    ELSE
      SELECT f.* INTO v_funcionario FROM public.funcionarios f
      WHERE f.id = (_payload->>'funcionario_id')::uuid
        AND f.owner_id = v_owner AND f.ativo = true
        AND f.role = ANY(v_cfg.papeis_autorizadores);
      IF NOT FOUND THEN
        v_motivo := 'Funcionário não autorizado';
      ELSIF v_funcionario.pin_hash = extensions.crypt(_payload->>'pin', v_funcionario.pin_hash) THEN
        v_ok := true;
        v_autorizador_funcionario_id := v_funcionario.id;
        v_autorizador_nome := v_funcionario.nome;
      ELSE
        v_motivo := 'PIN incorreto';
      END IF;
    END IF;
  ELSIF _metodo = 'senha_master' THEN
    IF NOT v_cfg.metodo_senha_master_habilitado OR v_cfg.senha_master_hash IS NULL THEN
      v_motivo := 'Método senha master não habilitado';
    ELSIF v_cfg.senha_master_hash = extensions.crypt(_payload->>'senha', v_cfg.senha_master_hash) THEN
      v_ok := true; v_autorizador_user_id := v_owner; v_autorizador_nome := 'Senha master';
    ELSE
      v_motivo := 'Senha master incorreta';
    END IF;
  ELSIF _metodo = 'codigo_qr' THEN
    IF NOT v_cfg.metodo_codigo_qr_habilitado OR v_cfg.codigo_qr_hash IS NULL THEN
      v_motivo := 'Método código QR não habilitado';
    ELSIF v_cfg.codigo_qr_hash = extensions.crypt(_payload->>'codigo', v_cfg.codigo_qr_hash) THEN
      v_ok := true; v_autorizador_user_id := v_owner;
      v_autorizador_nome := COALESCE(v_cfg.codigo_qr_label, 'Código de autorização');
    ELSE
      v_motivo := 'Código de autorização inválido';
    END IF;
  ELSE
    v_motivo := 'Método desconhecido';
  END IF;

  INSERT INTO public.autorizacoes_log (
    owner_id, acao, metodo, status,
    solicitante_funcionario_id, solicitante_user_id,
    autorizador_funcionario_id, autorizador_user_id, autorizador_nome,
    contexto, contexto_dados, valor_envolvido, diferenca_caixa,
    referencia_tipo, referencia_id, motivo_negacao, terminal_id, user_agent
  ) VALUES (
    v_owner, _acao, _metodo,
    CASE WHEN v_ok THEN 'autorizado'::autorizacao_status ELSE 'negado'::autorizacao_status END,
    _solicitante_funcionario_id, auth.uid(),
    v_autorizador_funcionario_id, v_autorizador_user_id, v_autorizador_nome,
    _contexto, COALESCE(_contexto_dados,'{}'::jsonb), _valor_envolvido, _diferenca_caixa,
    _referencia_tipo, _referencia_id, CASE WHEN v_ok THEN NULL ELSE v_motivo END,
    _terminal_id, _user_agent
  );

  RETURN jsonb_build_object('autorizado', v_ok, 'motivo', v_motivo, 'autorizador_nome', v_autorizador_nome);
END;
$$;

GRANT EXECUTE ON FUNCTION public.autorizacoes_config_obter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.autorizacoes_config_salvar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autorizacao_validar(autorizacao_acao, autorizacao_metodo, jsonb, text, jsonb, numeric, numeric, text, text, uuid, uuid, text) TO authenticated;
