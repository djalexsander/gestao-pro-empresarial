import { describe, expect, it } from "vitest";
import { resolveCommercialPlan, statusLabelPt } from "./commercialPlan";

const today = "2026-07-26";

describe("plano comercial efetivo", () => {
  it("mostra Free quando não há assinatura", () => {
    expect(resolveCommercialPlan(null, today)).toMatchObject({ planName: "Free", activeModules: 0 });
  });

  it("mantém o plano do trial vigente", () => {
    expect(resolveCommercialPlan({ status: "trial", planName: "Plano Base", expiresAt: "2026-07-27" }, today))
      .toMatchObject({ planName: "Plano Base", status: "período de teste" });
  });

  it("uma assinatura paga ativa nunca aparece como Free", () => {
    expect(resolveCommercialPlan({ status: "active", planName: "Plano Base", activeModules: 6 }, today))
      .toMatchObject({ planName: "Plano Base", status: "ativo", activeModules: 6 });
  });

  it("uma assinatura expirada não permanece ativa", () => {
    expect(resolveCommercialPlan({ status: "active", planName: "Plano Base", expiresAt: "2026-07-25", activeModules: 6 }, today))
      .toMatchObject({ planName: "Free", status: "expirado", activeModules: 0 });
  });

  it("traduz os status sem alterar seus valores internos", () => {
    expect(["active", "pending", "canceled", "cancelled", "expired", "trial", "blocked"].map(statusLabelPt))
      .toEqual(["ativo", "pendente", "cancelado", "cancelado", "expirado", "período de teste", "bloqueado"]);
  });
});

