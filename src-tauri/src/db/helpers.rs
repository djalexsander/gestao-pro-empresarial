//! Helpers puros do módulo `db`.
//!
//! Extraídos de `db/mod.rs` (PROMPT 12) como primeira etapa de divisão por
//! domínio. Aqui só entram funções **sem regra de negócio** e **sem acesso
//! ao banco**: conversões de tempo, leitura de campos JSON e a curva de
//! backoff usada pela outbox. Nenhum contrato HTTP/JSON depende destes
//! símbolos diretamente — eles são utilitários internos do crate.
//!
//! Próximos candidatos seguros para extração (etapas futuras): structs e
//! helpers da outbox (`OutboxItem`, `OutboxStats`, marcações de status),
//! stats por domínio e leitura/cache KV. Regras transacionais de
//! vendas/caixa/estoque **não** devem ser movidas sem testes dedicados.

use serde_json::Value;

/// Converte uma string ISO-8601/RFC-3339 em timestamp em milissegundos.
/// Retorna `None` se a string não for parseável.
pub(super) fn parse_iso_to_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

/// Lê um campo string de um `serde_json::Value` por chave.
pub(super) fn json_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

/// Lê um campo numérico (f64) de um `serde_json::Value` por chave.
pub(super) fn json_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

/// Formata um timestamp em milissegundos como string RFC-3339 UTC ("...Z").
/// Devolve string vazia se o valor estiver fora do intervalo válido.
pub(super) fn iso_from_ms_z_pub(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

/// Curva de backoff (ms) por número de tentativas de envio da outbox.
/// Mantém **exatamente** os mesmos valores anteriores — não alterar sem
/// revisão coordenada do scheduler de sync.
pub(super) fn backoff_ms_for_attempts(attempts: i64) -> i64 {
    match attempts {
        a if a <= 1 => 5_000,
        2 => 15_000,
        3 => 60_000,
        4 => 5 * 60_000,
        _ => 15 * 60_000,
    }
}

// ============================================================================
// Tests (PROMPT 13) — fixam o comportamento dos helpers puros.
// Rodar com: `cargo test -p gestao-pro --lib`.
// Não dependem de SQLite, rede ou Supabase.
// ============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn backoff_curve_locked() {
        // Trava a curva exata usada pelo scheduler de outbox. Alterar
        // estes valores deve ser uma decisão consciente.
        assert_eq!(backoff_ms_for_attempts(0), 5_000);
        assert_eq!(backoff_ms_for_attempts(1), 5_000);
        assert_eq!(backoff_ms_for_attempts(2), 15_000);
        assert_eq!(backoff_ms_for_attempts(3), 60_000);
        assert_eq!(backoff_ms_for_attempts(4), 5 * 60_000);
        assert_eq!(backoff_ms_for_attempts(5), 15 * 60_000);
        assert_eq!(backoff_ms_for_attempts(99), 15 * 60_000);
    }

    #[test]
    fn backoff_is_monotonic_nondecreasing() {
        let mut prev = 0_i64;
        for n in 0..20 {
            let cur = backoff_ms_for_attempts(n);
            assert!(cur >= prev, "backoff regrediu em n={n}: {cur} < {prev}");
            prev = cur;
        }
    }

    #[test]
    fn parse_iso_to_ms_roundtrip() {
        let ms = 1_700_000_000_000_i64;
        let s = iso_from_ms_z_pub(ms);
        assert!(!s.is_empty(), "iso_from_ms_z_pub devolveu vazio");
        let back = parse_iso_to_ms(&s).expect("parse_iso_to_ms falhou");
        assert_eq!(back, ms);
    }

    #[test]
    fn parse_iso_to_ms_invalid_returns_none() {
        assert!(parse_iso_to_ms("").is_none());
        assert!(parse_iso_to_ms("not-a-date").is_none());
        assert!(parse_iso_to_ms("2024-13-40").is_none());
    }

    #[test]
    fn iso_from_extreme_ms_is_safe() {
        // Não deve causar panic em valores extremos.
        let _ = iso_from_ms_z_pub(i64::MAX);
        let _ = iso_from_ms_z_pub(i64::MIN);
        let _ = iso_from_ms_z_pub(0);
    }

    #[test]
    fn json_str_and_f64_extract_fields() {
        let v = json!({ "nome": "Café", "preco": 12.5, "qtd": 3 });
        assert_eq!(json_str(&v, "nome"), Some("Café"));
        assert_eq!(json_str(&v, "ausente"), None);
        assert_eq!(json_f64(&v, "preco"), Some(12.5));
        assert_eq!(json_f64(&v, "qtd"), Some(3.0));
        assert_eq!(json_f64(&v, "nome"), None);
    }
}
