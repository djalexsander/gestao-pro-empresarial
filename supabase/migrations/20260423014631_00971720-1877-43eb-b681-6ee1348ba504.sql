-- Função para excluir definitivamente uma venda cancelada
CREATE OR REPLACE FUNCTION public.excluir_venda_cancelada(_venda_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda RECORD;
  v_user uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT id, numero, status, owner_id, total
    INTO v_venda
    FROM public.vendas
   WHERE id = _venda_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;

  IF v_venda.owner_id IS NOT NULL AND v_venda.owner_id <> v_user THEN
    RAISE EXCEPTION 'Sem permissão para excluir esta venda';
  END IF;

  IF v_venda.status <> 'cancelada' THEN
    RAISE EXCEPTION 'Apenas vendas canceladas podem ser excluídas. Cancele a venda antes.';
  END IF;

  -- Limpa pagamentos (sem FK cascade)
  DELETE FROM public.venda_pagamentos WHERE venda_id = _venda_id;

  -- Desvincula lançamentos financeiros já cancelados (mantém histórico)
  UPDATE public.financeiro_lancamentos SET venda_id = NULL WHERE venda_id = _venda_id;

  -- Desvincula movimentações de estoque (mantém histórico de estorno)
  UPDATE public.estoque_movimentacoes SET venda_id = NULL WHERE venda_id = _venda_id;

  -- Itens caem por cascade
  DELETE FROM public.vendas WHERE id = _venda_id;

  -- Auditoria (best-effort)
  BEGIN
    INSERT INTO public.auditoria_logs (owner_id, user_id, acao, entidade, entidade_id, detalhes)
    VALUES (
      COALESCE(v_venda.owner_id, v_user), v_user,
      'excluir_venda_cancelada', 'vendas', _venda_id,
      jsonb_build_object('numero', v_venda.numero, 'total', v_venda.total)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('venda_id', _venda_id, 'numero', v_venda.numero, 'excluida_em', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_venda_cancelada(uuid) TO authenticated;