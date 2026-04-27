-- Função utilitária para updated_at (idempotente)
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.notificacao_estados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  notificacao_key text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, notificacao_key)
);

CREATE INDEX idx_notificacao_estados_user
  ON public.notificacao_estados (user_id, deleted, read);

ALTER TABLE public.notificacao_estados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê seus estados de notificação"
  ON public.notificacao_estados FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Usuário cria seus estados de notificação"
  ON public.notificacao_estados FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Usuário atualiza seus estados de notificação"
  ON public.notificacao_estados FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Usuário remove seus estados de notificação"
  ON public.notificacao_estados FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_notificacao_estados_updated_at
  BEFORE UPDATE ON public.notificacao_estados
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();