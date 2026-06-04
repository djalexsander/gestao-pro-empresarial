# Auditoria offline - Gestao Pro

Data: 2026-06-04

## Status geral

O app ja possui a base offline operacional:

- Desktop Tauri com backend HTTP local.
- SQLite local em `src-tauri/src/db/mod.rs`.
- Outbox local para produtos, clientes, estoque, vendas, caixa, cancelamentos, financeiro manual e backup.
- Leitura local para produtos, clientes, estoque, caixa e vendas operacionais.
- Sync incremental/read-through para produtos, clientes e movimentacoes de estoque.
- Bloqueio anti split-brain nas operacoes criticas do PDV/caixa/estoque.

## Regra de operacao hibrida

O Gestao Pro deve rodar em modo hibrido:

- O nucleo operacional offline deve funcionar sem internet: PDV, caixa, estoque operacional, clientes/produtos basicos e outbox.
- Funcionalidades que dependem naturalmente da internet continuam funcionando online quando houver conexao, sem bloquear o restante do app.
- O app nao deve forcar "somente offline" quando existe internet.
- O app tambem nao deve travar o offline quando um modulo online-only falha, como Asaas, SaaS/admin, storage ou busca externa.
- Operacoes criticas que ja possuem estado local, como venda, caixa e baixa de estoque, continuam local-first para evitar split-brain.

## Corrigido nesta auditoria

- `useProduto` deixou de consultar Supabase direto e passou a usar `dataClient.produtos.get`.
- Validacao de saldo em lote do PDV (`useSaldosLote`) agora usa `dataClient.estoque.saldosLinhas` em modo local.
- Realtime especifico do resumo de caixa nao abre canal Supabase em modo local.
- Ping de conexao do terminal usa o servidor local em `local-server`/`local-terminal`, inclusive quando a internet esta indisponivel mas a LAN pode estar funcionando.
- `local-server` e `local-terminal` agora resolvem `produtos.get` pelo backend local.
- Categorias de produto em modo local passam a ser derivadas da lista local de produtos.
- Escritas ainda sem endpoint/outbox local continuam usando cloud quando houver internet, marcadas como cloud-only/fallback. Assim, o online segue normal e o offline operacional nao e travado.

## Offline operacional coberto

- Buscar/listar produtos.
- Criar produto local com outbox.
- Buscar/listar clientes.
- Criar cliente local com outbox.
- Consultar saldos e movimentacoes de estoque.
- Registrar movimento manual de estoque local com outbox.
- Abrir caixa, sangria/suprimento e fechar caixa local com outbox.
- Finalizar venda PDV local com baixa de estoque local e outbox.
- Cancelar venda local com estorno e outbox.
- Listar vendas locais, detalhe local e metricas locais.
- Login de operador por PIN com cache local apos validacao previa.
- Backup/restauracao do banco local.

## Ainda depende de nuvem em parte ou totalmente

- Edicao/status/exclusao de produto.
- Codigos auxiliares e variacoes de produto.
- Criacao/edicao/exclusao de categorias.
- Edicao/status/exclusao de cliente.
- Fornecedores, compras e varios relatorios analiticos.
- SaaS/assinaturas/cobrancas Asaas/admin master.
- Configuracoes de empresa com storage de logos.
- QA/evidencias e recursos que usam Supabase Storage.
- Busca externa de produto por OpenFoodFacts.

Esses pontos podem funcionar online normalmente. Quando a internet cair, eles podem falhar de forma localizada, mas isso nao deve impedir PDV/caixa/estoque local. O caminho para torna-los offline tambem e adicionar endpoints locais + tabelas/outbox por dominio.

## Proximos blocos recomendados

1. Produto CRUD completo local: editar, status, excluir seguro, codigos e variacoes.
2. Cliente CRUD completo local: editar, inativar/excluir seguro e historico local.
3. Fornecedores e compras local-first.
4. Leituras financeiras completas via adapter local, aproveitando `fetchFinanceiroLancamentos` e `fetchFinanceiroResumo`.
5. Relatorios principais lendo de agregados locais quando em modo desktop local.
