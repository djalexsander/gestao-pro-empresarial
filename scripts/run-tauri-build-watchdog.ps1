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
$lastOutputAt = Get-Date

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

function Show-RelevantProcesses {
  Log "[PROCESS_TREE] processos relevantes ativos"
  $patterns = "candle|light|makensis|signtool|signer|wix|tauri|cargo|rustc|node|npx"
  $rows = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -match $patterns -or $_.CommandLine -match $patterns } |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine
  if ($rows) {
    $rows | Format-Table -AutoSize -Wrap | Out-String -Width 240 | Write-Host
  } else {
    Write-Host "(nenhum processo candle/light/makensis/signtool/signer/wix/tauri/cargo/rustc/node/npx encontrado)"
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

function Stop-ProcessTree([int]$ProcessId) {
  try {
    & taskkill.exe /PID $ProcessId /T /F | Out-Host
  } catch {
    Log "[WATCHDOG] falha ao encerrar árvore do processo ${ProcessId}: $($_.Exception.Message)"
  }
}

try {
  Write-DiagnosticConfig
  $env:RUST_BACKTRACE = "1"
  $env:TAURI_DEBUG = "1"

  Log "[BUILD_START] target=$Target no_output_timeout=${NoOutputTimeoutSeconds}s disable_updater_artifacts=$DisableUpdaterArtifacts"
  Log "[BUILD_HINTS] observar no log: candle.exe, light.exe, makensis.exe, signer, updater artifact, wix, nsis"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "npx.cmd"
  $psi.Arguments = "tauri build --verbose"
  $psi.WorkingDirectory = $repo
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.EnableRaisingEvents = $true
  $outHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $event)
    if ($null -ne $event.Data) {
      $script:lastOutputAt = Get-Date
      Write-Host $event.Data
    }
  }
  $errHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $event)
    if ($null -ne $event.Data) {
      $script:lastOutputAt = Get-Date
      Write-Host $event.Data
    }
  }
  $proc.add_OutputDataReceived($outHandler)
  $proc.add_ErrorDataReceived($errHandler)

  if (-not $proc.Start()) { throw "Falha ao iniciar npx tauri build --verbose" }
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()

  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 10
    $idle = [int]((Get-Date) - $lastOutputAt).TotalSeconds
    $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
    if ($idle -ge 60 -and ($idle % 60 -lt 10)) {
      Log "[WATCHDOG] build ainda rodando; elapsed=${elapsed}s sem_saida=${idle}s target=$Target"
      Show-RelevantProcesses
      Show-BundleTree
    }
    if ($idle -ge $NoOutputTimeoutSeconds) {
      Log "[WATCHDOG_TIMEOUT] nenhum output por ${idle}s. Cancelando build para expor travamento."
      Show-RelevantProcesses
      Show-BundleTree
      Stop-ProcessTree $proc.Id
      throw "Tauri build congelou sem saída por ${idle}s no target '$Target'. Verifique a última linha acima para candle/light/makensis/signer/updater/wix/nsis."
    }
  }

  $proc.WaitForExit()
  $exitCode = $proc.ExitCode
  Log "[BUILD_END] target=$Target exit_code=$exitCode duração=$([int]((Get-Date) - $startedAt).TotalSeconds)s"
  Show-RelevantProcesses
  Show-BundleTree
  if ($exitCode -ne 0) { throw "npx tauri build --verbose falhou com exit code $exitCode no target '$Target'." }
} finally {
  Set-Content -Path $configPath -Value $originalConfig -Encoding utf8
  Log "[TAURI_CONFIG] tauri.conf.json restaurado"
}