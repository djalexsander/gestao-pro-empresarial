-- 1) Idempotência forte no webhook do Asaas
-- Remove duplicados existentes (mantém o mais antigo)
DELETE FROM public.asaas_webhook_eventos a
USING public.asaas_webhook_eventos b
WHERE a.event_id IS NOT NULL
  AND a.event_id = b.event_id
  AND a.recebido_em > b.recebido_em;

-- Índice único parcial (só quando event_id existir)
CREATE UNIQUE INDEX IF NOT EXISTS asaas_webhook_eventos_event_id_uniq
  ON public.asaas_webhook_eventos (event_id)
  WHERE event_id IS NOT NULL;

-- 2) Fechar bucket público de logos da empresa
UPDATE storage.buckets SET public = false WHERE id = 'empresa-logos';

-- Limpa policies antigas se existirem
DROP POLICY IF EXISTS "Public read empresa-logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view empresa-logos" ON storage.objects;
DROP POLICY IF EXISTS "Empresa lê sua logo" ON storage.objects;
DROP POLICY IF EXISTS "Empresa envia sua logo" ON storage.objects;
DROP POLICY IF EXISTS "Empresa atualiza sua logo" ON storage.objects;
DROP POLICY IF EXISTS "Empresa remove sua logo" ON storage.objects;

-- Cada usuário só acessa arquivos dentro de pasta com seu próprio user id
CREATE POLICY "Empresa lê sua logo"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'empresa-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Empresa envia sua logo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'empresa-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Empresa atualiza sua logo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'empresa-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Empresa remove sua logo"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'empresa-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );