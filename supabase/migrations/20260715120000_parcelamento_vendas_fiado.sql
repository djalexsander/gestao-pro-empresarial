-- Parcelamento de vendas fiado sem tabela paralela.
-- A implementação 1.1.23 permanece como núcleo transacional para venda,
-- estoque, pagamentos e numeração. Esta camada valida o contrato financeiro
-- e cria um título independente por parcela.

ALTER FUNCTION public.finalizar_venda_pdv(
  uuid, numeric, numeric, numeric, forma_pagamento, text, numeric, numeric,
  text, jsonb, jsonb, boolean, uuid, uuid, uuid, date
) RENAME TO finalizar_venda_pdv_legacy_1123;

ALTER TABLE public.financeiro_lancamentos
  DROP CONSTRAINT IF EXISTS financeiro_lancamentos_parcelas_validas;

ALTER TABLE public.financeiro_lancamentos
  ADD CONSTRAINT financeiro_lancamentos_parcelas_validas CHECK (
    (parcela_numero IS NULL AND parcela_total IS NULL)
    OR (
      parcela_numero >= 1
      AND parcela_total >= 1
      AND parcela_numero <= parcela_total
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_financeiro_venda_parcela
  ON public.financeiro_lancamentos(owner_id, venda_id, parcela_numero)
  WHERE venda_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finalizar_venda_pdv(
  _cliente_id uuid, _subtotal numeric, _desconto numeric, _total numeric,
  _forma forma_pagamento, _status_pagamento text, _valor_recebido numeric,
  _troco numeric, _observacao text, _itens jsonb,
  _pagamentos jsonb DEFAULT NULL::jsonb,
  _gerar_financeiro boolean DEFAULT true,
  _operador_id uuid DEFAULT NULL::uuid,
  _terminal_id uuid DEFAULT NULL::uuid,
  _client_uuid uuid DEFAULT NULL::uuid,
  _data_vencimento date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_id uuid;
  v_venda_id uuid;
  v_numero text;
  v_caixa_id uuid;
  v_pgto jsonb;
  v_pagamentos jsonb := _pagamentos;
  v_forma forma_pagamento;
  v_valor_centavos bigint;
  v_total_pagamentos_centavos bigint := 0;
  v_total_imediato_centavos bigint := 0;
  v_total_pendente_centavos bigint := 0;
  v_qtd_fiado integer := 0;
  v_quantidade integer;
  v_primeiro_vencimento date;
  v_valor_base bigint;
  v_resto bigint;
  v_numero_parcela integer;
  v_ano integer;
  v_mes integer;
  v_dia_original integer;
  v_ultimo_dia integer;
  v_vencimento date;
  v_status_calculado text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Serializa retries concorrentes antes do early-return da implementação base.
  IF _client_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('venda-client:' || _client_uuid::text, 0));
    SELECT id INTO v_existing_id
      FROM public.vendas
     WHERE owner_id = v_uid AND client_uuid = _client_uuid
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.vendas
         SET idempotent_replay_count = idempotent_replay_count + 1
       WHERE id = v_existing_id;
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Compatibilidade com clientes antigos que ainda enviam apenas a forma
  -- principal. Fiado legado equivale a 1/1 na data já existente no contrato.
  IF v_pagamentos IS NULL THEN
    v_pagamentos := jsonb_build_array(jsonb_build_object(
      'forma_pagamento', _forma::text,
      'valor', _total,
      'valor_recebido', _valor_recebido,
      'troco', _troco,
      'parcelas', 1,
      'quantidade_parcelas', 1,
      'primeiro_vencimento', _data_vencimento
    ));
  END IF;

  IF jsonb_typeof(v_pagamentos) <> 'array'
     OR jsonb_array_length(v_pagamentos) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma forma de pagamento.';
  END IF;

  FOR v_pgto IN SELECT value FROM jsonb_array_elements(v_pagamentos) LOOP
    BEGIN
      v_forma := (v_pgto->>'forma_pagamento')::forma_pagamento;
      v_valor_centavos := round((v_pgto->>'valor')::numeric * 100)::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Forma de pagamento ou valor inválido.';
    END;

    IF v_valor_centavos <= 0 THEN
      RAISE EXCEPTION 'O valor de cada forma de pagamento deve ser maior que zero.';
    END IF;
    v_total_pagamentos_centavos := v_total_pagamentos_centavos + v_valor_centavos;

    IF v_forma = 'fiado' THEN
      v_qtd_fiado := v_qtd_fiado + 1;
      IF _cliente_id IS NULL THEN
        RAISE EXCEPTION 'Selecione um cliente para realizar uma venda fiada.';
      END IF;
      BEGIN
        v_quantidade := (v_pgto->>'quantidade_parcelas')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Informe uma quantidade válida de parcelas.';
      END;
      IF v_quantidade IS NULL OR v_quantidade < 1 OR v_quantidade > 60
         OR (v_pgto->>'quantidade_parcelas') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Informe uma quantidade válida de parcelas.';
      END IF;
      BEGIN
        v_primeiro_vencimento := (v_pgto->>'primeiro_vencimento')::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Informe a data do primeiro vencimento.';
      END;
      IF v_primeiro_vencimento IS NULL THEN
        RAISE EXCEPTION 'Informe a data do primeiro vencimento.';
      END IF;
      v_total_pendente_centavos := v_total_pendente_centavos + v_valor_centavos;
    ELSIF v_forma IN ('boleto', 'ifood') THEN
      v_total_pendente_centavos := v_total_pendente_centavos + v_valor_centavos;
    ELSE
      v_total_imediato_centavos := v_total_imediato_centavos + v_valor_centavos;
    END IF;
  END LOOP;

  IF v_qtd_fiado > 1 THEN
    RAISE EXCEPTION 'Só é permitido um pagamento Fiado por venda.';
  END IF;
  IF v_total_pagamentos_centavos <> round(_total * 100)::bigint THEN
    RAISE EXCEPTION 'A soma das formas de pagamento não corresponde ao total da venda.';
  END IF;

  v_status_calculado := CASE
    WHEN v_total_pendente_centavos = 0 THEN 'pago'
    WHEN v_total_imediato_centavos = 0 THEN 'pendente'
    ELSE 'parcial'
  END;

  -- _gerar_financeiro=false evita o título único legado. Tudo continua na
  -- mesma transação da chamada externa: qualquer falha abaixo reverte a venda.
  v_venda_id := public.finalizar_venda_pdv_legacy_1123(
    _cliente_id, _subtotal, _desconto, _total, _forma, v_status_calculado,
    _valor_recebido, _troco, _observacao, _itens, v_pagamentos, false,
    _operador_id, _terminal_id, _client_uuid, _data_vencimento
  );

  SELECT numero, caixa_id INTO v_numero, v_caixa_id
    FROM public.vendas
   WHERE id = v_venda_id AND owner_id = v_uid;

  IF _gerar_financeiro THEN
    FOR v_pgto IN SELECT value FROM jsonb_array_elements(v_pagamentos) LOOP
      v_forma := (v_pgto->>'forma_pagamento')::forma_pagamento;
      v_valor_centavos := round((v_pgto->>'valor')::numeric * 100)::bigint;

      IF v_forma = 'fiado' THEN
        v_quantidade := (v_pgto->>'quantidade_parcelas')::integer;
        v_primeiro_vencimento := (v_pgto->>'primeiro_vencimento')::date;
        v_valor_base := v_valor_centavos / v_quantidade;
        v_resto := v_valor_centavos % v_quantidade;
        v_dia_original := extract(day FROM v_primeiro_vencimento)::integer;

        FOR v_numero_parcela IN 1..v_quantidade LOOP
          v_ano := extract(year FROM v_primeiro_vencimento)::integer
                   + ((extract(month FROM v_primeiro_vencimento)::integer - 1 + v_numero_parcela - 1) / 12);
          v_mes := ((extract(month FROM v_primeiro_vencimento)::integer - 1 + v_numero_parcela - 1) % 12) + 1;
          v_ultimo_dia := extract(day FROM (make_date(v_ano, v_mes, 1) + interval '1 month - 1 day'))::integer;
          v_vencimento := make_date(v_ano, v_mes, least(v_dia_original, v_ultimo_dia));

          INSERT INTO public.financeiro_lancamentos (
            owner_id, tipo, descricao, valor, valor_pago, data_emissao,
            data_vencimento, data_pagamento, forma_pagamento, status,
            cliente_id, venda_id, caixa_id, numero_documento,
            parcela_numero, parcela_total
          ) VALUES (
            v_uid, 'receber',
            'Venda ' || v_numero || ' — Parcela ' || v_numero_parcela || '/' || v_quantidade,
            (v_valor_base + CASE WHEN v_numero_parcela = v_quantidade THEN v_resto ELSE 0 END) / 100.0,
            0, CURRENT_DATE, v_vencimento, NULL, 'fiado', 'pendente',
            _cliente_id, v_venda_id, v_caixa_id, v_numero,
            v_numero_parcela, v_quantidade
          );
        END LOOP;
      ELSE
        INSERT INTO public.financeiro_lancamentos (
          owner_id, tipo, descricao, valor, valor_pago, data_emissao,
          data_vencimento, data_pagamento, forma_pagamento, status,
          cliente_id, venda_id, caixa_id, numero_documento,
          parcela_numero, parcela_total
        ) VALUES (
          v_uid, 'receber', 'Venda ' || v_numero,
          v_valor_centavos / 100.0,
          CASE WHEN v_forma IN ('boleto', 'ifood') THEN 0 ELSE v_valor_centavos / 100.0 END,
          CURRENT_DATE,
          COALESCE(NULLIF(v_pgto->>'primeiro_vencimento', '')::date, _data_vencimento, CURRENT_DATE),
          CASE WHEN v_forma IN ('boleto', 'ifood') THEN NULL ELSE CURRENT_DATE END,
          v_forma,
          CASE WHEN v_forma IN ('boleto', 'ifood') THEN 'pendente'::lancamento_status ELSE 'pago'::lancamento_status END,
          _cliente_id, v_venda_id, v_caixa_id, v_numero, 1, 1
        );
      END IF;
    END LOOP;
  END IF;

  -- O núcleo já registra o movimento quando tudo é imediato. Em venda mista,
  -- registra somente o valor efetivamente recebido agora.
  IF v_total_pendente_centavos > 0 AND v_total_imediato_centavos > 0 THEN
    INSERT INTO public.caixa_movimentos (caixa_id, owner_id, tipo, valor, venda_id, motivo)
    VALUES (
      v_caixa_id, v_uid, 'venda', v_total_imediato_centavos / 100.0,
      v_venda_id, 'Recebimento imediato da venda mista ' || v_numero
    );
  END IF;

  RETURN v_venda_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finalizar_venda_pdv(
  uuid, numeric, numeric, numeric, forma_pagamento, text, numeric, numeric,
  text, jsonb, jsonb, boolean, uuid, uuid, uuid, date
) TO authenticated;

-- Sem fluxo seguro de devolução financeira, uma venda com qualquer valor já
-- recebido não pode ser cancelada. Parcelas pendentes/parciais sem recebimento
-- continuam sendo preservadas e marcadas como canceladas pela função existente.
CREATE OR REPLACE FUNCTION public.cancelar_venda_parcelamento_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada'
     AND EXISTS (
       SELECT 1 FROM public.financeiro_lancamentos
        WHERE venda_id = NEW.id
          AND owner_id = NEW.owner_id
          AND COALESCE(valor_pago, 0) > 0
     ) THEN
    RAISE EXCEPTION 'Não é possível cancelar a venda: existem parcelas ou pagamentos já recebidos.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cancelar_venda_parcelamento_guard ON public.vendas;
CREATE TRIGGER trg_cancelar_venda_parcelamento_guard
BEFORE UPDATE OF status ON public.vendas
FOR EACH ROW EXECUTE FUNCTION public.cancelar_venda_parcelamento_guard();
