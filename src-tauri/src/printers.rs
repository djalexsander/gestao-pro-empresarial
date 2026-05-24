/*!
 * Detecção e impressão de impressoras nativas do SO.
 *
 * Estratégia portátil sem dependências externas pesadas:
 *   - Windows: PowerShell `Get-Printer` para listar, `Out-Printer` /
 *              `Start-Process -Verb PrintTo` para imprimir PDF.
 *   - macOS/Linux: CUPS (`lpstat -p`, `lp -d <printer> <arquivo>`).
 *
 * Falhas retornam `Err(String)` para o front exibir mensagem útil.
 */

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterInfo {
    pub name: String,
    pub status: Option<String>,
    pub is_default: bool,
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    // Get-Printer | Select-Object Name, PrinterStatus  -> formato CSV simples
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Printer | ForEach-Object { \"$($_.Name)|$($_.PrinterStatus)|$($_.Default)\" }",
        ])
        .output()
        .map_err(|e| format!("powershell falhou: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Get-Printer status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let printers = stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let parts: Vec<&str> = line.split('|').collect();
            let name = parts.first()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let status = parts.get(1).map(|s| s.trim().to_string());
            let is_default = parts
                .get(2)
                .map(|s| s.trim().eq_ignore_ascii_case("True"))
                .unwrap_or(false);
            Some(PrinterInfo {
                name,
                status,
                is_default,
            })
        })
        .collect();

    Ok(printers)
}

#[cfg(not(target_os = "windows"))]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    // lpstat -p -d
    let output = Command::new("lpstat")
        .args(["-p", "-d"])
        .output()
        .map_err(|e| format!("lpstat indisponível (CUPS): {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "lpstat status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut default_name: Option<String> = None;
    let mut printers: Vec<PrinterInfo> = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("printer ") {
            // "printer NAME is idle.  enabled since ..."
            let mut it = rest.split_whitespace();
            if let Some(name) = it.next() {
                let status = if line.contains("disabled") {
                    Some("disabled".to_string())
                } else if line.contains("idle") {
                    Some("idle".to_string())
                } else {
                    Some("ok".to_string())
                };
                printers.push(PrinterInfo {
                    name: name.to_string(),
                    status,
                    is_default: false,
                });
            }
        } else if let Some(rest) = line.strip_prefix("system default destination: ") {
            default_name = Some(rest.trim().to_string());
        }
    }

    if let Some(def) = default_name {
        for p in printers.iter_mut() {
            if p.name == def {
                p.is_default = true;
            }
        }
    }

    Ok(printers)
}

// ---------------------------------------------------------------------------
// PRINT
// ---------------------------------------------------------------------------

/// Imprime um arquivo PDF (caminho absoluto) na impressora informada.
/// Retorna mensagem de sucesso resumida.
#[cfg(target_os = "windows")]
pub fn print_pdf(file_path: &str, printer_name: &str) -> Result<String, String> {
    // Usa Start-Process com verbo PrintTo, que respeita o handler PDF padrão
    // do Windows (Edge/Adobe/SumatraPDF). Evita popups de "como abrir?".
    let cmd = format!(
        "Start-Process -FilePath \"{}\" -Verb PrintTo -ArgumentList '\"{}\"' -WindowStyle Hidden",
        file_path.replace('"', "`\""),
        printer_name.replace('"', "`\"")
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
        .output()
        .map_err(|e| format!("powershell falhou: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Falha ao imprimir: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(format!("Enviado para '{}'", printer_name))
}

#[cfg(not(target_os = "windows"))]
pub fn print_pdf(file_path: &str, printer_name: &str) -> Result<String, String> {
    let output = Command::new("lp")
        .args(["-d", printer_name, file_path])
        .output()
        .map_err(|e| format!("lp indisponível (CUPS): {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Falha ao imprimir: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(format!("Enviado para '{}'", printer_name))
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/// Grava bytes em arquivo temporário .pdf e retorna o caminho.
pub fn write_temp_pdf(bytes: &[u8]) -> Result<String, String> {
    use std::io::Write;
    let mut path = std::env::temp_dir();
    let name = format!(
        "gestao-pro-cupom-{}.pdf",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    path.push(name);
    let mut f = std::fs::File::create(&path).map_err(|e| format!("temp file: {e}"))?;
    f.write_all(bytes).map_err(|e| format!("write: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// RAW PRINT (ESC/POS para impressoras térmicas POS-80 etc.)
// ---------------------------------------------------------------------------

/// Envia bytes RAW direto para o spooler da impressora (ESC/POS).
/// Em Windows usa winspool (OpenPrinter/StartDocPrinter/WritePrinter) via
/// PowerShell+Add-Type — não depende de aplicativo associado a tipo de arquivo.
#[cfg(target_os = "windows")]
pub fn print_raw(printer_name: &str, data: &[u8]) -> Result<String, String> {
    use base64::Engine;
    use std::io::Write;

    let b64 = base64::engine::general_purpose::STANDARD.encode(data);

    let mut script_path = std::env::temp_dir();
    script_path.push(format!(
        "gestao-pro-rawprint-{}.ps1",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));

    let printer_escaped = printer_name.replace('`', "``").replace('"', "`\"");
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$printer = "{printer}"
$bytes = [System.Convert]::FromBase64String("{b64}")
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {{
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }}
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytesToPrinter(string szPrinterName, byte[] pBytes) {{
    IntPtr hPrinter;
    if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) return false;
    var di = new DOCINFOA();
    di.pDocName = "GestaoPro Cupom";
    di.pDataType = "RAW";
    bool ok = false;
    int written = 0;
    if (StartDocPrinter(hPrinter, 1, di)) {{
      if (StartPagePrinter(hPrinter)) {{
        ok = WritePrinter(hPrinter, pBytes, pBytes.Length, out written);
        EndPagePrinter(hPrinter);
      }}
      EndDocPrinter(hPrinter);
    }}
    ClosePrinter(hPrinter);
    return ok;
  }}
}}
"@
$result = [RawPrinterHelper]::SendBytesToPrinter($printer, $bytes)
if (-not $result) {{ Write-Error "WritePrinter falhou"; exit 1 }}
Write-Output "ok"
"#,
        printer = printer_escaped,
        b64 = b64
    );

    {
        let mut f = std::fs::File::create(&script_path)
            .map_err(|e| format!("temp ps1: {e}"))?;
        f.write_all(script.as_bytes())
            .map_err(|e| format!("write ps1: {e}"))?;
    }

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_path.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|e| format!("powershell falhou: {e}"))?;

    let _ = std::fs::remove_file(&script_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "Não foi possível enviar para a impressora '{}'. {}",
            printer_name,
            sanitize_ps_error(&stderr)
        ));
    }
    Ok(format!("Enviado para '{}'", printer_name))
}

#[cfg(not(target_os = "windows"))]
pub fn print_raw(printer_name: &str, data: &[u8]) -> Result<String, String> {
    use std::io::Write;
    let mut child = Command::new("lp")
        .args(["-d", printer_name, "-o", "raw"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("lp indisponível (CUPS): {e}"))?;
    if let Some(mut sin) = child.stdin.take() {
        sin.write_all(data).map_err(|e| format!("stdin: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("lp wait: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Falha ao imprimir raw: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(format!("Enviado para '{}'", printer_name))
}

#[cfg(target_os = "windows")]
fn sanitize_ps_error(stderr: &str) -> String {
    let cleaned: String = stderr
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty()
                && !t.starts_with('+')
                && !t.starts_with('~')
                && !t.contains("CategoryInfo")
                && !t.contains("FullyQualifiedErrorId")
                && !t.contains("At line")
        })
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        "Verifique se a impressora está ligada e conectada.".to_string()
    } else {
        cleaned
    }
}

