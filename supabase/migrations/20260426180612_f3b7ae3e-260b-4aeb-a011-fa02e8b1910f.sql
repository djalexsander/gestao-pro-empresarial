CREATE OR REPLACE FUNCTION public.conciliar_ifood_lote(
  _lancamento_ids uuid[],
  _data_repasse date,
  _valor_repasse_total numeric,
  _numero_repasse text DEFAULT NULL,
  _observacao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_total_bruto numeric := 0;
  v_taxa_total numeric;
  v_qtd integer;
  v_repasse_id uuid;
  v_lanc record;
BEGIN
  IF _lancamento_ids IS NULL OR array_length(_lancamento_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhum lançamento informado';
  END IF;

  -- Pega owner_id e totais sem usar MIN(uuid) que não existe em postgres
  SELECT COALESCE(SUM(valor), 0), COUNT(*)
    INTO v_total_bruto, v_qtd
  FROM public.financeiro_lancamentos
  WHERE id = ANY(_lancamento_ids)
    AND forma_pagamento = 'ifood'
    AND status = 'pendente';

  IF v_qtd = 0 THEN
    RAISE EXCEPTION 'Nenhum lançamento iFood pendente entre os selecionados';
  END IF;

  -- Busca o owner_id do primeiro lançamento (todos devem pertencer ao mesmo owner)
  SELECT owner_id INTO v_owner
  FROM public.financeiro_lancamentos
  WHERE id = ANY(_lancamento_ids)
    AND forma_pagamento = 'ifood'
    AND status = 'pendente'
  LIMIT 1;

  -- Garante que todos os lançamentos pertencem ao mesmo owner
  IF EXISTS (
    SELECT 1 FROM public.financeiro_lancamentos
    WHERE id = ANY(_lancamento_ids)
      AND forma_pagamento = 'ifood'
      AND status = 'pendente'
      AND owner_id <> v_owner
  ) THEN
    RAISE EXCEPTION 'Lançamentos de empresas diferentes não podem ser conciliados juntos';
  END IF;

  IF v_owner <> v_user
     AND NOT EXISTS (
       SELECT 1 FROM public.empresa_membros m
       JOIN public.empresas e ON e.id = m.empresa_id
       WHERE m.user_id = v_user AND e.owner_id = v_owner
         AND m.papel IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'Sem permissão para conciliar estes lançamentos';
  END IF;

  v_taxa_total := GREATEST(v_total_bruto - COALESCE(_valor_repasse_total, 0), 0);

  INSERT INTO public.ifood_repasses (
    owner_id, data_repasse, numero_repasse,
    valor_bruto, taxa_total, valor_liquido, qtd_lancamentos,
    observacao, conciliado_por
  ) VALUES (
    v_owner, _data_repasse, _numero_repasse,
    v_total_bruto, v_taxa_total, COALESCE(_valor_repasse_total, 0), v_qtd,
    _observacao, v_user
  ) RETURNING id INTO v_repasse_id;

  FOR v_lanc IN
    SELECT id, valor
      FROM public.financeiro_lancamentos
     WHERE id = ANY(_lancamento_ids)
       AND forma_pagamento = 'ifood'
       AND status = 'pendente'
     ORDER BY data_emissao, id
  LOOP
    DECLARE
      v_proporcao numeric;
      v_valor_rec numeric;
      v_taxa_rec numeric;
    BEGIN
      v_proporcao := CASE WHEN v_total_bruto > 0 THEN v_lanc.valor / v_total_bruto ELSE 0 END;
      v_valor_rec := round(COALESCE(_valor_repasse_total, 0) * v_proporcao, 2);
      v_taxa_rec := round(v_taxa_total * v_proporcao, 2);

      UPDATE public.financeiro_lancamentos SET
        status = 'recebido',
        data_pagamento = _data_repasse,
        valor_pago = v_valor_rec,
        conciliado_em = now(),
        conciliado_por = v_user,
        valor_repasse = v_valor_rec,
        taxa_repasse = v_taxa_rec,
        numero_repasse = _numero_repasse,
        observacao_repasse = _observacao,
        repasse_id = v_repasse_id,
        updated_at = now()
      WHERE id = v_lanc.id;
    END;
  END LOOP;

  IF v_taxa_total > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      owner_id, descricao, tipo, status,
      valor, valor_pago, data_emissao, data_vencimento, data_pagamento,
      forma_pagamento, observacoes, numero_documento
    ) VALUES (
      v_owner,
      'Taxa iFood - Repasse ' || COALESCE(_numero_repasse, to_char(_data_repasse, 'DD/MM/YYYY')),
      'despesa', 'pago',
      v_taxa_total, v_taxa_total,
      _data_repasse, _data_repasse, _data_repasse,
      'ifood',
      'Taxa retida no repasse iFood (' || v_qtd::text || ' venda(s))',
      _numero_repasse
    );
  END IF;

  RETURN v_repasse_id;
END;
$$;