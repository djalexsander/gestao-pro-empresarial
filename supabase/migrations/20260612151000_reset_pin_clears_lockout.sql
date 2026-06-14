CREATE OR REPLACE FUNCTION public.funcionario_resetar_pin(
  _funcionario_id UUID,
  _novo_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_pode BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _novo_pin IS NULL
     OR length(_novo_pin) < 4
     OR length(_novo_pin) > 6
     OR _novo_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 6 dígitos numéricos';
  END IF;

  SELECT owner_id
    INTO v_owner
    FROM public.funcionarios
   WHERE id = _funcionario_id
   FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;

  v_pode := (
    v_owner = v_uid
    OR EXISTS (
      SELECT 1
        FROM public.empresa_membros m
        JOIN public.empresas e ON e.id = m.empresa_id
       WHERE m.user_id = v_uid
         AND e.owner_id = v_owner
         AND m.papel IN ('owner', 'admin')
    )
  );

  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para redefinir o PIN do funcionário'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.funcionarios
     SET pin_hash = extensions.crypt(_novo_pin, extensions.gen_salt('bf', 8))
   WHERE id = _funcionario_id
     AND owner_id = v_owner;

  UPDATE public.funcionario_lockouts
     SET tentativas_na_janela = 0,
         janela_iniciada_em = NULL,
         ultima_tentativa_em = NULL,
         bloqueado_ate = NULL,
         updated_at = now()
   WHERE funcionario_id = _funcionario_id
     AND owner_id = v_owner;
END;
$$;

REVOKE ALL ON FUNCTION public.funcionario_resetar_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.funcionario_resetar_pin(UUID, TEXT) TO authenticated;
