import { describe, expect, it } from "vitest";
import {
  TODO_GREEN_PERMISSIONS,
  motivoParaNaoConceder,
  papeisConcediveis,
  rotuloDoPapel,
} from "./logisticsVerticalDomain.js";

// A régua de quem concede o quê é uma só, na tela de Acessos e no worker
// (test/todogreen-concessao-de-acesso.worker.test.js trava o lado da API).
const lider = { role: "lideranca_comercial", permissions: TODO_GREEN_PERMISSIONS.lideranca_comercial, email: "lider@empresa.test" };
const liderAntigo = { role: "lideranca_comercial", permissions: ["read", "crm:manage"], email: "antigo@empresa.test" };
const admin = { role: "admin", permissions: ["*"], email: "admin@empresa.test" };

describe("quem concede o quê", () => {
  it("a liderança concede vendedor, nunca papel de administração", () => {
    expect(motivoParaNaoConceder(lider, { role: "vendedor" })).toBe("");
    for (const role of ["admin", "desenvolvedor", "owner"])
      expect({ role, pode: !motivoParaNaoConceder(lider, { role }) }).toEqual({ role, pode: false });
  });

  it("nem papel ou funcionalidade além da própria alçada", () => {
    expect(motivoParaNaoConceder(lider, { role: "financeiro" })).not.toBe("");
    expect(motivoParaNaoConceder(lider, { role: "vendedor", permissions: ["read", "finance:manage"] })).not.toBe("");
    expect(motivoParaNaoConceder(lider, { role: "vendedor", permissions: ["*"] })).not.toBe("");
  });

  it("vínculo antigo da liderança (só read + crm:manage) ainda aprova vendedor — decide pelo papel", () => {
    expect(motivoParaNaoConceder(liderAntigo, { role: "vendedor" })).toBe("");
    expect(motivoParaNaoConceder(liderAntigo, { role: "admin" })).not.toBe("");
  });

  it("não mexe no próprio acesso nem no de quem administra", () => {
    expect(motivoParaNaoConceder(lider, { role: "vendedor", email: "LIDER@empresa.test" })).toMatch(/próprio acesso/);
    expect(motivoParaNaoConceder(lider, { role: "vendedor", email: "x@empresa.test", papelAtual: "admin" })).toMatch(/administra/);
  });

  it("admin concede tudo, menos o papel de proprietário", () => {
    expect(motivoParaNaoConceder(admin, { role: "admin" })).toBe("");
    expect(motivoParaNaoConceder(admin, { role: "financeiro", permissions: ["*"] })).toBe("");
    expect(motivoParaNaoConceder(admin, { role: "owner" })).toMatch(/proprietário/);
    expect(motivoParaNaoConceder({ role: "owner", permissions: ["*"] }, { role: "owner" })).toBe("");
  });

  it("o seletor da tela só oferece o que a pessoa pode conceder", () => {
    const daLideranca = papeisConcediveis(lider);
    expect(daLideranca).toContain("vendedor");
    expect(daLideranca).not.toContain("admin");
    expect(daLideranca).not.toContain("desenvolvedor");
    expect(daLideranca).not.toContain("financeiro");
    expect(papeisConcediveis(admin)).toContain("admin");
    expect(papeisConcediveis(admin)).not.toContain("owner");
  });

  it("o papel aparece com nome de gente", () => {
    expect(rotuloDoPapel("lideranca_comercial")).toBe("Liderança Comercial");
    expect(rotuloDoPapel("rh")).toBe("DP/RH");
    expect(rotuloDoPapel("papel_novo")).toBe("papel novo");
  });
});
