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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _novo_pin IS NULL
     OR length(_novo_pin) < 4
     OR length(_novo_pin) > 8
     OR _novo_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN deve ter de 4 a 8 dígitos numéricos';
  END IF;

  UPDATE public.funcionarios
     SET pin_hash = extensions.crypt(_novo_pin, extensions.gen_salt('bf', 8))
   WHERE id = _funcionario_id
     AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;

  UPDATE public.funcionario_lockouts
     SET tentativas_na_janela = 0,
         janela_iniciada_em = NULL,
         ultima_tentativa_em = NULL,
         bloqueado_ate = NULL,
         updated_at = now()
   WHERE funcionario_id = _funcionario_id
     AND owner_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.funcionario_resetar_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.funcionario_resetar_pin(UUID, TEXT) TO authenticated;
