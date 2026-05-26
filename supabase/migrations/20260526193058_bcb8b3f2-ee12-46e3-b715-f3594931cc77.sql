
CREATE OR REPLACE FUNCTION public.solicitar_mensalidade()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _empresa_id uuid;
  _plano record;
  _pgto_id uuid;
  _total numeric := 0;
  _descricao text;
  _mod record;
  _qtd_mods int := 0;
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

  -- Plano vigente (assinatura ativa/trial). Pode ser NULL se ainda não houver.
  SELECT p.* INTO _plano
  FROM public.empresa_assinaturas a
  JOIN public.planos p ON p.id = a.plano_id
  WHERE a.empresa_id = _empresa_id
    AND a.status IN ('active','ativo','trial','overdue','pending_payment','expired')
  ORDER BY a.updated_at DESC
  LIMIT 1;

  IF _plano.id IS NULL THEN
    RAISE EXCEPTION 'Nenhum plano associado à empresa';
  END IF;

  _total := COALESCE(_plano.valor, 0);

  -- Reaproveita cobrança pendente da mensalidade (não confirmada ainda no Asaas)
  SELECT id INTO _pgto_id
  FROM public.pagamentos
  WHERE empresa_id = _empresa_id
    AND referencia_tipo = 'outro'
    AND status = 'pendente'
    AND descricao LIKE 'Mensalidade%'
    AND asaas_payment_id IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF _pgto_id IS NOT NULL THEN
    RETURN _pgto_id;
  END IF;

  -- Soma módulos efetivamente contratados
  FOR _mod IN
    SELECT m.id, m.nome, m.valor
      FROM public.empresa_modulos em
      JOIN public.modulos m ON m.id = em.modulo_id
     WHERE em.empresa_id = _empresa_id
       AND em.status = 'ativo'
       AND COALESCE(m.valor, 0) > 0
  LOOP
    _total := _total + COALESCE(_mod.valor, 0);
    _qtd_mods := _qtd_mods + 1;
  END LOOP;

  _descricao := 'Mensalidade Plano ' || _plano.nome ||
                CASE WHEN _qtd_mods > 0
                     THEN ' + ' || _qtd_mods::text || ' módulo(s)'
                     ELSE ''
                END;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, descricao, valor, status, registrado_por
  ) VALUES (
    _empresa_id, 'outro', _descricao, _total, 'pendente', auth.uid()
  ) RETURNING id INTO _pgto_id;

  -- Item: plano
  INSERT INTO public.pagamento_itens (pagamento_id, tipo, plano_id, descricao, valor)
  VALUES (_pgto_id, 'plano', _plano.id,
          'Plano ' || _plano.nome, COALESCE(_plano.valor, 0));

  -- Itens: módulos ativos
  FOR _mod IN
    SELECT m.id, m.nome, m.valor
      FROM public.empresa_modulos em
      JOIN public.modulos m ON m.id = em.modulo_id
     WHERE em.empresa_id = _empresa_id
       AND em.status = 'ativo'
       AND COALESCE(m.valor, 0) > 0
  LOOP
    INSERT INTO public.pagamento_itens (pagamento_id, tipo, modulo_id, descricao, valor)
    VALUES (_pgto_id, 'modulo', _mod.id,
            'Módulo ' || _mod.nome, COALESCE(_mod.valor, 0));
  END LOOP;

  RETURN _pgto_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.solicitar_mensalidade() TO authenticated;
