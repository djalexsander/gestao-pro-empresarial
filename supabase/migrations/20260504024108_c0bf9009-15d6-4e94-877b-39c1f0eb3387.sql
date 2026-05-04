-- ============================================================
-- Integrações comerciais
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE integracao_tipo AS ENUM ('ifood','mercado_livre','shopee','whatsapp','pix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE integracao_status AS ENUM ('disconnected','configuring','connected','error','disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pedido_externo_origem AS ENUM ('ifood','mercado_livre','shopee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cobranca_wa_status AS ENUM ('pending','sent','failed','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cobranca_wa_tipo AS ENUM ('antes_vencimento','vencimento','apos_vencimento','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela: empresa_integracoes
CREATE TABLE IF NOT EXISTS public.empresa_integracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  tipo_integracao integracao_tipo NOT NULL,
  status integracao_status NOT NULL DEFAULT 'disconnected',
  nome_exibicao text,
  configuracoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ultimo_sync_at timestamptz,
  erro_ultimo_sync text,
  ativo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, tipo_integracao)
);

ALTER TABLE public.empresa_integracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa integracoes"
  ON public.empresa_integracoes FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros admin acessam integracoes"
  ON public.empresa_integracoes FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM empresa_membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = empresa_integracoes.owner_id
        AND m.papel IN ('owner','admin')
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM empresa_membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = empresa_integracoes.owner_id
        AND m.papel IN ('owner','admin')
    )
  );

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS empresa_integracoes_updated ON public.empresa_integracoes;
CREATE TRIGGER empresa_integracoes_updated
  BEFORE UPDATE ON public.empresa_integracoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Tabela: pedidos_externos
CREATE TABLE IF NOT EXISTS public.pedidos_externos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  origem pedido_externo_origem NOT NULL,
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'novo',
  cliente_nome text,
  cliente_documento text,
  cliente_telefone text,
  valor_total numeric NOT NULL DEFAULT 0,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  endereco_entrega jsonb,
  raw_payload jsonb,
  sincronizado_em timestamptz,
  venda_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, origem, external_id)
);

ALTER TABLE public.pedidos_externos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa pedidos externos"
  ON public.pedidos_externos FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros acessam pedidos externos"
  ON public.pedidos_externos FOR ALL TO authenticated
  USING (acessa_owner_id(owner_id, auth.uid()))
  WITH CHECK (acessa_owner_id(owner_id, auth.uid()));

DROP TRIGGER IF EXISTS pedidos_externos_updated ON public.pedidos_externos;
CREATE TRIGGER pedidos_externos_updated
  BEFORE UPDATE ON public.pedidos_externos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Tabela: cobranca_whatsapp_logs
CREATE TABLE IF NOT EXISTS public.cobranca_whatsapp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  cliente_id uuid,
  lancamento_id uuid,
  telefone text,
  mensagem text NOT NULL,
  status cobranca_wa_status NOT NULL DEFAULT 'pending',
  tipo cobranca_wa_tipo NOT NULL DEFAULT 'manual',
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

ALTER TABLE public.cobranca_whatsapp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dono acessa logs cobranca wa"
  ON public.cobranca_whatsapp_logs FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Membros admin acessam logs cobranca wa"
  ON public.cobranca_whatsapp_logs FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM empresa_membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = cobranca_whatsapp_logs.owner_id
        AND m.papel IN ('owner','admin')
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM empresa_membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = cobranca_whatsapp_logs.owner_id
        AND m.papel IN ('owner','admin')
    )
  );

CREATE INDEX IF NOT EXISTS idx_cobranca_wa_lanc ON public.cobranca_whatsapp_logs(lancamento_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_externos_emp ON public.pedidos_externos(empresa_id, status);
