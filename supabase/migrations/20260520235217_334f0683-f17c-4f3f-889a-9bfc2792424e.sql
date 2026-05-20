CREATE OR REPLACE FUNCTION public.admin_zerar_empresa(
  p_empresa_id uuid,
  p_incluir_produtos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_caller uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN
    RAISE EXCEPTION 'Apenas super admin pode zerar dados de empresa';
  END IF;

  SELECT owner_id INTO v_owner FROM public.empresas WHERE id = p_empresa_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Empresa % não encontrada', p_empresa_id;
  END IF;

  -- Ordem: filhos antes de pais.
  WITH d AS (DELETE FROM public.lancamento_pagamentos WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('lancamento_pagamentos', v_n);

  WITH d AS (DELETE FROM public.financeiro_lancamentos WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('financeiro_lancamentos', v_n);

  WITH d AS (DELETE FROM public.venda_pagamentos WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('venda_pagamentos', v_n);

  WITH d AS (DELETE FROM public.venda_itens WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('venda_itens', v_n);

  WITH d AS (DELETE FROM public.vendas_status_historico WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('vendas_status_historico', v_n);

  WITH d AS (DELETE FROM public.vendas WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('vendas', v_n);

  WITH d AS (DELETE FROM public.compra_itens WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('compra_itens', v_n);

  WITH d AS (DELETE FROM public.compras WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('compras', v_n);

  WITH d AS (DELETE FROM public.estoque_movimentacoes WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('estoque_movimentacoes', v_n);

  WITH d AS (DELETE FROM public.caixa_movimentos WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('caixa_movimentos', v_n);

  WITH d AS (DELETE FROM public.caixas WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('caixas', v_n);

  WITH d AS (DELETE FROM public.cobranca_whatsapp_logs WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('cobranca_whatsapp_logs', v_n);

  WITH d AS (DELETE FROM public.ifood_repasses WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('ifood_repasses', v_n);

  WITH d AS (DELETE FROM public.autorizacoes_log WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('autorizacoes_log', v_n);

  WITH d AS (DELETE FROM public.funcionario_tentativas_pin WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('funcionario_tentativas_pin', v_n);

  WITH d AS (DELETE FROM public.funcionario_lockouts WHERE owner_id = v_owner RETURNING 1)
    SELECT COUNT(*) INTO v_n FROM d;
  v_counts := v_counts || jsonb_build_object('funcionario_lockouts', v_n);

  IF p_incluir_produtos THEN
    WITH d AS (DELETE FROM public.lotes_produto WHERE owner_id = v_owner RETURNING 1)
      SELECT COUNT(*) INTO v_n FROM d;
    v_counts := v_counts || jsonb_build_object('lotes_produto', v_n);

    WITH d AS (DELETE FROM public.produtos WHERE owner_id = v_owner RETURNING 1)
      SELECT COUNT(*) INTO v_n FROM d;
    v_counts := v_counts || jsonb_build_object('produtos', v_n);

    WITH d AS (DELETE FROM public.categorias_produto WHERE owner_id = v_owner RETURNING 1)
      SELECT COUNT(*) INTO v_n FROM d;
    v_counts := v_counts || jsonb_build_object('categorias_produto', v_n);
  END IF;

  -- Audit
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (
    v_caller,
    'admin.zerar_empresa',
    'empresa',
    p_empresa_id::text,
    jsonb_build_object(
      'empresa_id', p_empresa_id,
      'owner_id', v_owner,
      'incluir_produtos', p_incluir_produtos,
      'removidos', v_counts
    )
  );

  RETURN jsonb_build_object(
    'empresa_id', p_empresa_id,
    'owner_id', v_owner,
    'incluir_produtos', p_incluir_produtos,
    'removidos', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_zerar_empresa(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_zerar_empresa(uuid, boolean) TO authenticated;