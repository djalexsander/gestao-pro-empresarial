
-- Coluna de quantidade recebida acumulada por item
ALTER TABLE public.compra_itens
  ADD COLUMN IF NOT EXISTS quantidade_recebida numeric NOT NULL DEFAULT 0;

-- Backfill: itens de compras já recebidas viram totalmente recebidos
UPDATE public.compra_itens ci
SET quantidade_recebida = ci.quantidade
FROM public.compras c
WHERE ci.compra_id = c.id
  AND c.status = 'recebida'
  AND ci.quantidade_recebida = 0;

-- Índices úteis para filtros e relatórios
CREATE INDEX IF NOT EXISTS idx_compras_owner_status      ON public.compras(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_compras_owner_data        ON public.compras(owner_id, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_compras_owner_fornecedor  ON public.compras(owner_id, fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_compra_itens_compra       ON public.compra_itens(compra_id);

-- Recebimento parcial / total por itens
CREATE OR REPLACE FUNCTION public.receber_compra_itens(
  _compra_id uuid,
  _itens jsonb,
  _data_recebimento date DEFAULT CURRENT_DATE,
  _gerar_financeiro boolean DEFAULT true,
  _data_vencimento date DEFAULT NULL,
  _categoria_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status compra_status;
  v_total numeric(14,2);
  v_fornecedor uuid;
  v_numero text;
  v_item jsonb;
  v_compra_item RECORD;
  v_qtd_remessa numeric(14,3);
  v_saldo numeric(14,3);
  v_pendente_total numeric(14,3) := 0;
  v_recebido_total numeric(14,3) := 0;
  v_qtd_itens_remessa int := 0;
  v_novo_status compra_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT owner_id, status, total, fornecedor_id, numero
    INTO v_owner, v_status, v_total, v_fornecedor, v_numero
  FROM public.compras
  WHERE id = _compra_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Compra não encontrada';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'Sem permissão sobre esta compra';
  END IF;
  IF v_status = 'recebida' THEN
    RAISE EXCEPTION 'Compra já foi totalmente recebida';
  END IF;
  IF v_status = 'cancelada' THEN
    RAISE EXCEPTION 'Compra cancelada não pode ser recebida';
  END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item para receber';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens)
  LOOP
    v_qtd_remessa := COALESCE((v_item->>'quantidade')::numeric, 0);
    IF v_qtd_remessa <= 0 THEN
      CONTINUE;
    END IF;

    SELECT id, produto_id, variacao_id, quantidade, quantidade_recebida, preco_unitario
      INTO v_compra_item
    FROM public.compra_itens
    WHERE id = (v_item->>'item_id')::uuid
      AND compra_id = _compra_id
      AND owner_id = v_uid;

    IF v_compra_item.id IS NULL THEN
      RAISE EXCEPTION 'Item % não pertence a esta compra', v_item->>'item_id';
    END IF;

    IF (v_compra_item.quantidade_recebida + v_qtd_remessa) > v_compra_item.quantidade THEN
      RAISE EXCEPTION 'Quantidade recebida excede o saldo pendente do item';
    END IF;

    v_saldo := public.calcular_saldo_estoque(v_compra_item.produto_id, v_compra_item.variacao_id);

    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, variacao_id, tipo, origem,
      quantidade, custo_unitario, saldo_anterior, saldo_posterior,
      compra_id, observacoes
    ) VALUES (
      v_uid, v_compra_item.produto_id, v_compra_item.variacao_id, 'entrada', 'compra',
      v_qtd_remessa, v_compra_item.preco_unitario, v_saldo, v_saldo + v_qtd_remessa,
      _compra_id, 'Recebimento da compra ' || v_numero
    );

    UPDATE public.compra_itens
    SET quantidade_recebida = quantidade_recebida + v_qtd_remessa,
        updated_at = now()
    WHERE id = v_compra_item.id;

    v_qtd_itens_remessa := v_qtd_itens_remessa + 1;
  END LOOP;

  IF v_qtd_itens_remessa = 0 THEN
    RAISE EXCEPTION 'Nenhum item válido para receber';
  END IF;

  SELECT
    COALESCE(SUM(quantidade - quantidade_recebida), 0),
    COALESCE(SUM(quantidade_recebida), 0)
  INTO v_pendente_total, v_recebido_total
  FROM public.compra_itens
  WHERE compra_id = _compra_id;

  IF v_pendente_total <= 0 THEN
    v_novo_status := 'recebida'::compra_status;
  ELSIF v_recebido_total > 0 THEN
    v_novo_status := 'recebida_parcial'::compra_status;
  ELSE
    v_novo_status := v_status;
  END IF;

  UPDATE public.compras
  SET status = v_novo_status,
      data_recebimento = CASE WHEN v_novo_status = 'recebida' THEN _data_recebimento ELSE data_recebimento END,
      updated_at = now()
  WHERE id = _compra_id;

  IF v_novo_status = 'recebida' AND _gerar_financeiro AND v_total > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.financeiro_lancamentos
      WHERE compra_id = _compra_id AND tipo = 'pagar'::lancamento_tipo
    ) THEN
      INSERT INTO public.financeiro_lancamentos (
        owner_id, tipo, descricao, valor,
        data_emissao, data_vencimento,
        fornecedor_id, compra_id, categoria_id, status
      ) VALUES (
        v_uid, 'pagar'::lancamento_tipo,
        'Compra ' || v_numero, v_total,
        _data_recebimento, COALESCE(_data_vencimento, _data_recebimento),
        v_fornecedor, _compra_id, _categoria_id, 'pendente'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'compra_id', _compra_id,
    'status', v_novo_status::text,
    'pendente_total', v_pendente_total,
    'recebido_total', v_recebido_total,
    'itens_recebidos', v_qtd_itens_remessa
  );
END;
$$;

-- Métricas por fornecedor (do dono autenticado)
CREATE OR REPLACE FUNCTION public.fornecedor_metricas()
RETURNS TABLE (
  fornecedor_id uuid,
  total_compras bigint,
  valor_total numeric,
  ultima_compra date,
  compras_em_aberto bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    f.id AS fornecedor_id,
    COUNT(c.id) FILTER (WHERE c.status <> 'cancelada')::bigint AS total_compras,
    COALESCE(SUM(c.total) FILTER (WHERE c.status <> 'cancelada'), 0)::numeric AS valor_total,
    MAX(c.data_emissao) FILTER (WHERE c.status <> 'cancelada')::date AS ultima_compra,
    COUNT(c.id) FILTER (WHERE c.status IN ('pendente','aprovada','recebida_parcial','rascunho'))::bigint AS compras_em_aberto
  FROM public.fornecedores f
  LEFT JOIN public.compras c ON c.fornecedor_id = f.id AND c.owner_id = auth.uid()
  WHERE f.owner_id = auth.uid()
  GROUP BY f.id;
$$;
