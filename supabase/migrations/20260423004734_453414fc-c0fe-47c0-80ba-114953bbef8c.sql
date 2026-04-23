-- Ativa todos os módulos disponíveis para a empresa do usuário atual
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, data_inicio, data_expiracao, observacoes)
SELECT
  '2cd088ba-34c0-4eda-be3b-922c6d18b4bf'::uuid,
  m.id,
  'ativo'::empresa_modulo_status,
  CURRENT_DATE,
  NULL,
  'Ativado manualmente via admin'
FROM public.modulos m
WHERE m.ativo = true
ON CONFLICT DO NOTHING;

-- Garante que módulos já existentes para essa empresa fiquem com status ativo e sem expiração
UPDATE public.empresa_modulos
SET status = 'ativo'::empresa_modulo_status,
    data_expiracao = NULL,
    updated_at = now()
WHERE empresa_id = '2cd088ba-34c0-4eda-be3b-922c6d18b4bf'::uuid;