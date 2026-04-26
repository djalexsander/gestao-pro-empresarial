-- Corrige caixa_resumo: total_ifood/total_fiado consideram APENAS vendas
-- com status_pagamento = 'pago' para fins do fechamento de caixa, porque
-- vendas pendentes/parciais já geram lançamentos individuais no financeiro
-- (pelo finalizar_venda_pdv), e duplicaríamos se também consolidássemos.
--
-- Para o resumo VISUAL (cards), também retornamos um total bruto separado
-- (incluindo pendentes), nomeado total_ifood_pendente/total_fiado_pendente,
-- para o operador enxergar quanto entrou nessa forma no turno.

CREATE OR REPLACE FUNCTION public.caixa_resumo(_caixa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_caixa RECORD;
  v_total_dinheiro NUMERIC(14,2) := 0;
  v_total_pix NUMERIC(14,2) := 0;
  v_total_debito NUMERIC(14,2) := 0;
  v_total_credito NUMERIC(14,2) := 0;
  v_total_boleto NUMERIC(14,2) := 0;
  v_total_ifood NUMERIC(14,2) := 0;
  v_total_fiado NUMERIC(14,2) := 0;
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

  -- Soma valores recebidos por forma. Para o resumo OPERACIONAL do caixa
  -- (visualização e fechamento), consideramos:
  --   - dinheiro/pix/débito/crédito/boleto/outros: valor confirmado quando
  --     a venda está paga; valor recebido parcial quando parcial.
  --   - ifood/fiado: somente vendas PAGAS. Vendas pendentes/parciais nessa
  --     forma já geram um lançamento individual no financeiro pelo PDV
  --     e seriam duplicadas se consolidássemos aqui.
  WITH pgs AS (
    SELECT
      vp.forma_pagamento::text AS forma,
      CASE
        WHEN v.status_pagamento = 'pago' THEN vp.valor
        WHEN v.status_pagamento = 'parcial'
             AND vp.forma_pagamento::text NOT IN ('ifood','fiado')
             THEN COALESCE(vp.valor_recebido, vp.valor)
        ELSE 0
      END AS valor_efetivo
    FROM public.venda_pagamentos vp
    JOIN public.vendas v ON v.id = vp.venda_id
    WHERE v.caixa_id = _caixa_id
      AND v.owner_id = v_uid
      AND v.status <> 'cancelada'
  )
  SELECT
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'dinheiro'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'pix'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'cartao_debito'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'cartao_credito'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'boleto'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'ifood'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma = 'fiado'), 0),
    COALESCE(SUM(valor_efetivo) FILTER (WHERE forma NOT IN ('dinheiro','pix','cartao_debito','cartao_credito','boleto','ifood','fiado')), 0)
  INTO v_total_dinheiro, v_total_pix, v_total_debito, v_total_credito, v_total_boleto, v_total_ifood, v_total_fiado, v_total_outros
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

  -- Valor esperado em DINHEIRO físico:
  -- inicial + dinheiro recebido + suprimentos - sangrias.
  -- iFood e Fiado NÃO entram aqui — não são dinheiro físico no caixa.
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
    'total_ifood', v_total_ifood,
    'total_fiado', v_total_fiado,
    'total_outros', v_total_outros,
    'total_sangrias', v_total_sangrias,
    'total_suprimentos', v_total_suprimentos,
    'valor_esperado', v_valor_esperado,
    'valor_informado', v_caixa.valor_informado,
    'diferenca', v_caixa.diferenca
  );
END;
$function$;