-- =====================================================================
-- Suporte a códigos de barras / QR Code / múltiplos identificadores
-- =====================================================================

-- 1) Novos campos na tabela produtos
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS codigo_interno text,
  ADD COLUMN IF NOT EXISTS qr_code text,
  ADD COLUMN IF NOT EXISTS tipo_identificacao_principal text NOT NULL DEFAULT 'sku',
  ADD COLUMN IF NOT EXISTS observacao_tecnica text;

-- Restringir os valores possíveis do tipo principal
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'produtos_tipo_identificacao_principal_check'
  ) THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT produtos_tipo_identificacao_principal_check
      CHECK (tipo_identificacao_principal IN ('sku','codigo_barras','qr_code','codigo_interno'));
  END IF;
END$$;

-- 2) Unicidade por owner do código de barras / QR Code / SKU / código interno
--    (apenas quando informado)
CREATE UNIQUE INDEX IF NOT EXISTS produtos_owner_sku_unique
  ON public.produtos (owner_id, sku)
  WHERE sku IS NOT NULL AND length(trim(sku)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS produtos_owner_codigo_barras_unique
  ON public.produtos (owner_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND length(trim(codigo_barras)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS produtos_owner_qr_code_unique
  ON public.produtos (owner_id, qr_code)
  WHERE qr_code IS NOT NULL AND length(trim(qr_code)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS produtos_owner_codigo_interno_unique
  ON public.produtos (owner_id, codigo_interno)
  WHERE codigo_interno IS NOT NULL AND length(trim(codigo_interno)) > 0;

-- 3) Tabela auxiliar para múltiplos códigos alternativos
CREATE TABLE IF NOT EXISTS public.produto_codigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  variacao_id uuid,
  tipo_codigo text NOT NULL CHECK (
    tipo_codigo IN ('codigo_barras','qr_code','sku','interno','alternativo')
  ),
  valor_codigo text NOT NULL CHECK (length(trim(valor_codigo)) > 0),
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mesma regra: não duplicar o mesmo código dentro da mesma empresa
CREATE UNIQUE INDEX IF NOT EXISTS produto_codigos_owner_valor_unique
  ON public.produto_codigos (owner_id, valor_codigo);

CREATE INDEX IF NOT EXISTS produto_codigos_produto_idx
  ON public.produto_codigos (produto_id);

ALTER TABLE public.produto_codigos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono acessa códigos de produto" ON public.produto_codigos;
CREATE POLICY "Dono acessa códigos de produto"
  ON public.produto_codigos
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_produto_codigos_updated_at ON public.produto_codigos;
CREATE TRIGGER trg_produto_codigos_updated_at
  BEFORE UPDATE ON public.produto_codigos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Função RPC: busca rápida de produto por qualquer código
--    Procura em: codigo_interno, sku, codigo_barras, qr_code (na tabela produtos)
--    e em produto_codigos. Restrita ao owner via RLS / auth.uid().
CREATE OR REPLACE FUNCTION public.buscar_produto_por_codigo(_codigo text)
RETURNS TABLE (
  produto_id uuid,
  sku text,
  nome text,
  codigo_barras text,
  qr_code text,
  codigo_interno text,
  tipo_identificacao_principal text,
  preco_venda numeric,
  preco_custo numeric,
  unidade text,
  status produto_status,
  categoria_id uuid,
  categoria_nome text,
  fonte text,            -- de onde veio o match (sku, codigo_barras, qr_code, interno, alternativo)
  saldo_estoque numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo text := trim(_codigo);
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF v_codigo IS NULL OR length(v_codigo) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH match AS (
    -- 1) Match na própria tabela produtos
    SELECT p.id AS produto_id,
           CASE
             WHEN p.codigo_barras  = v_codigo THEN 'codigo_barras'
             WHEN p.qr_code        = v_codigo THEN 'qr_code'
             WHEN p.sku            = v_codigo THEN 'sku'
             WHEN p.codigo_interno = v_codigo THEN 'interno'
           END AS fonte
      FROM public.produtos p
     WHERE p.owner_id = v_uid
       AND (
            p.codigo_barras  = v_codigo
         OR p.qr_code        = v_codigo
         OR p.sku            = v_codigo
         OR p.codigo_interno = v_codigo
       )
    UNION
    -- 2) Match na tabela auxiliar de códigos
    SELECT pc.produto_id, pc.tipo_codigo AS fonte
      FROM public.produto_codigos pc
     WHERE pc.owner_id = v_uid
       AND pc.valor_codigo = v_codigo
  )
  SELECT
    p.id,
    p.sku,
    p.nome,
    p.codigo_barras,
    p.qr_code,
    p.codigo_interno,
    p.tipo_identificacao_principal,
    p.preco_venda,
    p.preco_custo,
    p.unidade,
    p.status,
    p.categoria_id,
    c.nome,
    m.fonte,
    public.calcular_saldo_estoque(p.id, NULL) AS saldo_estoque
  FROM match m
  JOIN public.produtos p ON p.id = m.produto_id
  LEFT JOIN public.categorias_produto c ON c.id = p.categoria_id
  LIMIT 1;
END;
$$;

-- 5) Permissões
GRANT EXECUTE ON FUNCTION public.buscar_produto_por_codigo(text) TO authenticated;