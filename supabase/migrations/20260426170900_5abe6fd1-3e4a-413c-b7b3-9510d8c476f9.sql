ALTER TABLE public.financeiro_lancamentos
  ADD COLUMN IF NOT EXISTS conciliado_em timestamptz,
  ADD COLUMN IF NOT EXISTS conciliado_por uuid,
  ADD COLUMN IF NOT EXISTS valor_repasse numeric,
  ADD COLUMN IF NOT EXISTS taxa_repasse numeric,
  ADD COLUMN IF NOT EXISTS numero_repasse text,
  ADD COLUMN IF NOT EXISTS observacao_repasse text,
  ADD COLUMN IF NOT EXISTS repasse_id uuid;

CREATE TABLE IF NOT EXISTS public.ifood_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  data_repasse date NOT NULL,
  numero_repasse text,
  valor_bruto numeric NOT NULL DEFAULT 0,
  taxa_total numeric NOT NULL DEFAULT 0,
  valor_liquido numeric NOT NULL DEFAULT 0,
  qtd_lancamentos integer NOT NULL DEFAULT 0,
  observacao text,
  conciliado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ifood_repasses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono acessa repasses ifood" ON public.ifood_repasses;
CREATE POLICY "Dono acessa repasses ifood"
ON public.ifood_repasses FOR ALL TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Membros admin acessam repasses ifood" ON public.ifood_repasses;
CREATE POLICY "Membros admin acessam repasses ifood"
ON public.ifood_repasses FOR ALL TO authenticated
USING (
  (owner_id = auth.uid()) OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = ifood_repasses.owner_id
      AND m.papel IN ('owner','admin')
  )
)
WITH CHECK (
  (owner_id = auth.uid()) OR EXISTS (
    SELECT 1 FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = ifood_repasses.owner_id
      AND m.papel IN ('owner','admin')
  )
);

CREATE INDEX IF NOT EXISTS idx_ifood_repasses_owner_data
  ON public.ifood_repasses(owner_id, data_repasse DESC);

CREATE INDEX IF NOT EXISTS idx_finlanc_repasse
  ON public.financeiro_lancamentos(repasse_id);

CREATE INDEX IF NOT EXISTS idx_finlanc_ifood_pendentes
  ON public.financeiro_lancamentos(owner_id, status, forma_pagamento)
  WHERE forma_pagamento = 'ifood' AND status = 'pendente';

DROP TRIGGER IF EXISTS trg_ifood_repasses_updated_at ON public.ifood_repasses;
CREATE TRIGGER trg_ifood_repasses_updated_at
BEFORE UPDATE ON public.ifood_repasses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.conciliar_ifood_lancamento(
  _lancamento_id uuid,
  _data_repasse date,
  _valor_repasse numeric,
  _numero_repasse text DEFAULT NULL,
  _observacao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lanc public.financeiro_lancamentos%ROWTYPE;
  v_taxa numeric;
  v_user uuid := auth.uid();
BEGIN
  SELECT * INTO v_lanc FROM public.financeiro_lancamentos
   WHERE id = _lancamento_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  IF v_lanc.owner_id <> v_user
     AND NOT EXISTS (
       SELECT 1 FROM public.empresa_membros m
       JOIN public.empresas e ON e.id = m.empresa_id
       WHERE m.user_id = v_user AND e.owner_id = v_lanc.owner_id
         AND m.papel IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'Sem permissão para conciliar este lançamento';
  END IF;

  IF v_lanc.forma_pagamento <> 'ifood' THEN
    RAISE EXCEPTION 'Lançamento não é iFood';
  END IF;

  IF v_lanc.status = 'recebido' THEN
    RAISE EXCEPTION 'Lançamento já foi conciliado';
  END IF;

  v_taxa := GREATEST(COALESCE(v_lanc.valor,0) - COALESCE(_valor_repasse,0), 0);

  UPDATE public.financeiro_lancamentos SET
    status = 'recebido',
    data_pagamento = _data_repasse,
    valor_pago = _valor_repasse,
    conciliado_em = now(),
    conciliado_por = v_user,
    valor_repasse = _valor_repasse,
    taxa_repasse = v_taxa,
    numero_repasse = _numero_repasse,
    observacao_repasse = _observacao,
    updated_at = now()
  WHERE id = _lancamento_id;

  IF v_taxa > 0 THEN
    INSERT INTO public.financeiro_lancamentos (
      owner_id, descricao, tipo, status,
      valor, valor_pago, data_emissao, data_vencimento, data_pagamento,
      forma_pagamento, observacoes, numero_documento
    ) VALUES (
      v_lanc.owner_id,
      'Taxa iFood - ' || COALESCE(v_lanc.descricao, 'Venda'),
      'despesa', 'pago',
      v_taxa, v_taxa,
      _data_repasse, _data_repasse, _data_repasse,
      'ifood',
      'Taxa retida no repasse iFood' || COALESCE(' #' || _numero_repasse, ''),
      _numero_repasse
    );
  END IF;

  RETURN _lancamento_id;
END;
$$;

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

  SELECT COALESCE(SUM(valor), 0), COUNT(*), MIN(owner_id)
    INTO v_total_bruto, v_qtd, v_owner
  FROM public.financeiro_lancamentos
  WHERE id = ANY(_lancamento_ids)
    AND forma_pagamento = 'ifood'
    AND status = 'pendente';

  IF v_qtd = 0 THEN
    RAISE EXCEPTION 'Nenhum lançamento iFood pendente entre os selecionados';
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