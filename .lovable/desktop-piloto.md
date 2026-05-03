# Piloto comercial controlado — Gestão Pro Desktop

Roteiro objetivo para implantação assistida e critérios de aceite. Não troca
o checklist embutido em **Configurações → Desktop → Checklist de piloto
comercial**; complementa com instruções narrativas e registros mínimos.

## 1. Preparação

- Versão alvo congelada (ver `package.json` + `tauri.conf.json`).
- Backup automático ativo na máquina servidor (24h, retenção 14).
- Updater apontando para o `latest.json` correto.
- Chave de assinatura configurada e versionada apenas em ambiente seguro.
- Lista de máquinas: 1 servidor + N terminais, IPs e papéis registrados.

## 2. Instalação

1. Instalar o Gestão Pro no **servidor**; abrir wizard → **Servidor Local**.
2. Confirmar **Pronto para receber terminais** (tudo verde).
3. Anotar IP e porta exibidos no card.
4. Em cada **terminal**: instalar, abrir wizard → **Terminal Cliente** →
   preencher → **Testar conexão** → **Confirmar pareamento**.

## 3. Operação assistida (mínimo recomendado: 1 turno)

- Realizar pelo menos: 5 vendas, 1 cancelamento, 1 abertura+fechamento de
  caixa, 1 lançamento financeiro manual.
- Simular queda de rede por 5 min → continuar operando offline → restaurar
  rede → confirmar drenagem das filas (badges voltarem para `ok`).
- Forçar uma sincronização manual via botão "Sincronizar agora".

## 4. Backup e updater

- Conferir que o backup automático rodou (data recente em
  **Backup e segurança**).
- Exportar 1 backup para mídia externa.
- Em ambiente de teste, restaurar esse backup e validar arquivos.
- Publicar uma versão `+0.0.1` no `latest.json` e validar o fluxo de
  atualização ponta a ponta no servidor e em pelo menos 1 terminal.

## 5. Diagnóstico de suporte

- Em cada máquina, abrir **Diagnóstico de suporte** → **Baixar JSON**.
- Arquivar os JSONs junto com o registro do piloto. Estes arquivos contêm
  versão, papel, IDs estáveis, conexão e estado das filas — sem PII.

## 6. Critérios de aceite

O piloto é considerado **aceito** quando, no card de checklist, todos os
itens marcados como **crítico** estiverem concluídos. Em texto:

- Servidor estável por 8h contínuas sem erro crítico.
- Todos os terminais conectam, pareiam e operam.
- Vendas/caixa/financeiro offline gravam e drenam após retorno da rede.
- Backup automático executou e restauração foi validada em teste.
- Updater verifica e instala nova versão sem erro.
- Nenhuma fila offline em estado de erro persistente ao final.

## 7. Fora do escopo desta frente (evoluções futuras)

- mDNS/Bonjour para descoberta automática do servidor.
- QR code / token de pareamento curto.
- Modo kiosk para terminais.
- Telemetria remota agregada.
- Code-signing nativo (Authenticode + Apple notarization).
- Pipeline CI/CD multiplataforma.
- Multi-loja (mais de um servidor por empresa).
