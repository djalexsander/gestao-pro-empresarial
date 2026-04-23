CREATE OR REPLACE FUNCTION public.excluir_caixa(_caixa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caixa RECORD;
  v_user uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;

  SELECT id, status, owner_id, data_abertura, data_fechamento
    INTO v_caixa
    FROM public.caixas
   WHERE id = _caixa_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;

  IF v_caixa.owner_id <> v_user THEN
    RAISE EXCEPTION 'Sem permissão para excluir este caixa';
  END IF;

  IF v_caixa.status <> 'fechado' THEN
    RAISE EXCEPTION 'Apenas caixas fechados podem ser excluídos. Feche o caixa antes.';
  END IF;

  -- Desvincula vendas (mantém histórico das vendas)
  UPDATE public.vendas SET caixa_id = NULL WHERE caixa_id = _caixa_id;

  -- Apaga movimentos de caixa
  DELETE FROM public.caixa_movimentos WHERE caixa_id = _caixa_id;

  -- Apaga o caixa
  DELETE FROM public.caixas WHERE id = _caixa_id;

  RETURN jsonb_build_object('caixa_id', _caixa_id, 'excluido_em', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_caixa(uuid) TO authenticated;