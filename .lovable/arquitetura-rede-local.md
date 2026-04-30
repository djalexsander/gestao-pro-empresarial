# Arquitetura Desktop em Rede Local — Gestão Pro

> Documento técnico (não-destrutivo). Serve de roteiro para a evolução do sistema
> da arquitetura **100% cloud** atual para um modelo **desktop em rede local
> com servidor principal na loja + terminais clientes + sync opcional com nuvem**.

---

## PARTE 1 — Diagnóstico da arquitetura atual

### 1.1 Onde os dados estão hoje
- **100% na nuvem (Lovable Cloud / Postgres gerenciado)**.
- Todo terminal (PDV, ERP, painel admin) acessa o **mesmo banco remoto** via HTTPS + RLS.
- Não há cache local persistente nem banco embarcado.
- Sessão do usuário, terminal selecionado e operador ficam em `localStorage` por dispositivo (`gp.terminal:<userId>`, `erpUnlock`, etc.) — mas **dados de negócio sempre vão à nuvem**.

### 1.2 Como o sistema busca informação
| Recurso | Caminho atual |
|---|---|
| Produtos / busca por código de barras | `useProdutoCodigo`, `useProdutoPorPlu` → `supabase.from('produtos')` direto na nuvem |
| Vendas | `useVendas` → insert/select na nuvem |
| Estoque | `estoque_movimentacoes` na nuvem, atualizado por triggers SQL |
| Caixa | `caixas` + `caixa_movimentos` na nuvem |
| Financeiro | `financeiro_lancamentos` + `lancamento_pagamentos` na nuvem |
| Realtime entre terminais | `useRealtimeSync` via Supabase Realtime (WebSocket cloud) |
| Heartbeat de terminal | `terminal_heartbeat` RPC na nuvem |

### 1.3 Dependências críticas da nuvem
- **RLS multi-tenant** (`acessa_owner_id`, `is_super_admin`) — toda segurança está no Postgres remoto.
- **Realtime** — sincronização entre caixas depende de WebSocket cloud.
- **Storage** (`empresa-logos`).
- **Edge functions / server functions** (`asaas-webhook`, `criar-socio`, cobranças PIX).
- **Auth Supabase** — login, recuperação de senha, HIBP.

### 1.4 Módulos impactados por uma migração para rede local
| Módulo | Impacto | Observação |
|---|---|---|
| Produtos | **Alto** | Precisa cache/replica local para leitura instantânea de scanner |
| Estoque | **Alto** | Concorrência crítica entre caixas |
| PDV | **Crítico** | Precisa funcionar mesmo com internet ruim |
| Caixas | **Alto** | Abertura/fechamento + movimentos por terminal |
| Vendas | **Crítico** | Gravação imediata + reflexo em estoque |
| Clientes | Médio | Leitura frequente, escrita esporádica |
| Financeiro / CR / CP | Médio | Pode tolerar pequena latência |
| Usuários / permissões | Alto | Auth precisa funcionar sem internet (cache de roles) |
| Terminais | Alto | Heartbeat + permissões precisam funcionar local |
| SaaS / cobranças / Asaas | Baixo | **Continua na nuvem** (faturamento do SaaS) |
| Auditoria / super admin | Baixo | **Continua na nuvem** |

---

## PARTE 2 — Arquitetura-alvo

```
                 ┌──────────────────────────────────────────┐
                 │            ☁  LOVABLE CLOUD             │
                 │  (Auth, billing SaaS, backup, super    │
                 │   admin, relatórios remotos, Asaas)    │
                 └──────────────▲───────────────────────────┘
                                │ Sync bidirecional
                                │ (fila + delta + conflitos)
                                │ — opcional, tolerante a falha
                 ┌──────────────┴───────────────────────────┐
                 │       🖥  SERVIDOR LOCAL DA LOJA        │
                 │  ┌────────────────────────────────────┐  │
                 │  │  Postgres local (base principal)  │  │
                 │  │  + réplica de schema da nuvem     │  │
                 │  └────────────────────────────────────┘  │
                 │  ┌────────────────────────────────────┐  │
                 │  │  API local (Node/Bun + REST/WS)   │  │
                 │  │  • Auth local (cache de sessão)   │  │
                 │  │  • RLS espelhada via middleware   │  │
                 │  │  • Broadcast realtime LAN         │  │
                 │  │  • Worker de sync com a nuvem     │  │
                 │  └────────────────────────────────────┘  │
                 │  Electron shell "Modo Servidor"          │
                 └──────▲────────────▲────────────▲─────────┘
                        │ LAN        │ LAN        │ LAN
                        │ (HTTP+WS)  │            │
                ┌───────┴────┐ ┌─────┴──────┐ ┌───┴────────┐
                │ Caixa 01   │ │ Caixa 02   │ │ Balcão/ERP │
                │ Electron   │ │ Electron   │ │ Electron   │
                │ "Terminal" │ │ "Terminal" │ │ "Terminal" │
                └────────────┘ └────────────┘ └────────────┘
```

### 2.1 Camadas

| Camada | Responsabilidade |
|---|---|
| **Banco local (Postgres no servidor)** | Fonte da verdade operacional do dia: produtos, estoque, vendas, caixas, financeiro |
| **API local** | Expõe REST + WebSocket na LAN. Aplica regras de negócio, RLS e autenticação. Único ponto que fala com o Postgres local |
| **App desktop "Servidor"** | Electron rodando no PC da loja. Hospeda API local + worker de sync. Pode operar como terminal também |
| **App desktop "Terminal"** | Electron nos caixas. **Não tem banco próprio**, fala só com a API local. Cache leve em IndexedDB para resiliência momentânea |
| **Sync cloud (opcional)** | Worker no servidor envia/recebe deltas para a nuvem. Faturamento SaaS, backup, dashboards remotos, super admin continuam **lá** |

### 2.2 Por que **não** colocar banco em cada terminal
- Concorrência de estoque vira pesadelo (vendas duplicadas, estoque negativo).
- Sync N×N entre caixas é frágil.
- Modelo **N terminais → 1 servidor local** é o padrão de PDV de mercado (Linx, Bematech, PDV Legal etc.).

---

## PARTE 3 — Banco local principal

### 3.1 Tecnologia recomendada
**PostgreSQL local** instalado no PC servidor. Justificativas:
- Schema **idêntico** ao da nuvem → sync trivial, sem tradutor.
- RLS, triggers, funções `acessa_owner_id`, `has_role` funcionam iguais.
- Multiusuário robusto, MVCC, locks linha-a-linha → ideal para vários caixas.
- Backup com `pg_dump` / `pg_basebackup`.
- Pode rodar como serviço Windows/Linux.

**Descartados:**
- SQLite → péssimo com concorrência de escrita (lock de arquivo).
- IndexedDB no terminal → bom só como cache, não como base.
- Firebird/MySQL → exigiria reescrever todas as policies/triggers.

### 3.2 Distribuição
- Instalador do "Modo Servidor" embute Postgres portable + cria DB `gestao_pro_local`.
- Migrations versionadas em `supabase/migrations/` aplicadas localmente pelo mesmo runner.
- Schema clonado da nuvem na primeira instalação (`pg_dump --schema-only`).

### 3.3 Concorrência
- Estoque: usar `SELECT … FOR UPDATE` na linha do produto durante baixa de venda (já compatível com triggers atuais).
- Numeração de venda/caixa: sequence Postgres por `owner_id`.
- Idempotência: toda venda recebe `client_uuid` gerado no terminal → previne duplicação se rede LAN cair no meio.

---

## PARTE 4 — Terminais clientes

### 4.1 Conceito
- Terminal = Electron + React (o app atual quase sem mudança).
- Em vez de `supabase.from(...)` direto na nuvem → fala com **API local** via cliente abstraído.
- Descobre o servidor por: configuração manual (IP/porta) **ou** mDNS/Bonjour (`gestao-pro-server.local`).
- Mantém o conceito atual de `TerminalProvider` + `OperadorProvider` (PIN) — só muda a URL base.

### 4.2 Cache local do terminal
- IndexedDB com:
  - tabela `produtos` (read-only, atualizada por push do servidor) → busca instantânea por código de barras mesmo se LAN piscar.
  - fila `vendas_pendentes` para o caso de o servidor cair durante uma venda → ressincroniza ao voltar.
- **Nunca** fonte da verdade. Sempre reconcilia com servidor.

### 4.3 Realtime LAN
- Substituir Supabase Realtime por **WebSocket no servidor local** (`ws://servidor.local:PORT/realtime`).
- Mesma API mental do hook `useRealtimeSync` → migração transparente.

---

## PARTE 5 — Nuvem opcional

### 5.1 O que **continua sempre na nuvem**
- Auth do SaaS (multi-tenant, recuperação de senha, HIBP).
- `empresas`, `empresa_assinaturas`, `pagamentos`, `asaas_webhook_eventos`.
- Painel super admin (`/admin`).
- Auditoria global.
- Storage de logos.

### 5.2 O que vai para o servidor local
- `produtos`, `produto_variacoes`, `produto_codigos`, `lotes_produto`, `categorias_produto`
- `clientes`, `fornecedores`
- `caixas`, `caixa_movimentos`
- `vendas`, `venda_itens`
- `estoque_movimentacoes`
- `compras`, `compra_itens`
- `financeiro_lancamentos`, `lancamento_pagamentos`, `categorias_financeiras`
- `funcionarios`, `terminais`

### 5.3 Sync bidirecional
- Worker no servidor com fila `outbox` + `inbox`.
- Estratégia **Last-Write-Wins por `updated_at`** para cadastros, **append-only com idempotência** para vendas/movimentos.
- Conflito resolvido por regra de domínio (ex: estoque sempre prevalece o do servidor local da loja onde a venda ocorreu).
- Sync pode pausar/retomar sem perder dados (fila persistente).

---

## PARTE 6 — Regras de operação

1. **Toda escrita operacional** (venda, baixa de estoque, abertura/fechamento de caixa) → servidor local **primeiro**.
2. Terminal só confirma a venda ao cliente após `ACK` do servidor local.
3. Se servidor local cair: terminal entra em **modo degradado** (consulta cache, enfileira venda em IndexedDB, alerta visual). Nunca opera "às cegas".
4. Cadastro de produto no servidor → broadcast WS → todos os terminais atualizam cache em <1s.
5. Sync com nuvem é **assíncrono** e **não bloqueia operação**.

---

## PARTE 7 — Adaptações necessárias no código atual

### 7.1 Camada de abstração (a criar)
Criar **um único ponto** que hoje todo o app já usa de fato — `@/integrations/supabase/client` — e introduzir um **adapter**:

```
src/integrations/data/
  ├── client.ts            ← interface única (getProdutos, criarVenda, …)
  ├── adapters/
  │     ├── cloud.ts       ← implementação atual (Supabase remoto)
  │     ├── local.ts       ← futura (API local LAN)
  │     └── hybrid.ts      ← futura (local + sync cloud)
  └── mode.ts              ← detecta modo: 'cloud' | 'local-server' | 'local-terminal'
```

Hoje os hooks (`useProdutos`, `useVendas`, etc.) chamam `supabase` direto. A refatoração é **gradual**: começar pelos hooks mais críticos (PDV, produtos, estoque) movendo-os para o adapter; o resto continua chamando Supabase direto sem quebrar nada.

### 7.2 Pontos que precisam adaptar
| Arquivo / módulo | Adaptação |
|---|---|
| `src/integrations/supabase/client.ts` | Mantém (modo cloud). Não editar — gerado |
| `src/hooks/useProdutos.ts`, `useProdutoCodigo.ts` | Mover para adapter |
| `src/hooks/useVendas.ts` | Mover para adapter + idempotência por `client_uuid` |
| `src/hooks/useEstoque.ts` | Mover para adapter |
| `src/hooks/useCaixa.ts` | Mover para adapter |
| `src/hooks/useRealtimeSync.ts` | Abstrair fonte realtime (cloud WS ↔ LAN WS) |
| `src/hooks/useTerminalConexao.ts` | Já é o lugar ideal para indicar modo (cloud/local) e qualidade da LAN |
| `src/components/auth/AuthProvider.tsx` | Cache de sessão local para login offline |
| `supabase/migrations/*` | Reaproveitadas no servidor local sem mudança |

### 7.3 O que **não muda**
- Toda a UI (componentes, rotas, design).
- Schemas e RLS.
- Fluxo de auth, operador (PIN), terminal selecionado.
- Lógica de negócio dos componentes.

---

## PARTE 8 — Migração por fases (segura, não-destrutiva)

### **Fase 0 — Hoje**
✅ App cloud funcionando. Não mexer.

### **Fase 1 — Preparação da arquitetura (sem quebrar nada)**
- Criar `src/integrations/data/` com interface única.
- Adapter `cloud.ts` apenas reexporta o Supabase atual.
- Migrar **um hook por vez** (começar por `useProdutoCodigo` — leitura simples).
- Adicionar `client_uuid` em vendas (idempotência) — já útil em produção cloud.
- Entrega: zero mudança visível ao usuário.

### **Fase 2 — Modo Desktop (Electron shell)**
- Empacotar app atual em Electron (`@electron/packager`).
- Continua falando com a nuvem.
- Configurar `base: './'` no Vite, ajustes de rota.
- Distribuir `.exe` / `.dmg` / `.AppImage`.
- Entrega: clientes podem usar o app instalado, sem navegador.

### **Fase 3 — Modo Servidor Local (sem terminais ainda)**
- Instalador embute Postgres + roda API local (Bun + Hono ou Fastify).
- Schema clonado da nuvem.
- App em "Modo Servidor" usa `local.ts` como adapter.
- Worker de sync inicial **só puxa** dados da nuvem (one-way).
- Entrega: loja pode operar local com 1 PC.

### **Fase 4 — Terminais conectados ao servidor local**
- App em "Modo Terminal" descobre servidor (mDNS) e usa API local.
- Realtime LAN via WS do servidor.
- Cache IndexedDB nos terminais para scanner instantâneo.
- Fila de vendas pendentes para resiliência.
- Entrega: arquitetura-alvo funcionando 100% local.

### **Fase 5 — Sync bidirecional opcional com a nuvem**
- Worker envia deltas para nuvem (vendas, estoque, financeiro).
- Painel admin remoto continua funcionando como hoje.
- Backup automático.
- Entrega: melhor dos dois mundos.

---

## Validação final — resposta direta às suas perguntas

**Como ficará a arquitetura futura:**
Servidor local Postgres + API local na loja → terminais Electron na LAN → sync opcional com nuvem.

**O que continua na nuvem:**
Auth SaaS, faturamento (Asaas), super admin, auditoria global, backup, dashboards remotos, storage de logos.

**O que vai para o servidor local:**
Produtos, estoque, vendas, caixas, clientes, fornecedores, financeiro, compras, terminais, funcionários.

**Como os terminais se conectam:**
HTTP + WebSocket via LAN, descoberta por mDNS ou IP fixo configurável. Nunca têm banco próprio.

**Quais módulos precisam mudar (ordem de criticidade):**
1. Camada de acesso a dados (adapter) — base de tudo
2. Produtos / scanner
3. Vendas (idempotência)
4. Estoque (lock)
5. Caixa
6. Realtime
7. Auth (cache de sessão)

**Melhor ordem de implementação:**
Fase 1 (adapter) → Fase 2 (Electron) → Fase 3 (servidor local) → Fase 4 (terminais) → Fase 5 (sync cloud). Cada fase é entregável de forma independente, sem quebrar a anterior.

---

**Próximo passo recomendado:** começar pela **Fase 1** — criar `src/integrations/data/` e migrar `useProdutoCodigo` como prova de conceito. Isso já entrega valor (testabilidade, organização) e prepara terreno sem qualquer risco para a operação atual.
