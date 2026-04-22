-- ========================================================
-- 1) Tabela de TERMINAIS (pontos de venda físicos)
-- ========================================================
CREATE TABLE IF NOT EXISTS public.terminais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  identificador_dispositivo text,
  pareamento_token text,
  ultimo_uso timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identificador único por owner (quando preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS terminais_owner_identificador_uniq
  ON public.terminais (owner_id, identificador_dispositivo)
  WHERE identificador_dispositivo IS NOT NULL;

-- Token de pareamento globalmente único (quando preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS terminais_pareamento_token_uniq
  ON public.terminais (pareamento_token)
  WHERE pareamento_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS terminais_owner_idx ON public.terminais(owner_id);

ALTER TABLE public.terminais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dono gerencia terminais" ON public.terminais;
CREATE POLICY "Dono gerencia terminais"
  ON public.terminais
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_terminais_updated_at ON public.terminais;
CREATE TRIGGER trg_terminais_updated_at
  BEFORE UPDATE ON public.terminais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========================================================
-- 2) Vincular sessão de caixa, movimentos e vendas a um terminal
-- ========================================================
ALTER TABLE public.caixas
  ADD COLUMN IF NOT EXISTS terminal_id uuid;

ALTER TABLE public.caixa_movimentos
  ADD COLUMN IF NOT EXISTS terminal_id uuid;

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS terminal_id uuid;

CREATE INDEX IF NOT EXISTS caixas_terminal_idx ON public.caixas(terminal_id) WHERE terminal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendas_terminal_idx ON public.vendas(terminal_id) WHERE terminal_id IS NOT NULL;

-- 1 única sessão aberta por terminal ao mesmo tempo
CREATE UNIQUE INDEX IF NOT EXISTS caixas_terminal_aberto_uniq
  ON public.caixas (terminal_id)
  WHERE status = 'aberto' AND terminal_id IS NOT NULL;

-- ========================================================
-- 3) abrir_caixa — aceitar terminal e validar unicidade
-- ========================================================
CREATE OR REPLACE FUNCTION public.abrir_caixa(
  _valor_inicial numeric,
  _observacao text DEFAULT NULL,
  _operador_id uuid DEFAULT NULL,
  _terminal_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_caixa_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _valor_inicial IS NULL OR _valor_inicial < 0 THEN
    RAISE EXCEPTION 'Valor inicial inválido';
  END IF;

  IF _operador_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.funcionarios
      WHERE id = _operador_id AND owner_id = v_uid AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Operador inválido';
    END IF;
  END IF;

  IF _terminal_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.terminais
      WHERE id = _terminal_id AND owner_id = v_uid AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Terminal inválido ou inativo';
    END IF;

    -- Apenas 1 sessão aberta por terminal
    IF EXISTS (
      SELECT 1 FROM public.caixas
      WHERE owner_id = v_uid AND status = 'aberto' AND terminal_id = _terminal_id
    ) THEN
      RAISE EXCEPTION 'Já existe um caixa aberto neste terminal. Feche o atual antes de abrir outro.';
    END IF;
  END IF;

  -- Mesmo operador não pode abrir 2 caixas
  IF EXISTS (
    SELECT 1 FROM public.caixas
    WHERE owner_id = v_uid
      AND status = 'aberto'
      AND COALESCE(operador_id::text,'') = COALESCE(_operador_id::text,'')
  ) THEN
    RAISE EXCEPTION 'Já existe um caixa aberto para este operador. Feche o atual antes de abrir outro.';
  END IF;

  INSERT INTO public.caixas (
    owner_id, usuario_id, operador_id, terminal_id,
    valor_inicial, observacao, status
  ) VALUES (
    v_uid, v_uid, _operador_id, _terminal_id,
    _valor_inicial, NULLIF(trim(_observacao), ''), 'aberto'
  )
  RETURNING id INTO v_caixa_id;

  INSERT INTO public.caixa_movimentos (
    owner_id, caixa_id, tipo, valor, motivo, usuario_id, operador_id, terminal_id
  )
  VALUES (
    v_uid, v_caixa_id, 'abertura', _valor_inicial,
    'Abertura de caixa', v_uid, _operador_id, _terminal_id
  );

  IF _terminal_id IS NOT NULL THEN
    UPDATE public.terminais
       SET ultimo_uso = now()
     WHERE id = _terminal_id AND owner_id = v_uid;
  END IF;

  RETURN v_caixa_id;
END;
$function$;

-- ========================================================
-- 4) Listar terminais do dono
-- ========================================================
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
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    t.id, t.nome, t.descricao, t.ativo,
    t.identificador_dispositivo, t.pareamento_token, t.ultimo_uso,
    (SELECT c.id FROM public.caixas c
       WHERE c.owner_id = t.owner_id
         AND c.terminal_id = t.id
         AND c.status = 'aberto'
       ORDER BY c.data_abertura DESC LIMIT 1) AS caixa_aberto_id,
    t.created_at
  FROM public.terminais t
  WHERE t.owner_id = auth.uid()
  ORDER BY t.ativo DESC, t.nome ASC;
$function$;

-- ========================================================
-- 5) Gerar/regenerar token de pareamento (para Tauri)
-- ========================================================
CREATE OR REPLACE FUNCTION public.terminal_gerar_token(_terminal_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  v_token := encode(gen_random_bytes(18), 'hex');

  UPDATE public.terminais
     SET pareamento_token = v_token,
         updated_at = now()
   WHERE id = _terminal_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terminal não encontrado';
  END IF;
  RETURN v_token;
END;
$function$;

-- ========================================================
-- 6) Resolver terminal por identificador (para auto-pareamento Tauri)
-- ========================================================
CREATE OR REPLACE FUNCTION public.terminal_resolver(
  _identificador text DEFAULT NULL,
  _token text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  nome text,
  ativo boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT t.id, t.nome, t.ativo
  FROM public.terminais t
  WHERE t.owner_id = auth.uid()
    AND (
      (_token IS NOT NULL AND t.pareamento_token = _token)
      OR (_identificador IS NOT NULL AND t.identificador_dispositivo = _identificador)
    )
  LIMIT 1;
$function$;