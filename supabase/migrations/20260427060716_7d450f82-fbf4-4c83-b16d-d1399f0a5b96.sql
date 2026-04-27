CREATE TABLE IF NOT EXISTS public.balanca_config (
  owner_id uuid PRIMARY KEY,
  ativo boolean NOT NULL DEFAULT false,
  prefixos text[] NOT NULL DEFAULT ARRAY['20','21','22','23','24','25','26','27','28','29']::text[],
  comprimento_total integer NOT NULL DEFAULT 13,
  inicio_codigo_produto integer NOT NULL DEFAULT 2,
  digitos_codigo_produto integer NOT NULL DEFAULT 5,
  inicio_peso_valor integer NOT NULL DEFAULT 7,
  digitos_peso_valor integer NOT NULL DEFAULT 5,
  tipo_codigo text NOT NULL DEFAULT 'peso' CHECK (tipo_codigo IN ('peso','valor')),
  casas_decimais_peso integer NOT NULL DEFAULT 3,
  casas_decimais_valor integer NOT NULL DEFAULT 2,
  validar_dv boolean NOT NULL DEFAULT true,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.balanca_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa balanca_config"
ON public.balanca_config FOR ALL TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros acessam balanca_config"
ON public.balanca_config FOR ALL TO authenticated
USING (acessa_owner_id(owner_id, auth.uid()))
WITH CHECK (acessa_owner_id(owner_id, auth.uid()));

CREATE TRIGGER trg_balanca_config_updated_at
BEFORE UPDATE ON public.balanca_config
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS vendido_por_peso boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plu text,
  ADD COLUMN IF NOT EXISTS aceita_etiqueta_balanca boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS casas_decimais_quantidade integer NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_produtos_owner_plu
  ON public.produtos (owner_id, plu)
  WHERE plu IS NOT NULL;
