-- Restringe membros ao histórico da empresa exata à qual pertencem.
-- O dono continua acessando os logs das próprias empresas.
DROP POLICY IF EXISTS "Membros admin acessam logs cobranca wa"
  ON public.cobranca_whatsapp_logs;

CREATE POLICY "Membros admin acessam logs cobranca wa"
  ON public.cobranca_whatsapp_logs
  FOR ALL
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.empresa_membros m
      JOIN public.empresas e
        ON e.id = m.empresa_id
       AND e.owner_id = cobranca_whatsapp_logs.owner_id
      WHERE m.user_id = auth.uid()
        AND m.empresa_id = cobranca_whatsapp_logs.empresa_id
        AND m.papel IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.empresa_membros m
      JOIN public.empresas e
        ON e.id = m.empresa_id
       AND e.owner_id = cobranca_whatsapp_logs.owner_id
      WHERE m.user_id = auth.uid()
        AND m.empresa_id = cobranca_whatsapp_logs.empresa_id
        AND m.papel IN ('owner', 'admin')
    )
  );

CREATE INDEX IF NOT EXISTS idx_cobranca_wa_empresa_lanc_created
  ON public.cobranca_whatsapp_logs (empresa_id, lancamento_id, created_at DESC);
