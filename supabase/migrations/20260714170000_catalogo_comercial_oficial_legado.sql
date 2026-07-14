BEGIN;

-- O schema não possui relação plano-módulo. O Plano Base representa o ERP
-- essencial; módulos adicionais são contratados por empresa_modulos.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.planos
    WHERE nome = 'Plano Base'
      AND id <> '72000000-0000-4000-8000-000000000001'::uuid
  ) THEN
    RAISE EXCEPTION 'Plano Base já existe com UUID diferente do oficial';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.modulos
    WHERE (chave = 'financeiro_avancado' AND id <> '71000000-0000-4000-8000-000000000001'::uuid)
       OR (chave = 'relatorios'          AND id <> '71000000-0000-4000-8000-000000000002'::uuid)
       OR (chave = 'estoque_avancado'   AND id <> '71000000-0000-4000-8000-000000000003'::uuid)
       OR (chave = 'fiscal'              AND id <> '71000000-0000-4000-8000-000000000004'::uuid)
       OR (chave = 'multiusuario'        AND id <> '71000000-0000-4000-8000-000000000005'::uuid)
       OR (chave = 'exportacoes'         AND id <> '71000000-0000-4000-8000-000000000006'::uuid)
  ) THEN
    RAISE EXCEPTION 'Módulo oficial já existe com UUID diferente';
  END IF;
END;
$$;

INSERT INTO public.planos (
  id, nome, descricao, valor, tipo_cobranca,
  limite_usuarios, limite_produtos, ativo, ordem
) VALUES (
  '72000000-0000-4000-8000-000000000001'::uuid,
  'Plano Base',
  'Acesso ao ERP principal com funcionalidades essenciais (Dashboard, Produtos, PDV simples, Caixa, Clientes e Fornecedores).',
  39.99,
  'mensal'::public.plano_tipo_cobranca,
  5,
  NULL,
  true,
  10
)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  valor = EXCLUDED.valor,
  tipo_cobranca = EXCLUDED.tipo_cobranca,
  limite_usuarios = EXCLUDED.limite_usuarios,
  limite_produtos = EXCLUDED.limite_produtos,
  ativo = EXCLUDED.ativo,
  ordem = EXCLUDED.ordem,
  updated_at = now();

-- Catálogo provisório anterior: preservado, mas fora da oferta ativa.
UPDATE public.planos
SET ativo = false, updated_at = now()
WHERE id = '72000000-0000-4000-8000-000000000002'::uuid
  AND nome = 'Completo para Testes';

INSERT INTO public.modulos (
  id, nome, chave, descricao, valor, ativo, aplica_restricao, ordem
) VALUES
  (
    '71000000-0000-4000-8000-000000000001'::uuid,
    'Financeiro Avançado',
    'financeiro_avancado',
    'Contas a pagar, contas a receber, fluxo de caixa e lançamentos financeiros.',
    29.99, true, true, 10
  ),
  (
    '71000000-0000-4000-8000-000000000003'::uuid,
    'Estoque Avançado',
    'estoque_avancado',
    'Controle detalhado de estoque, movimentações e alertas de estoque baixo.',
    29.99, true, true, 20
  ),
  (
    '71000000-0000-4000-8000-000000000002'::uuid,
    'Relatórios',
    'relatorios',
    'Relatório de vendas, compras, fluxo de caixa analítico e DRE simplificado.',
    4.99, true, true, 30
  ),
  (
    '71000000-0000-4000-8000-000000000004'::uuid,
    'Fiscal',
    'fiscal',
    'Relatórios fiscais e apuração de impostos (em breve).',
    5.06, true, true, 40
  ),
  (
    '71000000-0000-4000-8000-000000000005'::uuid,
    'Multiusuário / Equipe',
    'multiusuario',
    'Cadastro de funcionários, controle de permissões e operadores de caixa.',
    14.99, true, true, 50
  ),
  (
    '71000000-0000-4000-8000-000000000006'::uuid,
    'Exportações',
    'exportacoes',
    'Exportação de relatórios, geração de PDF e download de dados.',
    4.99, true, true, 60
  )
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  chave = EXCLUDED.chave,
  descricao = EXCLUDED.descricao,
  valor = EXCLUDED.valor,
  ativo = EXCLUDED.ativo,
  aplica_restricao = EXCLUDED.aplica_restricao,
  ordem = EXCLUDED.ordem,
  updated_at = now();

-- Todos os adicionais são funcionalidades administrativas do ERP.
INSERT INTO public.mode_modules (mode_id, module_id)
SELECT sm.id, m.id
FROM public.system_modes sm
CROSS JOIN public.modulos m
WHERE sm.chave = 'erp'
  AND m.chave IN (
    'financeiro_avancado', 'estoque_avancado', 'relatorios',
    'fiscal', 'multiusuario', 'exportacoes'
  )
ON CONFLICT (mode_id, module_id) DO NOTHING;

-- No PDV, somente o módulo de equipe afeta diretamente operadores de caixa.
INSERT INTO public.mode_modules (mode_id, module_id)
SELECT sm.id, m.id
FROM public.system_modes sm
JOIN public.modulos m ON m.chave = 'multiusuario'
WHERE sm.chave = 'pdv'
ON CONFLICT (mode_id, module_id) DO NOTHING;

UPDATE public.config_comercial
SET plano_padrao_id = '72000000-0000-4000-8000-000000000001'::uuid,
    updated_at = now()
WHERE id = true;

DO $$
DECLARE
  v_erp uuid;
  v_pdv uuid;
BEGIN
  SELECT id INTO v_erp FROM public.system_modes WHERE chave = 'erp';
  SELECT id INTO v_pdv FROM public.system_modes WHERE chave = 'pdv';
  IF v_erp IS NULL OR v_pdv IS NULL THEN
    RAISE EXCEPTION 'Modos ERP/PDV obrigatórios não encontrados';
  END IF;

  IF (SELECT count(*) FROM public.planos
      WHERE nome = 'Plano Base' AND ativo = true) <> 1 THEN
    RAISE EXCEPTION 'Plano Base ativo ausente ou duplicado';
  END IF;

  IF (SELECT count(*) FROM public.modulos
      WHERE ativo = true AND chave IN (
        'financeiro_avancado', 'estoque_avancado', 'relatorios',
        'fiscal', 'multiusuario', 'exportacoes'
      )) <> 6 THEN
    RAISE EXCEPTION 'Catálogo oficial de seis módulos incompleto';
  END IF;

  IF (SELECT count(*) FROM public.mode_modules mm
      JOIN public.modulos m ON m.id = mm.module_id
      WHERE mm.mode_id = v_erp
        AND m.chave IN (
          'financeiro_avancado', 'estoque_avancado', 'relatorios',
          'fiscal', 'multiusuario', 'exportacoes'
        )) <> 6 THEN
    RAISE EXCEPTION 'Associações ERP incompletas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mode_modules mm
    JOIN public.modulos m ON m.id = mm.module_id
    WHERE mm.mode_id = v_pdv AND m.chave = 'multiusuario'
  ) THEN
    RAISE EXCEPTION 'Associação PDV/multiusuario ausente';
  END IF;
END;
$$;

COMMIT;
