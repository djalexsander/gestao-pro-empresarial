-- Adiciona colunas opcionais ao funcionarios? Não, vamos guardar telefone na empresa_membros como metadado
-- Adiciona telefone e nome em empresa_membros para casos onde criamos a conta diretamente
ALTER TABLE public.empresa_membros
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS email text;

-- Garante índice de unicidade por empresa+user
CREATE UNIQUE INDEX IF NOT EXISTS empresa_membros_empresa_user_uniq
  ON public.empresa_membros(empresa_id, user_id);
