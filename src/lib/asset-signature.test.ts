import { describe, expect, it } from "vitest";
import { extractAssetSignature } from "./asset-signature";

const ORIGIN = "https://gestao-pro-empresarial.alexproapps.com.br";

const shellSsr = (js: string, css: string) =>
  `<html><head><link rel="stylesheet" href="/assets/${css}.css"/></head>` +
  `<body><script type="module" src="/assets/${js}.js"></script></body></html>`;

const shellSpa = (entry: string, css: string, preload: string[]) =>
  `<html><head><link rel="stylesheet" href="/assets/${css}.css"/>` +
  preload.map((p) => `<link rel="modulepreload" href="/assets/${p}.js"/>`).join("") +
  `</head><body><script type="module" async="">import("/assets/${entry}.js")</script></body></html>`;

describe("extractAssetSignature", () => {
  it("shell SSR: muda quando o script de entrada muda", () => {
    const a = extractAssetSignature(shellSsr("index-A", "styles-1"), ORIGIN);
    const b = extractAssetSignature(shellSsr("index-B", "styles-1"), ORIGIN);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("shell SPA: um deploy que só muda o JS (CSS igual) muda a assinatura", () => {
    const a = extractAssetSignature(shellSpa("index-A", "styles-1", ["x-1"]), ORIGIN);
    const b = extractAssetSignature(shellSpa("index-B", "styles-1", ["x-1"]), ORIGIN);
    expect(a).not.toBe(b);
  });

  it("shell SPA: mudança só em um chunk com modulepreload também é detectada", () => {
    const a = extractAssetSignature(shellSpa("index-A", "styles-1", ["x-1"]), ORIGIN);
    const b = extractAssetSignature(shellSpa("index-A", "styles-1", ["x-2"]), ORIGIN);
    expect(a).not.toBe(b);
  });

  it("é estável para o mesmo HTML e independe da ordem", () => {
    const a = extractAssetSignature(shellSpa("index-A", "styles-1", ["x-1", "y-1"]), ORIGIN);
    const b = extractAssetSignature(shellSpa("index-A", "styles-1", ["y-1", "x-1"]), ORIGIN);
    expect(a).toBe(b);
  });

  it("ignora assets de outras origens", () => {
    const html =
      `<link rel="stylesheet" href="https://fonts.example.com/a.css"/>` +
      `<script type="module" src="/assets/index-A.js"></script>`;
    expect(extractAssetSignature(html, ORIGIN)).toBe("/assets/index-A.js");
  });

  it("devolve null quando não há assets", () => {
    expect(extractAssetSignature("<html></html>", ORIGIN)).toBeNull();
  });
});
