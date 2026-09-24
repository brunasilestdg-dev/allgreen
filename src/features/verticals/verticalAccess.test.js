import { describe, expect, it } from "vitest";
import {
  NUCLEO_ALL_GREEN,
  PORTAL_DO_PAPEL,
  destinosDoAcesso,
  todoGreenOwnerId,
} from "./verticalAccess.js";
import { VERTICAIS } from "./verticalsCatalog.js";

describe("atalhos de ambiente", () => {
  it("equipe interna vê as três verticais, na ordem do catálogo", () => {
    for (const role of ["owner", "admin", "vendedor", "financeiro", "auditor"]) {
      expect(destinosDoAcesso({ role }).map((d) => d.route), role).toEqual(
        VERTICAIS.map((v) => v.route),
      );
    }
  });

  it("motorista e colaborador vão para o próprio portal, não para o ERP", () => {
    expect(destinosDoAcesso({ role: "motorista" })).toEqual([PORTAL_DO_PAPEL.motorista]);
    expect(destinosDoAcesso({ role: "colaborador" })).toEqual([PORTAL_DO_PAPEL.colaborador]);
    expect(PORTAL_DO_PAPEL.motorista.route).toBe("/portal-motorista");
    expect(PORTAL_DO_PAPEL.colaborador.route).toBe("/portal-colaborador");
  });

  it("sem papel confirmado pelo servidor, nenhum atalho", () => {
    expect(destinosDoAcesso(null)).toEqual([]);
    expect(destinosDoAcesso({})).toEqual([]);
    expect(destinosDoAcesso({ role: "  " })).toEqual([]);
  });

  it("pergunta o acesso pelo mesmo espaço que a vertical usa", () => {
    const armazenamento = (valores) => ({ getItem: (chave) => valores[chave] ?? null });
    expect(todoGreenOwnerId(armazenamento({ "sf-space": "dona-1", "sf-active-user": "eu" }))).toBe("dona-1");
    expect(todoGreenOwnerId(armazenamento({ "sf-active-user": "eu" }))).toBe("eu");
    expect(todoGreenOwnerId(armazenamento({}))).toBe("");
    expect(todoGreenOwnerId({ getItem: () => { throw new Error("bloqueado"); } })).toBe("");
    expect(todoGreenOwnerId(undefined)).toBe("");
  });

  it("o caminho de volta da vertical leva ao núcleo, na raiz", () => {
    expect(NUCLEO_ALL_GREEN.route).toBe("/");
  });
});
