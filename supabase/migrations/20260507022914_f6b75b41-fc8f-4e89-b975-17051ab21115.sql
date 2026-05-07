
CREATE TABLE IF NOT EXISTS public.pix_cobrancas_geradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  lancamento_id uuid,
  cliente_id uuid,
  provider text NOT NULL,
  provider_payment_id text,
  valor numeric NOT NULL,
  vencimento date,
  status text NOT NULL DEFAULT 'pending',
  qr_code_image text,
  copia_cola text,
  invoice_url text,
  payload_request jsonb DEFAULT '{}'::jsonb,
  payload_response jsonb DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pix_gerados_owner ON public.pix_cobrancas_geradas(owner_id);
CREATE INDEX IF NOT EXISTS idx_pix_gerados_lanc ON public.pix_cobrancas_geradas(lancamento_id);
CREATE INDEX IF NOT EXISTS idx_pix_gerados_provider_pid ON public.pix_cobrancas_geradas(provider, provider_payment_id);

ALTER TABLE public.pix_cobrancas_geradas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa pix gerados"
  ON public.pix_cobrancas_geradas FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros admin acessam pix gerados"
  ON public.pix_cobrancas_geradas FOR ALL TO authenticated
  USING (
    owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = pix_cobrancas_geradas.owner_id
        AND m.papel = ANY (ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
    )
  )
  WITH CHECK (
    owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = pix_cobrancas_geradas.owner_id
        AND m.papel = ANY (ARRAY['owner'::empresa_papel, 'admin'::empresa_papel])
    )
  );

CREATE TRIGGER trg_pix_gerados_updated_at
  BEFORE UPDATE ON public.pix_cobrancas_geradas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pix_webhook_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text,
  payment_id text,
  status text,
  payload jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pix_wh_provider_pid ON public.pix_webhook_eventos(provider, payment_id);

ALTER TABLE public.pix_webhook_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin lê eventos pix"
  ON public.pix_webhook_eventos FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
