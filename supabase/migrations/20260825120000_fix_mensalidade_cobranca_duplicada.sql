-- Corrige duplicidade de cobrança Asaas no botao "Pagar mensalidade".
--
-- Causa raiz (confirmada com o caso da empresa 143c5224-a800-49d8-9b15-f550c5a7192a):
-- solicitar_mensalidade() so reaproveitava um titulo "pendente" quando ele
-- AINDA NAO tinha asaas_payment_id. Assim que o Pix era gerado (1o clique
-- com sucesso), um 2o/3o clique -- app reaberto, dialog fechado, usuaria
-- impaciente -- nao encontrava mais o titulo existente na checagem e caia
-- direto no INSERT, criando outro titulo e outra cobranca no Asaas. Sem
-- nenhum lock, dois cliques quase simultaneos tambem podiam passar os dois
-- pela checagem antes de qualquer INSERT confirmar (race clássica
-- check-then-insert).
--
-- Revisao: "cobranca aberta" para efeito desta trava e reaproveitamento
-- significa status IN ('pendente','atrasado') -- nao so 'pendente'. Uma
-- cobranca que o Asaas marcou como atrasada (webhook, status overdue)
-- continua sem estar paga nem cancelada; o caso real confirma isso: as
-- duas duplicatas da empresa acima estao hoje como 'atrasado', nao
-- 'pendente'. 'pago' e 'cancelado' seguem de fora da trava em todos os
-- pontos abaixo.
--
-- Nao mexe na regra de vencimento (Edge Function asaas-criar-cobranca,
-- tomorrowPlusDays(3)) -- isso e um problema separado, tratado a parte.
-- Nao altera nem cancela nada no lado do Asaas.

-- 1) Backfill defensivo -------------------------------------------------
-- Cancela mensalidades "pendente"/"atrasado" duplicadas que ja existam
-- hoje (mesma empresa, mesmo padrao de descricao), mantendo a que tem
-- cobranca Asaas ativa (ou a mais recente, na ausencia de uma). Necessario
-- para o indice unico do passo 2 poder ser criado sem falhar em dados ja
-- duplicados por este mesmo bug. So mexe no nosso banco -- ver relatorio
-- para o passo manual de cancelar as cobrancas duplicadas no Asaas.
DO $$
DECLARE
  r RECORD;
  v_keep uuid;
BEGIN
  FOR r IN
    SELECT empresa_id
    FROM public.pagamentos
    WHERE referencia_tipo = 'outro' AND status IN ('pendente', 'atrasado') AND descricao LIKE 'Mensalidade%'
    GROUP BY empresa_id
    HAVING count(*) > 1
  LOOP
    SELECT id INTO v_keep
      FROM public.pagamentos
     WHERE empresa_id = r.empresa_id AND referencia_tipo = 'outro'
       AND status IN ('pendente', 'atrasado') AND descricao LIKE 'Mensalidade%'
     ORDER BY (asaas_payment_id IS NOT NULL) DESC, created_at DESC
     LIMIT 1;

    UPDATE public.pagamentos
       SET status = 'cancelado',
           observacoes = COALESCE(observacoes || E'\n', '') ||
             'Cancelado automaticamente em ' || now()::date ||
             ' - cobranca duplicada da mesma mensalidade (correcao do bug de duplo clique em "Pagar mensalidade").'
     WHERE empresa_id = r.empresa_id AND referencia_tipo = 'outro'
       AND status IN ('pendente', 'atrasado') AND descricao LIKE 'Mensalidade%'
       AND id <> v_keep;
  END LOOP;
END $$;

-- 2) Trava dura no banco --------------------------------------------------
-- No maximo uma mensalidade aberta (pendente OU atrasada) por empresa,
-- independente de qual caminho de codigo tente inserir. Isso e o que
-- garante a regra mesmo que dois requests cheguem simultaneos e passem da
-- checagem da RPC ao mesmo tempo (o 2o INSERT falha aqui em vez de criar
-- outra cobranca). 'pago' e 'cancelado' nao entram no indice -- assim que
-- a mensalidade e paga (ou cancelada), a trava libera para a proxima.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_mensalidade_pendente
  ON public.pagamentos (empresa_id)
  WHERE referencia_tipo = 'outro' AND status IN ('pendente', 'atrasado') AND descricao LIKE 'Mensalidade%';

-- 3) solicitar_mensalidade(): lock por empresa + reaproveita titulo aberto
--    (pendente OU atrasado), mesmo ja com Pix gerado, + fallback gracioso
--    se a trava unica for atingida mesmo assim.
CREATE OR REPLACE FUNCTION public.solicitar_mensalidade()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_empresa uuid; v_assin record; v_pag uuid; v_total numeric:=0; v_desc text; v_mod record; v_qtd int:=0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_empresa:=public.current_empresa_id(); IF v_empresa IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  -- Serializa chamadas concorrentes para a MESMA empresa (duplo clique,
  -- retry de rede, duas abas/dispositivos). A 2a chamada so prossegue
  -- depois que a 1a ja commitou, e ai encontra o titulo recem-criado na
  -- checagem abaixo -- mesmo padrao ja usado em criar_cliente() e em
  -- finalizar_venda_pdv() para o mesmo tipo de corrida.
  PERFORM pg_advisory_xact_lock(hashtextextended('mensalidade:' || v_empresa::text, 0));

  SELECT a.*,p.nome,p.tipo_cobranca,p.valor valor_catalogo INTO v_assin
  FROM public.empresa_assinaturas a JOIN public.planos p ON p.id=a.plano_id
  WHERE a.empresa_id=v_empresa AND a.status::text IN ('active','ativo','trial','overdue','pending_payment','expired')
  ORDER BY a.updated_at DESC LIMIT 1;
  IF v_assin.id IS NULL THEN RAISE EXCEPTION 'Nenhum plano associado à empresa'; END IF;

  IF v_assin.proximo_valor IS NOT NULL AND v_assin.reajuste_vigencia<=CURRENT_DATE THEN
    UPDATE public.reajuste_historico SET aplicado_em=COALESCE(aplicado_em,now()) WHERE id=v_assin.reajuste_historico_id;
    UPDATE public.empresa_assinaturas SET valor_contratado=proximo_valor,proximo_valor=NULL,
      reajuste_vigencia=NULL,reajuste_historico_id=NULL WHERE id=v_assin.id;
    v_assin.valor_contratado:=v_assin.proximo_valor;
  END IF;
  UPDATE public.reajuste_historico h SET aplicado_em=COALESCE(h.aplicado_em,now())
  FROM public.empresa_modulos em WHERE em.empresa_id=v_empresa AND em.proximo_valor IS NOT NULL
    AND em.reajuste_vigencia<=CURRENT_DATE AND h.id=em.reajuste_historico_id;
  UPDATE public.empresa_modulos SET valor_contratado=proximo_valor,proximo_valor=NULL,
    reajuste_vigencia=NULL,reajuste_historico_id=NULL
  WHERE empresa_id=v_empresa AND proximo_valor IS NOT NULL AND reajuste_vigencia<=CURRENT_DATE;

  -- Reaproveita a mensalidade em aberto (pendente OU atrasada) -- inclusive
  -- quando ela ja tem uma cobranca Asaas/Pix gerada (antes a condicao
  -- extra "asaas_payment_id IS NULL" so pegava o titulo ANTES do Pix
  -- existir; um 2o clique depois do Pix ja criado nao encontrava nada
  -- aqui e caia direto no INSERT). Uma mensalidade "atrasada" continua
  -- sendo uma cobranca aberta -- so 'pago'/'cancelado' liberam a criacao
  -- de uma nova.
  SELECT id INTO v_pag FROM public.pagamentos WHERE empresa_id=v_empresa AND referencia_tipo='outro'
    AND status IN ('pendente', 'atrasado') AND descricao LIKE 'Mensalidade%'
    ORDER BY created_at DESC LIMIT 1;
  IF v_pag IS NOT NULL THEN RETURN v_pag; END IF;

  v_total:=COALESCE(v_assin.valor_contratado,v_assin.valor_catalogo,0);
  FOR v_mod IN SELECT m.id,m.nome,COALESCE(em.valor_contratado,m.valor) valor
    FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
    WHERE em.empresa_id=v_empresa AND em.status='ativo' AND COALESCE(em.valor_contratado,m.valor)>0
  LOOP v_total:=v_total+v_mod.valor; v_qtd:=v_qtd+1; END LOOP;
  v_desc:='Mensalidade Plano '||v_assin.nome||CASE WHEN v_qtd>0 THEN ' + '||v_qtd||' módulo(s)' ELSE '' END;

  BEGIN
    INSERT INTO public.pagamentos(empresa_id,referencia_tipo,descricao,valor,status,registrado_por)
    VALUES(v_empresa,'outro',v_desc,v_total,'pendente',auth.uid()) RETURNING id INTO v_pag;
  EXCEPTION WHEN unique_violation THEN
    -- Defesa extra: se por algum motivo o lock nao evitou a corrida (ex.:
    -- outro caminho de codigo futuro insere sem tomar o lock), o indice
    -- unico do passo 2 barra o 2o INSERT em vez de criar outra cobranca.
    -- Devolve o titulo que ja existe em vez de estourar erro pro usuario.
    SELECT id INTO v_pag FROM public.pagamentos WHERE empresa_id=v_empresa AND referencia_tipo='outro'
      AND status IN ('pendente', 'atrasado') AND descricao LIKE 'Mensalidade%'
      ORDER BY created_at DESC LIMIT 1;
    RETURN v_pag;
  END;

  INSERT INTO public.pagamento_itens(pagamento_id,tipo,plano_id,descricao,valor)
  VALUES(v_pag,'plano',v_assin.plano_id,'Plano '||v_assin.nome,COALESCE(v_assin.valor_contratado,v_assin.valor_catalogo,0));
  FOR v_mod IN SELECT m.id,m.nome,COALESCE(em.valor_contratado,m.valor) valor
    FROM public.empresa_modulos em JOIN public.modulos m ON m.id=em.modulo_id
    WHERE em.empresa_id=v_empresa AND em.status='ativo' AND COALESCE(em.valor_contratado,m.valor)>0
  LOOP INSERT INTO public.pagamento_itens(pagamento_id,tipo,modulo_id,descricao,valor)
    VALUES(v_pag,'modulo',v_mod.id,'Módulo '||v_mod.nome,v_mod.valor); END LOOP;
  RETURN v_pag;
END; $$;
GRANT EXECUTE ON FUNCTION public.solicitar_mensalidade() TO authenticated;

-- 4) cobranca_pendente_atual(): passa a enxergar tambem cobranca "atrasada"
--    -----------------------------------------------------------------
--    Original (20260714160000_seed_comercial_e_saas_multiusuario.sql):
--      WHERE empresa_id = v_emp AND status = 'pendente'
--    Essa RPC alimenta useCobrancaPendente(), usado em 3 lugares:
--      - PlanosModulosTab.tsx (botao "Pagar mensalidade", este fix)
--      - ResumoAssinatura.tsx: ja tem showPendente = status IN
--        ('pending_payment','overdue','expired') -- ou seja, esse
--        componente JA espera poder mostrar uma cobranca pendente quando a
--        assinatura esta em atraso; hoje isso falha silenciosamente porque
--        a RPC nunca devolve uma linha 'atrasado'. Alargar o filtro
--        corrige esse mesmo gap ali, de graca.
--      - CartDrawer.tsx: usa o resultado so dentro de
--        pendenteCorrespondeAoCarrinho(), que JA rejeita a cobranca
--        pendente quando data_vencimento passou (checagem independente de
--        status). Uma linha 'atrasado' tera vencimento no passado quase
--        sempre, entao cai nesse mesmo caminho e o carrinho segue o fluxo
--        normal de solicitar_carrinho() -- comportamento inalterado.
--    Nenhum dos 3 consumidores lia/assumia status na resposta (a funcao
--    nunca devolveu essa coluna), entao nao ha checagem de status
--    quebrando no frontend.
CREATE OR REPLACE FUNCTION public.cobranca_pendente_atual()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_empresa_id();
  v_pg record;
  v_itens jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_emp IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_pg
  FROM public.pagamentos
  WHERE empresa_id = v_emp AND status IN ('pendente', 'atrasado')
  ORDER BY created_at DESC LIMIT 1;
  IF v_pg.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tipo', pi.tipo, 'plano_id', pi.plano_id, 'modulo_id', pi.modulo_id,
    'descricao', pi.descricao, 'valor', pi.valor
  )), '[]'::jsonb)
  INTO v_itens
  FROM public.pagamento_itens pi
  WHERE pi.pagamento_id = v_pg.id;

  RETURN jsonb_build_object(
    'pagamento_id', v_pg.id, 'valor', v_pg.valor,
    'descricao', v_pg.descricao, 'data_vencimento', v_pg.data_vencimento,
    'asaas_payment_id', v_pg.asaas_payment_id,
    'invoice_url', v_pg.asaas_invoice_url,
    'pix_qrcode', v_pg.asaas_pix_qrcode,
    'pix_copia_cola', v_pg.asaas_pix_copia_cola,
    'created_at', v_pg.created_at, 'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cobranca_pendente_atual() TO authenticated;
