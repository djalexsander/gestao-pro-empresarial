# Gestão Pro — Desktop (Tauri)

Esta pasta contém a configuração do **shell desktop** do Gestão Pro.
A aplicação web (TanStack Start + Lovable Cloud) continua intacta — o Tauri
apenas embala o frontend já existente em uma janela nativa.

## Pré-requisitos (na sua máquina, não no sandbox Lovable)

1. Rust + Cargo: https://rustup.rs
2. Tauri CLI:
   ```bash
   npm install -D @tauri-apps/cli@^2
   ```
3. Dependências de SO (Linux: webkit2gtk, etc.) — ver https://tauri.app/start/prerequisites/

## Comandos

Rodar em desenvolvimento (abre janela conectada ao `vite dev`):
```bash
npx tauri dev
```

Gerar build desktop instalável:
```bash
npx tauri build
```

## Como o build funciona

- `tauri.conf.json` aponta `frontendDist` para `../dist/client` (saída do
  build do TanStack Start).
- `beforeBuildCommand` roda `npm run build:desktop` (ainda a ser adicionado
  no `package.json` na próxima etapa — pode ser igual ao `build` atual ou um
  build SPA específico para Tauri).
- `devUrl` aponta para `http://localhost:5173` (vite dev).

## Identidade do app

- Nome do produto: **Gestão Pro**
- Identificador: **com.alexproapps.gestaopro**
- Janela inicial: 1366×820, mínimo 1024×640, redimensionável.

## Ícones

Coloque os ícones em `src-tauri/icons/` (gere com `npx tauri icon caminho/logo.png`).
Sem eles, `tauri build` falha — `tauri dev` funciona normalmente.

## Detecção de runtime no frontend

Use `isDesktop()` / `getRuntimeShell()` de `src/integrations/data/mode.ts`
para diferenciar comportamento web vs desktop quando precisar.
