
# Plano — Desktop Local-First (Autônomo)

## Diagnóstico do que você está vendo

Já existe MUITA infraestrutura local-first no projeto:

- SQLite embarcado no Rust (`src-tauri/src/db.rs`, ~15k linhas)
- Servidor local HTTP (`local_server.rs`, ~8k linhas) com endpoints REST para vendas, caixa, estoque, funcionários, operadores offline, financeiro
- Adapter `local-server.ts` que já tenta usar o local primeiro com fallback para cloud
- Tabelas com outbox de sincronização (`outbox_funcionarios`, `outbox_vendas`, etc.)
- Cache de operadores para PIN offline (`operadores_offline`)
- Cache de funcionários remotos (`funcionarios_remote_cache`)

**O sintoma que você vê NÃO é "o desktop depende do Supabase". É um problema mais específico:**

1. **No instalador novo, o servidor local não está sendo iniciado ou cai logo após o boot** (badge "local-server" vermelho, "Servidor local indisponível").
2. **Sem servidor local, o adapter cai para Supabase** — e quando a operação é uma escrita protegida (criar funcionário), o adapter local-server **exige** o servidor e mostra erro, em vez de degradar para cloud.
3. **A sincronização inicial ("bootstrap") nunca rodou** porque o servidor local nunca subiu — então `funcionarios_remote_cache` está vazio e a lista fica em branco.
4. **No PWA web não há servidor local** — por isso lê direto do Supabase e funciona.

A arquitetura que você descreve já está parcialmente implementada. O que falta é (a) garantir que o servidor local **sempre** suba, (b) garantir que o bootstrap baixe os dados na primeira execução, (c) eliminar pontos onde o frontend ainda fala direto com Supabase em modo desktop.

---

## Onda 1 — Estabilizar o servidor local (sintoma imediato)

Objetivo: nunca mais aparecer "Servidor local indisponível" em desktop saudável.

- Auditar `useLocalServerBoot.ts` + `local_server.rs` para garantir start automático no boot do Tauri, com retry e log claro.
- Detectar porta em uso e tentar portas alternativas, persistindo a escolhida em config.
- Watchdog (`useLocalServerWatchdog.ts`) reinicia o servidor quando o `/api/health` falha 3x seguidas.
- Mensagem de erro no header mudaria de "Servidor local indisponível" para "Reiniciando serviço local…" com auto-retry visível.
- Botão "Diagnosticar" em Configurações → Desktop que mostra: porta, PID, último erro do servidor, caminho do SQLite.

## Onda 2 — Bootstrap inicial obrigatório

Objetivo: ao fazer login pela primeira vez no desktop, baixar tudo que é leitura frequente e popular o SQLite.

- Tela "Preparando dados offline" bloqueante após login no desktop (skip no PWA).
- Job que baixa do Supabase e grava no SQLite local: funcionários, produtos, categorias, clientes, fornecedores, formas de pagamento, configurações da empresa, módulos, permissões.
- Progresso por domínio com retomada (se cair na metade, continua de onde parou).
- Marca de bootstrap concluído por (owner_id + versão do schema). Não roda de novo até nova versão.
- Após concluído, badge muda para "Offline pronto".

## Onda 3 — Funcionários 100% locais (caso de teste do print)

Objetivo: validar a arquitetura no domínio que você mostrou falhando.

- `funcionarios.list`: sempre lê de `funcionarios_remote_cache` no SQLite. Cloud só roda no PWA ou se o cache estiver vazio e houver internet (apenas para popular).
- `funcionarios.criar/editar/excluir/resetarPin`: grava primeiro no SQLite (status `pending_create/pending_update/pending_delete`), enfileira em `outbox_funcionarios`, sincroniza com Supabase em background. Mostra na UI com ícone de "aguardando sync".
- PIN dos operadores criados offline já entra no cache `operadores_offline` para login no PDV sem internet.
- Erro de cadastro nunca mais por "servidor local indisponível" — o servidor local é garantido pela Onda 1; se realmente cair, escreve em buffer no localStorage e tenta de novo quando voltar.

## Onda 4 — Auth e PIN offline robustos

- Login do administrador continua usando `verifyOfflineCredential` (já existe em `erpOfflineCache.ts`) quando offline.
- PIN do operador valida 100% via `/api/auth/validar-pin` do servidor local (já existe).
- "Aquecer PIN" automático para todos os operadores ativos depois do bootstrap, sem exigir que cada um logue online uma vez.
- Sessão do desktop persiste localmente; refresh do JWT Supabase só roda quando há internet.

## Onda 5 — Auditoria final de chamadas diretas ao Supabase

Objetivo: garantir que no desktop o frontend nunca chame `supabase.from(...)` para dados de negócio.

- Varredura via `rg "supabase\.from\("` no `src/` separando: (a) chamadas só de auth/realtime (OK), (b) chamadas de dados (precisam migrar).
- Cada chamada de dados sobrevivente vira RPC do adapter (`dataClient.<dominio>.<acao>`) com implementação local-server + fallback cloud.
- ESLint rule custom proibindo `supabase.from` fora de `src/integrations/`.

## Onda 6 — Sync bidirecional robusto

- Worker de outbox com backoff exponencial e dead-letter.
- Pull periódico do Supabase (delta por `updated_at`) para refletir mudanças feitas em outros terminais/PWA no SQLite local.
- Conflito → política "última escrita vence" com log auditável; campos críticos (estoque, financeiro) usam soma/append em vez de overwrite.
- Tombstones (`deleted_at`) já existentes ganham respeito completo.

## Onda 7 — Indicadores de sync na UI

- Badge global no header: Sincronizado / Sincronizando / Pendente (N) / Offline / Conflito / Erro.
- Por registro, em listas críticas (vendas, funcionários, produtos), ícone discreto indicando estado de sync.
- Tela "Sincronização" em Configurações com fila de outbox, retry manual e log de conflitos.

---

## O que NÃO muda

- PWA continua usando Supabase direto (não tem servidor local — é o comportamento certo).
- Modo cloud puro (instalações sem Tauri) continua igual.
- Updater, releases, assinatura, módulos, SaaS, billing — intocados.
- Layouts, telas e fluxos visuais — só ganham badges de sync, sem redesenho.

---

## Como propor executar

Quero rodar **uma onda por vez**, validando com você no fim de cada uma antes de seguir. Sugestão de ordem:

1. **Onda 1 + 2 primeiro** (resolve o sintoma do print: servidor estável + bootstrap popula funcionários no SQLite).
2. **Onda 3** (funcionários 100% offline, end-to-end).
3. **Onda 4** (auth/PIN sólidos offline).
4. **Onda 5** (auditoria final).
5. **Ondas 6 e 7** (sync robusto + UI de status).

Cada onda é entregável independente. Posso começar pela Onda 1 assim que você aprovar.

### Detalhe técnico (para referência)

- Servidor local: Axum sobre Tokio em `src-tauri/src/local_server.rs`, persistência via `rusqlite` em `db.rs`.
- Identidade local: `LOCAL_IDENTITY` cache (já existe) com `empresa_id`, `owner_id`, `terminal_id`.
- Outbox: tabelas `outbox_*` por domínio, processadas por loop assíncrono no Rust com push pra RPCs Supabase.
- Adapter pattern: `src/integrations/data/adapters/local-server.ts` é wrapper sobre `cloudAdapter` — vamos inverter a relação (local é a fonte, cloud é o sync).
