-- RPC: lista os módulos disponíveis para a empresa do usuário logado.
-- Para cada módulo ativo retorna se ele está liberado (ativo, trial liberado, ou não restritivo).
CREATE OR REPLACE FUNCTION public.meus_modulos()
RETURNS TABLE (
  modulo_id uuid,
  chave text,
  nome text,
  descricao text,
  valor numeric,
  aplica_restricao boolean,
  liberado boolean,
  origem text -- 'ativo' | 'trial' | 'sem_restricao' | 'bloqueado'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _empresa_id uuid;
  _assinatura_status text;
  _permitir_trial boolean;
BEGIN
  SELECT id INTO _empresa_id FROM public.empresas WHERE owner_id = auth.uid() LIMIT 1;

  -- Sem empresa: retorna módulos como bloqueados (mas listáveis).
  IF _empresa_id IS NULL THEN
    RETURN QUERY
    SELECT m.id, m.chave, m.nome, m.descricao, m.valor, m.aplica_restricao,
           (NOT m.aplica_restricao) AS liberado,
           CASE WHEN m.aplica_restricao THEN 'bloqueado' ELSE 'sem_restricao' END
    FROM public.modulos m
    WHERE m.ativo = true
    ORDER BY m.ordem, m.nome;
    RETURN;
  END IF;

  -- Status efetivo da assinatura (trial / ativo / vencido).
  SELECT status INTO _assinatura_status
  FROM public.empresa_assinaturas
  WHERE empresa_id = _empresa_id
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT permitir_modulos_no_trial INTO _permitir_trial FROM public.config_comercial LIMIT 1;
  _permitir_trial := COALESCE(_permitir_trial, true);

  RETURN QUERY
  SELECT
    m.id, m.chave, m.nome, m.descricao, m.valor, m.aplica_restricao,
    CASE
      WHEN NOT m.aplica_restricao THEN true
      WHEN EXISTS (
        SELECT 1 FROM public.empresa_modulos em
        WHERE em.empresa_id = _empresa_id
          AND em.modulo_id = m.id
          AND em.status = 'ativo'
          AND (em.data_expiracao IS NULL OR em.data_expiracao >= CURRENT_DATE)
      ) THEN true
      WHEN _assinatura_status = 'trial' AND _permitir_trial THEN true
      ELSE false
    END AS liberado,
    CASE
      WHEN NOT m.aplica_restricao THEN 'sem_restricao'
      WHEN EXISTS (
        SELECT 1 FROM public.empresa_modulos em
        WHERE em.empresa_id = _empresa_id
          AND em.modulo_id = m.id
          AND em.status = 'ativo'
          AND (em.data_expiracao IS NULL OR em.data_expiracao >= CURRENT_DATE)
      ) THEN 'ativo'
      WHEN _assinatura_status = 'trial' AND _permitir_trial THEN 'trial'
      ELSE 'bloqueado'
    END AS origem
  FROM public.modulos m
  WHERE m.ativo = true
  ORDER BY m.ordem, m.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.meus_modulos() TO authenticated;

-- Garante unicidade da chave para evitar módulos duplicados
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='modulos_chave_uidx'
  ) THEN
    CREATE UNIQUE INDEX modulos_chave_uidx ON public.modulos(chave);
  END IF;
END $$;