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
