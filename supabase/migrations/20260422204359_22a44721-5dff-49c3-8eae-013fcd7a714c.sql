-- 1) Adicionar roles 'gerente' e 'caixa' ao enum app_role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gerente';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'caixa';