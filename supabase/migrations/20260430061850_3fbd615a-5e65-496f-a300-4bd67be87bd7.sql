-- ============================================================
-- Bloco 11 — Rate limit / lockout de PIN do operador
-- ============================================================

-- 1) Tabela de tentativas (log append-only para auditoria)
CREATE TABLE IF NOT EXISTS public.funcionario_tentativas_pin (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  funcionario_id UUID NOT NULL,
  sucesso BOOLEAN NOT NULL,
  terminal_id UUID NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  client_uuid UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tent_pin_func_created
  ON public.funcionario_tentativas_pin (funcionario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tent_pin_owner_created
  ON public.funcionario_tentativas_pin (owner_id, created_at DESC);

ALTER TABLE public.funcionario_tentativas_pin ENABLE ROW LEVEL SECURITY;

-- Apenas leitura via SELECT pelo dono / admin da empresa.
-- INSERT/UPDATE/DELETE NÃO têm policy => só funções SECURITY DEFINER inserem.
DROP POLICY IF EXISTS "Admin lê tentativas PIN" ON public.funcionario_tentativas_pin;
CREATE POLICY "Admin lê tentativas PIN"
ON public.funcionario_tentativas_pin
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = funcionario_tentativas_pin.owner_id
      AND m.papel IN ('owner', 'admin')
  )
);

-- 2) Tabela de estado de lockout (1 linha por funcionário)
CREATE TABLE IF NOT EXISTS public.funcionario_lockouts (
  funcionario_id UUID NOT NULL PRIMARY KEY,
  owner_id UUID NOT NULL,
  tentativas_na_janela INTEGER NOT NULL DEFAULT 0,
  janela_iniciada_em TIMESTAMPTZ NULL,
  ultima_tentativa_em TIMESTAMPTZ NULL,
  bloqueado_ate TIMESTAMPTZ NULL,
  total_bloqueios INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lockouts_owner ON public.funcionario_lockouts (owner_id);

ALTER TABLE public.funcionario_lockouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin lê lockouts" ON public.funcionario_lockouts;
CREATE POLICY "Admin lê lockouts"
ON public.funcionario_lockouts
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.empresa_membros m
    JOIN public.empresas e ON e.id = m.empresa_id
    WHERE m.user_id = auth.uid()
      AND e.owner_id = funcionario_lockouts.owner_id
      AND m.papel IN ('owner', 'admin')
  )
);

-- 3) Reescreve validação de PIN com lockout
-- Política:
--   * Janela: 10 minutos
--   * Limite: 5 falhas dentro da janela
--   * Bloqueio: 15 minutos após estourar
--   * Sucesso reseta contador e libera bloqueio
DROP FUNCTION IF EXISTS public.funcionario_validar_pin(uuid, text);
DROP FUNCTION IF EXISTS public.funcionario_validar_pin(uuid, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.funcionario_validar_pin(
  _funcionario_id UUID,
  _pin TEXT,
  _terminal_id UUID DEFAULT NULL,
  _ip_address TEXT DEFAULT NULL,
  _user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_func          public.funcionarios%ROWTYPE;
  v_lock          public.funcionario_lockouts%ROWTYPE;
  v_now           TIMESTAMPTZ := now();
  v_janela        INTERVAL := INTERVAL '10 minutes';
  v_limite        INTEGER  := 5;
  v_bloqueio      INTERVAL := INTERVAL '15 minutes';
  v_pin_ok        BOOLEAN  := FALSE;
  v_segundos      INTEGER;
  v_restantes     INTEGER;
BEGIN
  -- Lock pessimista no funcionário (serializa concorrência entre terminais)
  SELECT * INTO v_func
  FROM public.funcionarios
  WHERE id = _funcionario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_func.ativo THEN
    RAISE EXCEPTION 'Operador inativo' USING ERRCODE = 'P0001';
  END IF;

  -- Carrega/cria estado de lockout
  SELECT * INTO v_lock
  FROM public.funcionario_lockouts
  WHERE funcionario_id = _funcionario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.funcionario_lockouts (funcionario_id, owner_id)
    VALUES (_funcionario_id, v_func.owner_id)
    RETURNING * INTO v_lock;
  END IF;

  -- Bloqueio ativo? Recusa imediatamente sem comparar PIN.
  IF v_lock.bloqueado_ate IS NOT NULL AND v_lock.bloqueado_ate > v_now THEN
    v_segundos := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_lock.bloqueado_ate - v_now)))::INT);

    -- Mesmo bloqueado, registra a tentativa para auditoria
    INSERT INTO public.funcionario_tentativas_pin
      (owner_id, funcionario_id, sucesso, terminal_id, ip_address, user_agent)
    VALUES
      (v_func.owner_id, _funcionario_id, FALSE, _terminal_id, _ip_address, _user_agent);

    RAISE EXCEPTION 'Operador temporariamente bloqueado. Tente novamente em % segundo(s).', v_segundos
      USING ERRCODE = 'P0003';
  END IF;

  -- Janela expirada? Reseta contador.
  IF v_lock.janela_iniciada_em IS NULL
     OR (v_now - v_lock.janela_iniciada_em) > v_janela THEN
    v_lock.tentativas_na_janela := 0;
    v_lock.janela_iniciada_em := v_now;
  END IF;

  -- Compara PIN (bcrypt)
  v_pin_ok := (v_func.pin_hash = extensions.crypt(_pin, v_func.pin_hash));

  -- Registra tentativa (log)
  INSERT INTO public.funcionario_tentativas_pin
    (owner_id, funcionario_id, sucesso, terminal_id, ip_address, user_agent)
  VALUES
    (v_func.owner_id, _funcionario_id, v_pin_ok, _terminal_id, _ip_address, _user_agent);

  IF v_pin_ok THEN
    -- Sucesso: zera tudo, libera lockout, marca último acesso.
    UPDATE public.funcionario_lockouts
    SET tentativas_na_janela = 0,
        janela_iniciada_em   = NULL,
        bloqueado_ate        = NULL,
        ultima_tentativa_em  = v_now,
        updated_at           = v_now
    WHERE funcionario_id = _funcionario_id;

    UPDATE public.funcionarios
    SET ultimo_acesso = v_now
    WHERE id = _funcionario_id;

    RETURN jsonb_build_object(
      'id',    v_func.id,
      'nome',  v_func.nome,
      'login', v_func.login,
      'role',  v_func.role
    );
  END IF;

  -- Falha: incrementa
  v_lock.tentativas_na_janela := v_lock.tentativas_na_janela + 1;
  v_lock.ultima_tentativa_em  := v_now;

  IF v_lock.tentativas_na_janela >= v_limite THEN
    -- Estourou: aplica bloqueio
    v_lock.bloqueado_ate := v_now + v_bloqueio;
    v_lock.total_bloqueios := v_lock.total_bloqueios + 1;

    UPDATE public.funcionario_lockouts
    SET tentativas_na_janela = v_lock.tentativas_na_janela,
        janela_iniciada_em   = v_lock.janela_iniciada_em,
        ultima_tentativa_em  = v_lock.ultima_tentativa_em,
        bloqueado_ate        = v_lock.bloqueado_ate,
        total_bloqueios      = v_lock.total_bloqueios,
        updated_at           = v_now
    WHERE funcionario_id = _funcionario_id;

    v_segundos := EXTRACT(EPOCH FROM v_bloqueio)::INT;
    RAISE EXCEPTION 'Muitas tentativas inválidas. Operador bloqueado por % segundo(s).', v_segundos
      USING ERRCODE = 'P0003';
  ELSE
    UPDATE public.funcionario_lockouts
    SET tentativas_na_janela = v_lock.tentativas_na_janela,
        janela_iniciada_em   = v_lock.janela_iniciada_em,
        ultima_tentativa_em  = v_lock.ultima_tentativa_em,
        updated_at           = v_now
    WHERE funcionario_id = _funcionario_id;

    v_restantes := v_limite - v_lock.tentativas_na_janela;
    RAISE EXCEPTION 'PIN incorreto. % tentativa(s) restante(s).', v_restantes
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.funcionario_validar_pin(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.funcionario_validar_pin(uuid, text, uuid, text, text) TO authenticated;

-- 4) Desbloqueio manual por gerente/admin
CREATE OR REPLACE FUNCTION public.funcionario_desbloquear_pin(
  _funcionario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_pode  BOOLEAN;
BEGIN
  SELECT owner_id INTO v_owner
  FROM public.funcionarios
  WHERE id = _funcionario_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Operador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Permite ao próprio dono ou admin da empresa
  v_pode := (
    v_owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.empresa_membros m
      JOIN public.empresas e ON e.id = m.empresa_id
      WHERE m.user_id = auth.uid()
        AND e.owner_id = v_owner
        AND m.papel IN ('owner', 'admin')
    )
  );

  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para desbloquear operador' USING ERRCODE = '42501';
  END IF;

  UPDATE public.funcionario_lockouts
  SET tentativas_na_janela = 0,
      janela_iniciada_em   = NULL,
      bloqueado_ate        = NULL,
      updated_at           = now()
  WHERE funcionario_id = _funcionario_id;

  RETURN jsonb_build_object(
    'funcionario_id', _funcionario_id,
    'desbloqueado',   TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.funcionario_desbloquear_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.funcionario_desbloquear_pin(uuid) TO authenticated;