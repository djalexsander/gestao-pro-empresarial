-- Tabela de histórico de pagamentos parciais/baixas de lançamentos financeiros
CREATE TABLE IF NOT EXISTS public.lancamento_pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  lancamento_id UUID NOT NULL REFERENCES public.financeiro_lancamentos(id) ON DELETE CASCADE,
  valor NUMERIC NOT NULL CHECK (valor > 0),
  data_pagamento DATE NOT NULL DEFAULT CURRENT_DATE,
  forma_pagamento public.forma_pagamento,
  observacao TEXT,
  registrado_por UUID,
  caixa_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lanc_pag_lanc ON public.lancamento_pagamentos(lancamento_id);
CREATE INDEX IF NOT EXISTS idx_lanc_pag_owner ON public.lancamento_pagamentos(owner_id);
CREATE INDEX IF NOT EXISTS idx_lanc_pag_data ON public.lancamento_pagamentos(data_pagamento);

ALTER TABLE public.lancamento_pagamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa pagamentos"
  ON public.lancamento_pagamentos
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros admin acessam pagamentos"
  ON public.lancamento_pagamentos
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM empresa_membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = lancamento_pagamentos.owner_id
        AND m.papel = ANY (ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
    )
  )
  WITH CHECK (
    owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM empresa_membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = lancamento_pagamentos.owner_id
        AND m.papel = ANY (ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
    )
  );

-- Função: recalcula valor_pago e status do lançamento a partir do histórico
CREATE OR REPLACE FUNCTION public.recalcular_lancamento_apos_pagamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lanc_id UUID;
  v_total_pago NUMERIC;
  v_valor NUMERIC;
  v_tipo lancamento_tipo;
  v_ultima_data DATE;
  v_novo_status lancamento_status;
BEGIN
  v_lanc_id := COALESCE(NEW.lancamento_id, OLD.lancamento_id);

  SELECT COALESCE(SUM(valor), 0), MAX(data_pagamento)
    INTO v_total_pago, v_ultima_data
  FROM public.lancamento_pagamentos
  WHERE lancamento_id = v_lanc_id;

  SELECT valor, tipo INTO v_valor, v_tipo
  FROM public.financeiro_lancamentos
  WHERE id = v_lanc_id;

  IF v_valor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_total_pago <= 0 THEN
    v_novo_status := 'pendente';
  ELSIF v_total_pago >= v_valor THEN
    v_novo_status := CASE WHEN v_tipo = 'pagar' THEN 'pago' ELSE 'recebido' END;
  ELSE
    v_novo_status := 'parcial';
  END IF;

  UPDATE public.financeiro_lancamentos
  SET
    valor_pago = v_total_pago,
    data_pagamento = CASE WHEN v_total_pago > 0 THEN v_ultima_data ELSE NULL END,
    status = v_novo_status,
    updated_at = now()
  WHERE id = v_lanc_id
    AND status NOT IN ('cancelado');

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_lanc_after_ins ON public.lancamento_pagamentos;
CREATE TRIGGER trg_recalc_lanc_after_ins
AFTER INSERT OR UPDATE OR DELETE ON public.lancamento_pagamentos
FOR EACH ROW EXECUTE FUNCTION public.recalcular_lancamento_apos_pagamento();

-- Função: bloqueia pagamento que ultrapasse o saldo do título
CREATE OR REPLACE FUNCTION public.validar_pagamento_lancamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valor_titulo NUMERIC;
  v_total_pago NUMERIC;
  v_status lancamento_status;
BEGIN
  SELECT valor, status INTO v_valor_titulo, v_status
  FROM public.financeiro_lancamentos
  WHERE id = NEW.lancamento_id;

  IF v_valor_titulo IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;

  IF v_status = 'cancelado' THEN
    RAISE EXCEPTION 'Não é possível registrar pagamento em título cancelado.';
  END IF;

  SELECT COALESCE(SUM(valor), 0) INTO v_total_pago
  FROM public.lancamento_pagamentos
  WHERE lancamento_id = NEW.lancamento_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_total_pago + NEW.valor) > (v_valor_titulo + 0.005) THEN
    RAISE EXCEPTION 'Valor do pagamento (%.2f) ultrapassa o saldo do título (%.2f).',
      NEW.valor, (v_valor_titulo - v_total_pago);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_valida_pag_lanc ON public.lancamento_pagamentos;
CREATE TRIGGER trg_valida_pag_lanc
BEFORE INSERT OR UPDATE ON public.lancamento_pagamentos
FOR EACH ROW EXECUTE FUNCTION public.validar_pagamento_lancamento();