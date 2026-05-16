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
