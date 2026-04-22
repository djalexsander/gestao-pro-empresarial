
-- Corrige funções de PIN para usar extensions.gen_salt e extensions.crypt
-- (pgcrypto está no schema 'extensions' e SET search_path=public não as enxerga)

CREATE OR REPLACE FUNCTION public.funcionario_criar(
  _nome TEXT,
  _login TEXT,
  _pin TEXT,
  _role public.app_role DEFAULT 'caixa'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
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

  INSERT INTO public.funcionarios (owner_id, nome, login, pin_hash, role)
  VALUES (
    v_uid, trim(_nome), lower(trim(_login)),
    extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
    _role
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.funcionario_resetar_pin(
  _funcionario_id UUID,
  _novo_pin TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _novo_pin IS NULL OR length(_novo_pin) < 4 OR length(_novo_pin) > 8 OR _novo_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 8 dígitos numéricos';
  END IF;

  UPDATE public.funcionarios
  SET pin_hash = extensions.crypt(_novo_pin, extensions.gen_salt('bf', 8))
  WHERE id = _funcionario_id AND owner_id = v_uid;

  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.funcionario_validar_pin(
  _funcionario_id UUID,
  _pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_func RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT id, nome, login, role, ativo, pin_hash INTO v_func
  FROM public.funcionarios
  WHERE id = _funcionario_id AND owner_id = v_uid;

  IF v_func.id IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;
  IF NOT v_func.ativo THEN RAISE EXCEPTION 'Funcionário inativo'; END IF;
  IF v_func.pin_hash <> extensions.crypt(_pin, v_func.pin_hash) THEN
    RAISE EXCEPTION 'PIN incorreto';
  END IF;

  UPDATE public.funcionarios SET ultimo_acesso = now() WHERE id = _funcionario_id;

  RETURN jsonb_build_object(
    'id', v_func.id,
    'nome', v_func.nome,
    'login', v_func.login,
    'role', v_func.role
  );
END;
$$;
