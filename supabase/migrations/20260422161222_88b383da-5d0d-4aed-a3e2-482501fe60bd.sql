-- Função para receber compra de forma atômica:
-- - muda status para 'recebida'
-- - cria movimentações de entrada de estoque para cada item
-- - opcionalmente gera conta a pagar
CREATE OR REPLACE FUNCTION public.receber_compra(
  _compra_id uuid,
  _data_recebimento date DEFAULT CURRENT_DATE,
  _gerar_financeiro boolean DEFAULT true,
  _data_vencimento date DEFAULT NULL,
  _categoria_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_status compra_status;
  v_total numeric(14,2);
  v_fornecedor uuid;
  v_numero text;
  item RECORD;
  v_saldo numeric(14,3);
  v_lanc_id uuid;
BEGIN
  -- Verifica autenticação
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Carrega compra
  SELECT owner_id, status, total, fornecedor_id, numero
    INTO v_owner, v_status, v_total, v_fornecedor, v_numero
  FROM public.compras
  WHERE id = _compra_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Compra não encontrada';
  END IF;

  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão sobre esta compra';
  END IF;

  IF v_status = 'recebida' THEN
    RAISE EXCEPTION 'Compra já foi recebida';
  END IF;

  IF v_status = 'cancelada' THEN
    RAISE EXCEPTION 'Compra cancelada não pode ser recebida';
  END IF;

  -- Para cada item, cria movimentação de entrada
  FOR item IN
    SELECT id, produto_id, variacao_id, quantidade, preco_unitario
    FROM public.compra_itens
    WHERE compra_id = _compra_id
  LOOP
    -- Calcula saldo atual antes da entrada
    v_saldo := public.calcular_saldo_estoque(item.produto_id, item.variacao_id);

    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, variacao_id, tipo, origem,
      quantidade, custo_unitario, saldo_anterior, saldo_posterior,
      compra_id, observacoes
    ) VALUES (
      v_owner, item.produto_id, item.variacao_id, 'entrada', 'compra',
      item.quantidade, item.preco_unitario, v_saldo, v_saldo + item.quantidade,
      _compra_id, 'Recebimento da compra ' || v_numero
    );
  END LOOP;

  -- Atualiza status da compra
  UPDATE public.compras
  SET status = 'recebida',
      data_recebimento = _data_recebimento
  WHERE id = _compra_id;

  -- Gera conta a pagar (se solicitado e ainda não existir vinculada)
  IF _gerar_financeiro AND v_total > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.financeiro_lancamentos
      WHERE compra_id = _compra_id AND tipo = 'pagar'
    ) THEN
      INSERT INTO public.financeiro_lancamentos (
        owner_id, tipo, descricao, valor,
        data_emissao, data_vencimento,
        fornecedor_id, compra_id, categoria_id, status
      ) VALUES (
        v_owner, 'pagar',
        'Compra ' || v_numero, v_total,
        _data_recebimento, COALESCE(_data_vencimento, _data_recebimento),
        v_fornecedor, _compra_id, _categoria_id, 'pendente'
      )
      RETURNING id INTO v_lanc_id;
    END IF;
  END IF;

  RETURN _compra_id;
END;
$$;