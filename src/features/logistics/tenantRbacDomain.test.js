import { describe, it, expect } from "vitest";
import {
  ALL_ROLES,
  INTERNAL_ROLES,
  EXTERNAL_ROLES,
  INTERNAL_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  driverCan,
  tenantCan,
  scopedRead,
  filterByTenant,
  maskDriverPii,
  permissionsFor,
  normalizeRole,
  isInternalRole,
  isExternalRole,
} from "./tenantRbacDomain.js";

describe("tenantRbacDomain", () => {
  it("distingue papéis internos e externos e o total é a soma dos dois conjuntos, sem interseção", () => {
    const set = new Set([...INTERNAL_ROLES, ...EXTERNAL_ROLES]);
    expect(set.size).toBe(INTERNAL_ROLES.length + EXTERNAL_ROLES.length);
    expect(ALL_ROLES).toEqual([...INTERNAL_ROLES, ...EXTERNAL_ROLES]);
    for (const r of INTERNAL_ROLES) expect(isInternalRole(r)).toBe(true);
    for (const r of EXTERNAL_ROLES) expect(isExternalRole(r)).toBe(true);
  });

  it("permission de papel desconhecido devolve [] e normalizeRole devolve null", () => {
    expect(normalizeRole("xpto")).toBeNull();
    expect(permissionsFor("xpto")).toEqual([]);
  });

  it("nenhum papel externo tem capacidade INTERNAL_ONLY (blindagem de vazamento)", () => {
    for (const role of EXTERNAL_ROLES) {
      const perms = ROLE_PERMISSIONS[role] || [];
      for (const banned of INTERNAL_ONLY_PERMISSIONS) {
        expect(perms).not.toContain(banned);
      }
    }
  });

  it("cliente_leitor só lê o portal", () => {
    const s = { role: "cliente_leitor", tenantId: "t1", userId: "u1" };
    expect(can(s, "portal:read")).toBe(true);
    expect(can(s, "portal:document:download")).toBe(false);
    expect(can(s, "finance:read")).toBe(false);
  });

  it("sessão inativa nunca autoriza, mesmo com papel correto", () => {
    const s = { role: "tenant_admin", tenantId: "t1", status: "inactive" };
    expect(can(s, "fleet:read")).toBe(false);
  });

  it("driverCan(:self) exige dono igual ao userId da sessão", () => {
    const s = { role: "motorista", tenantId: "t1", userId: "driver-1" };
    expect(driverCan(s, "operation:self", { driverId: "driver-1" })).toBe(true);
    expect(driverCan(s, "operation:self", { driverId: "driver-2" })).toBe(false);
    // capacidade não :self não requer dono
    expect(driverCan(s, "greenpay:self", { userId: "driver-1" })).toBe(true);
  });

  it("tenantCan(rental:self) recusa registro de outro tenant/locatário", () => {
    const s = { role: "locatario_admin", tenantId: "t1", tenantAccountId: "loc-1" };
    expect(tenantCan(s, "rental:self:read", { tenantId: "t1", locatarioId: "loc-1" })).toBe(true);
    expect(tenantCan(s, "rental:self:read", { tenantId: "t1", locatarioId: "loc-2" })).toBe(false);
    expect(tenantCan(s, "rental:self:read", { tenantId: "t2", locatarioId: "loc-1" })).toBe(false);
  });

  it("scopedRead exige tenantId e devolve where parametrizado", () => {
    expect(() => scopedRead({})).toThrow(/tenant/);
    expect(scopedRead({ tenantId: "t1" })).toEqual({ sql: "tenant_id = ?", params: ["t1"] });
    expect(scopedRead({ tenantId: "t1" }, "status = 'ativo'")).toEqual({
      sql: "tenant_id = ? AND status = 'ativo'",
      params: ["t1"],
    });
  });

  it("filterByTenant filtra por tenant da sessão e sessão sem tenant não vê nada", () => {
    const rows = [{ id: 1, tenantId: "t1" }, { id: 2, tenantId: "t2" }, { id: 3 }];
    expect(filterByTenant(rows, { tenantId: "t1" })).toEqual([{ id: 1, tenantId: "t1" }, { id: 3 }]);
    expect(filterByTenant(rows, {})).toEqual([]);
  });

  it("maskDriverPii ofusca CPF/telefone/e-mail para quem não tem driver:read", () => {
    const drv = { id: "d1", nome: "Ana Paula Souza", cpf: "12345678901", telefone: "11987654321", email: "ana@ex.com" };
    const masked = maskDriverPii(drv, { role: "cliente_leitor", tenantId: "t1" });
    expect(masked.nome).toBe("Ana");
    expect(masked.cpf.startsWith("123")).toBe(true);
    expect(masked.cpf.includes("•")).toBe(true);
    expect(masked.email).toBe("a•••@ex.com");
  });

  it("maskDriverPii devolve o registro completo para o próprio motorista", () => {
    const drv = { id: "u1", nome: "Ana Paula", cpf: "12345678901" };
    const own = maskDriverPii(drv, { role: "motorista", tenantId: "t1", userId: "u1" });
    expect(own).toEqual(drv);
  });
});
