
CREATE OR REPLACE FUNCTION public.reabrir_caixa(_caixa_id uuid, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status public.caixa_status;
  v_pode BOOLEAN := FALSE;
  v_removidos INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.caixas WHERE id = _caixa_id
  FOR UPDATE;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_status <> 'fechado' THEN RAISE EXCEPTION 'Caixa não está fechado'; END IF;

  -- Permissão: dono OU membro admin/owner da empresa do dono
  IF v_owner = v_uid THEN
    v_pode := TRUE;
  ELSE
    SELECT TRUE INTO v_pode
    FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = v_uid
      AND e.owner_id = v_owner
      AND m.papel IN ('owner', 'admin')
    LIMIT 1;
  END IF;

  IF NOT COALESCE(v_pode, FALSE) THEN
    RAISE EXCEPTION 'Sem permissão para reabrir este caixa';
  END IF;

  -- Bloqueia reabertura se algum lançamento gerado pelo fechamento já foi
  -- conciliado (ifood) ou marcado como pago/recebido fora do automático.
  IF EXISTS (
    SELECT 1 FROM public.financeiro_lancamentos
    WHERE caixa_id = _caixa_id
      AND (repasse_id IS NOT NULL OR conciliado_em IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Não é possível reabrir: há lançamentos do caixa já conciliados.';
  END IF;

  -- Remove os lançamentos pendentes gerados automaticamente pelo fechamento
  DELETE FROM public.financeiro_lancamentos
  WHERE caixa_id = _caixa_id
    AND repasse_id IS NULL
    AND conciliado_em IS NULL
    AND forma_pagamento IN ('ifood', 'fiado', 'outro');
  GET DIAGNOSTICS v_removidos = ROW_COUNT;

  -- Remove o movimento de fechamento
  DELETE FROM public.caixa_movimentos
  WHERE caixa_id = _caixa_id AND tipo = 'fechamento';

  -- Reabre o caixa
  UPDATE public.caixas SET
    status = 'aberto',
    data_fechamento = NULL,
    valor_informado = NULL,
    diferenca = NULL,
    observacao_fechamento = CASE
      WHEN COALESCE(NULLIF(trim(_motivo), ''), '') = ''
        THEN NULL
      ELSE 'Reaberto: ' || trim(_motivo)
    END,
    updated_at = now()
  WHERE id = _caixa_id;

  PERFORM public.registrar_audit_log(
    'caixa.reabrir', 'caixa', _caixa_id::text,
    jsonb_build_object('motivo', _motivo, 'lancamentos_removidos', v_removidos)
  );

  RETURN jsonb_build_object(
    'caixa_id', _caixa_id,
    'reaberto_em', now(),
    'lancamentos_removidos', v_removidos
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reabrir_caixa(uuid, text) TO authenticated;
