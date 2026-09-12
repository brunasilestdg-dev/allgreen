import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_CHAMADO,
  categoriaChamadoValida,
  rotuloCategoriaChamado,
  STATUS_CHAMADO,
  rotuloStatusChamado,
  validarChamado,
  chamadoAtivo,
  podeAtender,
  podeResolver,
  podeCancelar,
} from "./employeeTicketDomain.js";

describe("Chamado do colaborador — categorias e status", () => {
  it("categorias oficiais e rótulo", () => {
    expect(CATEGORIAS_CHAMADO.map((c) => c.id)).toContain("dados_cadastrais");
    expect(categoriaChamadoValida("banco_pix")).toBe(true);
    expect(categoriaChamadoValida("xpto")).toBe(false);
    expect(rotuloCategoriaChamado("banco_pix")).toBe("Banco / PIX");
  });
  it("status oficiais e rótulo", () => {
    expect(STATUS_CHAMADO.map((s) => s.id)).toEqual(["aberto", "em_andamento", "resolvido", "cancelado"]);
    expect(rotuloStatusChamado("resolvido")).toBe("Resolvido");
  });
});

describe("Chamado do colaborador — validação", () => {
  it("exige categoria válida, assunto e descrição mínima", () => {
    expect(validarChamado({ categoria: "xpto", assunto: "a", descricao: "detalhe" }).valido).toBe(false);
    expect(validarChamado({ categoria: "dados_cadastrais", assunto: "", descricao: "detalhe" }).valido).toBe(false);
    expect(validarChamado({ categoria: "dados_cadastrais", assunto: "Erro no PIX", descricao: "abc" }).valido).toBe(false);
    expect(validarChamado({ categoria: "dados_cadastrais", assunto: "Erro no PIX", descricao: "Minha chave está errada" }).valido).toBe(true);
  });
});

describe("Chamado do colaborador — transições", () => {
  it("ativo, atender, resolver, cancelar por status", () => {
    expect(chamadoAtivo("aberto")).toBe(true);
    expect(chamadoAtivo("resolvido")).toBe(false);
    expect(podeAtender("aberto")).toBe(true);
    expect(podeAtender("em_andamento")).toBe(false);
    expect(podeResolver("em_andamento")).toBe(true);
    expect(podeResolver("resolvido")).toBe(false);
    expect(podeCancelar("aberto")).toBe(true);
    expect(podeCancelar("cancelado")).toBe(false);
  });
});
