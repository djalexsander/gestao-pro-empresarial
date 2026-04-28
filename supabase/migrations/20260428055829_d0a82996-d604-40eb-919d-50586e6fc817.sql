ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;

ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS asaas_invoice_url text,
  ADD COLUMN IF NOT EXISTS asaas_pix_qrcode text,
  ADD COLUMN IF NOT EXISTS asaas_pix_copia_cola text,
  ADD COLUMN IF NOT EXISTS asaas_billing_type text;