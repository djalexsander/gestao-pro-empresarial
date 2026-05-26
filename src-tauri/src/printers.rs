/*!
 * Detecção e impressão de impressoras nativas do SO.
 *
 * Histórico:
 *   - v1.1.10 → usava Start-Process / Out-Printer (PowerShell). Quebrava
 *     em térmicas e gerava o erro "Nenhum aplicativo associado" quando
 *     não havia handler PDF instalado.
 *   - Esta versão:
 *       * Detecta impressoras térmicas por heurística de nome.
 *       * Implementa ESC/POS RAW via WinAPI (OpenPrinterW / WritePrinter),
 *         100% offline, sem spawn de processo.
 *       * Substitui Start-Process por ShellExecuteW("printto") direto.
 *       * Lista impressoras pela API nativa do Windows (EnumPrintersW), sem
 *         depender de PowerShell para aparecerem no seletor.
 *       * Linux/macOS: CUPS (`lpstat`, `lp`, `lp -o raw`).
 *       * Logs detalhados com prefixo `[printers]`.
 */

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterInfo {
    pub name: String,
    pub status: Option<String>,
    pub is_default: bool,
    /// Heurística: nome sugere impressora térmica (POS-58, POS-80, PT260,
    /// TM-T, EPSON TM, Bematech, Daruma, Elgin, "thermal", "receipt", etc.).
    pub is_thermal: bool,
}

/// Heurística baseada em nome para identificar térmicas. Não é 100% mas
/// cobre os modelos mais comuns no varejo brasileiro.
pub fn detect_thermal(name: &str) -> bool {
    let n = name.to_lowercase();
    const NEEDLES: &[&str] = &[
        "pos-58", "pos58", "pos-80", "pos80", "pt-260", "pt260",
        "tm-t", "tm-u", "tm-m", "epson tm", "epson-tm",
        "bematech", "mp-4200", "mp4200", "mp-2800",
        "daruma", "dr-700", "dr700",
        "elgin", "i9", "i7", "vox",
        "sweda", "sat",
        "thermal", "term", "receipt", "ticket", "cupom", "non-fiscal", "rongta",
        "xprinter", "x-printer", "zjiang", "zj-",
        "gprinter", "gp-",
    ];
    NEEDLES.iter().any(|k| n.contains(k))
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    eprintln!("[printers] list_printers (windows/native)");
    let printers = win_raw::list_printers_native()?;
    eprintln!("[printers] {} impressoras detectadas", printers.len());
    Ok(printers)
}

#[cfg(not(target_os = "windows"))]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    eprintln!("[printers] list_printers (unix/cups)");
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
            let mut it = rest.split_whitespace();
            if let Some(name) = it.next() {
                let status = if line.contains("disabled") {
                    Some("disabled".to_string())
                } else if line.contains("idle") {
                    Some("idle".to_string())
                } else {
                    Some("ok".to_string())
                };
                let is_thermal = detect_thermal(name);
                printers.push(PrinterInfo {
                    name: name.to_string(),
                    status,
                    is_default: false,
                    is_thermal,
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
// PRINT — PDF (compat com fluxo antigo, sem Start-Process / PowerShell)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn print_pdf(file_path: &str, printer_name: &str) -> Result<String, String> {
    eprintln!(
        "[printers] print_pdf path={} printer={}",
        file_path, printer_name
    );

    // Tenta SumatraPDF silencioso primeiro — único PDF reader que aceita
    // -print-to sem precisar de janela visível.
    for sumatra in &[
        "SumatraPDF.exe",
        "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
        "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
    ] {
        let r = Command::new(sumatra)
            .args(["-print-to", printer_name, "-silent", file_path])
            .output();
        if let Ok(out) = r {
            if out.status.success() {
                eprintln!("[printers] PDF impresso via SumatraPDF ({sumatra})");
                return Ok(format!("Enviado para '{}'", printer_name));
            }
        }
    }

    // Fallback: ShellExecuteW("printto") — direto via Win32, sem spawn de
    // PowerShell / Start-Process. Depende do handler PDF padrão do SO.
    win_raw::shell_execute_printto(file_path, printer_name)
        .map(|_| format!("Enviado para '{}'", printer_name))
        .map_err(|e| {
            format!(
                "Falha ao imprimir PDF em '{printer_name}'. {e}. \
                 Instale o SumatraPDF para impressão silenciosa de PDF, \
                 ou configure uma impressora térmica para usar ESC/POS RAW."
            )
        })
}

#[cfg(not(target_os = "windows"))]
pub fn print_pdf(file_path: &str, printer_name: &str) -> Result<String, String> {
    eprintln!(
        "[printers] print_pdf (cups) path={} printer={}",
        file_path, printer_name
    );
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
// PRINT — RAW (ESC/POS direto para térmica)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn print_raw(printer_name: &str, doc_name: &str, data: &[u8]) -> Result<String, String> {
    eprintln!(
        "[printers] print_raw printer={} bytes={}",
        printer_name,
        data.len()
    );
    win_raw::write_raw(printer_name, doc_name, data)?;
    Ok(format!(
        "RAW {} bytes enviados para '{}'",
        data.len(),
        printer_name
    ))
}

#[cfg(not(target_os = "windows"))]
pub fn print_raw(printer_name: &str, _doc_name: &str, data: &[u8]) -> Result<String, String> {
    eprintln!(
        "[printers] print_raw (cups -o raw) printer={} bytes={}",
        printer_name,
        data.len()
    );
    use std::io::Write;
    let mut child = std::process::Command::new("lp")
        .args(["-d", printer_name, "-o", "raw"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("lp indisponível: {e}"))?;
    {
        let stdin = child.stdin.as_mut().ok_or("stdin do lp indisponível")?;
        stdin.write_all(data).map_err(|e| format!("write: {e}"))?;
    }
    let out = child.wait_with_output().map_err(|e| format!("wait: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "lp raw falhou: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(format!(
        "RAW {} bytes enviados para '{}'",
        data.len(),
        printer_name
    ))
}

// ---------------------------------------------------------------------------
// PRINT — IMAGEM/ETIQUETA via GDI (Windows spooler "normal")
// ---------------------------------------------------------------------------
//
// Caminho dedicado a impressoras de etiqueta que NÃO aceitam RAW/ESC-POS
// (ex.: PT260, Argox OS-214, Elgin L42, Zebra GK420 em modo Windows).
// Decodifica um PNG vindo do frontend e desenha via GDI (StretchDIBits) no
// DC da impressora. Compatível com qualquer driver Windows que aceite
// impressão GDI/bitmap, sem depender de SumatraPDF nem de handler PDF.

#[cfg(target_os = "windows")]
pub fn print_image_png(
    printer_name: &str,
    doc_name: &str,
    png_bytes: &[u8],
    copies: u32,
) -> Result<String, String> {
    eprintln!(
        "[printers] print_image_png printer={} bytes={} copies={}",
        printer_name,
        png_bytes.len(),
        copies
    );
    let img = image::load_from_memory(png_bytes)
        .map_err(|e| format!("Falha ao decodificar PNG da etiqueta: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    // Converte para BGRA (ordem que o GDI espera em BI_RGB 32bpp).
    let mut bgra = Vec::with_capacity((w * h * 4) as usize);
    for px in rgba.pixels() {
        bgra.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
    }
    win_raw::gdi_print_bitmap(printer_name, doc_name, &bgra, w as i32, h as i32, copies.max(1))?;
    Ok(format!(
        "Etiqueta enviada para '{}' ({}x{} px)",
        printer_name, w, h
    ))
}

#[cfg(not(target_os = "windows"))]
pub fn print_image_png(
    printer_name: &str,
    _doc_name: &str,
    png_bytes: &[u8],
    copies: u32,
) -> Result<String, String> {
    // Em Unix CUPS aceita PNG nativamente via `lp`.
    eprintln!(
        "[printers] print_image_png (cups) printer={} bytes={} copies={}",
        printer_name,
        png_bytes.len(),
        copies
    );
    let mut path = std::env::temp_dir();
    path.push(format!(
        "gestao-pro-etiqueta-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::write(&path, png_bytes).map_err(|e| format!("temp png: {e}"))?;
    let n = copies.max(1).to_string();
    let out = Command::new("lp")
        .args(["-d", printer_name, "-n", &n, path.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("lp indisponível: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Falha lp: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(format!("Etiqueta enviada para '{}'", printer_name))
}



/// Constrói um buffer ESC/POS para o texto informado.
///
/// `width_mm` controla apenas o `cut` e wrapping de linha (32 col para 58mm,
/// 48 col para 80mm). O texto deve vir já formatado em linhas pelo chamador;
/// linhas que excedam a largura são quebradas duramente.
pub fn build_escpos_receipt(text: &str, width_mm: u32, cut: bool) -> Vec<u8> {
    let cols: usize = if width_mm <= 58 { 32 } else { 48 };
    let mut out: Vec<u8> = Vec::with_capacity(text.len() + 64);

    // ESC @  — inicializa
    out.extend_from_slice(&[0x1B, 0x40]);
    // ESC t 16 — code page WPC1252 (acentos PT-BR razoáveis).
    out.extend_from_slice(&[0x1B, 0x74, 0x10]);
    // ESC a 0 — alinhamento esquerda
    out.extend_from_slice(&[0x1B, 0x61, 0x00]);

    for raw_line in text.split('\n') {
        // Conversão básica UTF-8 → CP1252 (best-effort; substitui não mapeáveis).
        let encoded = utf8_to_cp1252(raw_line);
        if encoded.is_empty() {
            out.push(0x0A);
            continue;
        }
        // Hard-wrap em `cols` colunas.
        let mut i = 0;
        while i < encoded.len() {
            let end = (i + cols).min(encoded.len());
            out.extend_from_slice(&encoded[i..end]);
            out.push(0x0A); // LF
            i = end;
        }
    }

    // Avança algumas linhas antes do corte para o papel sair da cabeça.
    out.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);

    if cut {
        // GS V 1 — corte parcial.
        out.extend_from_slice(&[0x1D, 0x56, 0x01]);
    }

    out
}

/// Conversor super-leve UTF-8 → Windows-1252.
/// Caracteres fora do mapa viram '?'. Cobre os acentos PT-BR comuns.
fn utf8_to_cp1252(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| {
            let code = c as u32;
            if code <= 0x7F {
                code as u8
            } else if (0xA0..=0xFF).contains(&code) {
                // ISO-8859-1 ⊂ CP1252 nesta faixa
                code as u8
            } else {
                match c {
                    '€' => 0x80,
                    '‚' => 0x82,
                    'ƒ' => 0x83,
                    '„' => 0x84,
                    '…' => 0x85,
                    '†' => 0x86,
                    '‡' => 0x87,
                    'ˆ' => 0x88,
                    '‰' => 0x89,
                    'Š' => 0x8A,
                    '‹' => 0x8B,
                    'Œ' => 0x8C,
                    'Ž' => 0x8E,
                    '‘' => 0x91,
                    '’' => 0x92,
                    '“' => 0x93,
                    '”' => 0x94,
                    '•' => 0x95,
                    '–' => 0x96,
                    '—' => 0x97,
                    '˜' => 0x98,
                    '™' => 0x99,
                    'š' => 0x9A,
                    '›' => 0x9B,
                    'œ' => 0x9C,
                    'ž' => 0x9E,
                    'Ÿ' => 0x9F,
                    _ => b'?',
                }
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// HELPERS — arquivo temporário
// ---------------------------------------------------------------------------

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
// Windows-only: WinAPI helpers (RAW + ShellExecute)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod win_raw {
    use super::{detect_thermal, PrinterInfo};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::{ptr, slice};

    use winapi::shared::minwindef::DWORD;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winnt::HANDLE;
    use winapi::um::winspool::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW,
        OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
        PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    };
    use winapi::um::winuser::SW_HIDE;

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    unsafe fn from_wide_ptr(p: *const u16) -> Option<String> {
        if p.is_null() {
            return None;
        }
        let mut len = 0usize;
        while *p.add(len) != 0 {
            len += 1;
        }
        if len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(slice::from_raw_parts(p, len)))
    }

    fn default_printer_name() -> Option<String> {
        unsafe {
            let mut needed: DWORD = 0;
            GetDefaultPrinterW(ptr::null_mut(), &mut needed);
            if needed == 0 {
                return None;
            }
            let mut buf = vec![0u16; needed as usize];
            if GetDefaultPrinterW(buf.as_mut_ptr(), &mut needed) == 0 {
                return None;
            }
            from_wide_ptr(buf.as_ptr())
        }
    }

    fn status_text(status: DWORD, jobs: DWORD) -> Option<String> {
        if jobs > 0 {
            return Some(format!("{} trabalho(s) na fila", jobs));
        }
        if status == 0 {
            Some("Pronta".to_string())
        } else {
            Some(format!("Status {}", status))
        }
    }

    pub fn list_printers_native() -> Result<Vec<PrinterInfo>, String> {
        unsafe {
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let mut needed: DWORD = 0;
            let mut returned: DWORD = 0;
            EnumPrintersW(
                flags,
                ptr::null_mut(),
                2,
                ptr::null_mut(),
                0,
                &mut needed,
                &mut returned,
            );
            if needed == 0 {
                return Ok(Vec::new());
            }

            let mut buffer = vec![0u8; needed as usize];
            let ok = EnumPrintersW(
                flags,
                ptr::null_mut(),
                2,
                buffer.as_mut_ptr(),
                needed,
                &mut needed,
                &mut returned,
            );
            if ok == 0 {
                return Err(format!("Falha ao consultar impressoras do Windows: {}", std::io::Error::last_os_error()));
            }

            let default_name = default_printer_name();
            let infos = slice::from_raw_parts(
                buffer.as_ptr() as *const PRINTER_INFO_2W,
                returned as usize,
            );
            let mut printers = Vec::with_capacity(returned as usize);
            for info in infos {
                let Some(name) = from_wide_ptr(info.pPrinterName) else {
                    continue;
                };
                let is_default = default_name
                    .as_deref()
                    .map(|d| d.eq_ignore_ascii_case(&name))
                    .unwrap_or(false);
                printers.push(PrinterInfo {
                    is_thermal: detect_thermal(&name),
                    status: status_text(info.Status, info.cJobs),
                    name,
                    is_default,
                });
            }
            Ok(printers)
        }
    }

    pub fn write_raw(printer: &str, doc_name: &str, data: &[u8]) -> Result<(), String> {
        unsafe {
            let mut printer_w = to_wide(printer);
            let mut handle: HANDLE = ptr::null_mut();

            if OpenPrinterW(printer_w.as_mut_ptr(), &mut handle, ptr::null_mut()) == 0
                || handle.is_null()
            {
                let e = std::io::Error::last_os_error();
                return Err(format!("OpenPrinter('{printer}') falhou: {e}"));
            }

            let mut doc_name_w = to_wide(doc_name);
            let mut datatype_w = to_wide("RAW");
            let mut di = DOC_INFO_1W {
                pDocName: doc_name_w.as_mut_ptr(),
                pOutputFile: ptr::null_mut(),
                pDatatype: datatype_w.as_mut_ptr(),
            };

            let job = StartDocPrinterW(handle, 1, &mut di as *mut _ as *mut _);
            if job == 0 {
                let e = std::io::Error::last_os_error();
                ClosePrinter(handle);
                return Err(format!("StartDocPrinter falhou: {e}"));
            }

            if StartPagePrinter(handle) == 0 {
                let e = std::io::Error::last_os_error();
                EndDocPrinter(handle);
                ClosePrinter(handle);
                return Err(format!("StartPagePrinter falhou: {e}"));
            }

            let mut written: DWORD = 0;
            let ok = WritePrinter(
                handle,
                data.as_ptr() as *mut _,
                data.len() as DWORD,
                &mut written,
            );
            let write_err = if ok == 0 {
                Some(std::io::Error::last_os_error())
            } else if (written as usize) != data.len() {
                Some(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("escrita parcial: {written}/{}", data.len()),
                ))
            } else {
                None
            };

            EndPagePrinter(handle);
            EndDocPrinter(handle);
            ClosePrinter(handle);

            if let Some(e) = write_err {
                return Err(format!("WritePrinter falhou: {e}"));
            }
        }
        Ok(())
    }

    /// Substitui `Start-Process -Verb PrintTo`. Chama ShellExecuteW direto
    /// com o verbo "printto" — sem spawn de PowerShell.
    pub fn shell_execute_printto(file: &str, printer: &str) -> Result<(), String> {
        let verb = to_wide("printto");
        let file_w = to_wide(file);
        let params = to_wide(&format!("\"{}\"", printer));
        let result = unsafe {
            ShellExecuteW(
                ptr::null_mut(),
                verb.as_ptr(),
                file_w.as_ptr(),
                params.as_ptr(),
                ptr::null(),
                SW_HIDE,
            )
        };
        // ShellExecute retorna > 32 em sucesso.
        let code = result as isize;
        if code <= 32 {
            return Err(format!(
                "ShellExecute 'printto' retornou {} (sem handler PDF associado?)",
                code
            ));
        }
        Ok(())
    }
}
