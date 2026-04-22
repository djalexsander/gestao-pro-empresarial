-- Adiciona valores 'receber' e 'pagar' ao enum lancamento_tipo
-- (mantém 'receita' e 'despesa' por compatibilidade)
ALTER TYPE public.lancamento_tipo ADD VALUE IF NOT EXISTS 'receber';
ALTER TYPE public.lancamento_tipo ADD VALUE IF NOT EXISTS 'pagar';