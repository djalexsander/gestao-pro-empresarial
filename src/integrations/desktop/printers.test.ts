import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteBobinaProfile,
  duplicateBobinaProfile,
  getActiveBobinaProfile,
  getBobinaProfiles,
  getPrinterDpi,
  printLabelSheet,
  printReceipt,
  saveBobinaProfile,
  setActiveBobinaProfileId,
  setDefaultBobinaProfile,
  type PrinterDpi,
  type ReceiptPrintResult,
  type TauriInvoke,
} from "./printers";
import { clearDesktopConfig, hydrateDesktopConfig } from "./configStore";
import { criarPerfil } from "@/lib/etiqueta-layout";

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

describe("printLabelSheet — pipeline central de etiquetas em folha (colunas x linhas)", () => {
  it("envia cada linha como uma página, na ordem, para o comando print_label_sheet", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => "ok");
    const pagina1 = new Uint8Array([1, 2, 3]);
    const pagina2 = new Uint8Array([4, 5]);

    const resultado = await printLabelSheet([pagina1, pagina2], "TSC E210", 3, {
      invoke: invoke as TauriInvoke,
    });

    expect(resultado).toBe("ok");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("print_label_sheet", {
      pages: [Array.from(pagina1), Array.from(pagina2)],
      printerName: "TSC E210",
      copies: 3,
    });
  });

  it("propaga o erro do backend quando a impressora não existe/falha (sem mascarar a mensagem)", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("CreateDC('Impressora Inexistente') falhou");
    });

    await expect(
      printLabelSheet([new Uint8Array([1])], "Impressora Inexistente", 1, {
        invoke: invoke as TauriInvoke,
      }),
    ).rejects.toThrow("CreateDC");
  });

  it("fora do desktop, rejeita com mensagem amigável sem chamar invoke", async () => {
    await expect(
      printLabelSheet([new Uint8Array([1])], "Qualquer", 1, { invoke: undefined }),
    ).rejects.toThrow(/desktop/i);
  });
});

describe("getPrinterDpi — consulta de DPI do driver (modo Automático)", () => {
  it("retorna o DPI relatado pelo driver quando a consulta funciona", async () => {
    const dpi: PrinterDpi = { x: 300, y: 300 };
    const invoke = vi.fn(async () => dpi);
    const resultado = await getPrinterDpi("TSC E210", { invoke: invoke as TauriInvoke });
    expect(resultado).toEqual(dpi);
    expect(invoke).toHaveBeenCalledWith("get_printer_dpi", { printerName: "TSC E210" });
  });

  it("retorna null (fallback seguro) quando a consulta falha, sem lançar", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("driver indisponível");
    });
    await expect(getPrinterDpi("X", { invoke: invoke as TauriInvoke })).resolves.toBeNull();
  });

  it("retorna null fora do desktop", async () => {
    await expect(getPrinterDpi("X", { invoke: undefined })).resolves.toBeNull();
  });
});

describe("perfis de bobina — persistência por terminal", () => {
  beforeAll(async () => {
    await hydrateDesktopConfig();
  });

  beforeEach(() => {
    clearDesktopConfig();
  });

  it("configuração nova (sem uso prévio) já expõe um perfil padrão utilizável", () => {
    const perfis = getBobinaProfiles();
    expect(perfis.length).toBeGreaterThan(0);
    expect(getActiveBobinaProfile()).not.toBeNull();
  });

  it("salvar um novo perfil o torna disponível em getBobinaProfiles", () => {
    const perfil = criarPerfil({
      id: "t-40x27",
      nome: "40x27 2 colunas",
      colunas: 2,
      larguraMidiaMm: 84,
    });
    saveBobinaProfile(perfil);
    const perfis = getBobinaProfiles();
    expect(perfis.some((p) => p.id === "t-40x27")).toBe(true);
  });

  it("editar um perfil existente (mesmo id) atualiza em vez de duplicar", () => {
    saveBobinaProfile(criarPerfil({ id: "t-edit", nome: "Original" }));
    const antes = getBobinaProfiles().length;
    saveBobinaProfile({ ...getBobinaProfiles().find((p) => p.id === "t-edit")!, nome: "Editado" });
    expect(getBobinaProfiles()).toHaveLength(antes);
    expect(getBobinaProfiles().find((p) => p.id === "t-edit")?.nome).toBe("Editado");
  });

  it("duplicar um perfil cria uma cópia independente", () => {
    saveBobinaProfile(criarPerfil({ id: "t-dup", nome: "Base" }));
    const copia = duplicateBobinaProfile("t-dup");
    expect(copia).not.toBeNull();
    expect(copia?.id).not.toBe("t-dup");
    expect(getBobinaProfiles().some((p) => p.id === copia?.id)).toBe(true);
  });

  it("excluir um perfil o remove da lista", () => {
    saveBobinaProfile(criarPerfil({ id: "t-del", nome: "Descartável" }));
    const resultado = deleteBobinaProfile("t-del");
    expect(resultado.ok).toBe(true);
    expect(getBobinaProfiles().some((p) => p.id === "t-del")).toBe(false);
  });

  it("não permite excluir o único perfil restante", () => {
    // Reduz à força para 1 perfil só, via API pública (exclui todos exceto o padrão).
    for (const p of getBobinaProfiles().slice(1)) {
      deleteBobinaProfile(p.id);
    }
    const restante = getBobinaProfiles();
    expect(restante).toHaveLength(1);
    const resultado = deleteBobinaProfile(restante[0].id);
    expect(resultado.ok).toBe(false);
    expect(getBobinaProfiles()).toHaveLength(1);
  });

  it("definir um perfil como padrão é exclusivo", () => {
    saveBobinaProfile(criarPerfil({ id: "t-pad-a", nome: "A" }));
    saveBobinaProfile(criarPerfil({ id: "t-pad-b", nome: "B" }));
    setDefaultBobinaProfile("t-pad-b");
    const perfis = getBobinaProfiles();
    expect(perfis.find((p) => p.id === "t-pad-b")?.padrao).toBe(true);
    expect(perfis.filter((p) => p.padrao)).toHaveLength(1);
  });

  it("trocar o perfil ativo deste terminal reflete em getActiveBobinaProfile", () => {
    saveBobinaProfile(criarPerfil({ id: "t-ativo", nome: "Ativo" }));
    setActiveBobinaProfileId("t-ativo");
    expect(getActiveBobinaProfile()?.id).toBe("t-ativo");
  });
});
