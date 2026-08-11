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
    /// Evidencia conservadora para o modo Automatico. `likely` permite tentar
    /// ESC/POS; `unknown` usa o driver do sistema. O usuario sempre pode forcar.
    pub escpos_support: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReceiptPrintResult {
    pub mode: String,
    pub message: String,
}

/// Heurística baseada em nome para identificar térmicas. Não é 100% mas
/// cobre os modelos mais comuns no varejo brasileiro.
pub fn detect_thermal(name: &str) -> bool {
    let n = name.to_lowercase();
    const NEEDLES: &[&str] = &[
        "pos-58",
        "pos58",
        "pos-80",
        "pos80",
        "pt-260",
        "pt260",
        "tm-t",
        "tm-u",
        "tm-m",
        "epson tm",
        "epson-tm",
        "bematech",
        "mp-4200",
        "mp4200",
        "mp-2800",
        "daruma",
        "dr-700",
        "dr700",
        "elgin",
        "i9",
        "i7",
        "vox",
        "sweda",
        "sat",
        "thermal",
        "term",
        "receipt",
        "ticket",
        "cupom",
        "non-fiscal",
        "rongta",
        "xprinter",
        "x-printer",
        "zjiang",
        "zj-",
        "gprinter",
        "gp-",
    ];
    NEEDLES.iter().any(|k| n.contains(k)) || contains_pos_model(&n)
}

/// Reconhece familias genericas do tipo POS-8370/POS80 sem cadastrar um
/// modelo individual. Nao basta para provar compatibilidade: por isso existe
/// o modo manual e o Automatico possui fallback para o driver do Windows.
fn contains_pos_model(name: &str) -> bool {
    let compact: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    compact.match_indices("pos").any(|(index, _)| {
        compact[index + 3..]
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
    })
}

/// Heuristica deliberadamente mais conservadora que `detect_thermal`.
/// Impressoras de etiqueta termica (TSC, Zebra, Argox, LABEL, PT260) nao sao
/// candidatas ESC/POS de cupom apenas por serem termicas.
pub fn detect_escpos_likely(name: &str) -> bool {
    let n = name.to_lowercase();
    const LABEL_MARKERS: &[&str] = &[
        "label", "etiqueta", "tsc", "zebra", "argox", "pt260", "pt-260",
    ];
    if LABEL_MARKERS.iter().any(|marker| n.contains(marker)) {
        return false;
    }

    const RECEIPT_MARKERS: &[&str] = &[
        "pos-58",
        "pos58",
        "pos-80",
        "pos80",
        "tm-t",
        "tm-u",
        "tm-m",
        "epson tm",
        "epson-tm",
        "bematech",
        "mp-4200",
        "mp4200",
        "mp-2800",
        "daruma",
        "dr-700",
        "dr700",
        "elgin i9",
        "sweda",
        "receipt",
        "cupom",
        "non-fiscal",
        "rongta",
        "xprinter",
        "x-printer",
        "zjiang",
        "zj-",
        "gprinter",
        "gp-",
    ];
    RECEIPT_MARKERS.iter().any(|marker| n.contains(marker)) || contains_pos_model(&n)
}

fn escpos_support(name: &str) -> String {
    if detect_escpos_likely(name) {
        "likely".to_string()
    } else {
        "unknown".to_string()
    }
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
                    escpos_support: escpos_support(name),
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

fn public_receipt_error(printer_name: &str, _mode: &str) -> String {
    format!(
        "Não foi possível imprimir na '{}' usando o modo selecionado.",
        printer_name
    )
}

fn receipt_attempt_order(
    requested_mode: &str,
    escpos_likely: bool,
) -> Option<&'static [&'static str]> {
    const RAW: &[&str] = &["raw"];
    const DRIVER: &[&str] = &["driver"];
    const RAW_THEN_DRIVER: &[&str] = &["raw", "driver"];
    match requested_mode {
        "raw" => Some(RAW),
        "driver" => Some(DRIVER),
        "auto" if escpos_likely => Some(RAW_THEN_DRIVER),
        "auto" => Some(DRIVER),
        _ => None,
    }
}

/// Unico ponto nativo para teste e cupons reais. PDF nao faz parte desta
/// estrategia: documentos e exportacoes continuam usando `print_pdf`.
pub fn print_receipt(
    text: &str,
    printer_name: &str,
    requested_mode: &str,
    width_mm: u32,
    cut: bool,
) -> Result<ReceiptPrintResult, String> {
    if width_mm != 58 && width_mm != 80 {
        eprintln!("[printers] largura de cupom invalida: {width_mm}");
        return Err(public_receipt_error(printer_name, requested_mode));
    }
    let printers = list_printers().map_err(|detail| {
        eprintln!("[printers] falha ao validar impressora '{printer_name}': {detail}");
        public_receipt_error(printer_name, requested_mode)
    })?;
    let Some(info) = printers
        .iter()
        .find(|printer| printer.name.eq_ignore_ascii_case(printer_name))
    else {
        eprintln!("[printers] impressora inexistente: '{printer_name}'");
        return Err(public_receipt_error(printer_name, requested_mode));
    };

    let raw = || {
        let bytes = build_escpos_receipt(text, width_mm, cut);
        print_raw(&info.name, "Gestao Pro Cupom", &bytes)
    };
    let driver = || print_driver_receipt(&info.name, "Gestao Pro Cupom", text, width_mm);

    let Some(attempts) = receipt_attempt_order(requested_mode, info.escpos_support == "likely")
    else {
        eprintln!("[printers] modo de cupom invalido: '{requested_mode}'");
        return Err(public_receipt_error(printer_name, requested_mode));
    };

    for (index, resolved_mode) in attempts.iter().enumerate() {
        let result = if *resolved_mode == "raw" {
            raw()
        } else {
            driver()
        };
        match result {
            Ok(message) => {
                return Ok(ReceiptPrintResult {
                    mode: (*resolved_mode).to_string(),
                    message,
                });
            }
            Err(detail) => {
                let has_fallback = index + 1 < attempts.len();
                eprintln!(
                    "[printers] cupom falhou printer='{}' requested={} resolved={} fallback={}: {}",
                    info.name, requested_mode, resolved_mode, has_fallback, detail
                );
            }
        }
    }

    Err(public_receipt_error(&info.name, requested_mode))
}

#[cfg(target_os = "windows")]
fn print_driver_receipt(
    printer_name: &str,
    doc_name: &str,
    text: &str,
    width_mm: u32,
) -> Result<String, String> {
    win_raw::gdi_print_receipt_text(printer_name, doc_name, text, width_mm)?;
    Ok(format!(
        "Cupom enviado para '{}' pelo driver do Windows",
        printer_name
    ))
}

#[cfg(not(target_os = "windows"))]
fn print_driver_receipt(
    printer_name: &str,
    _doc_name: &str,
    text: &str,
    _width_mm: u32,
) -> Result<String, String> {
    use std::io::Write;
    let mut child = Command::new("lp")
        .args(["-d", printer_name])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("lp indisponivel: {e}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("stdin do lp indisponivel")?
        .write_all(text.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    let output = child.wait_with_output().map_err(|e| format!("wait: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "lp falhou: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(format!("Cupom enviado para '{}' pelo driver", printer_name))
}

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
    win_raw::gdi_print_bitmap(
        printer_name,
        doc_name,
        &bgra,
        w as i32,
        h as i32,
        copies.max(1),
    )?;
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
        .args([
            "-d",
            printer_name,
            "-n",
            &n,
            path.to_string_lossy().as_ref(),
        ])
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

// ---------------------------------------------------------------------------
// ESC/POS — construtor de cupom de texto
// ---------------------------------------------------------------------------
//
// Caminho dedicado a impressoras de etiqueta que NÃO aceitam RAW/ESC-POS
// (ex.: PT260, Argox OS-214, Elgin L42, Zebra GK420 em modo Windows).
// Decodifica um PNG vindo do frontend e desenha via GDI (StretchDIBits) no
// DC da impressora. Compatível com qualquer driver Windows que aceite
// impressão GDI/bitmap, sem depender de SumatraPDF nem de handler PDF.

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
fn layout_receipt_lines(text: &str, width_mm: u32) -> Vec<String> {
    let cols = if width_mm <= 58 { 32 } else { 48 };
    let mut lines = Vec::new();
    for raw_line in text.split('\n') {
        let chars: Vec<char> = raw_line.chars().collect();
        if chars.is_empty() {
            lines.push(String::new());
        } else {
            lines.extend(
                chars
                    .chunks(cols)
                    .map(|chunk| chunk.iter().collect::<String>()),
            );
        }
    }
    lines
}

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
    use super::{detect_thermal, escpos_support, layout_receipt_lines, PrinterInfo};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::{ptr, slice};

    use winapi::shared::minwindef::DWORD;
    use winapi::shared::windef::HDC;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::wingdi::{
        CreateDCW, CreateFontW, DeleteDC, DeleteObject, EndDoc, EndPage, GetDeviceCaps,
        GetTextMetricsW, SelectObject, SetBkMode, StartDocW, StartPage, StretchDIBits, TextOutW,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET,
        DEFAULT_QUALITY, DIB_RGB_COLORS, DOCINFOW, FF_MODERN, FIXED_PITCH, FW_NORMAL, HORZRES,
        LOGPIXELSX, OUT_DEFAULT_PRECIS, PHYSICALHEIGHT, PHYSICALOFFSETX, PHYSICALOFFSETY,
        PHYSICALWIDTH, SRCCOPY, TEXTMETRICW, TRANSPARENT, VERTRES,
    };
    use winapi::um::winnt::HANDLE;
    use winapi::um::winspool::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW,
        OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
        PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    };
    use winapi::um::winuser::SW_HIDE;

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
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
                return Err(format!(
                    "Falha ao consultar impressoras do Windows: {}",
                    std::io::Error::last_os_error()
                ));
            }

            let default_name = default_printer_name();
            let infos =
                slice::from_raw_parts(buffer.as_ptr() as *const PRINTER_INFO_2W, returned as usize);
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
                    escpos_support: escpos_support(&name),
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

    /// Imprime o mesmo texto monoespacado do ESC/POS usando o driver do Windows.
    /// A largura fisica e limitada a 58/80 mm e conteudo longo e paginado pelo
    /// tamanho configurado no driver, sem PDF, associacao de arquivo ou popup.
    pub fn gdi_print_receipt_text(
        printer: &str,
        doc_name: &str,
        text: &str,
        width_mm: u32,
    ) -> Result<(), String> {
        unsafe {
            let driver = to_wide("WINSPOOL");
            let printer_w = to_wide(printer);
            let hdc = CreateDCW(
                driver.as_ptr(),
                printer_w.as_ptr(),
                ptr::null(),
                ptr::null(),
            );
            if hdc.is_null() {
                return Err(format!(
                    "CreateDC('{}') falhou: {}",
                    printer,
                    std::io::Error::last_os_error()
                ));
            }

            let page_w = GetDeviceCaps(hdc, HORZRES).max(1);
            let page_h = GetDeviceCaps(hdc, VERTRES).max(1);
            let dpi_x = GetDeviceCaps(hdc, LOGPIXELSX).max(96);
            let requested_w = ((width_mm as f64 / 25.4) * dpi_x as f64).round() as i32;
            let content_w = requested_w.min(page_w).max(1);
            let cols = if width_mm == 58 { 32 } else { 48 };
            let char_w = (content_w / cols).max(1);
            let requested_font_h = (char_w * 2).max(8);
            let face = to_wide("Courier New");
            let font = CreateFontW(
                -requested_font_h,
                char_w,
                0,
                0,
                FW_NORMAL,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                DEFAULT_QUALITY,
                FIXED_PITCH | FF_MODERN,
                face.as_ptr(),
            );
            if font.is_null() {
                let detail = std::io::Error::last_os_error();
                DeleteDC(hdc);
                return Err(format!("CreateFont falhou: {detail}"));
            }
            let previous_font = SelectObject(hdc, font as _);
            SetBkMode(hdc, TRANSPARENT as i32);

            let mut metrics: TEXTMETRICW = std::mem::zeroed();
            let line_h = if GetTextMetricsW(hdc, &mut metrics) != 0 {
                (metrics.tmHeight + metrics.tmExternalLeading).max(1)
            } else {
                requested_font_h
            };
            let lines_per_page = (page_h / line_h).max(1) as usize;
            let mut lines = layout_receipt_lines(text, width_mm);
            // Mesmo avanco de papel do caminho ESC/POS. O corte, quando existe,
            // fica a cargo da configuracao do driver ao encerrar a pagina/job.
            lines.extend((0..4).map(|_| String::new()));

            let doc_name_w = to_wide(doc_name);
            let mut di: DOCINFOW = std::mem::zeroed();
            di.cbSize = std::mem::size_of::<DOCINFOW>() as i32;
            di.lpszDocName = doc_name_w.as_ptr();
            if StartDocW(hdc, &di) <= 0 {
                let detail = std::io::Error::last_os_error();
                SelectObject(hdc, previous_font);
                DeleteObject(font as _);
                DeleteDC(hdc);
                return Err(format!("StartDoc falhou: {detail}"));
            }

            eprintln!(
                "[printers] GDI receipt printer='{}' width={}mm page={}x{} dpi={} cols={} line_h={}",
                printer, width_mm, page_w, page_h, dpi_x, cols, line_h
            );

            for page in lines.chunks(lines_per_page) {
                if StartPage(hdc) <= 0 {
                    let detail = std::io::Error::last_os_error();
                    EndDoc(hdc);
                    SelectObject(hdc, previous_font);
                    DeleteObject(font as _);
                    DeleteDC(hdc);
                    return Err(format!("StartPage falhou: {detail}"));
                }
                for (index, line) in page.iter().enumerate() {
                    if line.is_empty() {
                        continue;
                    }
                    let wide: Vec<u16> = OsStr::new(line).encode_wide().collect();
                    if TextOutW(
                        hdc,
                        0,
                        index as i32 * line_h,
                        wide.as_ptr(),
                        wide.len() as i32,
                    ) == 0
                    {
                        let detail = std::io::Error::last_os_error();
                        EndPage(hdc);
                        EndDoc(hdc);
                        SelectObject(hdc, previous_font);
                        DeleteObject(font as _);
                        DeleteDC(hdc);
                        return Err(format!("TextOut falhou: {detail}"));
                    }
                }
                if EndPage(hdc) <= 0 {
                    let detail = std::io::Error::last_os_error();
                    EndDoc(hdc);
                    SelectObject(hdc, previous_font);
                    DeleteObject(font as _);
                    DeleteDC(hdc);
                    return Err(format!("EndPage falhou: {detail}"));
                }
            }

            EndDoc(hdc);
            SelectObject(hdc, previous_font);
            DeleteObject(font as _);
            DeleteDC(hdc);
        }
        Ok(())
    }

    /// Imprime um bitmap BGRA (top-down) via GDI no DC da impressora informada.
    /// Caminho compatível com drivers Windows normais (PT260, Argox, Zebra-GK
    /// modo Windows, jato de tinta, laser…). Faz fit proporcional na área
    /// imprimível e respeita as margens físicas reportadas pelo driver.
    pub fn gdi_print_bitmap(
        printer: &str,
        doc_name: &str,
        bgra: &[u8],
        width: i32,
        height: i32,
        copies: u32,
    ) -> Result<(), String> {
        if width <= 0 || height <= 0 {
            return Err("bitmap inválido (dimensão zero)".into());
        }
        if bgra.len() != (width as usize) * (height as usize) * 4 {
            return Err(format!(
                "bitmap inconsistente: {} bytes para {}x{}",
                bgra.len(),
                width,
                height
            ));
        }
        unsafe {
            let driver = to_wide("WINSPOOL");
            let printer_w = to_wide(printer);
            let hdc: HDC = CreateDCW(
                driver.as_ptr(),
                printer_w.as_ptr(),
                ptr::null(),
                ptr::null(),
            );
            if hdc.is_null() {
                let e = std::io::Error::last_os_error();
                return Err(format!("CreateDC('{printer}') falhou: {e}"));
            }

            let page_w = GetDeviceCaps(hdc, HORZRES);
            let page_h = GetDeviceCaps(hdc, VERTRES);
            let phys_w = GetDeviceCaps(hdc, PHYSICALWIDTH);
            let phys_h = GetDeviceCaps(hdc, PHYSICALHEIGHT);
            let off_x = GetDeviceCaps(hdc, PHYSICALOFFSETX);
            let off_y = GetDeviceCaps(hdc, PHYSICALOFFSETY);
            // Área imprimível em coordenadas do DC (já descontadas as margens):
            // o GDI desenha relativo a (0,0) da área imprimível, então usamos
            // page_w/page_h direto. Os PHYSICAL* servem só para log.
            eprintln!(
                "[printers] GDI page={}x{} phys={}x{} off={},{}",
                page_w, page_h, phys_w, phys_h, off_x, off_y
            );

            // Fit proporcional centralizado.
            let scale = f64::min(page_w as f64 / width as f64, page_h as f64 / height as f64);
            let draw_w = ((width as f64) * scale).round() as i32;
            let draw_h = ((height as f64) * scale).round() as i32;
            let draw_x = ((page_w - draw_w) / 2).max(0);
            let draw_y = ((page_h - draw_h) / 2).max(0);

            let doc_name_w = to_wide(doc_name);
            let mut di: DOCINFOW = std::mem::zeroed();
            di.cbSize = std::mem::size_of::<DOCINFOW>() as i32;
            di.lpszDocName = doc_name_w.as_ptr();

            if StartDocW(hdc, &di) <= 0 {
                let e = std::io::Error::last_os_error();
                DeleteDC(hdc);
                return Err(format!("StartDoc falhou: {e}"));
            }

            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = width;
            // Negativo = top-down (mesma ordem dos nossos bytes BGRA).
            bmi.bmiHeader.biHeight = -height;
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;

            let mut err: Option<String> = None;
            for n in 0..copies.max(1) {
                if StartPage(hdc) <= 0 {
                    let e = std::io::Error::last_os_error();
                    err = Some(format!("StartPage cópia {n} falhou: {e}"));
                    break;
                }
                let r = StretchDIBits(
                    hdc,
                    draw_x,
                    draw_y,
                    draw_w,
                    draw_h,
                    0,
                    0,
                    width,
                    height,
                    bgra.as_ptr() as *const _,
                    &bmi,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                if r == 0 {
                    let e = std::io::Error::last_os_error();
                    EndPage(hdc);
                    err = Some(format!("StretchDIBits cópia {n} falhou: {e}"));
                    break;
                }
                if EndPage(hdc) <= 0 {
                    let e = std::io::Error::last_os_error();
                    err = Some(format!("EndPage cópia {n} falhou: {e}"));
                    break;
                }
            }

            EndDoc(hdc);
            DeleteDC(hdc);

            if let Some(e) = err {
                return Err(e);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_established_escpos_receipt_printer() {
        assert!(detect_escpos_likely("EPSON TM-T20III"));
        assert_eq!(
            receipt_attempt_order("auto", true),
            Some(&["raw", "driver"][..])
        );
    }

    #[test]
    fn unknown_thermal_printer_uses_windows_driver_in_auto() {
        assert!(detect_thermal("Generic Thermal Printer"));
        assert!(!detect_escpos_likely("Generic Thermal Printer"));
        assert_eq!(receipt_attempt_order("auto", false), Some(&["driver"][..]));
    }

    #[test]
    fn pos_8370_l_is_a_generic_pos_family_candidate_not_a_hardcoded_model() {
        assert!(detect_escpos_likely("POS-8370-L"));
        assert!(detect_escpos_likely("POS-9999 Future"));
        assert_eq!(escpos_support("POS-8370-L"), "likely");
    }

    #[test]
    fn label_printers_are_not_mistaken_for_escpos_receipt_printers() {
        for name in ["LABEL", "TSC E210", "Zebra GK420", "Argox OS-214", "PT260"] {
            assert!(!detect_escpos_likely(name), "{name}");
        }
    }

    #[test]
    fn manual_modes_are_never_replaced_and_pdf_is_never_an_attempt() {
        assert_eq!(receipt_attempt_order("raw", false), Some(&["raw"][..]));
        assert_eq!(receipt_attempt_order("driver", true), Some(&["driver"][..]));
        for likely in [false, true] {
            let attempts = receipt_attempt_order("auto", likely).unwrap();
            assert!(!attempts.contains(&"pdf"));
        }
    }

    #[test]
    fn receipt_layout_respects_58_and_80_mm_columns() {
        let text = "X".repeat(96);
        let lines_58 = layout_receipt_lines(&text, 58);
        let lines_80 = layout_receipt_lines(&text, 80);
        assert_eq!(
            lines_58
                .iter()
                .map(|line| line.chars().count())
                .collect::<Vec<_>>(),
            vec![32, 32, 32]
        );
        assert_eq!(
            lines_80
                .iter()
                .map(|line| line.chars().count())
                .collect::<Vec<_>>(),
            vec![48, 48]
        );
    }

    #[test]
    fn escpos_receipt_keeps_characters_feed_and_optional_cut() {
        let with_cut = build_escpos_receipt("acao café você", 80, true);
        let without_cut = build_escpos_receipt("teste", 58, false);
        assert!(with_cut.windows(3).any(|bytes| bytes == [0x1D, 0x56, 0x01]));
        assert!(!without_cut
            .windows(3)
            .any(|bytes| bytes == [0x1D, 0x56, 0x01]));
        assert!(with_cut.ends_with(&[0x1D, 0x56, 0x01]));
        assert!(with_cut.contains(&0xE9));
        assert!(with_cut.contains(&0xEA));
    }

    #[test]
    fn invalid_mode_and_user_error_do_not_expose_shell_details() {
        assert!(receipt_attempt_order("pdf", true).is_none());
        let message = public_receipt_error("POS-8370-L", "driver");
        assert!(message.contains("POS-8370-L"));
        assert!(!message.contains("ShellExecute"));
        assert!(!message.contains("31"));
    }
}
