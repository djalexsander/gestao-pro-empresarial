import { describe, expect, it, vi } from "vitest";
import { printReceipt, type ReceiptPrintResult, type TauriInvoke } from "./printers";

function invokeReturning(result: ReceiptPrintResult) {
  return vi.fn(async (_command: string, _args?: Record<string, unknown>) => result);
}

describe("pipeline central de cupom", () => {
  it.each([
    ["auto", 80, "raw"],
    ["raw", 58, "raw"],
    ["driver", 80, "driver"],
  ] as const)("envia modo %s e largura %i ao mesmo comando", async (mode, widthMm, resolved) => {
    const invoke = invokeReturning({ mode: resolved, message: "ok" });

    const result = await printReceipt(
      "TESTE\nCENTRALIZADO",
      "POS-8370-L",
      { mode, widthMm, cut: true },
      { invoke: invoke as TauriInvoke },
    );

    expect(result.mode).toBe(resolved);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("print_receipt", {
      text: "TESTE\nCENTRALIZADO",
      printerName: "POS-8370-L",
      mode,
      widthMm,
      cut: true,
    });
  });

  it("nao tenta PDF quando o pipeline nativo falha, mesmo sem handler PDF", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => {
      throw new Error("ShellExecute printto retornou 31");
    });

    await expect(
      printReceipt(
        "CUPOM REAL",
        "Impressora inexistente",
        { mode: "auto" },
        { invoke: invoke as TauriInvoke },
      ),
    ).rejects.toThrow("ShellExecute");

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0]).toBe("print_receipt");
    expect(invoke.mock.calls.some(([command]) => command === "print_pdf_bytes")).toBe(false);
  });

  it("usa o mesmo contrato para teste e cupom real", async () => {
    const invoke = invokeReturning({ mode: "driver", message: "ok" });
    const jobs = [
      "GESTAO PRO\nTESTE DE IMPRESSAO\nAVANCO E CORTE AO FINAL",
      "CUPOM NAO FISCAL\n001 Produto\nTOTAL R$ 10,00",
    ];

    await Promise.all(
      jobs.map((text) =>
        printReceipt(
          text,
          "Generic Thermal Printer",
          { mode: "auto", widthMm: 80 },
          { invoke: invoke as TauriInvoke },
        ),
      ),
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "print_receipt",
      "print_receipt",
    ]);
  });
});
