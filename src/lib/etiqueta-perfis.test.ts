import { describe, expect, it } from "vitest";
import { criarPerfil } from "./etiqueta-layout";
import {
  definirPadrao,
  duplicarPerfil,
  garantirPerfis,
  obterAtivo,
  obterPadrao,
  obterPerfil,
  removerPerfil,
  selecionarAtivo,
  upsertPerfil,
  type EstadoPerfis,
} from "./etiqueta-perfis";

describe("garantirPerfis — migração de configuração antiga", () => {
  it("instalação nova (sem labelFormat nem perfis) recebe um perfil padrão 50x30", () => {
    const estado = garantirPerfis({}, {});
    expect(estado.labelProfiles).toHaveLength(1);
    expect(estado.labelProfiles[0].larguraEtiquetaMm).toBe(50);
    expect(estado.labelProfiles[0].alturaEtiquetaMm).toBe(30);
    expect(estado.labelProfiles[0].padrao).toBe(true);
    expect(estado.labelProfileId).toBe(estado.labelProfiles[0].id);
  });

  it("migra labelFormat legado ('40x30') para um perfil 1-coluna padrão", () => {
    const estado = garantirPerfis({}, { labelFormat: "40x30" });
    expect(estado.labelProfiles).toHaveLength(1);
    const perfil = estado.labelProfiles[0];
    expect(perfil.larguraEtiquetaMm).toBe(40);
    expect(perfil.alturaEtiquetaMm).toBe(30);
    expect(perfil.colunas).toBe(1);
    expect(perfil.larguraMidiaMm).toBe(40);
    expect(perfil.padrao).toBe(true);
  });

  it("migra labelCustomFormats como perfis adicionais não-padrão", () => {
    const estado = garantirPerfis(
      {},
      { labelFormat: "50x30", labelCustomFormats: ["60x40", "80x40"] },
    );
    expect(estado.labelProfiles).toHaveLength(3);
    const nomes = estado.labelProfiles.map((p) => `${p.larguraEtiquetaMm}x${p.alturaEtiquetaMm}`);
    expect(nomes).toEqual(expect.arrayContaining(["50x30", "60x40", "80x40"]));
    expect(estado.labelProfiles.filter((p) => p.padrao)).toHaveLength(1);
  });

  it("é idempotente: não mexe na lista quando perfis já existem (não ressuscita excluídos)", () => {
    const perfil = criarPerfil({ nome: "Meu perfil custom", padrao: true });
    const resultado = garantirPerfis(
      { labelProfiles: [perfil], labelProfileId: perfil.id },
      { labelFormat: "50x30" },
    );
    expect(resultado.labelProfiles).toEqual([perfil]);
  });

  it("corrige labelProfileId órfão (apontando pra perfil inexistente) para o padrão", () => {
    const perfil = criarPerfil({ nome: "Único", padrao: true });
    const resultado = garantirPerfis(
      { labelProfiles: [perfil], labelProfileId: "id-que-nao-existe" },
      {},
    );
    expect(resultado.labelProfileId).toBe(perfil.id);
  });
});

describe("CRUD de perfis", () => {
  function estadoBase(): EstadoPerfis {
    const a = criarPerfil({ id: "a", nome: "A", padrao: true });
    const b = criarPerfil({ id: "b", nome: "B" });
    return { labelProfiles: [a, b], labelProfileId: "a" };
  }

  it("upsertPerfil cria um novo perfil quando o id não existe", () => {
    const estado = estadoBase();
    const novo = criarPerfil({ id: "c", nome: "C" });
    const resultado = upsertPerfil(estado, novo);
    expect(resultado.labelProfiles).toHaveLength(3);
    expect(obterPerfil(resultado, "c")?.nome).toBe("C");
  });

  it("upsertPerfil edita um perfil existente sem duplicar", () => {
    const estado = estadoBase();
    const editado = { ...obterPerfil(estado, "b")!, nome: "B editado" };
    const resultado = upsertPerfil(estado, editado);
    expect(resultado.labelProfiles).toHaveLength(2);
    expect(obterPerfil(resultado, "b")?.nome).toBe("B editado");
  });

  it("upsertPerfil marcando padrao:true remove o padrão dos demais", () => {
    const estado = estadoBase();
    const b = { ...obterPerfil(estado, "b")!, padrao: true };
    const resultado = upsertPerfil(estado, b);
    expect(obterPerfil(resultado, "a")?.padrao).toBe(false);
    expect(obterPerfil(resultado, "b")?.padrao).toBe(true);
  });

  it("duplicarPerfil cria uma cópia independente com novo id", () => {
    const estado = estadoBase();
    const { estado: resultado, novo } = duplicarPerfil(estado, "a");
    expect(novo).not.toBeNull();
    expect(novo!.id).not.toBe("a");
    expect(novo!.nome).toBe("A (cópia)");
    expect(novo!.padrao).toBe(false);
    expect(resultado.labelProfiles).toHaveLength(3);
    // Original não foi alterado.
    expect(obterPerfil(resultado, "a")?.nome).toBe("A");
  });

  it("duplicarPerfil com id inexistente é no-op seguro", () => {
    const estado = estadoBase();
    const { estado: resultado, novo } = duplicarPerfil(estado, "zzz");
    expect(novo).toBeNull();
    expect(resultado).toBe(estado);
  });

  it("removerPerfil exclui e promove outro perfil a padrão se o removido era padrão", () => {
    const estado = estadoBase();
    const resultado = removerPerfil(estado, "a");
    expect(resultado.ok).toBe(true);
    expect(resultado.estado.labelProfiles).toHaveLength(1);
    expect(resultado.estado.labelProfiles[0].padrao).toBe(true);
  });

  it("removerPerfil realoca labelProfileId quando o ativo foi removido", () => {
    const estado = estadoBase();
    const resultado = removerPerfil(estado, "a");
    expect(resultado.estado.labelProfileId).toBe(resultado.estado.labelProfiles[0].id);
  });

  it("removerPerfil recusa excluir o único perfil restante", () => {
    const unico: EstadoPerfis = {
      labelProfiles: [criarPerfil({ id: "a", padrao: true })],
      labelProfileId: "a",
    };
    const resultado = removerPerfil(unico, "a");
    expect(resultado.ok).toBe(false);
    expect(resultado.estado.labelProfiles).toHaveLength(1);
  });

  it("definirPadrao troca o padrão de forma exclusiva", () => {
    const estado = estadoBase();
    const resultado = definirPadrao(estado, "b");
    expect(obterPadrao(resultado)?.id).toBe("b");
    expect(obterPerfil(resultado, "a")?.padrao).toBe(false);
  });

  it("selecionarAtivo troca qual perfil este terminal está usando", () => {
    const estado = estadoBase();
    const resultado = selecionarAtivo(estado, "b");
    expect(obterAtivo(resultado)?.id).toBe("b");
  });

  it("obterAtivo cai para o padrão quando labelProfileId é nulo", () => {
    const estado = estadoBase();
    expect(obterAtivo({ ...estado, labelProfileId: null })?.id).toBe("a");
  });
});
