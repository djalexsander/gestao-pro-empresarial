
-- 1. Adiciona campo data_vencimento na tabela de compras
ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS data_vencimento date;

-- 2. Função: sincroniza/idempotente o lançamento de Contas a Pagar a partir da compra.
--    - Cria UM lançamento por compra (comp