import { describe, expect, it, vi } from "vitest";
import {
  checkDesktopUpdate,
  downloadInstallAndRelaunch,
  type DesktopUpdate,
  type UpdaterDependencies,
} from "./tauriUpdater";

function makeUpdate(
  downloadAndInstall: DesktopUpdate["downloadAndInstall"] = vi.fn(async (): Promise<void> => undefined),
): DesktopUpdate {
  return {
    version: "1.2.1",
    rawJson: {
      platforms: {
        "windows-x86_64": { url: "https://example.test/gestao-pro_1.2.1_x64-setup.exe" },
      },
    },
    downloadAndInstall,
  };
}

function makeDeps(overrides: Partial<UpdaterDependencies> = {}) {
  const log = vi.fn(async (_input: Parameters<UpdaterDependencies["log"]>[0]): Promise<void> => undefined);
  const deps: UpdaterDependencies = {
    check: vi.fn(async () => makeUpdate()),
    getVersion: vi.fn(async () => "1.2.0"),
    relaunch: vi.fn(async () => undefined),
    log,
    ...overrides,
  };
  return { deps, log };
}

describe("tauriUpdater", () => {
  it("executa o fluxo de sucesso e registra download e instalação", async () => {
    const downloadAndInstall = vi.fn(async (onEvent?: (event: any) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 30 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 10 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 20 } });
      onEvent?.({ event: "Finished", data: {} });
    });
    const update = makeUpdate(downloadAndInstall);
    const { deps, log } = makeDeps();

    await downloadInstallAndRelaunch({ update }, deps);

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(deps.relaunch).toHaveBeenCalledOnce();
    expect(log.mock.calls.map((call) => (call[0] as { type: string }).type)).toEqual(expect.arrayContaining([
      "updater-install-request",
      "updater-download-start",
      "updater-download-progress",
      "updater-download-finished",
      "updater-install-start",
      "updater-install-returned-to-javascript",
    ]));
  });

  it("propaga e registra erro em check()", async () => {
    const failure = new Error("manifesto indisponível");
    const { deps, log } = makeDeps({ check: vi.fn(async () => { throw failure; }) });

    await expect(checkDesktopUpdate(deps)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      type: "updater-check-error",
      error: expect.objectContaining({ message: "manifesto indisponível" }),
    }));
  });

  it("propaga e registra erro em downloadAndInstall() sem reiniciar", async () => {
    const cause = new Error("assinatura inválida");
    const failure = new Error("falha ao instalar", { cause });
    const update = makeUpdate(vi.fn(async () => { throw failure; }));
    const { deps, log } = makeDeps();

    await expect(downloadInstallAndRelaunch({ update }, deps)).rejects.toBe(failure);
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      type: "updater-install-error",
      error: expect.objectContaining({ message: "falha ao instalar" }),
      additional: expect.objectContaining({ errorDetails: expect.objectContaining({ message: "falha ao instalar" }) }),
    }));
  });

  it("chama relaunch somente depois que a instalação retorna ao JavaScript", async () => {
    const order: string[] = [];
    const update = makeUpdate(vi.fn(async () => { order.push("install-returned"); }));
    const { deps } = makeDeps({ relaunch: vi.fn(async () => { order.push("relaunch"); }) });

    await downloadInstallAndRelaunch({ update }, deps);

    expect(order).toEqual(["install-returned", "relaunch"]);
  });

  it("não instala quando check() retorna null", async () => {
    const { deps } = makeDeps({ check: vi.fn(async () => null) });

    const checked = await checkDesktopUpdate(deps);

    expect(checked.update).toBeNull();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("reutiliza a mesma execução para cliques simultâneos", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const downloadAndInstall = vi.fn(async () => gate);
    const update = makeUpdate(downloadAndInstall);
    const { deps } = makeDeps();

    const first = downloadInstallAndRelaunch({ update }, deps);
    const second = downloadInstallAndRelaunch({ update }, deps);
    release();
    await Promise.all([first, second]);

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(deps.relaunch).toHaveBeenCalledOnce();
  });

  it("mascara credenciais presentes em mensagens de erro", async () => {
    const failure = new Error("request failed: Authorization: Bearer secret-token?token=abc123");
    const { deps, log } = makeDeps({ check: vi.fn(async () => { throw failure; }) });

    await expect(checkDesktopUpdate(deps)).rejects.toBe(failure);

    const errorEntry = log.mock.calls.find((call) => call[0].type === "updater-check-error")?.[0];
    expect(JSON.stringify(errorEntry)).not.toContain("secret-token");
    expect(JSON.stringify(errorEntry)).not.toContain("abc123");
    expect(JSON.stringify(errorEntry)).toContain("[redacted]");
  });
});
