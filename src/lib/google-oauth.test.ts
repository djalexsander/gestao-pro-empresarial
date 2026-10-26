import { describe, expect, it, vi } from "vitest";
import { googleRedirectTo, iniciarLoginGoogle, loginGoogleDisponivel } from "./google-oauth";

describe("login com Google (Supabase Auth)", () => {
  it("só é oferecido na web, não no desktop Tauri", () => {
    expect(loginGoogleDisponivel(false)).toBe(true);
    expect(loginGoogleDisponivel(true)).toBe(false);
  });

  it("usa a origem atual, sem barra final, como URL de retorno", () => {
    expect(googleRedirectTo("https://gestao-pro-empresarial.alexproapps.com.br")).toBe(
      "https://gestao-pro-empresarial.alexproapps.com.br",
    );
    expect(googleRedirectTo("http://localhost:8080/")).toBe("http://localhost:8080");
  });

  it("chama supabase.auth.signInWithOAuth com provider google e redirectTo", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
    await iniciarLoginGoogle({ signInWithOAuth } as never, "https://exemplo.test/");
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://exemplo.test" },
    });
  });

  it("propaga o erro devolvido pelo Supabase", async () => {
    const erro = new Error("provider is not enabled");
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: null, error: erro });
    const r = await iniciarLoginGoogle({ signInWithOAuth } as never, "https://exemplo.test");
    expect(r.error).toBe(erro);
  });
});
