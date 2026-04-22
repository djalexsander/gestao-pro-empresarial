-- ============================================================
-- 1) TABELA FUNCIONARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.funcionarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  nome TEXT NOT NULL,
  login TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'caixa',
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultimo_acesso TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT funcionarios_role_check CHECK (role IN ('gerente','caixa')),
  CONSTRAINT funcionarios_login_owner_unique UNIQUE (owner_id, login)
);

CREATE INDEX IF NOT EXISTS idx_funcionarios_owner ON public.funcionarios(owner_id);
CREATE INDEX IF NOT EXISTS idx_funcionarios_ativo ON public.funcionarios(owner_id, ativo);

ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono gerencia seus funcionarios"
  ON public.funcionarios FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_funcionarios_updated
  BEFORE UPDATE ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2) ENABLE pgcrypto para hash de PIN
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 3) operador_id em caixas, vendas, caixa_movimentos
-- ============================================================
ALTER TABLE public.caixas
  ADD COLUMN IF NOT EXISTS operador_id UUID;

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS operador_id UUID;

ALTER TABLE public.caixa_movimentos
  ADD COLUMN IF NOT EXISTS operador_id UUID;

CREATE INDEX IF NOT EXISTS idx_caixas_operador ON public.caixas(operador_id);
CREATE INDEX IF NOT EXISTS idx_vendas_operador ON public.vendas(operador_id);

-- ============================================================
-- 4) RPC: criar funcionario (com hash do PIN)
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_criar(
  _nome TEXT,
  _login TEXT,
  _pin TEXT,
  _role public.app_role DEFAULT 'caixa'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _nome IS NULL OR length(trim(_nome)) = 0 THEN
    RAISE EXCEPTION 'Nome obrigatório';
  END IF;
  IF _login IS NULL OR length(trim(_login)) < 2 THEN
    RAISE EXCEPTION 'Login deve ter ao menos 2 caracteres';
  END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 8 dígitos numéricos';
  END IF;
  IF _role NOT IN ('gerente','caixa') THEN
    RAISE EXCEPTION 'Papel inválido (use gerente ou caixa)';
  END IF;

  INSERT INTO public.funcionarios (owner_id, nome, login, pin_hash, role)
  VALUES (
    v_uid,
    trim(_nome),
    lower(trim(_login)),
    crypt(_pin, gen_salt('bf', 8)),
    _role
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 5) RPC: alterar PIN
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_resetar_pin(
  _funcionario_id UUID,
  _novo_pin TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _novo_pin IS NULL OR length(_novo_pin) < 4 OR length(_novo_pin) > 8 OR _novo_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 8 dígitos numéricos';
  END IF;

  UPDATE public.funcionarios
  SET pin_hash = crypt(_novo_pin, gen_salt('bf', 8))
  WHERE id = _funcionario_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;
END;
$$;

-- ============================================================
-- 6) RPC: validar PIN e retornar dados do operador
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_validar_pin(
  _funcionario_id UUID,
  _pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_func RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT id, nome, login, role, ativo, pin_hash
    INTO v_func
  FROM public.funcionarios
  WHERE id = _funcionario_id AND owner_id = v_uid;

  IF v_func.id IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;
  IF NOT v_func.ativo THEN
    RAISE EXCEPTION 'Funcionário inativo';
  END IF;
  IF v_func.pin_hash <> crypt(_pin, v_func.pin_hash) THEN
    RAISE EXCEPTION 'PIN incorreto';
  END IF;

  UPDATE public.funcionarios
  SET ultimo_acesso = now()
  WHERE id = _funcionario_id;

  RETURN jsonb_build_object(
    'id', v_func.id,
    'nome', v_func.nome,
    'login', v_func.login,
    'role', v_func.role
  );
END;
$$;

-- ============================================================
-- 7) RPC: listar funcionários ativos (sem hash)
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionarios_listar()
RETURNS TABLE (
  id UUID,
  nome TEXT,
  login TEXT,
  role public.app_role,
  ativo BOOLEAN,
  ultimo_acesso TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, nome, login, role, ativo, ultimo_acesso, created_at
  FROM public.funcionarios
  WHERE owner_id = auth.uid()
  ORDER BY ativo DESC, nome ASC;
$$;

-- ============================================================
-- 8) Atualizar abrir_caixa para receber operador_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.abrir_caixa(
  _valor_inicial NUMERIC,
  _observacao TEXT DEFAULT NULL,
  _operador_id UUID DEFAULT NULL
) RETURNS UUID
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

  -- Validar operador, se informado
  IF _operador_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.funcionarios
      WHERE id = _operador_id AND owner_id = v_uid AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Operador inválido';
    END IF;
  END IF;

  -- Verifica caixa aberto pelo MESMO operador (ou pelo admin se sem operador)
  IF EXISTS (
    SELECT 1 FROM public.caixas
    WHERE owner_id = v_uid
      AND status = 'aberto'
      AND COALESCE(operador_id::text,'') = COALESCE(_operador_id::text,'')
  ) THEN
    RAISE EXCEPTION 'Já existe um caixa aberto para este operador. Feche o atual antes de abrir outro.';
  END IF;

  INSERT INTO public.caixas (owner_id, usuario_id, operador_id, valor_inicial, observacao, status)
  VALUES (v_uid, v_uid, _operador_id, _valor_inicial, NULLIF(trim(_observacao), ''), 'aberto')
  RETURNING id INTO v_caixa_id;

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, usuario_id, operador_id)
  VALUES (v_uid, v_caixa_id, 'abertura', _valor_inicial, 'Abertura de caixa', v_uid, _operador_id);

  RETURN v_caixa_id;
END;
$$;

-- ============================================================
-- 9) RPC para buscar caixa aberto de um operador
-- ============================================================
CREATE OR REPLACE FUNCTION public.caixa_aberto_operador(_operador_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.caixas
  WHERE owner_id = auth.uid()
    AND status = 'aberto'
    AND COALESCE(operador_id::text,'') = COALESCE(_operador_id::text,'')
  ORDER BY data_abertura DESC
  LIMIT 1;
$$;

-- ============================================================
-- 10) Atualizar finalizar_venda_pdv para aceitar operador_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalizar_venda_pdv(
  _cliente_id UUID,
  _subtotal NUMERIC,
  _desconto NUMERIC,
  _total NUMERIC,
  _forma forma_pagamento,
  _status_pagamento TEXT,
  _valor_recebido NUMERIC,
  _troco NUMERIC,
  _observacao TEXT,
  _itens JSONB,
  _pagamentos JSONB DEFAULT NULL,
  _gerar_financeiro BOOLEAN DEFAULT true,
  _operador_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_venda_id UUID;
  v_numero TEXT;
  v_count INT;
  v_seq INT;
  v_item JSONB;
  v_pgto JSONB;
  v_saldo NUMERIC(14,3);
  v_lanc_status lancamento_status;
  v_forma_principal forma_pagamento := _forma;
  v_total_recebido NUMERIC(14,2) := 0;
  v_total_troco NUMERIC(14,2) := 0;
  v_max_valor NUMERIC(14,2) := 0;
  v_pagamentos JSONB := _pagamentos;
  v_caixa_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;
  IF _status_pagamento NOT IN ('pago','pendente','parcial','cancelado') THEN
    RAISE EXCEPTION 'status_pagamento inválido: %', _status_pagamento;
  END IF;

  -- Caixa aberto do operador (ou do admin se sem operador)
  SELECT id INTO v_caixa_id FROM public.caixas
  WHERE owner_id = v_uid
    AND status = 'aberto'
    AND COALESCE(operador_id::text,'') = COALESCE(_operador_id::text,'')
  ORDER BY data_abertura DESC LIMIT 1;

  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto para este operador. Abra o caixa antes de vender.';
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
    owner_id, numero, cliente_id, vendedor_id, caixa_id, operador_id,
    data_emissao, subtotal, desconto, total,
    forma_pagamento, status, status_pagamento,
    valor_recebido, troco, observacoes, data_finalizacao
  ) VALUES (
    v_uid, v_numero, _cliente_id, v_uid, v_caixa_id, _operador_id,
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

  INSERT INTO public.caixa_movimentos (owner_id, caixa_id, tipo, valor, motivo, venda_id, usuario_id, operador_id)
  VALUES (v_uid, v_caixa_id, 'venda', _total, 'Venda ' || v_numero, v_venda_id, v_uid, _operador_id);

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