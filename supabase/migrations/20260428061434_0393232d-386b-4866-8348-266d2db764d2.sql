-- Reuso de pagamento pendente por (empresa, plano) e (empresa, módulo)
CREATE OR REPLACE FUNCTION public.solicitar_contratacao_plano(_plano_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _empresa_id uuid;
  _valor numeric;
  _nome text;
  _pgto_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT id INTO _empresa_id
  FROM public.empresas
  WHERE owner_id = auth.uid()
  LIMIT 1;

  IF _empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;

  SELECT valor, nome INTO _valor, _nome
  FROM public.planos
  WHERE id = _plano_id AND ativo = true;

  IF _valor IS NULL THEN
    RAISE EXCEPTION 'Plano inválido';
  END IF;

  -- Reaproveita pagamento pendente existente para o mesmo (empresa, plano)
  SELECT id INTO _pgto_id
  FROM public.pagamentos
  WHERE empresa_id = _empresa_id
    AND referencia_tipo = 'plano'
    AND plano_id = _plano_id
    AND status = 'pendente'
  ORDER BY created_at DESC
  LIMIT 1;

  IF _pgto_id IS NOT NULL THEN
    RETURN _pgto_id;
  END IF;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, plano_id, descricao, valor, status, registrado_por
  ) VALUES (
    _empresa_id, 'plano', _plano_id,
    'Contratação solicitada: ' || _nome, _valor, 'pendente', auth.uid()
  ) RETURNING id INTO _pgto_id;

  RETURN _pgto_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_contratacao_modulo(_modulo_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _empresa_id uuid;
  _valor numeric;
  _nome text;
  _pgto_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT id INTO _empresa_id
  FROM public.empresas
  WHERE owner_id = auth.uid()
  LIMIT 1;

  IF _empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;

  SELECT valor, nome INTO _valor, _nome
  FROM public.modulos
  WHERE id = _modulo_id AND ativo = true;

  IF _valor IS NULL THEN
    RAISE EXCEPTION 'Módulo inválido';
  END IF;

  INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, observacoes)
  VALUES (_empresa_id, _modulo_id, 'pendente', 'Solicitado pelo cliente')
  ON CONFLICT DO NOTHING;

  -- Reaproveita pagamento pendente existente para o mesmo (empresa, módulo)
  SELECT id INTO _pgto_id
  FROM public.pagamentos
  WHERE empresa_id = _empresa_id
    AND referencia_tipo = 'modulo'
    AND modulo_id = _modulo_id
    AND status = 'pendente'
  ORDER BY created_at DESC
  LIMIT 1;

  IF _pgto_id IS NOT NULL THEN
    RETURN _pgto_id;
  END IF;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, modulo_id, descricao, valor, status, registrado_por
  ) VALUES (
    _empresa_id, 'modulo', _modulo_id,
    'Contratação solicitada: ' || _nome, _valor, 'pendente', auth.uid()
  ) RETURNING id INTO _pgto_id;

  RETURN _pgto_id;
END;
$function$;

-- Habilita realtime na tabela pagamentos para o front escutar status -> pago
ALTER TABLE public.pagamentos REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pagamentos;