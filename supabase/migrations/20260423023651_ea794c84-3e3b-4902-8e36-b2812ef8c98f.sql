-- =========================================================
-- 1) ZERAR DADOS DAS EMPRESAS EXISTENTES (testes)
-- =========================================================
-- Mantém: auth.users, empresas, planos, modulos, empresa_assinaturas, empresa_modulos, configuracoes_empresa
-- Apaga: tudo que é dado operacional/transacional

-- Ordem importante por causa de FKs implícitas em owner_id
DELETE FROM public.venda_pagamentos;
DELETE FROM public.venda_itens;
DELETE FROM public.vendas;

DELETE FROM public.compra_itens;
DELETE FROM public.compras;

DELETE FROM public.caixa_movimentos;
DELETE FROM public.caixas;

DELETE FROM public.financeiro_lancamentos;
DELETE FROM public.categorias_financeiras;

DELETE FROM public.estoque_movimentacoes;
DELETE FROM public.lotes_produto;
DELETE FROM public.produto_codigos;
DELETE FROM public.produto_variacoes;
DELETE FROM public.produtos;
DELETE FROM public.categorias_produto;

DELETE FROM public.clientes;
DELETE FROM public.fornecedores;

DELETE FROM public.terminais;
DELETE FROM public.funcionarios;

-- =========================================================
-- 2) FUNÇÃO: dono da empresa zera os próprios dados
-- =========================================================
CREATE OR REPLACE FUNCTION public.resetar_dados_empresa()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  DELETE FROM public.venda_pagamentos      WHERE owner_id = _uid;
  DELETE FROM public.venda_itens           WHERE owner_id = _uid;
  DELETE FROM public.vendas                WHERE owner_id = _uid;

  DELETE FROM public.compra_itens          WHERE owner_id = _uid;
  DELETE FROM public.compras               WHERE owner_id = _uid;

  DELETE FROM public.caixa_movimentos      WHERE owner_id = _uid;
  DELETE FROM public.caixas                WHERE owner_id = _uid;

  DELETE FROM public.financeiro_lancamentos WHERE owner_id = _uid;
  DELETE FROM public.categorias_financeiras WHERE owner_id = _uid;

  DELETE FROM public.estoque_movimentacoes WHERE owner_id = _uid;
  DELETE FROM public.lotes_produto         WHERE owner_id = _uid;
  DELETE FROM public.produto_codigos       WHERE owner_id = _uid;
  DELETE FROM public.produto_variacoes     WHERE owner_id = _uid;
  DELETE FROM public.produtos              WHERE owner_id = _uid;
  DELETE FROM public.categorias_produto    WHERE owner_id = _uid;

  DELETE FROM public.clientes              WHERE owner_id = _uid;
  DELETE FROM public.fornecedores          WHERE owner_id = _uid;
END;
$$;

REVOKE ALL ON FUNCTION public.resetar_dados_empresa() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resetar_dados_empresa() TO authenticated;

-- =========================================================
-- 3) PLANOS DISPONÍVEIS para o cliente
-- =========================================================
CREATE OR REPLACE FUNCTION public.planos_disponiveis()
RETURNS TABLE (
  id uuid,
  nome text,
  descricao text,
  valor numeric,
  tipo_cobranca plano_tipo_cobranca,
  limite_usuarios integer,
  limite_produtos integer,
  ordem integer,
  atual boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH minha_empresa AS (
    SELECT e.id AS empresa_id
    FROM public.empresas e
    WHERE e.owner_id = auth.uid()
    LIMIT 1
  ),
  minha_assin AS (
    SELECT a.plano_id
    FROM public.empresa_assinaturas a
    JOIN minha_empresa me ON me.empresa_id = a.empresa_id
    ORDER BY a.updated_at DESC
    LIMIT 1
  )
  SELECT
    p.id, p.nome, p.descricao, p.valor, p.tipo_cobranca,
    p.limite_usuarios, p.limite_produtos, p.ordem,
    COALESCE(p.id = (SELECT plano_id FROM minha_assin), false) AS atual
  FROM public.planos p
  WHERE p.ativo = true
  ORDER BY p.ordem, p.valor;
$$;

REVOKE ALL ON FUNCTION public.planos_disponiveis() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.planos_disponiveis() TO authenticated;

-- =========================================================
-- 4) MÓDULOS DISPONÍVEIS para o cliente (com status)
-- =========================================================
CREATE OR REPLACE FUNCTION public.modulos_disponiveis_cliente()
RETURNS TABLE (
  id uuid,
  nome text,
  chave text,
  descricao text,
  valor numeric,
  aplica_restricao boolean,
  status text,
  data_expiracao date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH minha_empresa AS (
    SELECT e.id AS empresa_id
    FROM public.empresas e
    WHERE e.owner_id = auth.uid()
    LIMIT 1
  )
  SELECT
    m.id, m.nome, m.chave, m.descricao, m.valor, m.aplica_restricao,
    COALESCE(em.status::text, 'nao_contratado') AS status,
    em.data_expiracao
  FROM public.modulos m
  LEFT JOIN public.empresa_modulos em
    ON em.modulo_id = m.id
   AND em.empresa_id = (SELECT empresa_id FROM minha_empresa)
  WHERE m.ativo = true
  ORDER BY m.ordem, m.nome;
$$;

REVOKE ALL ON FUNCTION public.modulos_disponiveis_cliente() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modulos_disponiveis_cliente() TO authenticated;

-- =========================================================
-- 5) SOLICITAR CONTRATAÇÃO DE PLANO
-- =========================================================
CREATE OR REPLACE FUNCTION public.solicitar_contratacao_plano(_plano_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, plano_id, descricao, valor, status, registrado_por
  ) VALUES (
    _empresa_id, 'plano', _plano_id,
    'Contratação solicitada: ' || _nome, _valor, 'pendente', auth.uid()
  ) RETURNING id INTO _pgto_id;

  RETURN _pgto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_contratacao_plano(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_contratacao_plano(uuid) TO authenticated;

-- =========================================================
-- 6) SOLICITAR CONTRATAÇÃO DE MÓDULO
-- =========================================================
CREATE OR REPLACE FUNCTION public.solicitar_contratacao_modulo(_modulo_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Cria/atualiza vínculo como pendente (sem ativar)
  INSERT INTO public.empresa_modulos (empresa_id, modulo_id, status, observacoes)
  VALUES (_empresa_id, _modulo_id, 'pendente', 'Solicitado pelo cliente')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.pagamentos (
    empresa_id, referencia_tipo, modulo_id, descricao, valor, status, registrado_por
  ) VALUES (
    _empresa_id, 'modulo', _modulo_id,
    'Contratação solicitada: ' || _nome, _valor, 'pendente', auth.uid()
  ) RETURNING id INTO _pgto_id;

  RETURN _pgto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_contratacao_modulo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_contratacao_modulo(uuid) TO authenticated;