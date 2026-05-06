
-- Sincroniza o lançamento de Contas a Pagar a partir da compra (idempotente).
-- Cria o lançamento se data_vencimento foi definida e ainda não existe.
-- Atualiza data_vencimento/valor/fornecedor/descrição se já existe.
-- Não duplica, sempre 1 lançamento por compra (compra_id é a chave de vínculo).
CREATE OR REPLACE FUNCTION public.sincronizar_lancamento_compra(_compra_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_compra public.compras%ROWTYPE;
  v_lanc_id uuid;
  v_descricao text;
BEGIN
  SELECT * INTO v_compra FROM public.compras WHERE id = _compra_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Não cria/atualiza lançamento para compras canceladas
  IF v_compra.status = 'cancelada' THEN
    RETURN NULL;
  END IF;

  -- Só cria/atualiza se houver vencimento informado
  IF v_compra.data_vencimento IS NULL THEN
    RETURN NULL;
  END IF;

  v_descricao := 'Compra ' || COALESCE(v_compra.numero, '')
    || CASE WHEN v_compra.numero_nf IS NOT NULL AND v_compra.numero_nf <> ''
            THEN ' / NF ' || v_compra.numero_nf ELSE '' END;

  -- Existe lançamento vinculado?
  SELECT id INTO v_lanc_id
    FROM public.financeiro_lancamentos
   WHERE compra_id = _compra_id
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_lanc_id IS NULL THEN
    -- Cria novo (apenas se ainda não baixado / status pendente)
    INSERT INTO public.financeiro_lancamentos (
      owner_id, tipo, descricao, valor,
      data_emissao, data_vencimento,
      status, fornecedor_id, compra_id, observacoes
    )
    VALUES (
      v_compra.owner_id,
      'pagar',
      v_descricao,
      v_compra.total,
      v_compra.data_emissao,
      v_compra.data_vencimento,
      'pendente',
      v_compra.fornecedor_id,
      v_compra.id,
      v_compra.observacoes
    )
    RETURNING id INTO v_lanc_id;
  ELSE
    -- Atualiza vencimento/valor/fornecedor/descrição se ainda não foi pago.
    UPDATE public.financeiro_lancamentos
       SET data_vencimento = v_compra.data_vencimento,
           descricao = v_descricao,
           fornecedor_id = v_compra.fornecedor_id,
           valor = CASE WHEN status IN ('pago','recebido','parcial')
                        THEN valor
                        ELSE v_compra.total END,
           updated_at = now()
     WHERE id = v_lanc_id;
  END IF;

  RETURN v_lanc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_lancamento_compra(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sincronizar_lancamento_compra(uuid) TO authenticated;

-- Trigger: ao inserir/atualizar uma compra, sincronizar o lançamento.
CREATE OR REPLACE FUNCTION public.trg_compras_sync_lancamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só dispara quando muda algo financeiramente relevante
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sincronizar_lancamento_compra(NEW.id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.data_vencimento IS DISTINCT FROM OLD.data_vencimento)
       OR (NEW.total IS DISTINCT FROM OLD.total)
       OR (NEW.fornecedor_id IS DISTINCT FROM OLD.fornecedor_id)
       OR (NEW.numero_nf IS DISTINCT FROM OLD.numero_nf)
       OR (NEW.status IS DISTINCT FROM OLD.status)
       OR (NEW.observacoes IS DISTINCT FROM OLD.observacoes) THEN
      PERFORM public.sincronizar_lancamento_compra(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compras_sync_lancamento ON public.compras;
CREATE TRIGGER compras_sync_lancamento
AFTER INSERT OR UPDATE ON public.compras
FOR EACH ROW EXECUTE FUNCTION public.trg_compras_sync_lancamento();

-- RPC: editar metadados financeiros da compra sem mexer em estoque/itens.
-- Atualiza apenas: data_vencimento, fornecedor_id, numero_nf, serie_nf,
-- data_prevista, observacoes. O trigger acima sincroniza Contas a Pagar.
CREATE OR REPLACE FUNCTION public.atualizar_compra_metadados(
  _compra_id uuid,
  _data_vencimento date DEFAULT NULL,
  _data_prevista date DEFAULT NULL,
  _fornecedor_id uuid DEFAULT NULL,
  _numero_nf text DEFAULT NULL,
  _serie_nf text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _patch_data_vencimento boolean DEFAULT true,
  _patch_data_prevista boolean DEFAULT true,
  _patch_fornecedor_id boolean DEFAULT true,
  _patch_numero_nf boolean DEFAULT true,
  _patch_serie_nf boolean DEFAULT true,
  _patch_observacoes boolean DEFAULT true
) RETURNS public.compras
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.compras%ROWTYPE;
BEGIN
  -- RLS garante que só o owner/membro consegue ler a compra.
  -- Recarrega para validar acesso antes de atualizar.
  PERFORM 1 FROM public.compras WHERE id = _compra_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra não encontrada ou sem acesso.';
  END IF;

  UPDATE public.compras
     SET data_vencimento = CASE WHEN _patch_data_vencimento THEN _data_vencimento ELSE data_vencimento END,
         data_prevista   = CASE WHEN _patch_data_prevista   THEN _data_prevista   ELSE data_prevista   END,
         fornecedor_id   = CASE WHEN _patch_fornecedor_id   THEN _fornecedor_id   ELSE fornecedor_id   END,
         numero_nf       = CASE WHEN _patch_numero_nf       THEN _numero_nf       ELSE numero_nf       END,
         serie_nf        = CASE WHEN _patch_serie_nf        THEN _serie_nf        ELSE serie_nf        END,
         observacoes     = CASE WHEN _patch_observacoes     THEN _observacoes     ELSE observacoes     END,
         updated_at = now()
   WHERE id = _compra_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_compra_metadados(uuid, date, date, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atualizar_compra_metadados(uuid, date, date, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated;

-- Backfill: para compras existentes que já têm lançamento financeiro vinculado,
-- copia data_vencimento do lançamento para a compra (se a compra não tiver).
UPDATE public.compras c
   SET data_vencimento = fl.data_vencimento
  FROM public.financeiro_lancamentos fl
 WHERE fl.compra_id = c.id
   AND c.data_vencimento IS NULL
   AND fl.data_vencimento IS NOT NULL;
