-- =========================================
-- PDV: finalização da venda
-- =========================================

-- 1) Campos extras em vendas
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS valor_recebido numeric(14,2),
  ADD COLUMN IF NOT EXISTS troco numeric(14,2),
  ADD COLUMN IF NOT EXISTS status_pagamento text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS data_finalizacao timestamptz;

-- Validação de status_pagamento (trigger, não CHECK, para flexibilidade)
CREATE OR REPLACE FUNCTION public.validar_status_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status_pagamento NOT IN ('pago','pendente','parcial','cancelado') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', NEW.status_pagamento;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_status_pagamento ON public.vendas;
CREATE TRIGGER trg_validar_status_pagamento
BEFORE INSERT OR UPDATE OF status_pagamento ON public.vendas
FOR EACH ROW EXECUTE FUNCTION public.validar_status_pagamento();

-- 2) Tabela de pagamentos (preparada para misto)
CREATE TABLE IF NOT EXISTS public.venda_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  venda_id uuid NOT NULL,
  forma_pagamento forma_pagamento NOT NULL,
  valor numeric(14,2) NOT NULL,
  valor_recebido numeric(14,2),
  troco numeric(14,2),
  parcelas integer DEFAULT 1,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_venda ON public.venda_pagamentos(venda_id);
CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_owner ON public.venda_pagamentos(owner_id);

ALTER TABLE public.venda_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono acessa pagamentos de venda" ON public.venda_pagamentos;
CREATE POLICY "Dono acessa pagamentos de venda"
ON public.venda_pagamentos FOR ALL
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- 3) RPC para finalizar venda (PDV) atomicamente:
--    cria venda + itens + pagamento + saídas de estoque + financeiro (se pendente)
CREATE OR REPLACE FUNCTION public.finalizar_venda_pdv(
  _cliente_id uuid,
  _subtotal numeric,
  _desconto numeric,
  _total numeric,
  _forma forma_pagamento,
  _status_pagamento text,
  _valor_recebido numeric,
  _troco numeric,
  _observacao text,
  _itens jsonb,            -- array de {produto_id, quantidade, preco_unitario, desconto, descricao}
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
  v_saldo numeric(14,3);
  v_lanc_status lancamento_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;
  IF _status_pagamento NOT IN ('pago','pendente','parcial','cancelado') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', _status_pagamento;
  END IF;

  -- Numeração sequencial por dono: VND-000001
  SELECT COUNT(*) INTO v_count FROM public.vendas WHERE owner_id = v_uid;
  v_seq := v_count + 1;
  v_numero := 'VND-' || LPAD(v_seq::text, 6, '0');

  -- Cria a venda
  INSERT INTO public.vendas (
    owner_id, numero, cliente_id, vendedor_id,
    data_emissao, subtotal, desconto, total,
    forma_pagamento, status, status_pagamento,
    valor_recebido, troco, observacoes, data_finalizacao
  ) VALUES (
    v_uid, v_numero, _cliente_id, v_uid,
    CURRENT_DATE, _subtotal, _desconto, _total,
    _forma,
    CASE WHEN _status_pagamento = 'pago' THEN 'faturada'::venda_status
         WHEN _status_pagamento = 'cancelado' THEN 'cancelada'::venda_status
         ELSE 'aprovada'::venda_status
    END,
    _status_pagamento,
    _valor_recebido, _troco, NULLIF(trim(_observacao),''), now()
  )
  RETURNING id INTO v_venda_id;

  -- Itens + saída de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens)
  LOOP
    INSERT INTO public.venda_itens (
      owner_id, venda_id, produto_id,
      descricao, quantidade, preco_unitario, desconto, total
    ) VALUES (
      v_uid, v_venda_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'descricao',
      (v_item->>'quantidade')::numeric,
      (v_item->>'preco_unitario')::numeric,
      COALESCE((v_item->>'desconto')::numeric, 0),
      (v_item->>'quantidade')::numeric * (v_item->>'preco_unitario')::numeric
        - COALESCE((v_item->>'desconto')::numeric, 0)
    );

    -- Saída de estoque (mesmo se ficar negativo, registra; controle de bloqueio fica para política futura)
    v_saldo := public.calcular_saldo_estoque((v_item->>'produto_id')::uuid, NULL);
    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, tipo, origem,
      quantidade, saldo_anterior, saldo_posterior,
      venda_id, observacoes
    ) VALUES (
      v_uid, (v_item->>'produto_id')::uuid, 'saida', 'venda',
      (v_item->>'quantidade')::numeric,
      v_saldo,
      v_saldo - (v_item->>'quantidade')::numeric,
      v_venda_id, 'Saída automática da venda ' || v_numero
    );
  END LOOP;

  -- Pagamento (1 registro; estrutura suporta múltiplos no futuro)
  INSERT INTO public.venda_pagamentos (
    owner_id, venda_id, forma_pagamento, valor,
    valor_recebido, troco, observacao
  ) VALUES (
    v_uid, v_venda_id, _forma, _total,
    _valor_recebido, _troco, NULLIF(trim(_observacao),'')
  );

  -- Lançamento financeiro (a receber) quando aplicável
  IF _gerar_financeiro AND _status_pagamento IN ('pendente','parcial') AND _total > 0 THEN
    v_lanc_status := 'pendente'::lancamento_status;
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes
    ) VALUES (
      v_uid, 'receber'::tipo_lancamento,
      'Venda ' || v_numero, _total,
      CASE WHEN _status_pagamento = 'parcial' THEN COALESCE(_valor_recebido,0) ELSE 0 END,
      CURRENT_DATE, CURRENT_DATE,
      NULL, _cliente_id, v_venda_id, _forma, v_lanc_status,
      NULLIF(trim(_observacao),'')
    );
  ELSIF _gerar_financeiro AND _status_pagamento = 'pago' AND _total > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor, valor_pago,
      data_emissao, data_vencimento, data_pagamento,
      cliente_id, venda_id, forma_pagamento, status, observacoes
    ) VALUES (
      v_uid, 'receber'::tipo_lancamento,
      'Venda ' || v_numero, _total, _total,
      CURRENT_DATE, CURRENT_DATE, CURRENT_DATE,
      _cliente_id, v_venda_id, _forma, 'recebido'::lancamento_status,
      NULLIF(trim(_observacao),'')
    );
  END IF;

  RETURN v_venda_id;
END;
$$;