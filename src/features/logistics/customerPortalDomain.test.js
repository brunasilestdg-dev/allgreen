import { describe, expect, it } from "vitest";
import {
  CLIENT_PORTAL_PERMISSIONS,
  CLIENT_PORTAL_ROLES,
  INTERNAL_ONLY_PERMISSIONS,
  clientCan,
  isValidEmail,
  menuForAccess,
  normalizeEmail,
  permissionsForRole,
  resolveClientScope,
  scopedWhere,
} from "./customerPortalDomain.js";

const vinculo = (extra = {}) => ({
  tenant_id: "todogreen",
  client_id: "cli-mercado",
  client_name: "Mercado Livre",
  workspace_owner_id: "workspace-mercado",
  client_status: "ativo",
  portal_enabled: 1,
  email: "logistica@cliente.com.br",
  role: "cliente_gestor",
  status: "active",
  ...extra,
});

describe("de qual cliente é esta sessão", () => {
  it("o vínculo ativo define o cliente", () => {
    const escopo = resolveClientScope(vinculo());
    expect(escopo.clientId).toBe("cli-mercado");
    expect(escopo.clientName).toBe("Mercado Livre");
  });

  it("sem vínculo, não há cliente — e portanto não há consulta", () => {
    expect(resolveClientScope(null)).toBeNull();
    expect(resolveClientScope(undefined)).toBeNull();
  });

  it("vínculo suspenso não abre o portal", () => {
    expect(resolveClientScope(vinculo({ status: "inactive" }))).toBeNull();
  });

  it("cliente inativo não abre o portal, mesmo com vínculo ativo", () => {
    expect(resolveClientScope(vinculo({ client_status: "encerrado" }))).toBeNull();
  });

  it("portal desligado para o cliente não abre", () => {
    expect(resolveClientScope(vinculo({ portal_enabled: 0 }))).toBeNull();
  });

  it("papel desconhecido cai no menos poderoso, não no mais", () => {
    // Errar para cima seria dar acesso que ninguém concedeu.
    const escopo = resolveClientScope(vinculo({ role: "superusuario" }));
    expect(escopo.role).toBe("cliente_leitor");
    expect(escopo.permissions).toEqual(["portal:read"]);
  });
});

describe("não existe como pedir outro cliente", () => {
  it("a consulta sempre carrega tenant e cliente da sessão", () => {
    const escopo = resolveClientScope(vinculo());
    const { sql, params } = scopedWhere(escopo);
    expect(sql).toBe("tenant_id = ? AND workspace_owner_id = ? AND client_id = ?");
    expect(params).toEqual(["todogreen", "workspace-mercado", "cli-mercado"]);
  });

  it("condição extra não substitui o cliente, se soma a ele", () => {
    const escopo = resolveClientScope(vinculo());
    const { sql, params } = scopedWhere(escopo, "status = ?");
    expect(sql).toBe("tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND status = ?");
    expect(params).toEqual(["todogreen", "workspace-mercado", "cli-mercado"]);
  });

  it("montar consulta sem cliente na sessão é erro, não consulta aberta", () => {
    // Sem esta trava, esquecer o escopo devolveria a base inteira.
    expect(() => scopedWhere(null)).toThrow(/sem cliente/i);
    expect(() => scopedWhere({ tenantId: "todogreen" })).toThrow(/sem cliente/i);
    expect(() => scopedWhere({ clientId: "cli-mercado" })).toThrow(/sem cliente/i);
    expect(() => scopedWhere({ tenantId: "todogreen", clientId: "cli-mercado" })).toThrow(/sem cliente/i);
  });
});

describe("o lado do cliente não alcança o lado interno", () => {
  it("nenhum papel de cliente recebe permissão interna", () => {
    for (const papel of CLIENT_PORTAL_ROLES) {
      for (const interna of INTERNAL_ONLY_PERMISSIONS) {
        expect(
          CLIENT_PORTAL_PERMISSIONS[papel],
          `${papel} não pode receber ${interna}`,
        ).not.toContain(interna);
      }
    }
  });

  it("toda permissão de cliente é do espaço do portal", () => {
    for (const papel of CLIENT_PORTAL_ROLES)
      for (const permissao of CLIENT_PORTAL_PERMISSIONS[papel])
        expect(permissao.startsWith("portal:")).toBe(true);
  });

  it("curinga não vale no portal", () => {
    // "*" é o atalho do lado interno; aqui ele abriria tudo.
    const escopo = resolveClientScope(vinculo({ role: "cliente_admin" }));
    expect(escopo.permissions).not.toContain("*");
    expect(clientCan(escopo, "crm:view")).toBe(false);
  });
});

describe("o que a pessoa pode fazer", () => {
  it("leitor lê, mas não exporta nem abre solicitação", () => {
    const leitor = resolveClientScope(vinculo({ role: "cliente_leitor" }));
    expect(clientCan(leitor, "portal:read")).toBe(true);
    expect(clientCan(leitor, "portal:report:export")).toBe(false);
    expect(clientCan(leitor, "portal:request:create")).toBe(false);
  });

  it("só o admin do cliente gerencia as pessoas do próprio cliente", () => {
    expect(clientCan(resolveClientScope(vinculo({ role: "cliente_admin" })), "portal:user:manage")).toBe(true);
    expect(clientCan(resolveClientScope(vinculo({ role: "cliente_gestor" })), "portal:user:manage")).toBe(false);
  });

  it("acesso ausente não pode nada", () => {
    expect(clientCan(null, "portal:read")).toBe(false);
    expect(clientCan({ status: "inactive", permissions: ["portal:read"] }, "portal:read")).toBe(false);
  });
});

describe("menu", () => {
  it("mostra só o que o papel alcança", () => {
    const leitor = menuForAccess(resolveClientScope(vinculo({ role: "cliente_leitor" })));
    expect(leitor.map((i) => i.id)).toEqual(["inicio", "atendimento", "operacoes", "green-score", "esg", "planejar", "nps", "assistente"]);
  });

  it("gestor ganha relatórios, documentos e solicitações", () => {
    const gestor = menuForAccess(resolveClientScope(vinculo({ role: "cliente_gestor" })));
    expect(gestor.map((i) => i.id)).toContain("relatorios");
    expect(gestor.map((i) => i.id)).toContain("documentos");
    expect(gestor.map((i) => i.id)).toContain("solicitacoes");
  });

  it("nenhum item do menu leva a tela interna", () => {
    const admin = menuForAccess(resolveClientScope(vinculo({ role: "cliente_admin" })));
    const proibidos = ["clientes", "oportunidades", "precificacao", "propostas", "receita", "custos", "comissoes", "auditoria", "acessos"];
    for (const item of admin) expect(proibidos).not.toContain(item.id);
  });
});

describe("e-mail", () => {
  it("normaliza para comparar sem surpresa", () => {
    expect(normalizeEmail("  Pessoa@Empresa.COM.br ")).toBe("pessoa@empresa.com.br");
    expect(normalizeEmail(null)).toBe("");
  });

  it("recusa o que não é e-mail", () => {
    expect(isValidEmail("pessoa@empresa.com.br")).toBe(true);
    expect(isValidEmail("sem-arroba")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("permissionsForRole", () => {
  it("devolve o conjunto do papel", () => {
    expect(permissionsForRole("cliente_leitor")).toEqual(["portal:read"]);
  });

  it("valor estranho não quebra e não promove", () => {
    expect(permissionsForRole(null)).toEqual(["portal:read"]);
    expect(permissionsForRole("admin")).toEqual(["portal:read"]);
  });
});
