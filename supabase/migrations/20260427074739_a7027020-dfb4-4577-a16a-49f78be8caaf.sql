-- =============================================
-- 1) Tabela de histórico/auditoria de status da venda
-- =============================================
CREATE TABLE IF NOT EXISTS public.vendas_status_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  venda_id uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  status_anterior text,
  status_novo text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('financeiro','vendas','sistema')),
  alterado_por uuid,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_status_hist_venda
  ON public.vendas_status_historico(venda_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendas_status_hist_owner
  ON public.vendas_status_historico(owner_id, created_at DESC);

ALTER TABLE public.vendas_status_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono le historico status venda" ON public.vendas_status_historico;
CREATE POLICY "Dono le historico status venda"
  ON public.vendas_status_historico
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.acessa_owner_id(owner_id, auth.uid()));

DROP POLICY IF EXISTS "Sistema insere historico status venda" ON public.vendas_status_historico;
CREATE POLICY "Sistema insere historico status venda"
  ON public.vendas_status_historico
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() OR public.acessa_owner_id(owner_id, auth.uid()));

-- =============================================
-- 2) Função: deriva status_pagamento da venda a partir do(s) lançamento(s) vinculado(s)
-- Enum lancamento_status = {pendente, pago, recebido, vencido, cancelado} (sem 'parcial')
-- "parcial" é derivado de valor_pago vs valor.
-- =============================================
CREATE OR REPLACE FUNCTION public.derivar_status_pagamento_venda(_venda_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_status_venda venda_status;
  v_total_lanc numeric := 0;
  v_total_pago numeric := 0;
  v_qtd_total int := 0;
  v_qtd_cancelado int := 0;
  v_qtd_quitado int := 0;
  v_qtd_vencido int := 0;
  v_today date := CURRENT_DATE;
BEGIN
  SELECT total, status INTO v_total, v_status_venda
  FROM public.vendas WHERE id = _venda_id;

  IF v_total IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_status_venda = 'cancelada' THEN
    RETURN 'cancelado';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'cancelado'),
    COUNT(*) FILTER (WHERE status IN ('pago','recebido')),
    COUNT(*) FILTER (WHERE status NOT IN ('pago','recebido','cancelado')
                     AND data_vencimento < v_today
                     AND COALESCE(valor_pago,0) < valor),
    COALESCE(SUM(valor)      FILTER (WHERE status <> 'cancelado'), 0),
    COALESCE(SUM(valor_pago) FILTER (WHERE status <> 'cancelado'), 0)
  INTO
    v_qtd_total, v_qtd_cancelado, v_qtd_quitado, v_qtd_vencido,
    v_total_lanc, v_total_pago
  FROM public.financeiro_lancamentos
  WHERE venda_id = _venda_id;

  IF v_qtd_total = 0 THEN
    RETURN NULL;
  END IF;

  IF v_qtd_cancelado = v_qtd_total THEN
    RETURN 'cancelado';
  END IF;

  -- Pago: total recebido cobre o total da venda OU todos os lançamentos não-cancelados estão quitados
  IF (v_total_pago >= COALESCE(v_total, 0) - 0.005 AND v_total_pago > 0)
     OR (v_qtd_quitado > 0 AND v_qtd_quitado = (v_qtd_total - v_qtd_cancelado)) THEN
    RETURN 'pago';
  END IF;

  IF v_total_pago > 0 THEN
    RETURN 'parcial';
  END IF;

  IF v_qtd_vencido > 0 THEN
    RETURN 'vencido';
  END IF;

  RETURN 'pendente';
END;
$$;

-- =============================================
-- 3) Trigger: quando muda lançamento financeiro, sincroniza status_pagamento da venda
-- =============================================
CREATE OR REPLACE FUNCTION public.sync_venda_status_from_lancamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda_id uuid;
  v_owner uuid;
  v_status_atual text;
  v_status_novo text;
BEGIN
  v_venda_id := COALESCE(NEW.venda_id, OLD.venda_id);
  IF v_venda_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_status_novo := public.derivar_status_pagamento_venda(v_venda_id);
  IF v_status_novo IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status_pagamento, owner_id INTO v_status_atual, v_owner
  FROM public.vendas WHERE id = v_venda_id;

  IF v_status_atual IS DISTINCT FROM v_status_novo THEN
    UPDATE public.vendas
       SET status_pagamento = v_status_novo,
           updated_at = now()
     WHERE id = v_venda_id;

    INSERT INTO public.vendas_status_historico
      (owner_id, venda_id, status_anterior, status_novo, origem, alterado_por, motivo)
    VALUES
      (v_owner, v_venda_id, v_status_atual, v_status_novo, 'financeiro',
       auth.uid(),
       'Sincronizado automaticamente após alteração no lançamento financeiro');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_venda_status_lanc ON public.financeiro_lancamentos;
CREATE TRIGGER trg_sync_venda_status_lanc
  AFTER INSERT OR UPDATE OF status, valor_pago, valor, data_vencimento
  ON public.financeiro_lancamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_venda_status_from_lancamento();

DROP TRIGGER IF EXISTS trg_sync_venda_status_lanc_del ON public.financeiro_lancamentos;
CREATE TRIGGER trg_sync_venda_status_lanc_del
  AFTER DELETE ON public.financeiro_lancamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_venda_status_from_lancamento();

-- =============================================
-- 4) RPC: alterar status da venda pela tela Vendas (sincroniza financeiro)
-- =============================================
CREATE OR REPLACE FUNCTION public.alterar_status_venda(
  _venda_id uuid,
  _novo_status text,
  _motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_total numeric;
  v_status_atual text;
  v_status_venda venda_status;
  v_lanc RECORD;
  v_qtd_alterados int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF _novo_status NOT IN ('pago','pendente','parcial','cancelado','vencido') THEN
    RAISE EXCEPTION 'Status inválido: %', _novo_status;
  END IF;

  SELECT owner_id, total, status_pagamento, status
    INTO v_owner, v_total, v_status_atual, v_status_venda
  FROM public.vendas WHERE id = _venda_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;

  IF v_owner <> v_uid AND NOT public.acessa_owner_id(v_owner, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão sobre esta venda';
  END IF;

  IF v_status_venda = 'cancelada' AND _novo_status <> 'cancelado' THEN
    RAISE EXCEPTION 'Venda cancelada não pode ter o status alterado. Use o cancelamento dedicado.';
  END IF;

  -- Atualiza cada lançamento vinculado, evitando duplicações
  FOR v_lanc IN
    SELECT id, status, valor, valor_pago, tipo
    FROM public.financeiro_lancamentos
    WHERE venda_id = _venda_id
      AND status <> 'cancelado'
  LOOP
    IF _novo_status = 'pago' THEN
      IF v_lanc.valor_pago < v_lanc.valor - 0.005 THEN
        INSERT INTO public.lancamento_pagamentos
          (owner_id, lancamento_id, valor, data_pagamento, forma_pagamento, registrado_por, observacao)
        VALUES
          (v_owner, v_lanc.id, v_lanc.valor - v_lanc.valor_pago, CURRENT_DATE, NULL, v_uid,
           COALESCE(NULLIF(_motivo,''), 'Marcado como pago pela tela Vendas'));
        v_qtd_alterados := v_qtd_alterados + 1;
      END IF;
    ELSIF _novo_status = 'pendente' THEN
      DELETE FROM public.lancamento_pagamentos WHERE lancamento_id = v_lanc.id;
      UPDATE public.financeiro_lancamentos
         SET status = 'pendente',
             valor_pago = 0,
             data_pagamento = NULL,
             updated_at = now()
       WHERE id = v_lanc.id;
      v_qtd_alterados := v_qtd_alterados + 1;
    ELSIF _novo_status = 'cancelado' THEN
      UPDATE public.financeiro_lancamentos
         SET status = 'cancelado', updated_at = now()
       WHERE id = v_lanc.id;
      v_qtd_alterados := v_qtd_alterados + 1;
    ELSIF _novo_status = 'vencido' THEN
      -- Vencido é derivado do vencimento; aqui apenas garante pendente para que a derivação atue
      UPDATE public.financeiro_lancamentos
         SET status = 'pendente', updated_at = now()
       WHERE id = v_lanc.id AND status NOT IN ('pago','recebido');
      v_qtd_alterados := v_qtd_alterados + 1;
    ELSIF _novo_status = 'parcial' THEN
      -- Mantém pagamentos atuais; apenas força status coerente
      UPDATE public.financeiro_lancamentos
         SET status = CASE WHEN valor_pago >= valor THEN status
                           ELSE 'pendente' END,
             updated_at = now()
       WHERE id = v_lanc.id;
      v_qtd_alterados := v_qtd_alterados + 1;
    END IF;
  END LOOP;

  -- Atualiza o status_pagamento direto na venda também (caso não haja lançamento vinculado)
  UPDATE public.vendas
     SET status_pagamento = _novo_status,
         status = CASE WHEN _novo_status = 'cancelado' THEN 'cancelada'::venda_status
                       WHEN _novo_status = 'pago' THEN 'faturada'::venda_status
                       ELSE status END,
         updated_at = now()
   WHERE id = _venda_id;

  IF v_status_atual IS DISTINCT FROM _novo_status THEN
    INSERT INTO public.vendas_status_historico
      (owner_id, venda_id, status_anterior, status_novo, origem, alterado_por, motivo)
    VALUES
      (v_owner, _venda_id, v_status_atual, _novo_status, 'vendas', v_uid, NULLIF(_motivo,''));
  END IF;

  RETURN jsonb_build_object(
    'venda_id', _venda_id,
    'status_anterior', v_status_atual,
    'status_novo', _novo_status,
    'lancamentos_alterados', v_qtd_alterados
  );
END;
$$;

-- =============================================
-- 5) Backfill: corrige vendas existentes desalinhadas
-- =============================================
DO $$
DECLARE
  r RECORD;
  v_novo text;
BEGIN
  FOR r IN
    SELECT v.id, v.status_pagamento, v.owner_id
    FROM public.vendas v
    WHERE EXISTS (SELECT 1 FROM public.financeiro_lancamentos f WHERE f.venda_id = v.id)
  LOOP
    v_novo := public.derivar_status_pagamento_venda(r.id);
    IF v_novo IS NOT NULL AND v_novo IS DISTINCT FROM r.status_pagamento THEN
      UPDATE public.vendas SET status_pagamento = v_novo, updated_at = now() WHERE id = r.id;

      INSERT INTO public.vendas_status_historico
        (owner_id, venda_id, status_anterior, status_novo, origem, alterado_por, motivo)
      VALUES
        (r.owner_id, r.id, r.status_pagamento, v_novo, 'sistema', NULL,
         'Backfill: alinhamento inicial entre financeiro e vendas');
    END IF;
  END LOOP;
END $$;