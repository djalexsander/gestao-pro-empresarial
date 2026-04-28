
-- 1) Tabela de itens do pagamento (carrinho consolidado)
CREATE TABLE IF NOT EXISTS public.pagamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id uuid NOT NULL REFERENCES public.pagamentos(id) ON DELETE CASCADE,
  tipo public.pagamento_referencia NOT NULL,
  plano_id uuid REFERENCES public.planos(id) ON DELETE SET NULL,
  modulo_id uuid REFERENCES public.modulos(id) ON DELETE SET NULL,
  descricao text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagamento_itens_ref_chk CHECK (
    (tipo = 'plano'  AND plano_id  IS NOT NULL AND modulo_id IS NULL) OR
    (tipo = 'modulo' AND modulo_id IS NOT NULL AND plano_id  IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pagamento_itens_pag ON public.pagamento_itens(pagamento_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pag_itens_plano  ON public.pagamento_itens(pagamento_id, plano_id)  WHERE plano_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pag_itens_modulo ON public.pagamento_itens(pagamento_id, modulo_id) WHERE modulo_id IS NOT NULL;

ALTER TABLE public.pagamento_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Empresa le seus itens de pagamento"
  ON public.pagamento_itens FOR SELECT
  TO authenticated
  USING (
    pagamento_id IN (
      SELECT p.id FROM public.pagamentos p
      WHERE p.empresa_id IN (SELECT id FROM public.empresas WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "Super admin gerencia itens de pagamento"
  ON public.pagamento_itens FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- 2) Função: solicitar carrinho consolidado (idempotente por composição)
CREATE OR REPLACE FUNCTION public.solicitar_carrinho(
  _planos uuid[] DEFAULT ARRAY[]::uuid[],
  _modulos uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _empresa_id uuid;
  _pag_id uuid;
  _total numeric(14,2) := 0;
  _desc text;
  _qtd_planos int;
  _qtd_modulos int;
  _r record;
  _candidato uuid;
BEGIN
  -- empresa do usuário logado
  SELECT id INTO _empresa_id FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1;
  IF _empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não possui empresa cadastrada';
  END IF;

  _planos  := COALESCE(_planos,  ARRAY[]::uuid[]);
  _modulos := COALESCE(_modulos, ARRAY[]::uuid[]);
  _qtd_planos  := array_length(_planos, 1);
  _qtd_modulos := array_length(_modulos, 1);

  IF COALESCE(_qtd_planos,0) + COALESCE(_qtd_modulos,0) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio';
  END IF;

  -- Idempotência: tenta achar pagamento pendente da empresa que tenha
  -- exatamente o mesmo conjunto de itens.
  FOR _candidato IN
    SELECT pg.id
      FROM public.pagamentos pg
     WHERE pg.empresa_id = _empresa_id
       AND pg.status = 'pendente'
       AND pg.referencia_tipo = 'outro'
  LOOP
    IF (
      SELECT COALESCE(array_agg(plano_id ORDER BY plano_id) FILTER (WHERE plano_id IS NOT NULL), ARRAY[]::uuid[])
        FROM public.pagamento_itens WHERE pagamento_id = _candidato
    ) = (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(_planos) AS t(x))
       AND
       (
      SELECT COALESCE(array_agg(modulo_id ORDER BY modulo_id) FILTER (WHERE modulo_id IS NOT NULL), ARRAY[]::uuid[])
        FROM public.pagamento_itens WHERE pagamento_id = _candidato
    ) = (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(_modulos) AS t(x))
    THEN
      RETURN _candidato;
    END IF;
  END LOOP;

  -- Calcula total
  SELECT COALESCE(SUM(valor),0) INTO _total
    FROM public.planos WHERE id = ANY(_planos) AND ativo = true;
  SELECT _total + COALESCE(SUM(valor),0) INTO _total
    FROM public.modulos WHERE id = ANY(_modulos) AND ativo = true;

  IF _total <= 0 THEN
    RAISE EXCEPTION 'Total do carrinho inválido';
  END IF;

  _desc := format('Carrinho: %s plano(s) e %s módulo(s)',
                  COALESCE(_qtd_planos,0), COALESCE(_qtd_modulos,0));

  -- Cria pagamento consolidado
  INSERT INTO public.pagamentos (empresa_id, referencia_tipo, descricao, valor, status, registrado_por)
  VALUES (_empresa_id, 'outro', _desc, _total, 'pendente', auth.uid())
  RETURNING id INTO _pag_id;

  -- Insere itens (planos)
  FOR _r IN SELECT id, nome, valor FROM public.planos WHERE id = ANY(_planos) AND ativo = true LOOP
    INSERT INTO public.pagamento_itens (pagamento_id, tipo, plano_id, descricao, valor)
    VALUES (_pag_id, 'plano', _r.id, _r.nome, _r.valor);
  END LOOP;

  -- Insere itens (módulos)
  FOR _r IN SELECT id, nome, valor FROM public.modulos WHERE id = ANY(_modulos) AND ativo = true LOOP
    INSERT INTO public.pagamento_itens (pagamento_id, tipo, modulo_id, descricao, valor)
    VALUES (_pag_id, 'modulo', _r.id, _r.nome, _r.valor);
  END LOOP;

  RETURN _pag_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.solicitar_carrinho(uuid[], uuid[]) TO authenticated;

-- 3) Atualiza confirmar_pagamento_asaas para suportar pagamento consolidado
CREATE OR REPLACE FUNCTION public.confirmar_pagamento_asaas(
  _pagamento_id uuid,
  _data_pagamento date DEFAULT CURRENT_DATE,
  _forma_pagamento text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pg record;
  _plano record;
  _it record;
  _ativados jsonb := '[]'::jsonb;
  _has_itens boolean;
BEGIN
  SELECT * INTO _pg FROM public.pagamentos WHERE id = _pagamento_id FOR UPDATE;
  IF _pg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagamento_nao_encontrado');
  END IF;

  IF _pg.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'ja_processado', true, 'pagamento_id', _pg.id);
  END IF;

  UPDATE public.pagamentos
     SET status = 'pago',
         data_pagamento = COALESCE(_data_pagamento, CURRENT_DATE),
         forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento)
   WHERE id = _pg.id;

  SELECT EXISTS(SELECT 1 FROM public.pagamento_itens WHERE pagamento_id = _pg.id) INTO _has_itens;

  IF _has_itens THEN
    -- Pagamento consolidado: ativa cada item
    FOR _it IN
      SELECT * FROM public.pagamento_itens WHERE pagamento_id = _pg.id
    LOOP
      IF _it.tipo = 'plano' AND _it.plano_id IS NOT NULL THEN
        SELECT * INTO _plano FROM public.planos WHERE id = _it.plano_id;
        INSERT INTO public.empresa_assinaturas (
          empresa_id, plano_id, status, data_inicio, data_expiracao, observacoes
        ) VALUES (
          _pg.empresa_id, _it.plano_id, 'ativa', CURRENT_DATE,
          CASE
            WHEN _plano.tipo_cobranca = 'mensal' THEN CURRENT_DATE + INTERVAL '30 days'
            WHEN _plano.tipo_cobranca = 'anual'  THEN CURRENT_DATE + INTERVAL '365 days'
            ELSE NULL
          END,
          'Ativada via carrinho Asaas'
        );
        _ativados := _ativados || jsonb_build_object('tipo','plano','id',_it.plano_id);

      ELSIF _it.tipo = 'modulo' AND _it.modulo_id IS NOT NULL THEN
        INSERT INTO public.empresa_modulos (
          empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes
        ) VALUES (
          _pg.empresa_id, _it.modulo_id, 'ativo', CURRENT_DATE,
          CURRENT_DATE + INTERVAL '30 days',
          'Ativado via carrinho Asaas'
        )
        ON CONFLICT (empresa_id, modulo_id) DO UPDATE
          SET status = 'ativo',
              data_inicio = CURRENT_DATE,
              data_expiracao = CURRENT_DATE + INTERVAL '30 days',
              observacoes = 'Ativado via carrinho Asaas';
        _ativados := _ativados || jsonb_build_object('tipo','modulo','id',_it.modulo_id);
      END IF;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'consolidado', true, 'itens', _ativados);
  END IF;

  -- Compatibilidade: pagamento simples (1 item)
  IF _pg.referencia_tipo = 'plano' AND _pg.plano_id IS NOT NULL THEN
    SELECT * INTO _plano FROM public.planos WHERE id = _pg.plano_id;
    INSERT INTO public.empresa_assinaturas (
      empresa_id, plano_id, status, data_inicio, data_expiracao, observacoes
    ) VALUES (
      _pg.empresa_id, _pg.plano_id, 'ativa', CURRENT_DATE,
      CASE
        WHEN _plano.tipo_cobranca = 'mensal' THEN CURRENT_DATE + INTERVAL '30 days'
        WHEN _plano.tipo_cobranca = 'anual'  THEN CURRENT_DATE + INTERVAL '365 days'
        ELSE NULL
      END,
      'Ativada automaticamente via Asaas'
    );
    RETURN jsonb_build_object('ok', true, 'tipo', 'plano', 'plano_id', _pg.plano_id);

  ELSIF _pg.referencia_tipo = 'modulo' AND _pg.modulo_id IS NOT NULL THEN
    INSERT INTO public.empresa_modulos (
      empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes
    ) VALUES (
      _pg.empresa_id, _pg.modulo_id, 'ativo', CURRENT_DATE,
      CURRENT_DATE + INTERVAL '30 days',
      'Ativado automaticamente via Asaas'
    )
    ON CONFLICT (empresa_id, modulo_id) DO UPDATE
      SET status = 'ativo',
          data_inicio = CURRENT_DATE,
          data_expiracao = CURRENT_DATE + INTERVAL '30 days',
          observacoes = 'Ativado automaticamente via Asaas';
    RETURN jsonb_build_object('ok', true, 'tipo', 'modulo', 'modulo_id', _pg.modulo_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'tipo','outro');
END;
$$;
