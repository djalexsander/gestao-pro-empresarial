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
