
-- Add new authorization actions for sangria/suprimento
ALTER TYPE public.autorizacao_acao ADD VALUE IF NOT EXISTS 'sangria_caixa';
ALTER TYPE public.autorizacao_acao ADD VALUE IF NOT EXISTS 'suprimento_caixa';

-- Toggle columns in config (default true: caixa não pode fazer sozinho)
ALTER TABLE public.autorizacoes_config
  ADD COLUMN IF NOT EXISTS exigir_sangria_caixa boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exigir_suprimento_caixa boolean NOT NULL DEFAULT true;

-- Update salvar function to accept the new toggles
CREATE OR REPLACE FUNCTION public.autorizacoes_config_salvar(_payload jsonb)
RETURNS public.autorizacoes_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_row public.autorizacoes_config;
  v_senha_nova text;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sem usuário autenticado'; END IF;

  INSERT INTO public.autorizacoes_config(owner_id) VALUES (v_owner)
  ON CONFLICT (owner_id) DO NOTHING;

  v_senha_nova := _payload->>'senha_master_nova';

  UPDATE public.autorizacoes_config SET
    exigir_fechar_caixa_divergencia = COALESCE((_payload->>'exigir_fechar_caixa_divergencia')::boolean, exigir_fechar_caixa_divergencia),
    exigir_fechar_caixa_qualquer = COALESCE((_payload->>'exigir_fechar_caixa_qualquer')::boolean, exigir_fechar_caixa_qualquer),
    exigir_remover_item_venda = COALESCE((_payload->>'exigir_remover_item_venda')::boolean, exigir_remover_item_venda),
    exigir_cancelar_venda = COALESCE((_payload->>'exigir_cancelar_venda')::boolean, exigir_cancelar_venda),
    exigir_cancelar_compra = COALESCE((_payload->>'exigir_cancelar_compra')::boolean, exigir_cancelar_compra),
    exigir_excluir_lancamento_financeiro = COALESCE((_payload->>'exigir_excluir_lancamento_financeiro')::boolean, exigir_excluir_lancamento_financeiro),
    exigir_alterar_valor_confirmado = COALESCE((_payload->>'exigir_alterar_valor_confirmado')::boolean, exigir_alterar_valor_confirmado),
    exigir_reabrir_caixa = COALESCE((_payload->>'exigir_reabrir_caixa')::boolean, exigir_reabrir_caixa),
    exigir_sangria_caixa = COALESCE((_payload->>'exigir_sangria_caixa')::boolean, exigir_sangria_caixa),
    exigir_suprimento_caixa = COALESCE((_payload->>'exigir_suprimento_caixa')::boolean, exigir_suprimento_caixa),
    metodo_pin_habilitado = COALESCE((_payload->>'metodo_pin_habilitado')::boolean, metodo_pin_habilitado),
    metodo_senha_master_habilitado = COALESCE((_payload->>'metodo_senha_master_habilitado')::boolean, metodo_senha_master_habilitado),
    metodo_codigo_qr_habilitado = COALESCE((_payload->>'metodo_codigo_qr_habilitado')::boolean, metodo_codigo_qr_habilitado),
    codigo_qr_label = COALESCE(_payload->>'codigo_qr_label', codigo_qr_label),
    papeis_autorizadores = CASE
      WHEN _payload ? 'papeis_autorizadores'
        THEN ARRAY(SELECT jsonb_array_elements_text(_payload->'papeis_autorizadores'))::app_role[]
      ELSE papeis_autorizadores END,
    senha_master_hash = CASE
      WHEN v_senha_nova IS NOT NULL AND length(v_senha_nova) > 0
        THEN crypt(v_senha_nova, gen_salt('bf', 10))
      ELSE senha_master_hash END,
    updated_at = now()
  WHERE owner_id = v_owner
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
