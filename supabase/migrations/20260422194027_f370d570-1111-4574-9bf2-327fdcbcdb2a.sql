
-- ============ Clientes: duplicidade ============
-- Normalizar documentos vazios para null antes de criar o índice
UPDATE public.clientes
SET documento = NULL
WHERE documento IS NOT NULL AND length(btrim(documento)) = 0;

-- Índice único parcial: 1 documento por owner, quando informado
CREATE UNIQUE INDEX IF NOT EXISTS clientes_owner_documento_uniq
  ON public.clientes (owner_id, documento)
  WHERE documento IS NOT NULL;

-- ============ Métricas por cliente ============
CREATE OR REPLACE FUNCTION public.cliente_metricas(_cliente_id uuid DEFAULT NULL)
RETURNS TABLE (
  cliente_id uuid,
  total_vendas bigint,
  valor_total numeric,
  ticket_medio numeric,
  ultima_venda date
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS cliente_id,
    COUNT(v.id) FILTER (WHERE v.status <> 'cancelada')::bigint AS total_vendas,
    COALESCE(SUM(v.total) FILTER (WHERE v.status <> 'cancelada'), 0)::numeric AS valor_total,
    CASE
      WHEN COUNT(v.id) FILTER (WHERE v.status <> 'cancelada') > 0
        THEN (COALESCE(SUM(v.total) FILTER (WHERE v.status <> 'cancelada'), 0)
              / COUNT(v.id) FILTER (WHERE v.status <> 'cancelada'))::numeric
      ELSE 0::numeric
    END AS ticket_medio,
    MAX(v.data_emissao) FILTER (WHERE v.status <> 'cancelada')::date AS ultima_venda
  FROM public.clientes c
  LEFT JOIN public.vendas v
    ON v.cliente_id = c.id AND v.owner_id = auth.uid()
  WHERE c.owner_id = auth.uid()
    AND (_cliente_id IS NULL OR c.id = _cliente_id)
  GROUP BY c.id;
$$;

-- ============ Métricas do dia (vendas) ============
CREATE OR REPLACE FUNCTION public.venda_metricas_periodo(
  _data_inicio date DEFAULT CURRENT_DATE,
  _data_fim date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'qtd_vendas',     COUNT(*)::bigint,
    'qtd_canceladas', COUNT(*) FILTER (WHERE status = 'cancelada')::bigint,
    'total_vendido',  COALESCE(SUM(total) FILTER (WHERE status <> 'cancelada'), 0)::numeric,
    'ticket_medio',
      CASE
        WHEN COUNT(*) FILTER (WHERE status <> 'cancelada') > 0
          THEN (COALESCE(SUM(total) FILTER (WHERE status <> 'cancelada'), 0)
                / COUNT(*) FILTER (WHERE status <> 'cancelada'))::numeric
        ELSE 0::numeric
      END,
    'qtd_pendentes',  COUNT(*) FILTER (WHERE status_pagamento = 'pendente')::bigint,
    'valor_pendente', COALESCE(SUM(total) FILTER (WHERE status_pagamento = 'pendente'), 0)::numeric
  )
  FROM public.vendas
  WHERE owner_id = auth.uid()
    AND data_emissao BETWEEN _data_inicio AND _data_fim;
$$;
