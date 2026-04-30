-- ============================================================================
-- Bloco 14 — Lotes de produto: CRUD via RPC SECURITY DEFINER
-- ============================================================================

-- Idempotência: client_uuid em lotes_produto (CRIAÇÃO)
ALTER TABLE public.lotes_produto
  ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS lotes_produto_owner_client_uuid_uniq
  ON public.lotes_produto(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ============================================================================
-- HELPER
-- ============================================================================
CREATE OR REPLACE FUNCTION public._lote_tem_vinculo(_lote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.estoque_movimentacoes WHERE lote_id = _lote_id
    UNION ALL
    SELECT 1 FROM public.compra_itens          WHERE lote_id = _lote_id
    UNION ALL
    SELECT 1 FROM public.venda_itens           WHERE lote_id = _lote_id
  );
$$;

-- ============================================================================
-- CRIAR LOTE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.criar_lote_produto(
  _produto_id uuid,
  _numero_lote text,
  _quantidade_inicial numeric DEFAULT 0,
  _variacao_id uuid DEFAULT NULL,
  _data_fabricacao date DEFAULT NULL,
  _data_validade date DEFAULT NULL,
  _custo_unitario numeric DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _registrar_entrada boolean DEFAULT false,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
  v_numero text;
  v_qtd numeric;
  v_produto_owner uuid;
  v_variacao_owner uuid;
  v_variacao_produto uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.lotes_produto
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('lote_id', v_existing, 'idempotente', true);
    END IF;
  END IF;

  v_numero := NULLIF(trim(COALESCE(_numero_lote, '')), '');
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Número do lote é obrigatório' USING ERRCODE = '23502';
  END IF;

  v_qtd := COALESCE(_quantidade_inicial, 0);
  IF v_qtd < 0 THEN
    RAISE EXCEPTION 'Quantidade inicial não pode ser negativa' USING ERRCODE = '22023';
  END IF;

  IF _data_fabricacao IS NOT NULL AND _data_validade IS NOT NULL
     AND _data_fabricacao > _data_validade THEN
    RAISE EXCEPTION 'Data de fabricação não pode ser maior que a validade' USING ERRCODE = '22023';
  END IF;

  IF _custo_unitario IS NOT NULL AND _custo_unitario < 0 THEN
    RAISE EXCEPTION 'Custo unitário não pode ser negativo' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO v_produto_owner
  FROM public.produtos WHERE id = _produto_id;
  IF v_produto_owner IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_produto_owner <> v_owner AND NOT public.acessa_owner_id(v_produto_owner, v_owner) THEN
    RAISE EXCEPTION 'Sem acesso a este produto' USING ERRCODE = '42501';
  END IF;

  IF _variacao_id IS NOT NULL THEN
    SELECT owner_id, produto_id INTO v_variacao_owner, v_variacao_produto
    FROM public.produto_variacoes WHERE id = _variacao_id;
    IF v_variacao_owner IS NULL THEN
      RAISE EXCEPTION 'Variação não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF v_variacao_owner <> v_produto_owner THEN
      RAISE EXCEPTION 'Variação pertence a outro dono' USING ERRCODE = '42501';
    END IF;
    IF v_variacao_produto <> _produto_id THEN
      RAISE EXCEPTION 'Variação não pertence a este produto' USING ERRCODE = '23514';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.lotes_produto (
      owner_id, produto_id, variacao_id, numero_lote,
      data_fabricacao, data_validade,
      quantidade_inicial, quantidade_atual,
      custo_unitario, observacoes, client_uuid
    ) VALUES (
      v_produto_owner, _produto_id, _variacao_id, v_numero,
      _data_fabricacao, _data_validade,
      v_qtd, v_qtd,
      _custo_unitario, NULLIF(trim(COALESCE(_observacoes, '')), ''),
      _client_uuid
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    IF _client_uuid IS NOT NULL THEN
      SELECT id INTO v_existing
      FROM public.lotes_produto
      WHERE owner_id = v_owner AND client_uuid = _client_uuid
      LIMIT 1;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('lote_id', v_existing, 'idempotente', true);
      END IF;
    END IF;
    RAISE EXCEPTION 'Já existe um lote com este número para este produto'
      USING ERRCODE = '23505';
  END;

  IF _registrar_entrada AND v_qtd > 0 THEN
    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, variacao_id, lote_id,
      tipo, origem, quantidade, custo_unitario, observacoes,
      data_movimentacao, client_uuid
    ) VALUES (
      v_produto_owner, _produto_id, _variacao_id, v_id,
      'entrada', 'outro', v_qtd, _custo_unitario,
      'Saldo inicial do lote ' || v_numero,
      now(),
      _client_uuid
    );
  END IF;

  RETURN jsonb_build_object('lote_id', v_id, 'idempotente', false);
END;
$$;

-- ============================================================================
-- EDITAR LOTE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.editar_lote_produto(
  _lote_id uuid,
  _numero_lote text,
  _data_fabricacao date DEFAULT NULL,
  _data_validade date DEFAULT NULL,
  _custo_unitario numeric DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _variacao_id uuid DEFAULT NULL,
  _quantidade_inicial numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_lote record;
  v_numero text;
  v_tem_vinculo boolean;
  v_variacao_owner uuid;
  v_variacao_produto uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_lote
  FROM public.lotes_produto
  WHERE id = _lote_id
  FOR UPDATE;

  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lote.owner_id <> v_owner AND NOT public.acessa_owner_id(v_lote.owner_id, v_owner) THEN
    RAISE EXCEPTION 'Sem acesso a este lote' USING ERRCODE = '42501';
  END IF;

  v_numero := NULLIF(trim(COALESCE(_numero_lote, '')), '');
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Número do lote é obrigatório' USING ERRCODE = '23502';
  END IF;

  IF _data_fabricacao IS NOT NULL AND _data_validade IS NOT NULL
     AND _data_fabricacao > _data_validade THEN
    RAISE EXCEPTION 'Data de fabricação não pode ser maior que a validade' USING ERRCODE = '22023';
  END IF;

  IF _custo_unitario IS NOT NULL AND _custo_unitario < 0 THEN
    RAISE EXCEPTION 'Custo unitário não pode ser negativo' USING ERRCODE = '22023';
  END IF;

  v_tem_vinculo := public._lote_tem_vinculo(_lote_id);

  IF _variacao_id IS DISTINCT FROM v_lote.variacao_id AND v_tem_vinculo THEN
    RAISE EXCEPTION 'Não é possível mudar a variação: lote já possui movimentações.'
      USING ERRCODE = '23514';
  END IF;

  IF _variacao_id IS NOT NULL AND _variacao_id IS DISTINCT FROM v_lote.variacao_id THEN
    SELECT owner_id, produto_id INTO v_variacao_owner, v_variacao_produto
    FROM public.produto_variacoes WHERE id = _variacao_id;
    IF v_variacao_owner IS NULL THEN
      RAISE EXCEPTION 'Variação não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF v_variacao_owner <> v_lote.owner_id THEN
      RAISE EXCEPTION 'Variação pertence a outro dono' USING ERRCODE = '42501';
    END IF;
    IF v_variacao_produto <> v_lote.produto_id THEN
      RAISE EXCEPTION 'Variação não pertence a este produto' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF _quantidade_inicial IS NOT NULL
     AND _quantidade_inicial IS DISTINCT FROM v_lote.quantidade_inicial THEN
    IF v_tem_vinculo THEN
      RAISE EXCEPTION 'Não é possível alterar quantidade inicial: lote já tem movimentações. Use ajustar_quantidade_lote.'
        USING ERRCODE = '23514';
    END IF;
    IF _quantidade_inicial < 0 THEN
      RAISE EXCEPTION 'Quantidade inicial não pode ser negativa' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.lotes_produto SET
    numero_lote        = v_numero,
    data_fabricacao    = _data_fabricacao,
    data_validade      = _data_validade,
    custo_unitario     = _custo_unitario,
    observacoes        = NULLIF(trim(COALESCE(_observacoes, '')), ''),
    variacao_id        = _variacao_id,
    quantidade_inicial = COALESCE(_quantidade_inicial, quantidade_inicial),
    quantidade_atual   = CASE
      WHEN _quantidade_inicial IS NOT NULL AND NOT v_tem_vinculo
        THEN _quantidade_inicial
      ELSE quantidade_atual
    END,
    updated_at         = now()
  WHERE id = _lote_id;

  RETURN jsonb_build_object('lote_id', _lote_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um lote com este número para este produto'
    USING ERRCODE = '23505';
END;
$$;

-- ============================================================================
-- AJUSTAR QUANTIDADE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ajustar_quantidade_lote(
  _lote_id uuid,
  _nova_quantidade numeric,
  _motivo text DEFAULT NULL,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_lote record;
  v_diff numeric;
  v_existing uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF _nova_quantidade IS NULL OR _nova_quantidade < 0 THEN
    RAISE EXCEPTION 'Nova quantidade deve ser ≥ 0' USING ERRCODE = '22023';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.estoque_movimentacoes
    WHERE owner_id = v_owner AND client_uuid = _client_uuid
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'lote_id', _lote_id,
        'movimentacao_id', v_existing,
        'idempotente', true
      );
    END IF;
  END IF;

  SELECT * INTO v_lote
  FROM public.lotes_produto
  WHERE id = _lote_id
  FOR UPDATE;

  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lote.owner_id <> v_owner AND NOT public.acessa_owner_id(v_lote.owner_id, v_owner) THEN
    RAISE EXCEPTION 'Sem acesso a este lote' USING ERRCODE = '42501';
  END IF;

  v_diff := _nova_quantidade - v_lote.quantidade_atual;
  IF v_diff = 0 THEN
    RETURN jsonb_build_object('lote_id', _lote_id, 'movimentacao_id', NULL, 'sem_diferenca', true);
  END IF;

  INSERT INTO public.estoque_movimentacoes (
    owner_id, produto_id, variacao_id, lote_id,
    tipo, origem,
    quantidade, custo_unitario,
    saldo_anterior, saldo_posterior,
    observacoes, data_movimentacao, client_uuid
  ) VALUES (
    v_lote.owner_id, v_lote.produto_id, v_lote.variacao_id, _lote_id,
    'ajuste', 'ajuste_manual',
    abs(v_diff), v_lote.custo_unitario,
    v_lote.quantidade_atual, _nova_quantidade,
    COALESCE(NULLIF(trim(COALESCE(_motivo, '')), ''),
             'Ajuste de saldo do lote ' || v_lote.numero_lote),
    now(), _client_uuid
  )
  RETURNING id INTO v_existing;

  UPDATE public.lotes_produto
     SET quantidade_atual = _nova_quantidade,
         updated_at = now()
   WHERE id = _lote_id;

  RETURN jsonb_build_object(
    'lote_id', _lote_id,
    'movimentacao_id', v_existing,
    'diferenca', v_diff,
    'idempotente', false
  );
END;
$$;

-- ============================================================================
-- EXCLUIR
-- ============================================================================
CREATE OR REPLACE FUNCTION public.excluir_lote_produto(_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_lote record;
  v_mov int;
  v_compra int;
  v_venda int;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_lote FROM public.lotes_produto WHERE id = _lote_id FOR UPDATE;
  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lote.owner_id <> v_owner AND NOT public.acessa_owner_id(v_lote.owner_id, v_owner) THEN
    RAISE EXCEPTION 'Sem acesso a este lote' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_mov    FROM public.estoque_movimentacoes WHERE lote_id = _lote_id;
  SELECT count(*) INTO v_compra FROM public.compra_itens          WHERE lote_id = _lote_id;
  SELECT count(*) INTO v_venda  FROM public.venda_itens           WHERE lote_id = _lote_id;

  IF v_mov + v_compra + v_venda > 0 THEN
    RAISE EXCEPTION 'Lote possui vínculos (% movimentações, % compras, % vendas). Para zerar saldo, use ajustar_quantidade_lote.',
      v_mov, v_compra, v_venda
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.lotes_produto WHERE id = _lote_id;
  RETURN jsonb_build_object('lote_id', _lote_id, 'excluido', true);
END;
$$;

-- ============================================================================
-- VIEW DE LEITURA: lotes com saldo real
-- ============================================================================
CREATE OR REPLACE VIEW public.lotes_produto_com_saldo
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.owner_id,
  l.produto_id,
  l.variacao_id,
  l.numero_lote,
  l.data_fabricacao,
  l.data_validade,
  l.quantidade_inicial,
  l.quantidade_atual,
  l.custo_unitario,
  l.observacoes,
  l.created_at,
  l.updated_at,
  p.nome AS produto_nome,
  p.sku  AS produto_sku,
  v.nome AS variacao_nome,
  COALESCE((
    SELECT SUM(
      CASE WHEN m.tipo IN ('entrada','devolucao') THEN m.quantidade
           WHEN m.tipo = 'ajuste' THEN
             CASE WHEN m.saldo_posterior >= m.saldo_anterior THEN m.quantidade
                  ELSE -m.quantidade END
           ELSE -m.quantidade
      END
    )
    FROM public.estoque_movimentacoes m
    WHERE m.lote_id = l.id
  ), l.quantidade_inicial) AS saldo_real,
  CASE
    WHEN l.data_validade IS NULL THEN NULL
    WHEN l.data_validade < CURRENT_DATE THEN 'vencido'
    WHEN l.data_validade <= CURRENT_DATE + INTERVAL '7 days' THEN 'critico'
    WHEN l.data_validade <= CURRENT_DATE + INTERVAL '30 days' THEN 'alerta'
    ELSE 'ok'
  END AS status_validade
FROM public.lotes_produto l
JOIN public.produtos p ON p.id = l.produto_id
LEFT JOIN public.produto_variacoes v ON v.id = l.variacao_id;

GRANT SELECT ON public.lotes_produto_com_saldo TO authenticated;