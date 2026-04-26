
-- ============================================================
-- TERMINAIS EM REDE: papel servidor/terminal + heartbeat + realtime
-- ============================================================

-- 1) Novos campos no terminais
ALTER TABLE public.terminais
  ADD COLUMN IF NOT EXISTS papel text NOT NULL DEFAULT 'terminal'
    CHECK (papel IN ('servidor', 'terminal')),
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS operador_atual_id uuid,
  ADD COLUMN IF NOT EXISTS operador_atual_nome text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS ip_local text;

-- 2) Garantir somente UM servidor por owner
CREATE UNIQUE INDEX IF NOT EXISTS terminais_um_servidor_por_owner
  ON public.terminais (owner_id)
  WHERE papel = 'servidor';

-- 3) RPC para registrar heartbeat do terminal (chamado pelo dispositivo a cada 30s)
CREATE OR REPLACE FUNCTION public.terminal_heartbeat(
  _terminal_id uuid,
  _operador_id uuid DEFAULT NULL,
  _operador_nome text DEFAULT NULL,
  _user_agent text DEFAULT NULL,
  _ip_local text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.terminais WHERE id = _terminal_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Terminal não encontrado';
  END IF;

  -- Só dono ou membro pode atualizar heartbeat do terminal
  IF NOT (v_owner = auth.uid() OR public.acessa_owner_id(v_owner, auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão para este terminal';
  END IF;

  UPDATE public.terminais
     SET heartbeat_at       = now(),
         ultimo_uso         = now(),
         operador_atual_id  = COALESCE(_operador_id, operador_atual_id),
         operador_atual_nome= COALESCE(_operador_nome, operador_atual_nome),
         user_agent         = COALESCE(_user_agent, user_agent),
         ip_local           = COALESCE(_ip_local, ip_local)
   WHERE id = _terminal_id;
END;
$$;

-- 4) RPC para limpar operador (logout do operador no terminal)
CREATE OR REPLACE FUNCTION public.terminal_limpar_operador(_terminal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.terminais WHERE id = _terminal_id;
  IF v_owner IS NULL THEN RETURN; END IF;
  IF NOT (v_owner = auth.uid() OR public.acessa_owner_id(v_owner, auth.uid())) THEN
    RAISE EXCEPTION 'Sem permissão para este terminal';
  END IF;
  UPDATE public.terminais
     SET operador_atual_id = NULL,
         operador_atual_nome = NULL
   WHERE id = _terminal_id;
END;
$$;

-- 5) RPC para promover terminal a "servidor principal"
CREATE OR REPLACE FUNCTION public.terminal_definir_servidor(_terminal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.terminais WHERE id = _terminal_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Terminal não encontrado';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Apenas o dono pode definir o servidor principal';
  END IF;

  -- Rebaixa o servidor anterior
  UPDATE public.terminais
     SET papel = 'terminal'
   WHERE owner_id = v_owner AND papel = 'servidor';

  -- Promove o novo
  UPDATE public.terminais
     SET papel = 'servidor'
   WHERE id = _terminal_id;
END;
$$;

-- 6) Atualiza terminais_listar para retornar campos novos
DROP FUNCTION IF EXISTS public.terminais_listar();
CREATE OR REPLACE FUNCTION public.terminais_listar()
RETURNS TABLE (
  id uuid,
  nome text,
  descricao text,
  ativo boolean,
  identificador_dispositivo text,
  pareamento_token text,
  ultimo_uso timestamptz,
  caixa_aberto_id uuid,
  created_at timestamptz,
  papel text,
  heartbeat_at timestamptz,
  operador_atual_id uuid,
  operador_atual_nome text,
  user_agent text,
  ip_local text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.nome, t.descricao, t.ativo, t.identificador_dispositivo,
    t.pareamento_token, t.ultimo_uso,
    (SELECT c.id FROM public.caixas c
       WHERE c.terminal_id = t.id AND c.status = 'aberto'
       ORDER BY c.data_abertura DESC LIMIT 1) AS caixa_aberto_id,
    t.created_at,
    t.papel,
    t.heartbeat_at,
    t.operador_atual_id,
    t.operador_atual_nome,
    t.user_agent,
    t.ip_local
  FROM public.terminais t
  WHERE t.owner_id = auth.uid()
     OR public.acessa_owner_id(t.owner_id, auth.uid())
  ORDER BY
    CASE WHEN t.papel = 'servidor' THEN 0 ELSE 1 END,
    t.nome;
$$;

-- 7) Habilitar REALTIME nas tabelas críticas para sincronização entre terminais
ALTER TABLE public.terminais            REPLICA IDENTITY FULL;
ALTER TABLE public.caixas               REPLICA IDENTITY FULL;
ALTER TABLE public.caixa_movimentos     REPLICA IDENTITY FULL;
ALTER TABLE public.vendas               REPLICA IDENTITY FULL;
ALTER TABLE public.venda_itens          REPLICA IDENTITY FULL;
ALTER TABLE public.produtos             REPLICA IDENTITY FULL;
ALTER TABLE public.estoque_movimentacoes REPLICA IDENTITY FULL;
ALTER TABLE public.financeiro_lancamentos REPLICA IDENTITY FULL;

DO $$
BEGIN
  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='terminais';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.terminais; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='caixas';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.caixas; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='caixa_movimentos';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.caixa_movimentos; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='vendas';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.vendas; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='venda_itens';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.venda_itens; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='produtos';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.produtos; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='estoque_movimentacoes';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.estoque_movimentacoes; END IF;

  PERFORM 1 FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='financeiro_lancamentos';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.financeiro_lancamentos; END IF;
END $$;
