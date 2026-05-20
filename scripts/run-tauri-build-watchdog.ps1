param(
  [ValidateSet("nsis", "msi", "all")]
  [string]$Target = "nsis",
  [int]$NoOutputTimeoutSeconds = 900,
  [switch]$DisableUpdaterArtifacts
)

$ErrorActionPreference = "Stop"
$repo = (Get-Location).Path
$configPath = Join-Path $repo "src-tauri\tauri.conf.json"
$bundlePath = Join-Path $repo "src-tauri\target\release\bundle"
$originalConfig = Get-Content -Raw -Path $configPath
$startedAt = Get-Date

function Log([string]$Message) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Write-Host "[$stamp] $Message"
}

function Show-BundleTree {
  Log "[BUNDLE_TREE] dir src-tauri\target\release\bundle /s"
  if (Test-Path $bundlePath) {
    cmd /c "dir src-tauri\target\release\bundle /s"
  } else {
    Write-Host "(pasta bundle ainda não existe)"
  }
}

function Write-DiagnosticConfig {
  $json = $originalConfig | ConvertFrom-Json -Depth 100
  $json.bundle.targets = if ($Target -eq "all") { "all" } else { @($Target) }
  if ($DisableUpdaterArtifacts) {
    $json.bundle.createUpdaterArtifacts = $false
  }
  $json | ConvertTo-Json -Depth 100 | Set-Content -Path $configPath -Encoding utf8
  Log "[TAURI_CONFIG] bundle.targets=$($json.bundle.targets -join ',') createUpdaterArtifacts=$($json.bundle.createUpdaterArtifacts)"
}

try {
  Write-DiagnosticConfig
  $env:RUST_BACKTRACE = "1"
  $env:TAURI_DEBUG = "1"

  $bundleArg = if ($Target -eq "all") { "all" } else { $Target }

  Log "[BUILD_START] target=$Target disable_updater_artifacts=$DisableUpdaterArtifacts"
  Log "[COMMAND] bun run tauri build -- --verbose --bundles $bundleArg"

  # Execução direta — sem ProcessStartInfo / async handlers para evitar
  # "There is no Runspace available to run scripts in this thread".
  # Usar bun (gerenciador instalado no workflow) em vez de npx, que
  # falha com "could not determine executable to run".
  & bun.exe run tauri build -- --verbose --bundles $bundleArg
  $code = $LASTEXITCODE

  Log "[EXIT_CODE] $code"
  Log "[BUILD_END] target=$Target exit_code=$code duração=$([int]((Get-Date) - $startedAt).TotalSeconds)s"
  Show-BundleTree

  if ($code -ne 0) {
    Write-Host "::error::Tauri build failed (target=$Target) with exit code $code"
    exit $code
  }
} finally {
  Set-Content -Path $configPath -Value $originalConfig -Encoding utf8
  Log "[TAURI_CONFIG] tauri.conf.json restaurado"
}
