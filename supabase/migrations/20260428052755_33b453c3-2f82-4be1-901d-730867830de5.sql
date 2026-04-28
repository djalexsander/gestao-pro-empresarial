
ALTER TABLE public.config_comercial
  ADD COLUMN IF NOT EXISTS asaas_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asaas_ambiente text NOT NULL DEFAULT 'sandbox'
    CHECK (asaas_ambiente IN ('sandbox','producao'));

CREATE OR REPLACE FUNCTION public.admin_set_config_comercial(
  _dias_trial integer,
  _permitir_modulos_no_trial boolean,
  _plano_padrao_id uuid,
  _valor_padrao_sistema numeric,
  _asaas_enabled boolean DEFAULT NULL,
  _asaas_ambiente text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO public.config_comercial (id, dias_trial, permitir_modulos_no_trial, plano_padrao_id, valor_padrao_sistema)
  VALUES (true, _dias_trial, _permitir_modulos_no_trial, _plano_padrao_id, _valor_padrao_sistema)
  ON CONFLICT (id) DO UPDATE SET
    dias_trial = EXCLUDED.dias_trial,
    permitir_modulos_no_trial = EXCLUDED.permitir_modulos_no_trial,
    plano_padrao_id = EXCLUDED.plano_padrao_id,
    valor_padrao_sistema = EXCLUDED.valor_padrao_sistema,
    updated_at = now();

  IF _asaas_enabled IS NOT NULL OR _asaas_ambiente IS NOT NULL THEN
    UPDATE public.config_comercial
       SET asaas_enabled = COALESCE(_asaas_enabled, asaas_enabled),
           asaas_ambiente = COALESCE(_asaas_ambiente, asaas_ambiente),
           updated_at = now()
     WHERE id = true;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.asaas_webhook_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento text NOT NULL,
  payment_id text,
  status text,
  payload jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.asaas_webhook_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin lê eventos asaas" ON public.asaas_webhook_eventos;
CREATE POLICY "Super admin lê eventos asaas"
  ON public.asaas_webhook_eventos FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
