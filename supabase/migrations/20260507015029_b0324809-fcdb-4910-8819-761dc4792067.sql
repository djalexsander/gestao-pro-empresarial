-- =========================================================
-- Cartões de autorização (múltiplos por empresa)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.autorizacao_cartoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  rotulo text NOT NULL,
  funcao text,
  funcionario_id uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  user_id uuid,
  codigo_hash text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  usado_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autorizacao_cartoes_owner ON public.autorizacao_cartoes(owner_id);
CREATE INDEX IF NOT EXISTS idx_autorizacao_cartoes_ativo ON public.autorizacao_cartoes(owner_id, ativo);

ALTER TABLE public.autorizacao_cartoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono acessa cartoes autorizacao" ON public.autorizacao_cartoes;
CREATE POLICY "Dono acessa cartoes autorizacao"
  ON public.autorizacao_cartoes FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Admins acessam cartoes autorizacao" ON public.autorizacao_cartoes;
CREATE POLICY "Admins acessam cartoes autorizacao"
  ON public.autorizacao_cartoes FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = autorizacao_cartoes.owner_id
        AND m.papel = ANY(ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = autorizacao_cartoes.owner_id
        AND m.papel = ANY(ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
    )
  );

CREATE OR REPLACE FUNCTION public.set_autorizacao_cartao_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_autorizacao_cartoes_updated_at ON public.autorizacao_cartoes;
CREATE TRIGGER trg_autorizacao_cartoes_updated_at
BEFORE UPDATE ON public.autorizacao_cartoes
FOR EACH ROW EXECUTE FUNCTION public.set_autorizacao_cartao_updated_at();

-- ---------- Helper: resolve owner do usuário autenticado ----------
CREATE OR REPLACE FUNCTION public.autorizacao_resolver_owner()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT COALESCE(
    (SELECT e.owner_id FROM public.empresas e WHERE e.owner_id = auth.uid() LIMIT 1),
    (SELECT e.owner_id FROM public.empresa_membros m JOIN public.empresas e ON e.id = m.empresa_id WHERE m.user_id = auth.uid() LIMIT 1)
  ) INTO v_owner;
  RETURN v_owner;
END $$;

-- ---------- Criar cartão ----------
CREATE OR REPLACE FUNCTION public.autorizacao_cartao_criar(
  _rotulo text,
  _codigo text,
  _funcionario_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT NULL,
  _funcao text DEFAULT NULL,
  _observacoes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_owner uuid := public.autorizacao_resolver_owner();
  v_id uuid;
  v_pode boolean;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa associada'; END IF;
  -- só owner ou admin
  SELECT (v_owner = auth.uid()) OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid() AND e.owner_id = v_owner
      AND m.papel = ANY(ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
  ) INTO v_pode;
  IF NOT v_pode THEN RAISE EXCEPTION 'Sem permissão para criar cartões'; END IF;

  IF _codigo IS NULL OR length(_codigo) < 8 THEN
    RAISE EXCEPTION 'Código inválido';
  END IF;

  INSERT INTO public.autorizacao_cartoes (
    owner_id, rotulo, funcao, funcionario_id, user_id,
    codigo_hash, criado_por, observacoes
  ) VALUES (
    v_owner, _rotulo, _funcao, _funcionario_id, _user_id,
    extensions.crypt(_codigo, extensions.gen_salt('bf')),
    auth.uid(), _observacoes
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ---------- Revogar / reativar cartão ----------
CREATE OR REPLACE FUNCTION public.autorizacao_cartao_set_ativo(_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid := public.autorizacao_resolver_owner();
  v_pode boolean;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa associada'; END IF;
  SELECT (v_owner = auth.uid()) OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid() AND e.owner_id = v_owner
      AND m.papel = ANY(ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
  ) INTO v_pode;
  IF NOT v_pode THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  UPDATE public.autorizacao_cartoes
     SET ativo = _ativo,
         revogado_em = CASE WHEN _ativo THEN NULL ELSE now() END,
         revogado_por = CASE WHEN _ativo THEN NULL ELSE auth.uid() END
   WHERE id = _id AND owner_id = v_owner;
END $$;

-- ---------- Excluir cartão ----------
CREATE OR REPLACE FUNCTION public.autorizacao_cartao_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid := public.autorizacao_resolver_owner();
  v_pode boolean;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa associada'; END IF;
  SELECT (v_owner = auth.uid()) OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid() AND e.owner_id = v_owner
      AND m.papel = ANY(ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
  ) INTO v_pode;
  IF NOT v_pode THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  DELETE FROM public.autorizacao_cartoes WHERE id = _id AND owner_id = v_owner;
END $$;

-- ---------- Validar autorização (atualizada) ----------
CREATE OR REPLACE FUNCTION public.autorizacao_validar(
  _acao autorizacao_acao, _metodo autorizacao_metodo, _payload jsonb, _contexto text,
  _contexto_dados jsonb DEFAULT '{}'::jsonb,
  _valor_envolvido numeric DEFAULT NULL,
  _diferenca_caixa numeric DEFAULT NULL,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id text DEFAULT NULL,
  _solicitante_funcionario_id uuid DEFAULT NULL,
  _terminal_id uuid DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_owner uuid; v_cfg public.autorizacoes_config; v_ok boolean := false;
  v_autorizador_funcionario_id uuid; v_autorizador_user_id uuid;
  v_autorizador_nome text; v_motivo text; v_funcionario record;
  v_cartao record; v_codigo text; v_papel_membro empresa_papel;
BEGIN
  v_owner := public.autorizacao_resolver_owner();
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
      IF NOT FOUND THEN v_motivo := 'Funcionário não autorizado';
      ELSIF v_funcionario.pin_hash = extensions.crypt(_payload->>'pin', v_funcionario.pin_hash) THEN
        v_ok := true;
        v_autorizador_funcionario_id := v_funcionario.id;
        v_autorizador_nome := v_funcionario.nome;
      ELSE v_motivo := 'PIN incorreto'; END IF;
    END IF;

  ELSIF _metodo = 'senha_master' THEN
    IF NOT v_cfg.metodo_senha_master_habilitado OR v_cfg.senha_master_hash IS NULL THEN
      v_motivo := 'Método senha master não habilitado';
    ELSIF v_cfg.senha_master_hash = extensions.crypt(_payload->>'senha', v_cfg.senha_master_hash) THEN
      v_ok := true; v_autorizador_user_id := v_owner; v_autorizador_nome := 'Senha master';
    ELSE v_motivo := 'Senha master incorreta'; END IF;

  ELSIF _metodo = 'codigo_qr' THEN
    IF NOT v_cfg.metodo_codigo_qr_habilitado THEN
      v_motivo := 'Método código QR não habilitado';
    ELSE
      v_codigo := COALESCE(_payload->>'codigo', '');
      -- Procura nos cartões ativos
      FOR v_cartao IN
        SELECT * FROM public.autorizacao_cartoes
        WHERE owner_id = v_owner AND ativo = true
      LOOP
        IF v_cartao.codigo_hash = extensions.crypt(v_codigo, v_cartao.codigo_hash) THEN
          -- Validar permissão do usuário vinculado (se houver)
          IF v_cartao.funcionario_id IS NOT NULL THEN
            SELECT f.* INTO v_funcionario FROM public.funcionarios f
            WHERE f.id = v_cartao.funcionario_id AND f.ativo = true
              AND f.role = ANY(v_cfg.papeis_autorizadores);
            IF NOT FOUND THEN
              v_motivo := 'Funcionário do cartão não autorizado';
              EXIT;
            END IF;
            v_autorizador_funcionario_id := v_funcionario.id;
            v_autorizador_nome := v_funcionario.nome || ' (' || v_cartao.rotulo || ')';
          ELSIF v_cartao.user_id IS NOT NULL THEN
            -- Verifica se ainda é owner ou membro admin
            IF v_cartao.user_id = v_owner THEN
              v_autorizador_user_id := v_owner;
              v_autorizador_nome := COALESCE(v_cartao.rotulo, 'Dono');
            ELSE
              SELECT m.papel INTO v_papel_membro
              FROM public.empresa_membros m
              JOIN public.empresas e ON e.id = m.empresa_id
              WHERE m.user_id = v_cartao.user_id AND e.owner_id = v_owner
              LIMIT 1;
              IF v_papel_membro IS NULL OR NOT (v_papel_membro::text = ANY(SELECT unnest(v_cfg.papeis_autorizadores)::text)) THEN
                v_motivo := 'Usuário do cartão não autorizado';
                EXIT;
              END IF;
              v_autorizador_user_id := v_cartao.user_id;
              v_autorizador_nome := COALESCE(v_cartao.rotulo, 'Membro');
            END IF;
          ELSE
            -- Cartão genérico (sem vínculo)
            v_autorizador_user_id := v_owner;
            v_autorizador_nome := COALESCE(v_cartao.rotulo, 'Cartão da empresa');
          END IF;
          v_ok := true;
          UPDATE public.autorizacao_cartoes SET usado_em = now() WHERE id = v_cartao.id;
          EXIT;
        END IF;
      END LOOP;
      -- Fallback: código global antigo (se ainda existir e não houve match)
      IF NOT v_ok AND v_motivo IS NULL AND v_cfg.codigo_qr_hash IS NOT NULL THEN
        IF v_cfg.codigo_qr_hash = extensions.crypt(v_codigo, v_cfg.codigo_qr_hash) THEN
          v_ok := true; v_autorizador_user_id := v_owner;
          v_autorizador_nome := COALESCE(v_cfg.codigo_qr_label, 'Código de autorização');
        END IF;
      END IF;
      IF NOT v_ok AND v_motivo IS NULL THEN
        v_motivo := 'Código de autorização inválido';
      END IF;
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
END $$;

-- ---------- Migrar codigo_qr_hash legado para cartão genérico ----------
INSERT INTO public.autorizacao_cartoes (owner_id, rotulo, codigo_hash, observacoes, ativo)
SELECT c.owner_id,
       COALESCE(NULLIF(c.codigo_qr_label, ''), 'Cartão da empresa'),
       c.codigo_qr_hash,
       'Migrado automaticamente do código único anterior. Sem usuário vinculado.',
       true
FROM public.autorizacoes_config c
WHERE c.codigo_qr_hash IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.autorizacao_cartoes ac
    WHERE ac.owner_id = c.owner_id AND ac.codigo_hash = c.codigo_qr_hash
  );