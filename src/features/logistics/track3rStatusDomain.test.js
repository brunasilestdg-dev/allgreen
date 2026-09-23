import { describe, it, expect } from "vitest";
import {
  categoriaStatusTrack3r,
  ehStatusEntregue,
  ehStatusInsucesso,
  CATEGORIAS_INSUCESSO,
} from "./track3rStatusDomain.js";

describe("De-para oficial de status da Track3r", () => {
  it("mapeia por código", () => {
    expect(categoriaStatusTrack3r("2")).toBe("entregue");
    expect(categoriaStatusTrack3r("3")).toBe("em_transito");
    expect(categoriaStatusTrack3r("178")).toBe("insucesso");
  });

  it("mapeia por descrição (texto do descricao_status)", () => {
    expect(categoriaStatusTrack3r("Entregue")).toBe("entregue");
    expect(categoriaStatusTrack3r("Em Rota")).toBe("em_transito");
    expect(categoriaStatusTrack3r("Cliente ausente")).toBe("insucesso");
  });

  it("é tolerante a caixa/acentos/espaços na descrição", () => {
    expect(categoriaStatusTrack3r("  ENTREGUE ")).toBe("entregue");
    expect(categoriaStatusTrack3r("destinatario ausente")).toBe("insucesso");
    expect(categoriaStatusTrack3r("Destinatário Ausente")).toBe("insucesso");
  });

  it("retorna vazio para status fora da tabela oficial", () => {
    expect(categoriaStatusTrack3r("Status inventado que não existe")).toBe("");
    expect(categoriaStatusTrack3r("")).toBe("");
    expect(categoriaStatusTrack3r(null)).toBe("");
    expect(categoriaStatusTrack3r(undefined)).toBe("");
  });

  it("ehStatusEntregue só é verdadeiro para a categoria entregue", () => {
    expect(ehStatusEntregue("Entregue")).toBe(true);
    expect(ehStatusEntregue("2")).toBe(true);
    expect(ehStatusEntregue("Em Rota")).toBe(false);
    expect(ehStatusEntregue("Cliente ausente")).toBe(false);
    expect(ehStatusEntregue("qualquer coisa")).toBe(false);
  });

  it("ehStatusInsucesso cobre insucesso/avaria/extravio e nada além", () => {
    expect(ehStatusInsucesso("Cliente ausente")).toBe(true); // insucesso
    expect(ehStatusInsucesso("Extravio Total - Armazém")).toBe(true); // extravio
    expect(ehStatusInsucesso("Entregue")).toBe(false);
    expect(ehStatusInsucesso("Em Rota")).toBe(false); // em trânsito não é insucesso
    expect(ehStatusInsucesso("Devolvido")).toBe(false); // devolução não é insucesso
  });

  it("CATEGORIAS_INSUCESSO é congelada e contém só as falhas de entrega", () => {
    expect(CATEGORIAS_INSUCESSO).toEqual(["insucesso", "avaria", "extravio"]);
    expect(Object.isFrozen(CATEGORIAS_INSUCESSO)).toBe(true);
  });
});
