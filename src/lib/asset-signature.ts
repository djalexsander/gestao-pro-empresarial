/**
 * Assinatura dos assets referenciados pelo HTML publicado. Duas assinaturas
 * diferentes indicam que houve um novo deploy (ver `useAppUpdate`).
 *
 * Cobre os dois formatos de shell:
 *  - SSR (Cloudflare): `<script type="module" src="/assets/...">` + stylesheet;
 *  - SPA estático (Vercel): entrada inline `import("/assets/index-HASH.js")`,
 *    `<link rel="modulepreload">` e stylesheet. Sem tratar o `import()` e o
 *    modulepreload, um deploy que só muda JS (CSS igual) passaria despercebido.
 */
export function extractAssetSignature(html: string, origin: string): string | null {
  try {
    const patterns: RegExp[] = [
      /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
      /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["'][^>]*>/gi,
      /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
      /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']stylesheet["'][^>]*>/gi,
      /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
      /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']modulepreload["'][^>]*>/gi,
      /\bimport\(\s*["']([^"']+)["']\s*\)/gi,
    ];

    const urls = new Set<string>();
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) urls.add(m[1]);
    }

    const filtered = [...urls].filter((u) => {
      if (!u) return false;
      if (/^https?:\/\//i.test(u)) {
        try {
          return new URL(u, origin).origin === origin;
        } catch {
          return false;
        }
      }
      return true;
    });

    if (filtered.length === 0) return null;
    return filtered.sort().join("|");
  } catch {
    return null;
  }
}
