/**
 * @vitest-environment jsdom
 *
 * Regressão: o Dialog Radix (@radix-ui/react-dialog + react-presence) monta
 * o <canvas> da prévia um ciclo de render DEPOIS do `open` virar `true` —
 * `Presence` inicia em "unmounted" e só despacha "MOUNT" dentro de um
 * useLayoutEffect, ou seja, o commit em que `open` muda ainda renderiza
 * `null` no lugar do conteúdo do dialog. Um efeito que lê `canvasRef.current`
 * usando `open`/`produto`/etc. como dependências chega cedo demais (ref
 * ainda nulo) e nunca roda de novo, pois nenhuma dessas dependências muda no
 * commit seguinte — a prévia fica em branco pra sempre. Ver EtiquetaImpressaoDialog.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EtiquetaImpressaoDialog } from "./EtiquetaImpressaoDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockRenderizarFolhas } = vi.hoisted(() => ({
  mockRenderizarFolhas: vi
    .fn()
    .mockResolvedValue([
      { png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), larguraDots: 10, alturaDots: 10 },
    ]),
}));

vi.mock("@/lib/etiqueta-render", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/etiqueta-render")>();
  return { ...mod, renderizarFolhas: mockRenderizarFolhas };
});

const produto = { nome: "Produto Teste", codigo: "7891000100103", preco: 19.9, sku: null };

describe("EtiquetaImpressaoDialog — prévia da etiqueta", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    mockRenderizarFolhas.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renderiza a prévia mesmo quando o dialog abre a partir de uma instância já montada (timing real do Radix Presence)", async () => {
    // Igual ao app real: o componente já existe montado com open=false, e só
    // depois recebe open=true — é essa transição (não um mount "a frio" já
    // aberto) que expõe o atraso de 1 ciclo do Presence.
    await act(async () => {
      root.render(<EtiquetaImpressaoDialog open={false} onOpenChange={() => {}} produto={null} />);
    });

    expect(mockRenderizarFolhas).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <EtiquetaImpressaoDialog open={true} onOpenChange={() => {}} produto={produto} />,
      );
    });

    expect(mockRenderizarFolhas).toHaveBeenCalledTimes(1);
    const chamada = mockRenderizarFolhas.mock.calls[0][0];
    expect(chamada.perfil.larguraEtiquetaMm).toBe(50);
    expect(chamada.perfil.alturaEtiquetaMm).toBe(30);
    expect(chamada.itens).toHaveLength(chamada.perfil.colunas);
  });
});
