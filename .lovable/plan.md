# Plano: Consistência e limpeza Gestão Pro

## Diagnóstico confirmado

Rodei queries no Supabase pelos owners da empresa de teste:

| owner | lanç. | recebíveis | vendas | produtos | caixas | mov_caixa |
|---|---|---|---|---|---|---|
| `2aa0fdf8…` (xaviervieira1979) | 0 | 0 | 0 | 0 | 0 | 0 |
| `a6b2e7b9…` (xaviervieira) | 0 | 0 | 0 | 0 | 2 | 3 |

O banco **já está zerado**. Os 32 títulos / R$ 900,38 / 2 produtos críticos mostrados no Dashboard vêm do **cache local persistido** (`gp.rq.cache.v1` em localStorage via `QueryProvider`, mais o adapter local do desktop), e o "HTTP 400 Não autenticado" do Caixa vem da **outbox offline** tentando empurrar mutações antigas sem bearer token válido.

## O que vou implementar

### 1. RPC `admin_zerar_empresa(p_empresa_id uuid, p_incluir_produtos bool)`
- `SECURITY DEFINER`, com guard `is_super_admin(auth.uid())`.
- Transacional. Apaga por `owner_id` da empresa: `lancamento_pagamentos`, `financeiro_lancamentos`, `compra_itens`, `compras`, `estoque_movimentacoes`, `caixa_movimentos`, `caixas`, `cobranca_whatsapp_logs`, `ifood_repasses`, `autorizacoes_log`, `funcionario_tentativas_pin`, `funcionario_lockouts`, vendas + itens + pagamentos (verifico nomes exatos). Se `p_incluir_produtos`, também `produtos`, `categorias_produto`, `lotes`.
- **Não toca** em `empresas`, `empresa_membros`, `empresa_assinaturas`, `empresa_modulos`, `configuracoes_empresa`, `funcionarios`, `clientes`, `fornecedores` (configurável, mas default = preservar).
- Retorna `jsonb` com contagem do que foi removido (auditoria).

### 2. Botão em `/admin/empresas` (super admin)
- "Zerar dados operacionais" com modal de confirmação dupla (digitar nome da empresa).
- Checkbox "Incluir produtos".
- Chama RPC via `supabaseAdmin` em `createServerFn` com `requireSupabaseAuth` + verificação `is_super_admin`.

### 3. Limpeza de cache local quando o owner muda / dados zeram
- Em `AuthProvider`: no `SIGNED_IN`, se o `user.id` mudou desde a última sessão (chave `gp.lastUid` em localStorage), **purgar** `gp.rq.cache.v1`, todas as chaves `gp.outbox.*`, `gp.local.*`, IndexedDB do adapter local, e chamar `queryClient.clear()`.
- Adicionar utilitário `purgeLocalState(reason)` em `src/integrations/data/local-purge.ts` que centraliza isso.
- Botão "Limpar cache local desta máquina" em `Configurações > Sincronização` para o usuário rodar manualmente.

### 4. Outbox / sync: tratar 401/400 "não autenticado"
- No worker que processa a outbox (provavelmente em `realtime-client` / `local-server` / `adapters/cloud.ts` — vou localizar): se a resposta for 401 ou 400 com mensagem auth, chamar `supabase.auth.refreshSession()` e tentar **1 vez** de novo.
- Se falhar de novo: marcar o item da fila como `paused_auth`, parar o loop, e exibir banner "Sessão expirada — refaça login para sincronizar" em vez de logar erro infinito.
- Se o item da outbox pertence a um `owner_id` que não bate com o usuário atual: descartar silenciosamente (item órfão de empresa que foi trocada/zerada).

### 5. Auditoria mínima dos cards do Dashboard
- Em DEV, cada hook do Dashboard (`useDashboard`, `useFinanceiroIndicadores`, `useEstoque` low-stock) loga no console:
  `[DASH_AUDIT] card=contas_receber owner=… filtros={tipo:receber,status:[pendente,parcial,vencido]} count=X total=R$ Y`
- Garante que TODA query do Dashboard tem `.eq('owner_id', user.id)` explícito. Vou auditar os hooks listados e adicionar onde faltar.

### 6. Não vou mexer
- Layout, regras visuais, motor financeiro (`src/lib/finance/*` já está correto), Tauri, frontend de PDV/Vendas/Compras, RLS existente.

## Ordem de execução

1. Migration: criar RPC `admin_zerar_empresa` + helper `is_super_admin` (se não existir já).
2. `local-purge.ts` + hook no `AuthProvider` para purgar em troca de usuário.
3. Auditoria de owner_id nos hooks do Dashboard + log `[DASH_AUDIT]`.
4. Retry com refresh + descarte de órfãos na outbox.
5. UI: botão "Zerar empresa" em `/admin/empresas`, botão "Limpar cache local" em `/configuracoes`.
6. Validar: logar com a empresa teste, abrir Dashboard → tudo deve zerar; rodar "Zerar empresa" no banco; erro do Caixa some.

## Riscos

- RPC destrutiva: mitigado com guard super_admin + confirmação dupla na UI + retorno auditado.
- Purgar cache em troca de usuário pode irritar quem alterna entre empresas legítimas — por isso a chave é `user.id` (não empresa), e a primeira sessão de um user em uma máquina não dispara purga.
- Refresh de sessão automático: limitado a 1 retry para evitar loop.