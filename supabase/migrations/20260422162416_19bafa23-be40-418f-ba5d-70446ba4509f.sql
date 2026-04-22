-- 1. Adicionar super_admin ao enum app_role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
