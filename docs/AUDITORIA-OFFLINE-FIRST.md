# Auditoria Offline-First — Etapa 1 (rodada de revisão)

> Atualizado nesta etapa. A versão anterior deste documento listava 42
> arquivos / 140 chamadas; a maioria já foi migrada para `dataClient`.
> Esta revisão reflete o estado **real** do código hoje.

## 1. Mapeamento de chamadas diretas a `@/integrations/supabase/client`

Varredura `rg -l "@/integrations/supabase/client" src`:

| Arquivo | Camada | Status |
|---|---|---|
| `src/integrations/supabase/client.ts` | infra (gerado) | ✅ esperado — base do SDK |
| `src/integrations/supabase/client.server.ts` | infra (gerado) | ✅ esperado — admin server |
| `src/integrations/data/adapters/cloud.ts` | adapter | ✅ esperado |
| `src/integrations/data/adapters/cloud-auth.ts` | adapter | ✅ esperado |
| `src/integrations/data/adapters/cloud-realtime.ts` | adapter | ✅ esperado |
| `src/integrations/data/adapters/cloud-relatorios.ts` | adapter | ✅ esperado |
| `src/integrations/data/adapters/local-terminal.ts` | adapter | ✅ esperado (usa cloud como fallback) |
| `src/routes/api/public/webhooks/asaas.ts` | server route | ✅ ok — server-side, não bloqueia UI |
| `src/routes/api/public/webhooks/pix.ts` | server route | ✅ ok — server-side |
| `src/routes/api/public/hooks/cobrancas-wa-cron.ts` | server route | ✅ ok — server-side |
| **`src/hooks/useFuncionarios.ts`** | hook de UI | ⚠️ usa `supabase.rpc` direto (1 chamada) — migrar para adapter em onda futura |
| **`src/components/configuracoes/WhatsAppConfigForm.tsx`** | UI | ⚠️ usa `supabase.functions.invoke` (chamada externa WhatsApp) — não é dado offline-relevante |

**Resumo:** apenas **2 arquivos de UI/hook** ainda chamam Supabase fora da
camada `dataClient`, e nenhum deles é caminho crítico de PDV/caixa/estoque.
A onda 1 listada na versão antiga deste documento (`useDashboard`,
`useProdutos`, `useVendas`, `useCompras`, `useFinanceiro*`, `useClientes`,
`useNotificacoes`, etc.) **já foi concluída** — todos consomem `dataClient`.

## 2. Estado dos módulos por camada

### ✅ Já no `dataClient` (cobertos por adapter)
Produtos, clientes, fornecedores, vendas, compras, caixa, financeiro,
notificações, estoque, terminais, dashboard, relatórios (via
`cloud-relatorios`), realtime (via `cloud-realtime`), auth (via
`cloud-auth`).

### ⚙️ Adapter local-terminal com fallback transparente
`local-terminal.ts` tenta o servidor LAN primeiro e, em falha, delega ao
`cloudAdapter`. Telemetria reportada via `source-telemetry.ts`.

### 🟡 Adapter local-server (desktop server)
Hoje delega para `cloudAdapter` na maior parte dos domínios; backend Rust
+ SQLite (`src-tauri/src/db.rs`, `local_server.rs`) já existe e expõe
endpoints HTTP. Migração domínio-a-domínio é trabalho das próximas etapas.

### ⚠️ Ainda fora do `dataClient`
- `useFuncionarios.ts` — RPC direta. Baixo risco offline (não é PDV).
- `WhatsAppConfigForm.tsx` — invoke de Edge Function externa, sem
  equivalente offline (depende de provedor WhatsApp).

## 3. Operações que PRECISAM funcionar offline

Lista canônica para nortear próximas etapas:

1. **PDV** — abrir venda, escanear produto, calcular total, finalizar,
   imprimir cupom.
2. **Caixa** — abrir, registrar sangria/suprimento, fechar.
3. **Consulta de produto / preço** — leitura por código de barras / PLU.
4. **Estoque (consulta)** — saldo atual local.
5. **Clientes (busca/criar simples)** — para venda fiado.
6. **Lançamento de fiado** — gravar localmente, sincronizar depois.

Operações que podem permanecer **online-only** por ora:
relatórios consolidados, admin SaaS, cobranças/Pix/Asaas, planos,
WhatsApp, integrações fiscais externas.

## 4. Camada de detecção de modo

Implementada nesta etapa em `src/lib/runtimeMode.ts`. Combina três sinais
já existentes (`getDataMode`, `getRuntimeShell`, `useNetworkStatus`) em
4 estados legíveis:

- `online-cloud`
- `desktop-server`
- `desktop-terminal`
- `offline`

Não substitui nem altera nenhum mecanismo existente — é puramente
observacional, para uso por banners/diagnóstico.

## 5. Logs de diagnóstico adicionados

- `src/integrations/data/client.ts` → loga **uma vez por mudança de modo**:
  `[dataClient] modo ativo → 🖥️ SERVIDOR LOCAL` etc.
- `src/integrations/data/source-telemetry.ts` → em DEV, loga cada chamada
  com origem real: `[dataSource] ☁️ cloud · produtos.list` /
  `[dataSource] ⚠️ fallback→cloud · vendas.create`.

Esses logs já permitem inspecionar no console do navegador / DevTools do
Tauri qual backend serviu cada operação, sem alterar nenhum comportamento.

## 6. Garantias de não-travamento da UI desktop

Já em vigor (não foi necessário mexer nesta etapa):

- `src/lib/withTimeout.ts` — `withTimeout` / `withTimeoutFallback`
  envolve promises com timeout máximo e fallback.
- `src/hooks/useNetworkStatus.ts` — probe HTTP real (não confia no
  `navigator.onLine` puro). Timeout 4s, intervalo 30s.
- `src/components/shared/OfflineBanner.tsx` — banner discreto integrado
  em `__root.tsx`; mensagem específica em modo desktop.
- `local-terminal` adapter já faz fallback automático para cloud quando o
  servidor LAN não responde, sem propagar erro para a UI.

## 7. Próximas etapas sugeridas (NÃO executadas aqui)

- **Etapa 2:** SQLite local de fato (via Tauri command) servindo leituras
  de produto/cliente para o PDV mesmo offline.
- **Etapa 3:** outbox de mutations + worker de sync bidirecional.
- **Etapa 4:** migrar `useFuncionarios` e endpoints administrativos para
  `dataClient` com timeout curto.

---

## Etapa 2 — local-server real (executada)

### O que foi feito

- **`src/integrations/data/adapters/local-server.ts` reescrito.** Não é mais
  um simples "tag de origem" sobre o cloudAdapter. Agora consome de fato os
  endpoints HTTP locais expostos pelo backend Tauri/Axum em
  `127.0.0.1:<porta>`:

  | Domínio | Endpoint local | Origem real |
  |---|---|---|
  | `produtos.list`             | `GET /api/produtos/list` | SQLite local + sync incremental |
  | `clientes.listLite`         | `GET /api/clientes/lite` | SQLite local |
  | `fornecedores.list`         | `GET /api/fornecedores`  | SQLite local |
  | `funcionarios.list`         | `GET /api/relatorios/funcionarios-ativos` | SQLite local |
  | `estoque.saldosLinhas`      | `GET /api/estoque/saldos` | Saldo materializado local |
  | `estoque.movimentacoes`     | `GET /api/estoque/movimentacoes` | SQLite local |

### Ordem de prioridade implementada

1. **SQLite local** (header `x-gp-source: local-table` / `local-table-stale` /
   `local-db`) — nunca toca a internet.
2. **Servidor local foi à nuvem** (header `x-gp-source: upstream`) — o
   backend Rust faz sync incremental e ingere o resultado no SQLite antes
   de responder.
3. **`cloudAdapter` como último recurso** — só quando o servidor local
   está parado, sem upstream configurado, ou retorna erro/timeout.

Cloud nunca é tentado primeiro e nunca trava a UI: timeout HTTP de 4s no
adapter + `withTimeoutFallback` da camada superior.

### Cache local automático

Já garantido pelo backend Rust (`proxy_with_incremental_sync` +
`ingest_typed`): toda página vinda da nuvem é persistida nas tabelas
SQLite locais (`produtos_local`, `clientes_local`, `fornecedores_local`,
`estoque_saldos_local`, etc.). Após o primeiro sync, leituras passam a
ser servidas localmente mesmo sem internet.

### Logs DEV adicionados

- `[LOCAL_DB] produtos.list (origem=local-table)` — leitura veio do SQLite.
- `[LOCAL_SERVER] clientes.listLite (origem=upstream)` — servidor local
  precisou refrescar via PostgREST (já materializou no SQLite).
- `[CLOUD_FALLBACK] funcionarios.list (origem=cloud-fallback)` — servidor
  local indisponível; caímos direto no Supabase.

Os mesmos eventos continuam sendo publicados em `source-telemetry` para
componentes de diagnóstico.

### O que NÃO foi alterado

- **cloudAdapter**: intacto.
- **Supabase client**: intacto.
- **local-terminal adapter**: intacto (já consumia o servidor local via LAN).
- **Escritas** (create/update/delete/RPC): seguem por cloudAdapter.
- **Outbox / sync de mutations**: backend Rust já tem; não foi tocado.
- **Telas / regras de negócio / cobrança / planos / assinatura**: nada.

### Segurança

- O adapter chama apenas `127.0.0.1:<porta>` — porta local, sem acesso
  externo.
- `service_role`, anon key e JWT do usuário **não** são manipulados pelo
  adapter; quem decide o que enviar à nuvem é o servidor Rust local.
- Nenhum secret novo foi adicionado ao bundle web.

### Comportamento garantido

- Online: tudo segue funcionando como antes (servidor local sincroniza com
  a nuvem; em pior caso, fallback cloud direto).
- Offline (desktop server): produtos, clientes, fornecedores, funcionários
  e estoque continuam carregando — direto do SQLite local.
- Terminal LAN: continua usando `local-terminal.ts` (que aponta para
  outro PC); este adapter de servidor não interfere.

---

## Etapa 4 — Login ERP e PIN do PDV offline

### Login admin/proprietário (já existente)

`src/lib/erpOfflineCache.ts` + `AdminAuthDialog` continuam responsáveis: após
um login ONLINE bem-sucedido, salvamos um verificador PBKDF2-SHA-256 (salt +
hash, 120k iter) por e-mail. Em modo desktop, sem internet, a próxima
abertura do ERP valida senha contra o cache local. Mensagens já cobrem o
caso "máquina não preparada".

### PIN do operador no PDV — Etapa 4 (novo)

Adicionado `src/lib/operadorOfflineCache.ts` (paralelo ao admin):

- Após **cada validação ONLINE bem-sucedida** de PIN, salva PBKDF2-SHA-256
  (salt + hash, 80k iter) por `funcionario_id`, junto de `nome`, `login`,
  `role`. PIN em texto puro nunca é persistido.
- `validarPinOperador` (em `useFuncionarios.ts`) agora é offline-first:
  1. Desktop sem internet → valida pelo cache local (lança mensagem amigável
     se ainda não preparado).
  2. Online → cloud + warm cache.
  3. Falha de rede em desktop com cache → fallback local automático.
- Lockout local espelhando o servidor: 5 falhas/10 min ⇒ 15 min de
  bloqueio. Auditoria detalhada (`funcionario_tentativas_pin`) continua
  exclusiva do Supabase — gerada na próxima validação online.
- Logs DEV: `[OFFLINE_AUTH] PIN validado localmente`,
  `[OFFLINE_AUTH] PIN recusado localmente`,
  `[OFFLINE_AUTH] fallback cloud → PIN validado/recusado localmente`.

### Decisão de arquitetura

A Etapa 4 ficou em **camada JS (localStorage)**, não no Rust/SQLite:

- Mesma estratégia já usada para o admin (`erpOfflineCache`) — o cache é
  por máquina, e o PDV é por máquina (terminal); não há ganho real em
  centralizar no servidor local Rust.
- Evita expor `pin_hash` na rede local e evita adicionar crates de
  cripto (`pbkdf2`, `sha2`, `hmac`) ao binário Tauri agora.
- Endpoint Rust `/api/auth/validar-pin` fica para uma etapa futura, caso
  passemos a querer um terminal LAN validar PIN contra o servidor central
  (hoje cada terminal valida contra o próprio cache, o que é equivalente
  já que o `saveOperadorPin` ocorre na máquina onde o operador entra).

### Garantias

- Senhas e PINs nunca em texto puro (PBKDF2-SHA-256 + salt aleatório).
- Login online e fluxo de Supabase intactos.
- Sem mudança em layout, cobrança, planos ou módulos.

---

## Sub-etapa 4.1 — PIN offline centralizado no servidor local (LAN)

### Problema da etapa 4

A etapa 4 implementou validação offline de PIN apenas no `localStorage` de
cada terminal (`operadorOfflineCache.ts`). Funciona em máquina única, mas
em rede LAN cada terminal precisava ter feito sua própria validação online
antes — não havia uma fonte única de verdade local.

### Modelo correto

- **Servidor local (PC servidor)**: SQLite central com tabela
  `operadores_offline` armazena `(funcionario_id, empresa_id, nome, login,
  role, ativo, salt, hash_pbkdf2, iter, failed_attempts, locked_until_ms)`.
- **Terminais LAN**: validam PIN via `POST /api/auth/validar-pin` do
  servidor local, sem nunca chamar Supabase direto.
- **Cache JS** (`operadorOfflineCache.ts`): mantido como **fallback de
  emergência** para máquina única, ou quando o servidor local está fora.
- **Cloud (Supabase)**: usada apenas quando online E o operador ainda não
  foi "aquecido" no servidor local.

### Endpoints novos no Rust (`local_server.rs`)

| Método | Path                       | Função                                     |
|--------|----------------------------|--------------------------------------------|
| POST   | `/api/auth/aquecer-pin`    | Grava verificador PBKDF2 (salt+hash) local |
| POST   | `/api/auth/validar-pin`    | Valida PIN local com lockout em SQLite     |

`aquecer-pin` é chamado automaticamente em `useFuncionarios.validarPinOperador`
após uma validação ONLINE bem-sucedida (best-effort, não bloqueia o login).

### Política de lockout (paralela ao server-side cloud)

- 5 falhas em 10 min ⇒ bloqueio de 15 min no SQLite local.
- Tentativas e `locked_until_ms` ficam na própria linha da tabela.
- Sucesso limpa o contador.
- Comparação usa `subtle::ConstantTimeEq` para evitar timing attacks.

### Algoritmo de hash

PBKDF2-HMAC-SHA256, 80 000 iterações, salt aleatório de 16 bytes
(`getrandom`). Mesmo padrão do cache JS, permitindo migração futura sem
mudança de algoritmo. **PIN nunca é persistido em texto puro**, e o hash
bcrypt da nuvem **não** é importado (não é exportado pela RPC por segurança).

### Limitações conhecidas (documentadas)

- Operador que **nunca validou PIN online** neste servidor local cai em:
  - 1ª preferência: cloud (se houver internet);
  - 2ª preferência: cache JS local do terminal (se já validou online ali antes);
  - sem essas opções: PIN é recusado com mensagem clara.
- O verificador local é regenerado a cada validação online (sempre seta o
  hash corrente do PIN). Mudanças de PIN feitas em outro terminal só se
  propagam para o servidor local quando algum terminal validar online com
  o PIN novo.

### Logs DEV

- `[OFFLINE_AUTH] terminal validando PIN no servidor LAN`
- `[OFFLINE_AUTH] PIN validado no servidor local`
- `[OFFLINE_AUTH] PIN recusado no servidor local`
- `[OFFLINE_AUTH] PIN aquecido no servidor local`
- `[OFFLINE_AUTH] fallback cloud online — servidor LAN <motivo>`
- `[OFFLINE_AUTH] fallback cache JS local`

---

## Etapa 5 — Produtos & Estoque offline-first (PDV)

### Decisão

Scanner de código de barras e leitor de balança (PLU) são **caminhos
quentes do PDV**: precisam responder em <50ms e nunca podem depender de
internet. Antes desta etapa, `produtos.buscarPorCodigo` e `buscarPorPlu`
caíam diretamente para `cloudAdapter` (RPC `buscar_produto_por_codigo` no
Supabase) — qualquer instabilidade de rede travava o PDV.

### Estratégia adotada

**Servidor local (Rust + SQLite) é a fonte primária** para os 3 endpoints
de PDV — list, busca por código, busca por PLU — e idem para `estoque.*`.
Cloud é apenas fallback de último recurso.

### Endpoints novos (Rust / Axum)

- `GET /api/produtos/buscar-codigo?codigo=<X>` → consulta `produtos_local`
  por `sku`, `json_extract($.codigo_barras)`, `$.qr_code`, `$.codigo_interno`.
  Retorna `{ result: ProdutoBuscaResult | null }` com `saldo_estoque` já
  resolvido via JOIN com `estoque_saldos_local`. Identifica a `fonte` do
  match (`barras` / `qr` / `sku` / `interno`).
- `GET /api/produtos/buscar-plu?plu=<X>` → tenta `$.plu` → `sku` →
  `$.codigo_interno`; repete sem zeros à esquerda.

### Convenção autoritativa offline

Os handlers retornam:

- **200 + `{ result }`** → resposta autoritativa local. Mesmo se
  `result === null`, o adapter NÃO consulta cloud (produto não existe
  nesse tenant — não adianta perguntar ao Supabase).
- **503** → `produtos_local` ainda vazio (sync inicial não rodou).
  Adapter cai para cloud quando online.
- **erro de rede / timeout** → idem (cloud fallback se online).

Isso mata o cenário "scanner trava 4s tentando online quando o produto
nem existe" e garante PDV instantâneo offline.

### Busca priorizada em `produtos.list`

`read_produtos` (com `busca`) agora ordena por relevância antes do
alfabético:

1. SKU exato
2. Nome exato
3. Nome começa com
4. SKU começa com
5. Contém em qualquer lugar

### Adapters

- `local-server.ts` (PC servidor / desktop único): local primeiro, cloud
  como fallback opcional.
- `local-terminal.ts` (terminal LAN): local **sempre** primeiro; cloud
  só quando o servidor central está fora — exatamente como a regra
  pedida ("nunca consultar Supabase diretamente para produtos/estoque
  em modo terminal").

### Logs DEV

- `[LOCAL_PRODUTOS]` — leitura de produto via SQLite local
- `[LOCAL_BUSCA]` — busca por código de barras / PLU via local
- `[LOCAL_ESTOQUE]` — leitura de estoque via local
- `[LOCAL_SERVER]` — servidor local foi à nuvem agora (ainda local-first)
- `[CLOUD_FALLBACK]` — produtos / clientes / fornecedores caíram p/ cloud
- `[CLOUD_FALLBACK_ESTOQUE]` — estoque caiu p/ cloud (raro, alarmante)

### O que NÃO mudou

- Nenhuma regra de negócio de estoque foi tocada.
- Movimentações de estoque continuam transacionais no SQLite local
  (`registrar_movimento_local` em `db.rs`) — concorrência LAN já era
  protegida via `unchecked_transaction()` + saldo materializado em
  `estoque_saldos_local`.
- `cloudAdapter` permanece intacto e ainda atende os caminhos não-PDV.

## Etapa 5 — continuação (resiliência do estoque local)

Schema local v18. Aditivo, sem mudança de regra de negócio.

- **Tabela `estoque_audit_local`**: trilha forense gravada na MESMA
  transação SQLite que `estoque_movimentacoes_local` + `outbox_estoque_movs`.
  Se a transação falhar, nada fica gravado — inclusive a auditoria. Não é
  enviada para a nuvem.
- **`db::rebuild_local_stock()`**: recalcula `estoque_saldos_local` a partir
  do histórico (SUM com sinal por tipo). Truncate + reinsert atômicos.
  Endpoint: `POST /api/estoque/rebuild`.
- **`db::verify_local_stock_health()`**: diagnóstico read-only — saldos
  negativos, movimentações órfãs, duplicidades, status da outbox.
  Endpoint: `GET /api/estoque/saude`. Retorna `status: ok | warning | error`.
- **UI**: `OfflineHealthCard` em Configurações → Desktop. Polling a cada 30s.
  Botões "Verificar" e "Recalcular saldos".
- **Logs DEV**: `[LOCAL_STOCK] rebuild ...` e `[LOCAL_STOCK] saude ...`.

Concorrência LAN: os writes de estoque já rodam sob `WAL` + transação
SQLite atômica (SQLite serializa writers no mesmo arquivo). Saldo negativo
é bloqueado dentro da transação (`saldo_insuficiente`), antes do commit —
dois caixas vendendo o mesmo último item recebem erro determinístico no
segundo, sem race window.

Próximos passos sugeridos: stream SSE `/api/eventos/estoque` para refletir
mudanças em tempo real entre terminais sem polling.

## Etapa 6 — Vendas e PDV 100% offline-first

Schema local **v19**. Aditivo, sem alterar fluxo do PDV nem regras de negócio.

### Já existia (intacto)
- `vendas_local`, `venda_itens_local`, `venda_pagamentos_local`,
  `outbox_vendas`, `outbox_cancelamentos_venda` — venda atômica em
  **uma única transação SQLite** (cabeçalho + itens + pagamentos +
  baixa de estoque via `apply_mov_to_saldo` + outbox).
- Idempotência por `client_uuid` (cabeçalho + cancelamento).
- Cancelamento atômico com **devolução de estoque** + regeneração de
  lançamentos do caixa associado.
- Vínculo automático com `caixa_local` aberto (match por operador,
  fallback para o caixa aberto mais recente).
- Endpoints HTTP `POST /api/vendas/registrar` e
  `POST /api/vendas/cancelar` (terminais LAN).

### Novidades nesta etapa
- **`vendas_audit_local`**: trilha forense (`criada` / `cancelada`) gravada
  na **MESMA transação** da venda/cancelamento — atomicidade total.
- **`contas_receber_local`**: título local criado quando a forma de
  pagamento é fiado/clientes a receber (detecção por substring:
  `fiado`, `receber`, `credito_loja`). Suporta vencimento opcional
  (`pagamentos[].vencimento_ms`). Cancelar a venda transiciona o título
  para `cancelado` na mesma transação — nunca duplica estorno.
- **`LocalVendaPagamentoInput.vencimento_ms`** opcional (backwards-compatível
  via `serde(default)`); incluído no payload da outbox para a cloud.
- **Logs DEV** nos handlers HTTP:
  `[LOCAL_SALE]`, `[LOCAL_PDV]`, `[LOCAL_CANCEL]`, `[LOCAL_OUTBOX]`.

### Garantias de consistência

| Cenário | Garantia |
|---|---|
| Duplo clique em Finalizar | Bloqueado por `uq_outbox_vendas_client_uuid` + idempotência por `client_uuid` na função |
| App reinicia após gravar | Venda persiste em `vendas_local` (WAL); outbox retoma push pelo scheduler |
| Cancelamento duplicado | Bloqueado por `uq_outbox_canc_venda` (1 cancelamento por venda) + early-return idempotente quando `status='cancelada'` |
| Crash durante venda | Transação SQLite rollback completo — nenhuma linha de itens/estoque/outbox/auditoria/fiado fica órfã |
| Terminal LAN | `local-terminal.ts` POSTa em `/api/vendas/registrar` no servidor central; nenhum acesso direto ao Supabase |
| Máquina única | `local-server.ts` grava direto no SQLite e enfileira na outbox para sync posterior |

### Não alterado
- Layout do PDV, modal de finalização, regras fiscais/financeiras,
  Asaas, cobrança, planos, módulos, assinatura.
- O ciclo de impressão/cupom continua usando `src/lib/cupom-print.ts`
  e `src/lib/cupom.ts` — já operam com dados locais da venda.

---

## Etapa 7 — Caixa 100% offline-first

### Estado
Toda a operação de caixa — abrir, suprimento, sangria, fechamento — já
gravava no SQLite local desde a v9 e enfileirava na `outbox_caixa`
(`abrir`/`movimento`/`fechar`) com retry + backoff exponencial. Esta etapa
fecha o ciclo com **auditoria local atômica**, **sync status no resumo** e
**observabilidade DEV**.

### Novidades

- **`caixa_audit_local` (schema v20)** — trilha forense gravada na
  **MESMA transação** SQLite da abertura/movimento/fechamento. Não vai
  à nuvem (a `outbox_caixa` já carrega tudo), serve para auditoria
  offline local. Eventos: `abertura`, `suprimento`, `sangria`,
  `fechamento`, `autorizacao` (reservado).
- **`CaixaResumoLocal.sync_pending` + `sync_status`** — o resumo agora
  expõe quantos itens da `outbox_caixa` ainda estão pending/sending/error
  para o caixa em questão, classificando como `synced` / `pending` / `error`.
- **Logs DEV** nos handlers HTTP:
  `[LOCAL_CASH_OPEN]`, `[LOCAL_CASH_MOVE]`, `[LOCAL_CASH_CLOSE]`,
  `[LOCAL_CASH_AUDIT]`, `[LOCAL_CASH_OUTBOX]`, `[LOCAL_CASH]`.

### Garantias

| Cenário | Garantia |
|---|---|
| Reabrir caixa para mesmo operador | Idempotente: devolve o caixa aberto existente em vez de criar outro |
| Duplo clique em Sangria / Suprimento | Bloqueado por `uq_outbox_caixa_client_uuid` + idempotência por `client_uuid` |
| Fechar caixa duas vezes | `fechar_caixa_local` exige `status='aberto'` (erro claro) e a outbox é deduplicada por `client_uuid` |
| Crash durante movimento | Rollback total — caixa, mov, outbox e auditoria saem juntos ou não saem |
| Terminal LAN | `local-terminal.ts` POSTa em `/api/caixa/*` no servidor central — nenhum acesso direto a Supabase para caixa |
| Vínculo venda↔caixa | `registrar_venda_local` já resolve o caixa aberto por operador e grava em `vendas_local.caixa_local_uuid` automaticamente |

### Não alterado
- Layout do caixa, regras de autorização (gerente para sangria/fechamento
  com falta), fluxos atuais da UI, Asaas, cobrança, planos, módulos,
  assinatura.

---

## Etapa 8 — Financeiro 100% offline-first

### Estado prévio
Já existiam `lancamentos_financeiros_local`, `financeiro_lancamentos_local`,
`outbox_financeiro` + scheduler, endpoints `/api/financeiro/lancamentos`,
`/resumo`, `/manual`, `/cancelar`, e `contas_receber_local` (criada na
Etapa 6 a partir das vendas fiado). Esta etapa fecha o ciclo expondo
Contas a Receber para leitura/baixa offline e adicionando trilha
forense financeira.

### Novidades (schema v21)

- **`contas_receber_pagtos_local`** — registra cada baixa (parcial/total)
  aplicada offline a um título de `contas_receber_local`. Insert + UPDATE
  do título acontecem na MESMA transação SQLite.
- **`financeiro_audit_local`** — trilha forense de
  `recebimento`/`pagamento`/`cancelamento`/`alterar_status` para
  receber/pagar/lancamento, com `status_anterior`/`status_atual`,
  `valor_pago`, `valor_restante`, operador/terminal/origem.
- **Funções Rust** (`src-tauri/src/db.rs`):
  `contas_receber_local_list`, `baixar_receber_local`,
  `cancelar_receber_local` — todas atômicas, idempotentes por `client_uuid`.
- **Endpoints HTTP** (`src-tauri/src/local_server.rs`):
  - `GET  /api/financeiro/receber?status=&cliente_id=&desde_ms=&ate_ms=&limit=`
  - `POST /api/financeiro/receber/baixar` — body: `BaixarReceberInput`
  - `POST /api/financeiro/receber/cancelar` — body: `CancelarReceberInput`
- **Logs DEV**: `[LOCAL_FINANCE]`, `[LOCAL_RECEIVABLE]`, `[LOCAL_PAYABLE]`
  (reservado), `[LOCAL_CASHFLOW]`, `[LOCAL_FINANCE_AUDIT]`,
  `[LOCAL_FINANCE_OUTBOX]`.

### Garantias

| Cenário | Garantia |
|---|---|
| Baixa offline duplicada (duplo clique) | Bloqueado por `uq_cr_pag_client_uuid` + early-return idempotente |
| Baixa excede valor restante | Erro `baixa excede o valor restante` antes do INSERT |
| Status derivado `vencido`/`parcial` | Calculado no read (não persistido) — não exige job de relógio |
| Cancelar título já cancelado | Idempotente — devolve `idempotente:true` sem novo audit |
| Reiniciar app | Tudo persiste em SQLite WAL; sync_status='pending' até a outbox confirmar |
| Terminal LAN | Adapter de terminal usa `/api/financeiro/*` no servidor central — sem acesso direto ao Supabase |

### Status do front-end

A camada de dados local e os endpoints estão prontos para serem consumidos
pelos hooks/adapters existentes (`hooks/useVendas`, telas `fiado.tsx` e
`relatorios.contas-receber.tsx`). A integração visual é aditiva e segue
o mesmo padrão dos demais módulos: o adapter local prioriza o servidor
local e usa cloud como fallback quando offline. Layout, regras
financeiras, Asaas, cobrança, planos, módulos e assinatura permanecem
inalterados.

---

## Sub-etapa 8.1 — Ligação das telas de Financeiro aos endpoints locais

Conecta de fato as telas existentes (`/fiado`, `RegistrarPagamentoDialog`,
relatórios) à camada local construída na Etapa 8, sem reescrever a UI.

### Mudanças

- **`src/integrations/desktop/serverConnection.ts`** — três fetchers HTTP:
  - `fetchContasReceberLocal(cfg, filtro)` → `GET /api/financeiro/receber`
  - `baixarReceberLocal(cfg, input)` → `POST /api/financeiro/receber/baixar`
  - `cancelarReceberLocal(cfg, input)` → `POST /api/financeiro/receber/cancelar`
  + tipos `ContaReceberLocalRow`, `BaixarReceberLocalInput/Result`,
  `CancelarReceberLocalInput/Result`, `ContasReceberLocalFiltro`.

- **`src/integrations/data/adapters/local-terminal.ts`** (terminal LAN) e
  **`src/integrations/data/adapters/local-server.ts`** (PC servidor):
  override do bloco `financeiro` com três métodos:
  - `listFiado()` → tenta local primeiro; mapeia
    `ContaReceberLocalRow → FiadoLancamentoDomain`. Se a lista local vier
    vazia (ainda não houve fiado offline) ou o servidor local estiver
    inacessível, faz fallback para a cloud.
  - `registrarPagamento(input)` → tenta `baixar_receber_local`. Se o
    título não existe localmente (ids de origem cloud) ou o local está
    fora, faz fallback para `cloudAdapter.financeiro.registrarPagamento`.
    Idempotência é preservada via `client_uuid` em ambos os caminhos.
  - `cancelarLancamento(input)` → mesmo padrão, tenta
    `cancelar_receber_local` primeiro.

### Indicador discreto de sincronização

A coluna `sync_status` do título local (`synced` | `pending` | `error`)
é injetada no campo `observacoes` da `FiadoLancamentoDomain` como
prefixo `[sync:pending]` ou `[sync:error]` apenas quando não está
`synced`. Telas existentes que renderizam observações já mostram o
indicador sem alteração de layout.

### Ordem de prioridade (mantida)

1. Endpoint local (`/api/financeiro/receber*`)
2. Cache/local data (já coberto pelos endpoints, que leem SQLite)
3. `cloudAdapter` — somente quando online e local indisponível/sem dados

Nenhum caminho dispara cloud primeiro em modo desktop/local.

### Logs DEV adicionados

- `[LOCAL_RECEIVABLE_UI]` — chamadas de leitura/baixa/cancelamento via
  servidor local nos adapters.
- `[LOCAL_FINANCE_UI]` / `[LOCAL_CASHFLOW_UI]` — reservados para
  futuras telas de fluxo de caixa quando passarem a consumir
  `/api/financeiro/lancamentos` e `/api/financeiro/resumo`
  diretamente. Os endpoints já existem desde a Etapa 8.

### Garantias (atualização)

| Cenário | Comportamento |
|---|---|
| PDV faz venda fiado offline | Já gravava `contas_receber_local`; agora aparece em `/fiado` direto do local |
| Baixa parcial/total offline | UI chama `dataClient.financeiro.registrarPagamento` → adapter detecta modo local e usa `POST /api/financeiro/receber/baixar` |
| Cancelamento offline | Mesmo caminho via `POST /api/financeiro/receber/cancelar` |
| Reiniciar app | Dados persistem em SQLite WAL; sync_status indicado discretamente |
| Sincronizar depois | Outbox financeira (`outbox_financeiro`) cuida do push — sem duplicar baixas (idempotência por `client_uuid`) |
| Online sem fiado local | Cai automaticamente para cloud (sem regressão para usuários só-cloud) |

### Não alterado

- Layout principal das telas `/fiado`, relatórios e dialog de pagamento.
- Regras financeiras, cobrança SaaS, Asaas, planos, módulos e assinatura.
- Estrutura do `dataClient` exposto à UI — a troca acontece somente
  dentro do adapter selecionado em runtime conforme modo (cloud,
  servidor local, terminal LAN).

---

## Etapa 9 — Compras, Fornecedores e Contas a Pagar offline-first

### O que esta etapa entrega

Fornecedores e compras já tinham infraestrutura completa nas etapas
anteriores (offline-first com `outbox_fornecedores` / `outbox_compras`,
recebimento de mercadoria atomicamente com entrada de estoque,
idempotência por `client_uuid`, colapso de ações e causalidade
entre `criar` → demais ações). A Etapa 9 adiciona o que faltava:
**Contas a Pagar offline geradas por compras a prazo**, com baixa,
cancelamento e auditoria locais.

### Mudanças

- **Schema v22 (`db.rs`)**:
  - `contas_pagar_local`: título de contas a pagar com vínculo lógico
    para `compras_local` via `compra_local_uuid`. Inclui `valor`,
    `valor_pago`, `vencimento_ms`, `status` base e `sync_status`.
  - `uq_contas_pagar_origem_compra`: índice único que impede duplicar
    um título por retry de recebimento ou re-execução do trigger
    remoto.
  - `contas_pagar_pagtos_local`: cada baixa parcial/total, deduplicada
    por `client_uuid`.
- **Geração atômica via compra**:
  - `compra_receber_local` e `compra_receber_itens_local` chamam
    `criar_pagar_from_compra_tx` na MESMA transação SQLite quando
    `gerar_financeiro=true` e há `data_vencimento`. Garante
    atomicidade entre estoque + payable.
- **Operações offline**:
  - `contas_pagar_local_list` — leitura com `status` derivado
    (vencido/parcial) em tempo de read, sem dependência de relógio.
  - `baixar_pagar_local` — baixa parcial ou total, atualiza título,
    grava pagamento + auditoria atomicamente.
  - `cancelar_pagar_local` — cancelamento idempotente com auditoria.
- **HTTP endpoints (`local_server.rs`)**:
  - `GET /api/financeiro/pagar` — listagem com filtros
    `status` / `fornecedor_id` / `compra_id` / `desde_ms` / `ate_ms`.
  - `POST /api/financeiro/pagar/baixar` — body `BaixarPagarInput`.
  - `POST /api/financeiro/pagar/cancelar` — body `CancelarPagarInput`.
- **Logs DEV**:
  - `[LOCAL_PURCHASE]`, `[LOCAL_PURCHASE_STOCK]`,
    `[LOCAL_PURCHASE_OUTBOX]` em handlers de compras.
  - `[LOCAL_PAYABLE]` em handlers de contas a pagar.
  - `[LOCAL_FINANCE_AUDIT]`, `[LOCAL_CASHFLOW]` no fluxo de baixa.
  - `[LOCAL_SUPPLIER]` em handlers de fornecedores (já existente
    via outbox de fornecedores).

### Garantias

| Requisito                                | Como é garantido                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Fornecedor offline (CRUD)                | `outbox_fornecedores` + `fornecedor_*_local` (Etapas anteriores)                              |
| Compra offline (cabeçalho + itens)       | `compras_local` + `compra_itens_local` + `outbox_compras` (Etapas anteriores)                 |
| Entrada de estoque por compra            | `compra_apply_recebimento_item` atomicamente com UPDATE de saldo + `estoque_movimentacoes_local` |
| Contas a pagar por compra a prazo        | `criar_pagar_from_compra_tx` na mesma TX de `compra_receber_local`                            |
| Baixa de pagar offline                   | `baixar_pagar_local` (TX atômica: pagto + título + auditoria)                                 |
| Idempotência de criação                  | `uq_contas_pagar_origem_compra` (1 título por compra)                                         |
| Idempotência de baixa                    | `uq_cp_pag_client_uuid` (1 baixa por `client_uuid`)                                           |
| Retry sem duplicar                       | Outbox + `client_uuid` end-to-end; recheck por chave única antes de inserir                   |
| Terminal LAN                             | Terminal chama `/api/compras/*`, `/api/fornecedores/*`, `/api/financeiro/pagar/*` no servidor local; o servidor central grava SQLite e enfileira outbox |
| Reinício do app preserva dados           | SQLite + WAL; nada é mantido em memória                                                       |
| Cloud como sincronização secundária      | `outbox_compras` (causal — `receber` só sai após `criar` resolver `remote_id`); pagar local atualiza UI imediata e converge ao backfill do upstream |

### Fora de escopo desta etapa

- Wiring direto da UI de Contas a Pagar nos novos endpoints
  (`/api/financeiro/pagar`) — a UI atual já consome
  `listLancamentosCompleto` (cache local), e os novos endpoints
  expõem dados específicos para integração futura sem mudar layout.
- Regras de negócio, cobrança, planos, Asaas, módulos, layout
  principal — intocados.

---

## Etapa 15 — Checklist final de release offline

Rotina obrigatória antes de gerar nova versão para o cliente. Todos os
itens devem ser validados manualmente no ambiente de homologação **com o
cabo de rede desconectado** (exceto onde indicado).

### Bateria operacional (sem internet)

- [ ] **Login ERP offline** — abrir o app sem rede e autenticar com
      credenciais já salvas localmente.
- [ ] **PIN PDV offline** — entrar no PDV usando o PIN do operador.
- [ ] **Abrir caixa offline** — abertura grava em SQLite e fica visível
      após reiniciar o app.
- [ ] **Vender offline** — venda à vista, baixa de estoque local,
      cupom impresso.
- [ ] **Venda fiado offline** — gera conta a receber local atrelada ao
      cliente.
- [ ] **Baixar cliente a receber offline** — recebimento atualiza
      status local e cai no caixa aberto.
- [ ] **Registrar compra offline** — entrada de mercadoria aumenta
      estoque local.
- [ ] **Compra gera contas a pagar** — compra a prazo cria título em
      Contas a Pagar (1 título por compra, idempotente).
- [ ] **Baixar conta a pagar offline** — pagamento atualiza status do
      título sem internet.
- [ ] **Fechar caixa offline** — fechamento consolida totais e mantém
      histórico local após restart.
- [ ] **Backup local** — gerar backup manual em Configurações → Desktop
      e abrir a pasta destino.
- [ ] **Restore backup** — restaurar um backup recente; o app reinicia
      e os dados aparecem corretos.
- [ ] **Sincronizar depois** — religar a internet e rodar a
      sincronização: nada duplica, conflitos ficam visíveis.
- [ ] **Terminal LAN conectado ao servidor** — caixa secundário grava
      vendas/caixa pelo servidor local (sem usar a nuvem).

### Diagnóstico automático

Antes do checklist manual, rodar:

> **Configurações → Desktop → Diagnóstico offline → "Executar diagnóstico offline"**

O painel deve fechar com um dos veredictos:

| Veredito                  | Significado                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- |
| **Pronto para uso offline** | Todos os checks verdes — pode liberar a versão.                                |
| **Atenção**               | Há avisos (ex.: outboxes acumuladas, backup antigo). Revise antes de liberar.   |
| **Erro crítico**          | SQLite corrompido, servidor parado, sync inicial pendente ou cache vazio.       |

Verificações cobertas pelo diagnóstico:

- SQLite (integridade + tamanho + journal mode);
- Servidor local Rust (running + porta);
- Status do backup (último backup conhecido);
- Sincronização agregada (pendentes / erros / conflitos);
- Outboxes pendentes (totais acumulados);
- Sincronização inicial (`/api/offline/status`);
- PIN do PDV preparado (usuários com PIN sincronizados);
- Produtos no cache local (>0);
- Estoque no cache local (>0);
- Caixa local (informativo).

### Fora de escopo desta etapa

- Regras de negócio, telas principais, Supabase, cloudAdapter,
  cobrança, planos, módulos, Asaas — intocados.

---

## Etapa 16 — Produtos & Categorias local-first (Fase 1 do ajuste global)

Concluída a primeira onda do ajuste global "**Desktop é local-first.
Cloud é sincronização secundária**" focando em Produtos, Categorias e
Códigos (barras/PLU/QR). Áreas críticas de PDV/Caixa/Financeiro foram
deliberadamente adiadas para fases posteriores.

### O que mudou

| Camada | Arquivo(s) | Mudança |
| --- | --- | --- |
| Migração SQL | `supabase/migrations/2026...produtos_idempotencia.sql` | RPCs `criar_produto` / `criar_categoria_produto` aceitam `_produto_id` / `_categoria_id_in` + `_client_uuid` (idempotência por id do cliente) |
| Cloud adapter | `src/integrations/data/adapters/cloud.ts`, `types.ts` | Propaga `produto_id` / `categoria_id` / `client_uuid` para as RPCs |
| Schema local (Rust) | `src-tauri/src/db.rs` (v24) | Tabelas `produtos_local`, `categorias_produto_local`, `outbox_produtos`, `outbox_categorias_produto` + índices únicos por `client_uuid` |
| Lógica local (Rust) | `src-tauri/src/db.rs` | `produto_criar_local`, `produto_enqueue_action` (editar / alterar_status / excluir-soft), helpers de resolução `local_uuid` ↔ `remote_id`, propagador causal categoria→produto |
| Servidor LAN | `src-tauri/src/local_server.rs` | Handlers `/api/produtos/{criar,editar,alterar-status,excluir}` e `/api/categorias-produto/*`; schedulers de outbox dedicados (drenam só quando há internet, sem duplicar) |
| Bridge TS | `src/integrations/desktop/serverConnection.ts` | `criar/editar/alterarStatus/excluirProdutoLocal` + variantes para categorias |
| Adapters | `src/integrations/data/adapters/local-terminal.ts`, `local-server.ts` | Mutations passam a tentar o servidor LAN primeiro; em falha, caem para `cloudAdapter` (fallback transparente) |
| Hooks | `src/hooks/useProdutos.ts` | `useCreateProduto / useUpdateProduto / useDeleteProduto / useCreateCategoria` agora geram `client_uuid` + id no cliente e aplicam **patch otimista** no React Query (rollback em erro) |

### Garantias

- **Local-first**: criação, edição, troca de status e exclusão de
  produtos/categorias gravam primeiro em SQLite, geram outbox e a UI
  reflete na hora (cache otimista do React Query).
- **Idempotência ponta-a-ponta**: `client_uuid` único por ação +
  `produto_id` / `categoria_id` gerados no cliente garantem que retries
  não duplicam.
- **Causalidade categoria → produto**: produto criado offline
  referenciando uma categoria local pendente só vai para o cloud depois
  que o `remote_id` da categoria resolve (propagador automático).
- **Reads já eram local-first** (`/api/produtos/list`,
  `/api/produtos/buscar-codigo`, `/api/produtos/buscar-plu`) — esta fase
  fecha o ciclo cobrindo também as escritas.

### Próximas fases (planejadas, **não** executadas nesta rodada)

1. Funcionários / operadores local-first (PIN seguro + outbox).
2. Configurações de empresa, logo, preferências e dados do servidor /
   terminais local-first.
3. Clientes / Fornecedores local-first (mesmo padrão de Produtos).
4. *Adiado por risco*: PDV, Caixa e Financeiro — só serão tocados após
   bateria completa de testes do que já está offline.

## Etapa 17 — Configurações da Empresa offline-first (camada 1 do plano global)

- Sem migração no SQLite: configurações de empresa são um único registro
  por owner, então uma camada TS leve resolve sem o custo/risco de uma
  nova tabela + outbox no Rust.
- Novo helper `src/lib/configEmpresaOfflineCache.ts`:
  * `getCachedConfigEmpresa(userId)` / `setCachedConfigEmpresa` —
    persistência em `localStorage` por user_id.
  * `mergeCachedConfigEmpresa(userId, patch)` — merge otimista usado
    pelo `onMutate`.
  * Fila de pendências `enqueue/get/clearConfigEmpresaPending(userId)`
    com semântica "last-write-wins".
  * `isNetworkLikeError(err)` para distinguir falha de rede de erro de
    validação.
- `useConfigEmpresa` agora é offline-first:
  * `initialData` lido do cache local (UI instantânea, mesmo sem rede).
  * `queryFn` tenta nuvem; em falha de rede devolve cache; em sucesso
    atualiza cache e tenta drenar pendência.
- `useSalvarConfigEmpresa` cobre os 3 cenários:
  * Online OK → grava cloud + cache + limpa fila.
  * Offline → grava cache otimista, enfileira pendência e devolve
    sucesso (UI não bloqueia).
  * Erro não-rede → rollback do cache do React Query + toast.
- Novo hook `useFlushConfigEmpresaPending` plugado em `AppLayout` —
  drena a fila ao montar, ao ganhar foco (`window.focus`) e quando a
  rede volta (`window.online`).

## Etapa 18 — Funcionários offline-first (camada 2 do plano global)

- A infra Rust já existia (v23): `funcionarios_remote_cache` +
  `outbox_funcionarios` com ações `criar | editar | resetar_pin |
  alterar_status | excluir`, handlers HTTP em `local_server.rs`
  (`/api/funcionarios/*`), worker que drena para Supabase via RPC.
- O adapter de TERMINAL (`local-terminal.ts`) já cobria todas as ações
  via servidor LAN. O que faltava era a MÁQUINA-SERVIDOR fazer o mesmo:
  agora `local-server.ts` também roteia `editar`, `alterarStatus`,
  `excluir` e `resetarPin` para `postLocalAuth(...)` (mesmo padrão de
  produtos/categorias). Cloud só entra como último recurso.
- `useEditarFuncionario`, `useToggleFuncionarioAtivo` e
  `useExcluirFuncionario` ganharam `onMutate` otimista com snapshot
  de TODAS as queries `["funcionarios", ...]` (cobre lista admin +
  lista de ativos do PDV) e rollback em `onError`.
- `useResetarPinFuncionario` mantém invalidação simples (mudança de
  PIN não tem reflexo visual na lista).
- PIN continua tratado de forma segura ponta-a-ponta: nunca persistido
  em texto, hash PBKDF2 no SQLite local + bcrypt no Postgres remoto;
  `aquecerPinServidor` continua propagando o verificador para os outros
  terminais LAN.

## Etapa 19 — Clientes/Fornecedores offline-first (camada 3 do plano global)

- A infra Rust já tinha tudo: `clientes_local` / `fornecedores_local`,
  `outbox_clientes` / `outbox_fornecedores`, handlers HTTP em
  `/api/clientes/{criar,editar,alterar-status,excluir}` e equivalentes
  para fornecedores, worker drenando para Supabase via RPC. Adapter
  de TERMINAL (`local-terminal.ts`) já roteava tudo para LAN.
- O que faltava era a MÁQUINA-SERVIDOR agir do mesmo jeito. Agora
  `local-server.ts` roteia `criar/editar/alterarStatus/excluir` de
  clientes e fornecedores via `postLocalAuth(...)` com fallback cloud
  só como último recurso (mesmo padrão de produtos/funcionários).
  `reportDataSource` marca a origem real em cada chamada.
- `useToggleClienteStatus` e `useDeleteCliente` ganharam `onMutate`
  otimista com snapshot de TODAS as queries `["clientes"]` e
  `["clientes-lite"]` (cobre tela de gerenciamento + selects do PDV),
  com rollback completo em `onError`.
- `useToggleFornecedorStatus` e `useDeleteFornecedor` seguem o mesmo
  padrão sobre `["fornecedores"]`.
- Criação/edição continuam invalidando + refetch (precisamos do id
  vindo do servidor antes de exibir o registro completo) — a gravação
  em si já é local-first via SQLite + outbox.

## Etapa 20 — Estoque/Movimentações offline-first (camada 4 do plano global)

- Leituras (`saldosLinhas`, `movimentacoes`) já eram local-first via
  SQLite (`/api/estoque/saldos`, `/api/estoque/movimentacoes`).
- O write `registrarMovimento` no `local-server.ts` agora também é
  local-first: roteia para `POST /api/estoque/movimentacoes/registrar`
  do servidor Rust desta máquina, que grava em `movimentacoes_local`,
  recalcula saldo no SQLite e enfileira no outbox para sincronizar
  com a RPC `registrar_movimento_estoque`. Cloud só como fallback.
- `useCriarMovimentacao` ganhou `onMutate` otimista: aplica o delta
  (entrada/devolução = +qty, saída/transferência = −qty) sobre todas
  as queries `["estoque-saldos"]` imediatamente, com snapshot e
  rollback em `onError`. UI mostra o novo saldo antes da resposta do
  servidor; `onSuccess` ainda invalida `estoque-saldos / movimentacoes
  / produtos` para reconciliar com o cálculo autoritativo do backend.
- Idempotência preservada: `client_uuid` por modal cobre duplo clique,
  e o `local_uuid` gerado pelo Rust cobre retries cross-runs.
