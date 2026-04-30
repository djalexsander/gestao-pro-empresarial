-- ============================================================
-- Bloco 10 — Funcionários (operadores PDV) com idempotência,
-- editar, alterar status e excluir seguros, todos via RPC.
-- PIN segue hasheado no banco com bcrypt (pgcrypto).
-- ============================================================

-- 1) Idempotência
ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_owner_client_uuid_uidx
  ON public.funcionarios(owner_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- Login único por owner (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_owner_login_uidx
  ON public.funcionarios(owner_id, lower(login));

-- ============================================================
-- 2) funcionario_criar — agora aceita client_uuid (idempotência)
--    e checa login duplicado de forma amigável.
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_criar(
  _nome text,
  _login text,
  _pin text,
  _role app_role DEFAULT 'caixa'::app_role,
  _client_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
  v_login TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _nome IS NULL OR length(trim(_nome)) = 0 THEN RAISE EXCEPTION 'Nome obrigatório'; END IF;
  IF _login IS NULL OR length(trim(_login)) < 2 THEN RAISE EXCEPTION 'Login deve ter ao menos 2 caracteres'; END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 8 dígitos numéricos';
  END IF;
  IF _role NOT IN ('gerente','caixa') THEN
    RAISE EXCEPTION 'Papel inválido (use gerente ou caixa)';
  END IF;

  v_login := lower(trim(_login));

  -- Idempotência: mesmo client_uuid retorna o registro existente.
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.funcionarios
    WHERE owner_id = v_uid AND client_uuid = _client_uuid;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('funcionario_id', v_id, 'idempotente', true);
    END IF;
  END IF;

  -- Login único por owner.
  IF EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE owner_id = v_uid AND lower(login) = v_login
  ) THEN
    RAISE EXCEPTION 'Já existe um funcionário com o login "%"', v_login
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.funcionarios (owner_id, nome, login, pin_hash, role, client_uuid)
  VALUES (
    v_uid, trim(_nome), v_login,
    extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
    _role, _client_uuid
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('funcionario_id', v_id, 'idempotente', false);
END;
$function$;

-- ============================================================
-- 3) funcionario_editar — altera nome / login / role.
--    NÃO altera PIN (use funcionario_resetar_pin).
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_editar(
  _funcionario_id uuid,
  _nome text,
  _login text,
  _role app_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_login TEXT;
  v_existente RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _nome IS NULL OR length(trim(_nome)) = 0 THEN RAISE EXCEPTION 'Nome obrigatório'; END IF;
  IF _login IS NULL OR length(trim(_login)) < 2 THEN RAISE EXCEPTION 'Login deve ter ao menos 2 caracteres'; END IF;
  IF _role NOT IN ('gerente','caixa') THEN
    RAISE EXCEPTION 'Papel inválido (use gerente ou caixa)';
  END IF;

  v_login := lower(trim(_login));

  -- Lock do registro (serializa edições concorrentes entre terminais).
  SELECT id, role, ativo INTO v_existente
  FROM public.funcionarios
  WHERE id = _funcionario_id AND owner_id = v_uid
  FOR UPDATE;

  IF v_existente.id IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;

  -- Login único (excluindo o próprio).
  IF EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE owner_id = v_uid
      AND lower(login) = v_login
      AND id <> _funcionario_id
  ) THEN
    RAISE EXCEPTION 'Já existe outro funcionário com o login "%"', v_login
      USING ERRCODE = '23505';
  END IF;

  -- Não pode rebaixar o último gerente ativo se isso deixar a empresa sem gerente.
  IF v_existente.role = 'gerente' AND _role <> 'gerente' AND v_existente.ativo THEN
    IF (SELECT count(*) FROM public.funcionarios
        WHERE owner_id = v_uid AND role = 'gerente' AND ativo
          AND id <> _funcionario_id) = 0 THEN
      RAISE EXCEPTION 'Não é possível remover o papel de gerente: este é o último gerente ativo';
    END IF;
  END IF;

  UPDATE public.funcionarios
  SET nome = trim(_nome),
      login = v_login,
      role = _role,
      updated_at = now()
  WHERE id = _funcionario_id;

  RETURN jsonb_build_object('funcionario_id', _funcionario_id);
END;
$function$;

-- ============================================================
-- 4) funcionario_alterar_status — ativar / inativar.
--    Bloqueia inativação do último gerente ativo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_alterar_status(
  _funcionario_id uuid,
  _ativo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_existente RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT id, role, ativo INTO v_existente
  FROM public.funcionarios
  WHERE id = _funcionario_id AND owner_id = v_uid
  FOR UPDATE;

  IF v_existente.id IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;

  -- Idempotente: já está no status desejado.
  IF v_existente.ativo = _ativo THEN
    RETURN jsonb_build_object('funcionario_id', _funcionario_id, 'ativo', _ativo, 'idempotente', true);
  END IF;

  -- Inativar último gerente ativo é bloqueado.
  IF v_existente.role = 'gerente' AND _ativo = false THEN
    IF (SELECT count(*) FROM public.funcionarios
        WHERE owner_id = v_uid AND role = 'gerente' AND ativo
          AND id <> _funcionario_id) = 0 THEN
      RAISE EXCEPTION 'Não é possível inativar o último gerente ativo';
    END IF;
  END IF;

  UPDATE public.funcionarios
  SET ativo = _ativo, updated_at = now()
  WHERE id = _funcionario_id;

  RETURN jsonb_build_object('funcionario_id', _funcionario_id, 'ativo', _ativo, 'idempotente', false);
END;
$function$;

-- ============================================================
-- 5) funcionario_excluir — hard delete só sem vínculos.
--    Caixas, movimentos de caixa, vendas (operador_id) bloqueiam.
-- ============================================================
CREATE OR REPLACE FUNCTION public.funcionario_excluir(
  _funcionario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_existente RECORD;
  v_caixas INT := 0;
  v_movs INT := 0;
  v_vendas INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT id, role, ativo INTO v_existente
  FROM public.funcionarios
  WHERE id = _funcionario_id AND owner_id = v_uid
  FOR UPDATE;

  IF v_existente.id IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;

  SELECT count(*) INTO v_caixas
  FROM public.caixas WHERE operador_id = _funcionario_id;

  SELECT count(*) INTO v_movs
  FROM public.caixa_movimentos WHERE operador_id = _funcionario_id;

  -- vendas.operador_id pode existir ou não dependendo do schema; ignora se a coluna não existe.
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.vendas WHERE operador_id = $1'
      INTO v_vendas USING _funcionario_id;
  EXCEPTION WHEN undefined_column THEN
    v_vendas := 0;
  END;

  IF v_caixas > 0 OR v_movs > 0 OR v_vendas > 0 THEN
    RAISE EXCEPTION 'Funcionário possui histórico vinculado (% caixa(s), % movimento(s), % venda(s)). Inative em vez de excluir.',
      v_caixas, v_movs, v_vendas
      USING ERRCODE = '23503';
  END IF;

  -- Bloqueia excluir o último gerente ativo (mesma regra de inativar).
  IF v_existente.role = 'gerente' AND v_existente.ativo THEN
    IF (SELECT count(*) FROM public.funcionarios
        WHERE owner_id = v_uid AND role = 'gerente' AND ativo
          AND id <> _funcionario_id) = 0 THEN
      RAISE EXCEPTION 'Não é possível excluir o último gerente ativo';
    END IF;
  END IF;

  DELETE FROM public.funcionarios WHERE id = _funcionario_id;

  RETURN jsonb_build_object('funcionario_id', _funcionario_id, 'excluido', true);
END;
$function$;

-- Garantia de execução pela role authenticated.
GRANT EXECUTE ON FUNCTION public.funcionario_criar(text, text, text, app_role, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.funcionario_editar(uuid, text, text, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.funcionario_alterar_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.funcionario_excluir(uuid) TO authenticated;