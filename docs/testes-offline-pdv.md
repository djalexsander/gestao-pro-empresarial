# Testes de concorrência e offline — Gestão Pro

> Checklist versionado (PROMPT 13). Cobre os fluxos críticos de PDV,
> estoque, caixa, outbox, compras e split-brain. Deve ser executado a
> cada release desktop e sempre que `db/`, `local_server`, `adapters/`,
> `hooks/useCaixa.ts`, `hooks/useVendas.ts`, `hooks/useCompras.ts` ou
> `useOutboxPendingSummary.ts` forem alterados.
>
> Nenhum teste aqui depende de Supabase real para o caminho local; os
> que validam sync para a nuvem usam um ambiente de homologação.

## Como rodar

### 1. Testes automatizados (Rust)

```bash
cd src-tauri
cargo test -p gestao-pro --lib
```

Cobre hoje: helpers puros (`db::helpers`) e curva de backoff da outbox.
Sem dependência de SQLite/Tauri/rede.

### 2. Testes frontend automatizados

Ainda **não há runner** instalado (vitest/jest). Ver seção "Próximos
passos" no final.

### 3. Checklist manual

Use as seções A–E abaixo. Marque [x] após cada execução e registre
data + build no rodapé do release.

---

## Pré-requisitos do ambiente de teste

- Build desktop assinada (`npm run tauri:build:signed`) **ou** `tauri dev`.
- Banco local limpo (apagar `gestao-pro.sqlite` em `%APPDATA%/com.gestao-pro/`
  ou diretório equivalente do SO — fazer backup antes).
- Empresa de teste com pelo menos: 1 produto com estoque controlado,
  1 cliente cadastrado, 1 fornecedor, 1 categoria.
- Acesso a um ambiente Supabase de homologação (não usar produção).
- Capacidade de cortar a internet (modo avião, desligar Wi-Fi ou bloquear
  no firewall as URLs `*.supabase.co`).

---

## A) Estoque e venda

### A1. Saldo 1 — venda de 2 unidades falha
1. Garantir produto `P-TEST` com `estoque_atual = 1`.
2. PDV: tentar finalizar venda com 2× `P-TEST`.
3. **Esperado**: erro claro "estoque insuficiente"; nenhuma baixa; saldo
   continua 1; nenhuma linha em `outbox` (online) ou `outbox_vendas`
   (offline).

### A2. Concorrência — duas vendas simultâneas do último item
1. Garantir saldo `= 1`.
2. Abrir 2 terminais (ou 2 instâncias do app) apontando para o **mesmo
   servidor local**.
3. Em ambos, adicionar `P-TEST` ao carrinho.
4. Finalizar nas duas janelas no mesmo instante (Ctrl+Enter coordenado).
5. **Esperado**: exatamente 1 venda concluída, 1 falha com "estoque
   insuficiente". Saldo final = 0. Nenhuma venda fantasma na listagem.

### A3. Idempotência — retry da mesma venda
1. Finalizar venda de `P-TEST` (qty=1).
2. No DevTools/console, disparar `dataClient.vendas.finalizar` novamente
   com o **mesmo `client_uuid`** (capturar do payload anterior).
3. **Esperado**: segunda chamada retorna o `venda_id` da primeira
   (`idempotente=true`); estoque cai apenas 1 vez; outbox não duplica.

### A4. Cancelamento devolve estoque
1. Venda confirmada de `P-TEST` (qty=2), saldo antes = 5.
2. Cancelar venda em "Vendas" com motivo.
3. **Esperado**: saldo volta a 5; aparece 1 movimento de estorno em
   "Estoque > Movimentações"; financeiro associado também é estornado.

---

## B) Outbox offline

### B1. Venda offline entra como pending
1. Cortar internet (manter servidor local rodando, modo `local-server`
   ou `local-terminal`).
2. Finalizar venda no PDV.
3. **Esperado**: venda concluída na tela com aviso "pendente de sync";
   Configurações > Desktop mostra `Vendas > pending +1`.

### B2. Retry com erro de rede mantém o item na fila
1. Manter internet cortada; clicar "Sincronizar agora".
2. **Esperado**: item permanece na fila; `last_error` classificado como
   **"Sem internet"** no card de DesktopTab; `attempts` incrementa;
   `next_attempt_at_ms` segue a curva (5s, 15s, 60s, 5min, 15min).

### B3. Erro de autenticação marca AUTH e não apaga item
1. Restaurar internet, mas invalidar o JWT (Configurações > Sair e logar
   com outra conta sem permissão, **ou** revogar a sessão no Supabase).
2. Clicar "Sincronizar agora".
3. **Esperado**: badge "Sem autorização" no card; item permanece na fila;
   contadores `error` ou `pending` corretos no `useOutboxPendingSummary`.

### B4. Retry após auth válida sincroniza sem duplicar
1. Logar novamente com a conta correta.
2. Clicar "Reenfileirar erros" (se necessário) e "Sincronizar agora".
3. **Esperado**: venda sobe ao Supabase exatamente 1 vez; `remote_id`
   preenchido; `pending=0, error=0`; consulta SQL no Supabase mostra 1
   linha na tabela `vendas` com o `client_uuid` correspondente.

### B5. Fiado offline antigo sem vencimento não sincroniza errado
1. Offline, criar venda fiado **sem** data de vencimento (UI deve forçar
   campo — se permitir vazio, registrar como bug).
2. Tentar sincronizar.
3. **Esperado**: erro de validação claro classificado como `validacao`
   ou `dados-antigos`; item fica em `error`, não em `sent`; nenhuma
   linha errada no financeiro da nuvem.

---

## C) Caixa

### C1. Abrir caixa (caminho feliz)
1. Caixa fechado, abrir com valor inicial R$ 100.
2. **Esperado**: registro criado no SQLite local (offline) ou Supabase
   (online); PDV libera vendas.

### C2. Impedir duplo abrir
1. Com caixa já aberto, tentar abrir novamente.
2. **Esperado**: bloqueio com mensagem "Já existe caixa aberto".
   Nenhum novo registro criado.

### C3. Sangria / suprimento
1. Caixa aberto. Registrar sangria de R$ 50 e suprimento de R$ 30.
2. **Esperado**: 2 linhas em `movimentos_caixa` com `tipo` correto;
   saldo esperado do caixa reflete (entrada inicial + vendas + supr -
   sangria).

### C4. Fechamento com pendências de outbox alerta sem bloquear
1. Forçar 1 venda offline pendente (cenário B1).
2. Abrir diálogo "Fechar caixa".
3. **Esperado**: banner `OutboxPendenciasAlert` aparece listando
   "Vendas (PDV) — 1 pendente"; botão "Confirmar fechamento" continua
   habilitado (regra atual: alerta, não bloqueia).

### C5. Fechamento não duplica financeiro
1. Fechar caixa com R$ X esperado.
2. Conferir Financeiro > Fluxo de Caixa do dia.
3. **Esperado**: 1 lançamento de fechamento; nenhuma duplicação de
   movimentos de vendas/sangria/suprimento já contabilizados.

---

## D) Compra

### D1. Criar compra com vários itens
1. Compras > Nova compra, adicionar 3 itens diferentes.
2. Confirmar.
3. **Esperado**: compra + 3 itens gravados juntos; 3 movimentações de
   entrada de estoque (quando recebimento for automático ou após D4);
   1 lançamento em contas a pagar.

### D2. Idempotência — clique duplo
1. Abrir CompraDialog; clicar "Salvar" 2× rapidamente (ou simular via
   DevTools chamando `mutate` duas vezes com mesmo payload).
2. **Esperado**: apenas 1 compra criada; `client_uuid` garante
   idempotência; estoque atualiza 1 vez; contas a pagar com 1 linha.

### D3. Erro em item cancela a compra inteira
1. Forçar erro em 1 item (ex.: produto inexistente, qty=0, custo
   negativo).
2. Tentar salvar.
3. **Esperado**: nenhuma compra criada; nenhum item solto; nenhum
   movimento de estoque; nenhuma linha em contas a pagar.

### D4. Recebimento total atualiza estoque uma vez
1. Compra criada com status "Pendente".
2. Receber total via ReceberCompraDialog.
3. **Esperado**: status = "Recebida"; movimentações de entrada
   criadas 1 vez (não duplicam se a tela for fechada e reaberta).

### D5. Recebimento parcial mantém status correto
1. Compra de qty=10. Receber 4.
2. **Esperado**: status = "Parcial"; estoque +4; saldo pendente = 6
   visível; possível receber o restante depois sem duplicar os 4.

---

## E) Split-brain (modo `local-terminal`)

### E1. Servidor local indisponível bloqueia venda
1. Terminal em `local-terminal`. Parar o app servidor (ou bloquear porta
   3333 no firewall).
2. Tentar finalizar venda.
3. **Esperado**: erro `LOCAL_SERVER_INDISPONIVEL` com mensagem
   "Servidor local indisponível...". **Nenhum** request para
   `*.supabase.co` na aba Network durante a tentativa.

### E2. Mesmo bloqueio para caixa e estoque
1. Repetir E1 para: abrir caixa, fechar caixa, sangria, movimentação
   de estoque manual.
2. **Esperado**: todos bloqueados com a mesma mensagem; zero POST
   silencioso ao Supabase.

### E3. Leituras seguras caem para cloud
1. Mesma situação. Abrir Produtos, Clientes, listagem de estoque.
2. **Esperado**: listagens carregam via cloud (fallback permitido para
   leitura); badge de origem de dados mostra "cloud (fallback)".

### E4. Modo cloud puro continua funcionando
1. Web (`gestao-pro-empresarial.lovable.app`) ou desktop sem servidor
   local configurado.
2. Executar A1, A3, A4, C1, D1, D4.
3. **Esperado**: todos os fluxos passam normalmente direto contra
   Supabase, sem aviso de split-brain.

---

## Registro de execução

| Data | Build/Tag | Executor | A | B | C | D | E | Notas |
|------|-----------|----------|---|---|---|---|---|-------|
|      |           |          |   |   |   |   |   |       |

---

## Próximos passos (não nesta etapa)

Para automatizar parte deste checklist, sugiro em PR separado:

1. **Frontend**: adicionar `vitest` + `@testing-library/react` como
   devDependencies e cobrir:
   - `src/integrations/desktop/outboxErrors.ts` — classificação de erro
     (rede, auth, validacao, servidor, dados-antigos).
   - `src/integrations/data/adapters/local-terminal.ts` — guard
     `requireLocalBaseUrl` bloqueando operações críticas (mock de
     `getDesktopConfig`).
   - `src/hooks/useOutboxPendingSummary.ts` — agregação de stats.
2. **Rust integração**: criar `src-tauri/tests/` com testes de
   integração usando SQLite em arquivo temporário (`tempfile` crate)
   para validar:
   - `registrar_venda_local` idempotente por `client_uuid`.
   - `registrar_movimento_local` falhando para saldo insuficiente.
   - `cancelar_venda_local` estornando estoque + financeiro.
   - Curva de backoff aplicada por `outbox_mark_error`.
3. **E2E desktop**: avaliar Playwright sobre `tauri dev` em CI
   (Windows runner) para automatizar E1/E2.
