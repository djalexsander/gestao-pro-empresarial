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
