-- 1) Adicionar novos valores ao enum forma_pagamento
ALTER TYPE public.forma_pagamento ADD VALUE IF NOT EXISTS 'ifood';
ALTER TYPE public.forma_pagamento ADD VALUE IF NOT EXISTS 'fiado';

-- 2) Adicionar colunas de totais por forma na tabela caixas
ALTER TABLE public.caixas
  ADD COLUMN IF NOT EXISTS total_ifood numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fiado numeric NOT NULL DEFAULT 0;