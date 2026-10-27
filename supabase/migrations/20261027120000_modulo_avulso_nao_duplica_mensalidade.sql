-- Contratacao de modulo avulso nao pode duplicar o que a mensalidade ja cobra.
--
-- Incidente (empresa vanderleiadias817, 21/10/2026): a mensalidade consolidada
-- (Plano Base + 6 modulos, R$ 150,00) estava vencida em 19/10. Em
-- Configuracoes > Planos e Modulos o cartao do modulo vencido mostra "Contratar";
-- a cliente clicou em "Financeiro Avancado", e solicitar_contratacao_modulo()
-- criou uma cobranca avulsa de R$ 29,99 (pagamentos.f207d86b) 20 segundos antes
-- de ela pagar a mensalidade, que ja inclui esse mesmo modulo (R$ 29,99 e item
-- de todas as mensalidades). O RPC nao verificava se o modulo ja estava
-- contratado.
--
-- Correcao:
--   1) solicitar_contratacao_modulo() recusa modulo com status 'ativo' (vigente
--      ou vencido): renovar e pagar a mensalidade, nunca uma cobranca avulsa.
--   2) Serializa por empresa (mesma chave da mensalidade/webhook) e reaproveita
--      a cobranca avulsa aberta do modulo, inclusive 'atrasado'.
--   3) Indice unico: no maximo uma cobranca avulsa aberta por empresa e modulo.
--
-- Nao altera tabelas (sem novos GRANTs), nem confirmar_pagamento_asaas().
BEGIN;

CREATE OR REPLACE FUNCTION public.solicitar_contratacao_modulo(_modulo_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid := public.current_empresa_id();
  v_valor numeric;
  v_nome text;
  v_pgto_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  SELECT valor, nome INTO v_valor, v_nome
  FROM public.modulos WHERE id = _modulo_id AND ativo = true;
  IF v_valor IS NULL THEN RAISE EXCEPTION 'Módulo inválido'; END IF;

  -- Mesma chave de solicitar_mensalidade() e do webhook: cliques simultaneos e a
  -- confirmacao de uma mensalidade nao se cruzam.
  PERFORM pg_advisory_xact_lock(hashtextextended('assinatura:' || v_empresa_id::text, 0));

  -- Modulo contratado (mesmo com a vigencia vencida) e cobrado dentro da
  -- mensalidade; uma cobranca avulsa seria cobranca em duplicidade.
  IF EXISTS (
    SELECT 1 FROM public.empresa_modulos em
    WHERE em.empresa_id = v_empresa_id
      AND em.modulo_id = _modulo_id
      AND em.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'O módulo % já está contratado e é cobrado na sua mensalidade. Para renová-lo, pague a mensalidade.', v_nome;
  END IF;

  INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, observacoes)
  VALUES (v_empresa_id, _modulo_id, 'pendente', 'Solicitado pelo cliente')
  ON CONFLICT (empresa_id, modulo_id) DO NOTHING;

  SELECT id INTO v_pgto_id
  FROM public.pagamentos
  WHERE empresa_id = v_empresa_id
    AND referencia_tipo = 'modulo'
    AND modulo_id = _modulo_id
    AND status IN ('pendente', 'atrasado')
  ORDER BY created_at DESC LIMIT 1;
  IF v_pgto_id IS NOT NULL THEN RETURN v_pgto_id; END IF;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, modulo_id, descricao, valor, status, registrado_por
  ) VALUES (
    v_empresa_id, 'modulo', _modulo_id,
    'Contratação solicitada: ' || v_nome, v_valor, 'pendente', auth.uid()
  ) RETURNING id INTO v_pgto_id;
  RETURN v_pgto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_contratacao_modulo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_contratacao_modulo(uuid) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_modulo_aberto
  ON public.pagamentos (empresa_id, modulo_id)
  WHERE referencia_tipo = 'modulo'
    AND modulo_id IS NOT NULL
    AND status IN ('pendente', 'atrasado');

COMMENT ON INDEX public.uq_pagamentos_modulo_aberto IS
  'No maximo uma cobranca avulsa aberta (pendente ou atrasada) por empresa e modulo.';

COMMIT;
