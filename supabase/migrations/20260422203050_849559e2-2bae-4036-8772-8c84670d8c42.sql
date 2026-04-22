-- ============================================================
-- MÓDULO CAIXA: abertura, operação, sangria/suprimento, fechamento
-- ============================================================

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE public.caixa_status AS ENUM ('aberto', 'fechado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.caixa_movimento_tipo AS ENUM ('abertura', 'venda', 'sangria', 'suprimento', 'fechamento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabela: caixas
CREATE TABLE IF NOT EXISTS public.caixas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  usuario_id UUID NOT NULL,
  data_abertura TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_fechamento TIMESTAMPTZ,
  valor_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Totais consolidados (preenchidos no fechamento; durante aberto são calculados sob demanda)
  total_vendas NUMERIC(14,2) NOT NULL DEFAULT 0,
  qtd_vendas INT NOT NULL DEFAULT 0,
  total_dinheiro NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_pix NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_debito NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credito NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_boleto NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_outros NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_sangrias NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_suprimentos NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Conferência (preenchido no fechamento)
  valor_esperado NUMERIC(14,2),
  valor_informado NUMERIC(14,2),
  diferenca NUMERIC(14,2),
  status public.caixa_status NOT NULL DEFAULT 'aberto',
  observacao TEXT,
  observacao_fechamento TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garante apenas 1 caixa aberto por usuário
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixas_um_aberto_por_usuario
  ON public.caixas (owner_id, usuario_id)
  WHERE status = 'aberto';

CREATE INDEX IF NOT EXISTS idx_caixas_owner_status ON public.caixas (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_caixas_data_abertura ON public.caixas (owner_id, data_abertura DESC);

ALTER TABLE public.caixas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono acessa caixas" ON public.caixas;
CREATE POLICY "Dono acessa caixas" ON public.caixas
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_caixas_updated_at ON public.caixas;
CREATE TRIGGER trg_caixas_updated_at
  BEFORE UPDATE ON public.caixas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Tabela: caixa_movimentos (sangrias, suprimentos, ref. abertura/fechamento/vendas)
CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  caixa_id UUID NOT NULL,
  tipo public.caixa_movimento_tipo NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  motivo TEXT,
  venda_id UUID,
  usuario_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_mov_caixa ON public.caixa_movimentos (caixa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_caixa_mov_owner ON public.caixa_movimentos (owner_id, created_at DESC);

ALTER TABLE public.caixa_movimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono acessa movimentos de caixa" ON public.caixa_movimentos;
CREATE POLICY "Dono acessa movimentos de caixa" ON public.caixa_movimentos
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 4) Adiciona caixa_id na tabela vendas (vincula venda ao caixa aberto)
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS caixa_id UUID;
CREATE INDEX IF NOT EXISTS idx_vendas_caixa ON public.vendas (caixa_id) WHERE caixa_id IS NOT NULL;

-- ============================================================
-- FUNÇÕES RPC
-- ============================================================

-- Abrir caixa
CREATE OR REPLACE FUNCTION public.abrir_caixa(_valor_inicial NUMERIC, _observacao TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caixa_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _valor_inicial IS NULL OR _valor_inicial < 0 THEN
    RAISE EXCEPTION 'Valor inicial inválido';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.caixas
    WHERE owner_id = v_uid AND usuario_id = v_uid AND status = 'aberto'
  ) THEN
    RAISE EXCEPTION 'Já existe um caixa aberto. Feche o atual antes de abrir outro.';
  END IF;

  INSERT INTO public.caixas (owner_id, usuario_id, valor_inicial, observacao, status)
  VALUES (v_uid, v_uid, _valor_inicial, NULLIF(trim(_observacao), ''), 'aberto')
  RETURNING id INTO v_caixa_id;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id)
  VALUES (v_uid, v_caixa_id, 'abertura', _valor_inicial, 'Abertura de caixa', v_uid);

  RETURN v_caixa_id;
END;
$$;

-- Buscar caixa aberto do usuário atual
CREATE OR REPLACE FUNCTION public.caixa_aberto_atual()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.caixas
  WHERE owner_id = auth.uid()
    AND usuario_id = auth.uid()
    AND status = 'aberto'
  ORDER BY data_abertura DESC
  LIMIT 1;
$$;

-- Resumo do caixa (totais ao vivo, considerando apenas valores efetivamente recebidos)
CREATE OR REPLACE FUNCTION public.caixa_resumo(_caixa_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caixa RECORD;
  v_total_dinheiro NUMERIC(14,2) := 0;
  v_total_pix NUMERIC(14,2) := 0;
  v_total_debito NUMERIC(14,2) := 0;
  v_total_credito NUMERIC(14,2) := 0;
  v_total_boleto NUMERIC(14,2) := 0;
  v_total_outros NUMERIC(14,2) := 0;
  v_total_vendas NUMERIC(14,2) := 0;
  v_qtd_vendas INT := 0;
  v_total_sangrias NUMERIC(14,2) := 0;
  v_total_suprimentos NUMERIC(14,2) := 0;
  v_valor_esperado NUMERIC(14,2) := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT * INTO v_caixa FROM public.caixas
  WHERE id = _caixa_id AND owner_id = v_uid;
  IF v_caixa.id IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;

  -- Soma pagamentos efetivamente recebidos das vendas vinculadas a este caixa.
  -- Vendas pendentes/parciais entram apenas pelo valor já recebido (vp.valor_recebido OR vp.valor quando paga).
  -- Vendas canceladas são ignoradas.
  WITH pgs AS (
    SELECT
      vp.forma_pagamento,
      CASE
        WHEN v.status_pagamento = 'pago' THEN vp.valor
        WHEN v.status_pagamento = 'parcial' THEN COALESCE(vp.valor_recebido, vp.valor)
        ELSE 0
      END AS valor_efetivo
    FROM public.venda_pagamentos vp
    JOIN public.vendas v ON v.id = vp.venda_id
    WHERE v.caixa_id = _caixa_id
      AND v.owner_id = v_uid
      AND v.status <> 'cancelada'
  )
  SELECT
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento = 'dinheiro'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento = 'pix'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento = 'cartao_debito'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento = 'cartao_credito'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento = 'boleto'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma_pagamento NOT IN ('dinheiro','pix','cartao_debito','cartao_credito','boleto')), 0)
  INTO v_total_dinheiro, v_total_pix, v_total_debito, v_total_credito, v_total_boleto, v_total_outros
  FROM pgs;

  SELECT COUNT(*), COALESCE(SUM(total), 0)
    INTO v_qtd_vendas, v_total_vendas
  FROM public.vendas
  WHERE caixa_id = _caixa_id AND owner_id = v_uid AND status <> 'cancelada';

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'sangria'), 0),
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'suprimento'), 0)
  INTO v_total_sangrias, v_total_suprimentos
  FROM public.caixa_movimentos
  WHERE caixa_id = _caixa_id AND owner_id = v_uid;

  -- Valor esperado em DINHEIRO no caixa físico:
  -- inicial + dinheiro recebido + suprimentos - sangrias
  v_valor_esperado := v_caixa.valor_inicial
                    + v_total_dinheiro
                    + v_total_suprimentos
                    - v_total_sangrias;

  RETURN jsonb_build_object(
    'caixa_id', v_caixa.id,
    'status', v_caixa.status,
    'data_abertura', v_caixa.data_abertura,
    'data_fechamento', v_caixa.data_fechamento,
    'valor_inicial', v_caixa.valor_inicial,
    'qtd_vendas', v_qtd_vendas,
    'total_vendas', v_total_vendas,
    'total_dinheiro', v_total_dinheiro,
    'total_pix', v_total_pix,
    'total_debito', v_total_debito,
    'total_credito', v_total_credito,
    'total_boleto', v_total_boleto,
    'total_outros', v_total_outros,
    'total_sangrias', v_total_sangrias,
    'total_suprimentos', v_total_suprimentos,
    'valor_esperado', v_valor_esperado,
    'valor_informado', v_caixa.valor_informado,
    'diferenca', v_caixa.diferenca
  );
END;
$$;

-- Registrar sangria ou suprimento
CREATE OR REPLACE FUNCTION public.caixa_registrar_movimento(
  _caixa_id UUID,
  _tipo TEXT,
  _valor NUMERIC,
  _motivo TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status public.caixa_status;
  v_mov_id UUID;
  v_tipo public.caixa_movimento_tipo;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido. Use sangria ou suprimento.';
  END IF;
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero';
  END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.caixas WHERE id = _caixa_id;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Sem permissão sobre este caixa'; END IF;
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'Caixa precisa estar aberto'; END IF;

  v_tipo := _tipo::public.caixa_movimento_tipo;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id)
  VALUES (v_uid, _caixa_id, v_tipo, _valor, NULLIF(trim(_motivo), ''), v_uid)
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- Fechar caixa (consolida totais e registra diferença)
CREATE OR REPLACE FUNCTION public.fechar_caixa(
  _caixa_id UUID,
  _valor_informado NUMERIC,
  _observacao TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status public.caixa_status;
  v_resumo JSONB;
  v_diferenca NUMERIC(14,2);
  v_valor_esperado NUMERIC(14,2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _valor_informado IS NULL OR _valor_informado < 0 THEN
    RAISE EXCEPTION 'Informe o valor contado em dinheiro';
  END IF;

  SELECT owner_id, status INTO v_owner, v_status
  FROM public.caixas WHERE id = _caixa_id;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Sem permissão sobre este caixa'; END IF;
  IF v_status = 'fechado' THEN RAISE EXCEPTION 'Caixa já está fechado'; END IF;

  v_resumo := public.caixa_resumo(_caixa_id);
  v_valor_esperado := (v_resumo->>'valor_esperado')::NUMERIC;
  v_diferenca := _valor_informado - v_valor_esperado;

  IF ABS(v_diferenca) > 0.009 AND COALESCE(NULLIF(trim(_observacao), ''), '') = '' THEN
    RAISE EXCEPTION 'Há diferença no caixa (% ). Informe uma justificativa.', v_diferenca;
  END IF;

  UPDATE public.caixas SET
    status = 'fechado',
    data_fechamento = now(),
    total_vendas = (v_resumo->>'total_vendas')::NUMERIC,
    qtd_vendas = (v_resumo->>'qtd_vendas')::INT,
    total_dinheiro = (v_resumo->>'total_dinheiro')::NUMERIC,
    total_pix = (v_resumo->>'total_pix')::NUMERIC,
    total_debito = (v_resumo->>'total_debito')::NUMERIC,
    total_credito = (v_resumo->>'total_credito')::NUMERIC,
    total_boleto = (v_resumo->>'total_boleto')::NUMERIC,
    total_outros = (v_resumo->>'total_outros')::NUMERIC,
    total_sangrias = (v_resumo->>'total_sangrias')::NUMERIC,
    total_suprimentos = (v_resumo->>'total_suprimentos')::NUMERIC,
    valor_esperado = v_valor_esperado,
    valor_informado = _valor_informado,
    diferenca = v_diferenca,
    observacao_fechamento = NULLIF(trim(_observacao), '')
  WHERE id = _caixa_id;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id)
  VALUES (v_uid, _caixa_id, 'fechamento', _valor_informado,
    'Fechamento de caixa. Diferença: ' || v_diferenca::text, v_uid);

  PERFORM public.registrar_audit_log(
    'caixa.fechar', 'caixa', _caixa_id::text,
    jsonb_build_object(
      'valor_esperado', v_valor_esperado,
      'valor_informado', _valor_informado,
      'diferenca', v_diferenca
    )
  );

  RETURN jsonb_build_object(
    'caixa_id', _caixa_id,
    'valor_esperado', v_valor_esperado,
    'valor_informado', _valor_informado,
    'diferenca', v_diferenca,
    'fechado_em', now()
  );
END;
$$;

-- Atualiza finalizar_venda_pdv para EXIGIR caixa aberto e VINCULAR a venda
CREATE OR REPLACE FUNCTION public.finalizar_venda_pdv(
  _cliente_id uuid, _subtotal numeric, _desconto numeric, _total numeric,
  _forma forma_pagamento, _status_pagamento text,
  _valor_recebido numeric, _troco numeric, _observacao text,
  _itens jsonb, _pagamentos jsonb DEFAULT NULL::jsonb,
  _gerar_financeiro boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_venda_id uuid;
  v_numero text;
  v_count int;
  v_seq int;
  v_item jsonb;
  v_pgto jsonb;
  v_saldo numeric(14,3);
  v_lanc_status lancamento_status;
  v_forma_principal forma_pagamento := _forma;
  v_total_recebido numeric(14,2) := 0;
  v_total_troco numeric(14,2) := 0;
  v_max_valor numeric(14,2) := 0;
  v_pagamentos jsonb := _pagamentos;
  v_caixa_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;
  IF _status_pagamento NOT IN ('pago','pendente','parcial','cancelado') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', _status_pagamento;
  END IF;

  -- Caixa aberto é obrigatório
  SELECT id INTO v_caixa_id FROM public.caixas
  WHERE owner_id = v_uid AND usuario_id = v_uid AND status = 'aberto'
  ORDER BY data_abertura DESC LIMIT 1;

  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto. Abra o caixa antes de vender.';
  END IF;

  IF v_pagamentos IS NULL OR jsonb_array_length(v_pagamentos) = 0 THEN
    v_pagamentos := jsonb_build_array(
      jsonb_build_object(
        'forma_pagamento', _forma::text,
        'valor', _total,
        'valor_recebido', _valor_recebido,
        'troco', _troco,
        'parcelas', 1,
        'observacao', _observacao
      )
    );
  END IF;

  FOR v_pgto IN SELECT * FROM jsonb_array_elements(v_pagamentos) LOOP
    IF (v_pgto->>'valor')::numeric > v_max_valor THEN
      v_max_valor := (v_pgto->>'valor')::numeric;
      v_forma_principal := (v_pgto->>'forma_pagamento')::forma_pagamento;
    END IF;
    v_total_recebido := v_total_recebido + COALESCE((v_pgto->>'valor_recebido')::numeric, (v_pgto->>'valor')::numeric, 0);
    v_total_troco    := v_total_troco    + COALESCE((v_pgto->>'troco')::numeric, 0);
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM public.vendas WHERE owner_id = v_uid;
  v_seq := v_count + 1;
  v_numero := 'VND-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO public.vendas (
    owner_id, numero, cliente_id, vendedor_id, caixa_id,
    data_emissao, subtotal, desconto, total,
    forma_pagamento, status, status_pagamento,
    valor_recebido, troco, observacoes, data_finalizacao
  ) VALUES (
    v_uid, v_numero, _cliente_id, v_uid, v_caixa_id,
    CURRENT_DATE, _subtotal, _desconto, _total,
    v_forma_principal,
    CASE WHEN _status_pagamento = 'pago' THEN 'faturada'::venda_status
         WHEN _status_pagamento = 'cancelado' THEN 'cancelada'::venda_status
         ELSE 'aprovada'::venda_status END,
    _status_pagamento,
    NULLIF(v_total_recebido, 0), NULLIF(v_total_troco, 0),
    NULLIF(trim(_observacao),''), now()
  ) RETURNING id INTO v_venda_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    INSERT INTO public.venda_itens (
      owner_id, venda_id, produto_id, descricao,
      quantidade, preco_unitario, desconto, total
    ) VALUES (
      v_uid, v_venda_id, (v_item->>'produto_id')::uuid, v_item->>'descricao',
      (v_item->>'quantidade')::numeric, (v_item->>'preco_unitario')::numeric,
      COALESCE((v_item->>'desconto')::numeric, 0),
      (v_item->>'quantidade')::numeric * (v_item->>'preco_unitario')::numeric
        - COALESCE((v_item->>'desconto')::numeric, 0)
    );

    v_saldo := public.calcular_saldo_estoque((v_item->>'produto_id')::uuid, NULL);
    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, tipo, origem, quantidade,
      saldo_anterior, saldo_posterior, venda_id, observacoes
    ) VALUES (
      v_uid, (v_item->>'produto_id')::uuid, 'saida', 'venda',
      (v_item->>'quantidade')::numeric, v_saldo,
      v_saldo - (v_item->>'quantidade')::numeric,
      v_venda_id, 'Saída automática da venda ' || v_numero
    );
  END LOOP;

  FOR v_pgto IN SELECT * FROM jsonb_array_elements(v_pagamentos) LOOP
    INSERT INTO public.venda_pagamentos (
      owner_id, venda_id, forma_pagamento, valor,
      valor_recebido, troco, parcelas, observacao
    ) VALUES (
      v_uid, v_venda_id, (v_pgto->>'forma_pagamento')::forma_pagamento,
      (v_pgto->>'valor')::numeric,
      NULLIF((v_pgto->>'valor_recebido')::numeric, 0),
      NULLIF((v_pgto->>'troco')::numeric, 0),
      COALESCE((v_pgto->>'parcelas')::int, 1),
      NULLIF(trim(v_pgto->>'observacao'),'')
    );
  END LOOP;

  -- Movimento de venda no caixa (referência; valores efetivos são calculados em caixa_resumo)
  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, venda_id, usuario_id)
  VALUES (v_uid, v_caixa_id, 'venda', _total, 'Venda ' || v_numero, v_venda_id, v_uid);

  IF _gerar_financeiro AND _status_pagamento IN ('pendente','parcial') AND _total > 0 THEN
    v_lanc_status := 'pendente'::lancamento_status;
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes
    ) VALUES (
      v_uid, 'receber'::lancamento_tipo, 'Venda ' || v_numero, _total,
      CASE WHEN _status_pagamento = 'parcial' THEN COALESCE(v_total_recebido,0) ELSE 0 END,
      CURRENT_DATE, CURRENT_DATE, NULL, _cliente_id, v_venda_id,
      v_forma_principal, v_lanc_status, NULLIF(trim(_observacao),'')
    );
  ELSIF _gerar_financeiro AND _status_pagamento = 'pago' AND _total > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes
    ) VALUES (
      v_uid, 'receber'::lancamento_tipo, 'Venda ' || v_numero, _total, _total,
      CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, _cliente_id, v_venda_id,
      v_forma_principal, 'recebido'::lancamento_status, NULLIF(trim(_observacao),'')
    );
  END IF;

  RETURN v_venda_id;
END;
$$;