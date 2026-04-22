
-- Coluna auxiliar para captura do estoque inicial no cadastro
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS estoque_inicial NUMERIC(14,3) NOT NULL DEFAULT 0;

-- Índice composto para somatório rápido de saldo
CREATE INDEX IF NOT EXISTS idx_movs_saldo
  ON public.estoque_movimentacoes(owner_id, produto_id, variacao_id);

-- Função: calcula saldo atual (entradas - saídas + ajustes)
CREATE OR REPLACE FUNCTION public.calcular_saldo_estoque(
  _produto_id UUID,
  _variacao_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN tipo = 'entrada'    THEN  quantidade
      WHEN tipo = 'devolucao'  THEN  quantidade
      WHEN tipo = 'saida'      THEN -quantidade
      WHEN tipo = 'ajuste'     THEN  quantidade  -- ajuste pode ser positivo ou negativo
      WHEN tipo = 'transferencia' THEN -quantidade
      ELSE 0
    END
  ), 0)
  FROM public.estoque_movimentacoes
  WHERE owner_id = auth.uid()
    AND produto_id = _produto_id
    AND (
      (_variacao_id IS NULL AND variacao_id IS NULL)
      OR variacao_id = _variacao_id
    );
$$;

-- Trigger: registrar entrada inicial automaticamente ao criar produto
CREATE OR REPLACE FUNCTION public.registrar_estoque_inicial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estoque_inicial IS NOT NULL AND NEW.estoque_inicial > 0 THEN
    INSERT INTO public.estoque_movimentacoes (
      owner_id, produto_id, tipo, origem, quantidade,
      custo_unitario, saldo_anterior, saldo_posterior, observacoes
    ) VALUES (
      NEW.owner_id, NEW.id, 'entrada', 'inventario', NEW.estoque_inicial,
      NEW.preco_custo, 0, NEW.estoque_inicial, 'Estoque inicial do cadastro'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produtos_estoque_inicial ON public.produtos;
CREATE TRIGGER trg_produtos_estoque_inicial
  AFTER INSERT ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_estoque_inicial();
