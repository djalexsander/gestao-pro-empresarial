-- Substitui as duas vers\u00f5es atuais de funcionario_criar por uma \u00fanica
-- que aceita _funcionario_id opcional (UUID gerado no desktop offline).
DROP FUNCTION IF EXISTS public.funcionario_criar(text, text, text, app_role);
DROP FUNCTION IF EXISTS public.funcionario_criar(text, text, text, app_role, uuid);

CREATE OR REPLACE FUNCTION public.funcionario_criar(
  _nome text,
  _login text,
  _pin text,
  _role app_role DEFAULT 'caixa'::app_role,
  _client_uuid uuid DEFAULT NULL,
  _funcionario_id uuid DEFAULT NULL
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
  v_existing_owner UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'N\u00e3o autenticado'; END IF;
  IF _nome IS NULL OR length(trim(_nome)) = 0 THEN RAISE EXCEPTION 'Nome obrigat\u00f3rio'; END IF;
  IF _login IS NULL OR length(trim(_login)) < 2 THEN RAISE EXCEPTION 'Login deve ter ao menos 2 caracteres'; END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 8 d\u00edgitos num\u00e9ricos';
  END IF;
  IF _role NOT IN ('gerente','caixa') THEN
    RAISE EXCEPTION 'Papel inv\u00e1lido (use gerente ou caixa)';
  END IF;

  v_login := lower(trim(_login));

  -- Idempot\u00eancia 1: mesmo client_uuid devolve o registro existente.
  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.funcionarios
    WHERE owner_id = v_uid AND client_uuid = _client_uuid;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('funcionario_id', v_id, 'idempotente', true);
    END IF;
  END IF;

  -- Idempot\u00eancia 2: se o desktop passou um _funcionario_id e ele j\u00e1 existe
  -- nesta empresa, devolve o registro existente (re-tentativa de outbox).
  IF _funcionario_id IS NOT NULL THEN
    SELECT owner_id INTO v_existing_owner
    FROM public.funcionarios
    WHERE id = _funcionario_id;

    IF v_existing_owner IS NOT NULL THEN
      IF v_existing_owner <> v_uid THEN
        RAISE EXCEPTION 'Conflito de identificador de funcion\u00e1rio'
          USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object('funcionario_id', _funcionario_id, 'idempotente', true);
    END IF;
  END IF;

  -- Login \u00fanico por owner.
  IF EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE owner_id = v_uid AND lower(login) = v_login
  ) THEN
    RAISE EXCEPTION 'J\u00e1 existe um funcion\u00e1rio com o login "%"', v_login
      USING ERRCODE = '23505';
  END IF;

  -- Insere usando o UUID fornecido (se houver) ou deixa o default gerar.
  IF _funcionario_id IS NOT NULL THEN
    INSERT INTO public.funcionarios (id, owner_id, nome, login, pin_hash, role, client_uuid)
    VALUES (
      _funcionario_id,
      v_uid, trim(_nome), v_login,
      extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
      _role, _client_uuid
    ) RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.funcionarios (owner_id, nome, login, pin_hash, role, client_uuid)
    VALUES (
      v_uid, trim(_nome), v_login,
      extensions.crypt(_pin, extensions.gen_salt('bf', 8)),
      _role, _client_uuid
    ) RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('funcionario_id', v_id, 'idempotente', false);
END;
$function$;