# Desktop — Updater, Release e Implantação Comercial

Este documento descreve o fluxo de atualização e release do **Gestão Pro Desktop**
(Tauri 2). Foco: distribuição profissional, atualização segura e processo
repetível. Não cobre módulos de negócio — apenas o ciclo de vida do app instalado.

---

## 1. Visão geral

```
┌──────────────┐   check()    ┌──────────────────────────┐
│  App desktop │ ───────────▶ │ latest.json (CDN/Domínio)│
└──────┬───────┘              └──────────────┬───────────┘
       │ assinatura OK?                      │
       │ download bundle (.msi/.dmg/.AppImage)│
       │ verifica assinatura (pubkey)         │
       │ instala + relaunch                  │
       ▼
   nova versão rodando
```

- **Plugin Rust:** `tauri-plugin-updater` (registrado em `src-tauri/src/lib.rs`).
- **Plugin JS:** `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`
  (consumido em `src/components/configuracoes/AtualizacoesTab.tsx`).
- **Permissões:** `updater:default`, `process:allow-restart`, `dialog:default`
  (em `src-tauri/capabilities/default.json`).
- **Configuração:** bloco `plugins.updater` em `src-tauri/tauri.conf.json` com
  endpoints e `pubkey`.

---

## 2. Geração de chaves de assinatura (uma única vez)

```bash
npm run tauri signer generate -- -w ~/.tauri/gestao-pro.key
```

Saída: chave privada em `~/.tauri/gestao-pro.key` (NUNCA commitar) e a chave
pública correspondente (cole em `tauri.conf.json` → `plugins.updater.pubkey`,
substituindo `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`).

Variáveis para o build assinar artefatos:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/gestao-pro.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="senha-da-chave"
```

---

## 3. Versionamento

Semver simples: `MAJOR.MINOR.PATCH`. A versão **deve** estar idêntica em:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Use o script:

```bash
node scripts/release-desktop.mjs 1.1.0
```

Ele faz o bump nos três arquivos atomicamente.

---

## 4. Build e empacotamento

```bash
npm install
npm run tauri:build
```

Artefatos gerados em `src-tauri/target/release/bundle/`:

| Plataforma | Instalador            | Updater bundle           |
|------------|-----------------------|--------------------------|
| Windows    | `*.msi` / `*-setup.exe` | `*.msi.zip` + `.sig`     |
| macOS      | `*.dmg`               | `*.app.tar.gz` + `.sig`  |
| Linux      | `*.AppImage` / `*.deb`| `*.AppImage.tar.gz`+`.sig`|

`createUpdaterArtifacts: true` em `tauri.conf.json` garante o segundo grupo
(arquivos consumidos pelo updater).

---

## 5. Manifesto `latest.json`

Hospede em uma URL estável (uma das definidas em `plugins.updater.endpoints`).
Formato esperado pelo updater:

```json
{
  "version": "1.1.0",
  "notes": "Correções no caixa, melhorias no financeiro local.",
  "pub_date": "2026-05-03T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<conteúdo do arquivo .sig>",
      "url": "https://cdn.alexproapps.com.br/gestao-pro/v1.1.0/Gestao-Pro_1.1.0_x64_en-US.msi.zip"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://cdn.alexproapps.com.br/gestao-pro/v1.1.0/Gestao-Pro_1.1.0_x64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "...",
      "url": "https://cdn.alexproapps.com.br/gestao-pro/v1.1.0/gestao-pro_1.1.0_amd64.AppImage.tar.gz"
    }
  }
}
```

---

## 6. Checklist de release

1. `node scripts/release-desktop.mjs <versão>`
2. `git commit -am "chore(desktop): release vX.Y.Z" && git tag vX.Y.Z`
3. `npm run tauri:build` em cada plataforma alvo (CI ou local).
4. Coletar artefatos `*.msi.zip|*.app.tar.gz|*.AppImage.tar.gz` + `*.sig`.
5. Subir tudo para o CDN sob `/gestao-pro/vX.Y.Z/`.
6. Atualizar `latest.json` no endpoint configurado.
7. Smoke test: abra um desktop em versão anterior e confirme que o card
   **Atualizações do app desktop** detecta e instala a nova versão.

---

## 7. Implantação comercial

- **Servidor (máquina principal)**: instale o `.msi`/`.dmg`/`.AppImage`,
  configure servidor local na aba **Desktop → Servidor local**.
- **Terminais**: instalem o mesmo build, marquem como **terminal** e apontem
  para o IP/porta do servidor (aba **Configurações → Terminais**).
- **Backup**: já automatizado (24h) — ver `BackupSeguranca` na aba Desktop.
- **Atualização**: cada máquina (servidor e terminais) usa o card
  **Atualizações do app desktop** para checar/instalar nova versão. O servidor
  local Rust é reiniciado automaticamente após o relaunch.

---

## 8. Fora do escopo desta etapa

- Auto-update silencioso/forçado (atualmente o usuário aciona pela UI).
- Canais separados (beta/stable) — pode ser adicionado com múltiplos endpoints.
- Pipeline CI/CD multiplataforma — depende da escolha de provider.
- Code-signing nativo Windows (Authenticode) e notarization Apple — exigem
  certificados pagos por plataforma e configuração específica.
