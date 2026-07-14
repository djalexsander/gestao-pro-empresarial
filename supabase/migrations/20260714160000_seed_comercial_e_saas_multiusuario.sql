BEGIN;

-- Catálogo comercial oficial: somente chaves com gate efetivo no frontend.
INSERT INTO public.modulos (
  id, nome, chave, descricao, valor, ativo, aplica_restricao, ordem
) VALUES
  (
    '71000000-0000-4000-8000-000000000001'::uuid,
    'Financeiro Avançado',
    'financeiro_avancado',
    'Contas a pagar e receber, fiado, fluxo de caixa e recursos financeiros avançados.',
    0, true, true, 10
  ),
  (
    '71000000-0000-4000-8000-000000000002'::uuid,
    'Relatórios',
    'relatorios',
    'Relatórios gerenciais, financeiros, fiscais, de estoque, caixa, compras e vendas.',
    0, true, true, 20
  )
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  chave = EXCLUDED.chave,
  descricao = EXCLUDED.descricao,
  valor = EXCLUDED.valor,
  ativo = EXCLUDED.ativo,
  aplica_restricao = EXCLUDED.aplica_restricao,
  ordem = EXCLUDED.ordem,
  updated_at = now();

-- Falha explicitamente se uma chave oficial estiver ligada a outro UUID.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.modulos
    WHERE chave = 'financeiro_avancado'
      AND id <> '71000000-0000-4000-8000-000000000001'::uuid
  ) OR EXISTS (
    SELECT 1
    FROM public.modulos
    WHERE chave = 'relatorios'
      AND id <> '71000000-0000-4000-8000-000000000002'::uuid
  ) THEN
    RAISE EXCEPTION 'Conflito de UUID nas chaves oficiais de módulos';
  END IF;
END;
$$;

INSERT INTO public.planos (
  id, nome, descricao, valor, tipo_cobranca,
  limite_usuarios, limite_produtos, ativo, ordem
) VALUES
  (
    '72000000-0000-4000-8000-000000000001'::uuid,
    'Trial Gratuito',
    'Plano gratuito para avaliação do Gestão Pro.',
    0, 'mensal'::public.plano_tipo_cobranca,
    2, 100, true, 10
  ),
  (
    '72000000-0000-4000-8000-000000000002'::uuid,
    'Completo para Testes',
    'Plano completo sem cobrança, destinado a validação funcional.',
    0, 'vitalicio'::public.plano_tipo_cobranca,
    NULL, NULL, true, 20
  )
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  valor = EXCLUDED.valor,
  tipo_cobranca = EXCLUDED.tipo_cobranca,
  limite_usuarios = EXCLUDED.limite_usuarios,
  limite_produtos = EXCLUDED.limite_produtos,
  ativo = EXCLUDED.ativo,
  ordem = EXCLUDED.ordem,
  updated_at = now();

-- Os dois gates são rotas do ERP. O modo PDV não possui gate comercial próprio.
INSERT INTO public.mode_modules (mode_id, module_id)
SELECT sm.id, m.id
FROM public.system_modes sm
CROSS JOIN public.modulos m
WHERE sm.chave = 'erp'
  AND m.chave IN ('financeiro_avancado', 'relatorios')
ON CONFLICT (mode_id, module_id) DO NOTHING;

-- Resolução determinística: owner primeiro; depois o vínculo mais antigo em empresa ativa.
CREATE OR REPLACE FUNCTION public.current_empresa_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT e.id
      FROM public.empresas e
      WHERE e.owner_id = auth.uid()
        AND e.status = 'ativa'
      ORDER BY e.created_at, e.id
      LIMIT 1
    ),
    (
      SELECT m.empresa_id
      FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.status = 'ativa'
      ORDER BY m.created_at, m.empresa_id
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_empresa_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.minha_assinatura_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status', 'expired', 'readonly', true);
  END IF;

  v_emp := public.current_empresa_id();
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'active', 'readonly', false, 'sem_empresa', true
    );
  END IF;

  RETURN public.assinatura_status_efetivo(v_emp);
END;
$$;

GRANT EXECUTE ON FUNCTION public.minha_assinatura_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.meus_modulos()
RETURNS TABLE (
  modulo_id uuid,
  chave text,
  nome text,
  descricao text,
  valor numeric,
  aplica_restricao boolean,
  liberado boolean,
  origem text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_assinatura_status text;
  v_permitir_trial boolean;
BEGIN
  v_empresa_id := public.current_empresa_id();

  IF v_empresa_id IS NULL THEN
    RETURN QUERY
    SELECT m.id, m.chave, m.nome, m.descricao, m.valor, m.aplica_restricao,
           NOT m.aplica_restricao,
           CASE WHEN m.aplica_restricao THEN 'bloqueado' ELSE 'sem_restricao' END
    FROM public.modulos m
    WHERE m.ativo = true
    ORDER BY m.ordem, m.nome;
    RETURN;
  END IF;

  SELECT (public.assinatura_status_efetivo(v_empresa_id)->>'status')
    INTO v_assinatura_status;

  SELECT permitir_modulos_no_trial
    INTO v_permitir_trial
  FROM public.config_comercial
  WHERE id = true;
  v_permitir_trial := COALESCE(v_permitir_trial, true);

  RETURN QUERY
  SELECT
    m.id, m.chave, m.nome, m.descricao, m.valor, m.aplica_restricao,
    CASE
      WHEN NOT m.aplica_restricao THEN true
      WHEN EXISTS (
        SELECT 1
        FROM public.empresa_modulos em
        WHERE em.empresa_id = v_empresa_id
          AND em.modulo_id = m.id
          AND em.status = 'ativo'
          AND (em.data_expiracao IS NULL OR em.data_expiracao >= CURRENT_DATE)
      ) THEN true
      WHEN v_assinatura_status = 'trial' AND v_permitir_trial THEN true
      ELSE false
    END,
    CASE
      WHEN NOT m.aplica_restricao THEN 'sem_restricao'
      WHEN EXISTS (
        SELECT 1
        FROM public.empresa_modulos em
        WHERE em.empresa_id = v_empresa_id
          AND em.modulo_id = m.id
          AND em.status = 'ativo'
          AND (em.data_expiracao IS NULL OR em.data_expiracao >= CURRENT_DATE)
      ) THEN 'ativo'
      WHEN v_assinatura_status = 'trial' AND v_permitir_trial THEN 'trial'
      ELSE 'bloqueado'
    END
  FROM public.modulos m
  WHERE m.ativo = true
  ORDER BY m.ordem, m.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.meus_modulos() TO authenticated;

CREATE OR REPLACE FUNCTION public.planos_disponiveis()
RETURNS TABLE (
  id uuid, nome text, descricao text, valor numeric,
  tipo_cobranca public.plano_tipo_cobranca,
  limite_usuarios integer, limite_produtos integer, ordem integer, atual boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH minha_assin AS (
    SELECT a.plano_id
    FROM public.empresa_assinaturas a
    WHERE a.empresa_id = public.current_empresa_id()
    ORDER BY a.updated_at DESC
    LIMIT 1
  )
  SELECT p.id, p.nome, p.descricao, p.valor, p.tipo_cobranca,
         p.limite_usuarios, p.limite_produtos, p.ordem,
         COALESCE(p.id = (SELECT plano_id FROM minha_assin), false)
  FROM public.planos p
  WHERE p.ativo = true
  ORDER BY p.ordem, p.valor;
$$;

REVOKE ALL ON FUNCTION public.planos_disponiveis() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.planos_disponiveis() TO authenticated;

CREATE OR REPLACE FUNCTION public.modulos_disponiveis_cliente()
RETURNS TABLE (
  id uuid, nome text, chave text, descricao text, valor numeric,
  aplica_restricao boolean, status text, data_expiracao date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.nome, m.chave, m.descricao, m.valor, m.aplica_restricao,
         COALESCE(em.status::text, 'nao_contratado'), em.data_expiracao
  FROM public.modulos m
  LEFT JOIN public.empresa_modulos em
    ON em.modulo_id = m.id
   AND em.empresa_id = public.current_empresa_id()
  WHERE m.ativo = true
  ORDER BY m.ordem, m.nome;
$$;

REVOKE ALL ON FUNCTION public.modulos_disponiveis_cliente() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modulos_disponiveis_cliente() TO authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_contratacao_plano(_plano_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid := public.current_empresa_id();
  v_valor numeric;
  v_nome text;
  v_pgto_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  SELECT valor, nome INTO v_valor, v_nome
  FROM public.planos WHERE id = _plano_id AND ativo = true;
  IF v_valor IS NULL THEN RAISE EXCEPTION 'Plano inválido'; END IF;

  SELECT id INTO v_pgto_id
  FROM public.pagamentos
  WHERE empresa_id = v_empresa_id
    AND referencia_tipo = 'plano'
    AND plano_id = _plano_id
    AND status = 'pendente'
  ORDER BY created_at DESC LIMIT 1;
  IF v_pgto_id IS NOT NULL THEN RETURN v_pgto_id; END IF;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, plano_id, descricao, valor, status, registrado_por
  ) VALUES (
    v_empresa_id, 'plano', _plano_id,
    'Contratação solicitada: ' || v_nome, v_valor, 'pendente', auth.uid()
  ) RETURNING id INTO v_pgto_id;
  RETURN v_pgto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_contratacao_plano(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_contratacao_plano(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_contratacao_modulo(_modulo_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid := public.current_empresa_id();
  v_valor numeric;
  v_nome text;
  v_pgto_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  SELECT valor, nome INTO v_valor, v_nome
  FROM public.modulos WHERE id = _modulo_id AND ativo = true;
  IF v_valor IS NULL THEN RAISE EXCEPTION 'Módulo inválido'; END IF;

  INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, observacoes)
  VALUES (v_empresa_id, _modulo_id, 'pendente', 'Solicitado pelo cliente')
  ON CONFLICT (empresa_id, modulo_id) DO NOTHING;

  SELECT id INTO v_pgto_id
  FROM public.pagamentos
  WHERE empresa_id = v_empresa_id
    AND referencia_tipo = 'modulo'
    AND modulo_id = _modulo_id
    AND status = 'pendente'
  ORDER BY created_at DESC LIMIT 1;
  IF v_pgto_id IS NOT NULL THEN RETURN v_pgto_id; END IF;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, modulo_id, descricao, valor, status, registrado_por
  ) VALUES (
    v_empresa_id, 'modulo', _modulo_id,
    'Contratação solicitada: ' || v_nome, v_valor, 'pendente', auth.uid()
  ) RETURNING id INTO v_pgto_id;
  RETURN v_pgto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_contratacao_modulo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_contratacao_modulo(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cobranca_pendente_atual()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_empresa_id();
  v_pg record;
  v_itens jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_emp IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_pg
  FROM public.pagamentos
  WHERE empresa_id = v_emp AND status = 'pendente'
  ORDER BY created_at DESC LIMIT 1;
  IF v_pg.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tipo', pi.tipo, 'plano_id', pi.plano_id, 'modulo_id', pi.modulo_id,
    'descricao', pi.descricao, 'valor', pi.valor
  )), '[]'::jsonb)
  INTO v_itens
  FROM public.pagamento_itens pi
  WHERE pi.pagamento_id = v_pg.id;

  RETURN jsonb_build_object(
    'pagamento_id', v_pg.id, 'valor', v_pg.valor,
    'descricao', v_pg.descricao, 'data_vencimento', v_pg.data_vencimento,
    'asaas_payment_id', v_pg.asaas_payment_id,
    'invoice_url', v_pg.asaas_invoice_url,
    'pix_qrcode', v_pg.asaas_pix_qrcode,
    'pix_copia_cola', v_pg.asaas_pix_copia_cola,
    'created_at', v_pg.created_at, 'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cobranca_pendente_atual() TO authenticated;

-- Leitura direta no frontend deve respeitar owner ou membership.
DROP POLICY IF EXISTS "Empresa le sua assinatura" ON public.empresa_assinaturas;
CREATE POLICY "Empresa le sua assinatura"
ON public.empresa_assinaturas FOR SELECT TO authenticated
USING (public.is_member_of(empresa_id, auth.uid()));

DROP POLICY IF EXISTS "Empresa le seus modulos" ON public.empresa_modulos;
CREATE POLICY "Empresa le seus modulos"
ON public.empresa_modulos FOR SELECT TO authenticated
USING (public.is_member_of(empresa_id, auth.uid()));

DROP POLICY IF EXISTS "Empresa le seus pagamentos" ON public.pagamentos;
CREATE POLICY "Empresa le seus pagamentos"
ON public.pagamentos FOR SELECT TO authenticated
USING (public.is_member_of(empresa_id, auth.uid()));

DROP POLICY IF EXISTS "Empresa le itens de seus pagamentos" ON public.pagamento_itens;
CREATE POLICY "Empresa le itens de seus pagamentos"
ON public.pagamento_itens FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pagamentos p
    WHERE p.id = pagamento_id
      AND public.is_member_of(p.empresa_id, auth.uid())
  )
);

-- Validações do catálogo. Qualquer divergência aborta toda a migration.
DO $$
DECLARE
  v_erp uuid;
BEGIN
  SELECT id INTO v_erp FROM public.system_modes WHERE chave = 'erp';
  IF v_erp IS NULL THEN RAISE EXCEPTION 'Modo ERP não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_modes WHERE chave = 'pdv') THEN
    RAISE EXCEPTION 'Modo PDV não encontrado';
  END IF;
  IF (SELECT count(*) FROM public.modulos
      WHERE chave IN ('financeiro_avancado', 'relatorios')) <> 2 THEN
    RAISE EXCEPTION 'Catálogo oficial de módulos incompleto';
  END IF;
  IF (SELECT count(*) FROM public.planos
      WHERE id IN (
        '72000000-0000-4000-8000-000000000001'::uuid,
        '72000000-0000-4000-8000-000000000002'::uuid
      )) <> 2 THEN
    RAISE EXCEPTION 'Catálogo oficial de planos incompleto';
  END IF;
  IF (SELECT count(*) FROM public.mode_modules mm
      JOIN public.modulos m ON m.id = mm.module_id
      WHERE mm.mode_id = v_erp
        AND m.chave IN ('financeiro_avancado', 'relatorios')) <> 2 THEN
    RAISE EXCEPTION 'Associações do ERP incompletas';
  END IF;
END;
$$;

COMMIT;
