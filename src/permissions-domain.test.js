import { describe, expect, it } from "vitest";
import {
  AREA_PERMISSION_CATALOG,
  PERMISSION_AREAS,
  applyPreset,
  clearMember,
  getMemberPermissions,
  hasPermission,
  isKnownPermission,
  listPermissions,
  permissionCoverage,
  permissionInfo,
  permissionsToLegalRole,
  setPermission,
  summarizeByArea,
} from "./features/permissions/permissionsDomain.js";

describe("catálogo", () => {
  it("cobre as áreas declaradas em PERMISSION_AREAS", () => {
    for (const area of PERMISSION_AREAS) {
      expect(AREA_PERMISSION_CATALOG.find((a) => a.area === area.id)).toBeDefined();
    }
  });

  it("cada permissão traz descrição não vazia (a UI mostra pro usuário decidir)", () => {
    for (const area of AREA_PERMISSION_CATALOG) {
      for (const perm of area.permissions) {
        expect(perm.description.length).toBeGreaterThan(10);
      }
    }
  });

  it("isKnownPermission rejeita chave inventada e aceita chave do catálogo", () => {
    expect(isKnownPermission("juridico.aprovar")).toBe(true);
    expect(isKnownPermission("super-poder")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
  });

  it("permissionInfo devolve o objeto certo com área", () => {
    const info = permissionInfo("financeiro.aprovar_pagamento");
    expect(info?.area).toBe("financeiro");
  });
});

describe("mutações imutáveis", () => {
  it("setPermission liga a chave e não muta o objeto anterior", () => {
    const before = {};
    const after = setPermission(before, "u1", "juridico.solicitar", true);
    expect(before).toEqual({});
    expect(hasPermission(after, "u1", "juridico.solicitar")).toBe(true);
  });

  it("setPermission desliga a chave quando value=false", () => {
    let perms = setPermission({}, "u1", "juridico.aprovar", true);
    perms = setPermission(perms, "u1", "juridico.aprovar", false);
    expect(hasPermission(perms, "u1", "juridico.aprovar")).toBe(false);
  });

  it("setPermission ignora chave desconhecida em silêncio", () => {
    const after = setPermission({}, "u1", "nao-existe", true);
    expect(after).toEqual({});
  });

  it("hasPermission é false mesmo se alguém gravar chave desconhecida direto no banco", () => {
    const raw = { u1: { keys: { "fake.super": true } } };
    expect(hasPermission(raw, "u1", "fake.super")).toBe(false);
  });

  it("clearMember remove o registro do membro sem afetar os outros", () => {
    let perms = setPermission({}, "u1", "juridico.ver_fila", true);
    perms = setPermission(perms, "u2", "financeiro.ver", true);
    const cleared = clearMember(perms, "u1");
    expect(cleared.u1).toBeUndefined();
    expect(hasPermission(cleared, "u2", "financeiro.ver")).toBe(true);
  });
});

describe("presets", () => {
  it("Head Jurídico liga aprovação + confidencial + gestão", () => {
    const perms = applyPreset({}, "u1", "juridico_head");
    expect(hasPermission(perms, "u1", "juridico.aprovar")).toBe(true);
    expect(hasPermission(perms, "u1", "juridico.confidencial")).toBe(true);
    expect(hasPermission(perms, "u1", "juridico.gerenciar_contratos")).toBe(true);
  });

  it("Analista Jurídico NÃO liga aprovação nem confidencial", () => {
    const perms = applyPreset({}, "u1", "juridico_analista");
    expect(hasPermission(perms, "u1", "juridico.aprovar")).toBe(false);
    expect(hasPermission(perms, "u1", "juridico.confidencial")).toBe(false);
    expect(hasPermission(perms, "u1", "juridico.ver_fila")).toBe(true);
  });

  it("presets são atalho, não papel: a chave individual pode ser desmarcada depois", () => {
    let perms = applyPreset({}, "u1", "juridico_head");
    perms = setPermission(perms, "u1", "juridico.aprovar", false);
    expect(hasPermission(perms, "u1", "juridico.aprovar")).toBe(false);
    // As demais chaves seguem ligadas:
    expect(hasPermission(perms, "u1", "juridico.gerenciar_processos")).toBe(true);
  });

  it("guarda o nome do preset em `presets` só para rastro (sem virar papel oculto)", () => {
    const perms = applyPreset({}, "u1", "juridico_head");
    const slot = getMemberPermissions(perms, "u1");
    expect(slot.presets).toContain("juridico_head");
  });

  it("preset desconhecido não altera nada", () => {
    const perms = applyPreset({ u1: { keys: {}, presets: [] } }, "u1", "nao-existe");
    expect(getMemberPermissions(perms, "u1").keys).toEqual({});
  });
});

describe("adaptador para o LegalHub", () => {
  it("mapeia aprovação em head_juridico", () => {
    const perms = applyPreset({}, "u1", "juridico_head");
    expect(permissionsToLegalRole(perms, "u1")).toBe("head_juridico");
  });

  it("mapeia analista em juridico", () => {
    const perms = applyPreset({}, "u1", "juridico_analista");
    expect(permissionsToLegalRole(perms, "u1")).toBe("juridico");
  });

  it("sem permissão jurídica é solicitante — todo mundo pode pedir", () => {
    expect(permissionsToLegalRole({}, "u1")).toBe("solicitante");
    const perms = applyPreset({}, "u1", "solicitante");
    expect(permissionsToLegalRole(perms, "u1")).toBe("solicitante");
  });

  it("diretoria (ver_tudo) também entra como head_juridico", () => {
    const perms = setPermission({}, "u1", "diretoria.ver_tudo", true);
    expect(permissionsToLegalRole(perms, "u1")).toBe("head_juridico");
  });
});

describe("resumos", () => {
  it("summarizeByArea conta chaves por área", () => {
    let perms = applyPreset({}, "u1", "juridico_head");
    perms = applyPreset(perms, "u1", "financeiro_analista");
    const summary = summarizeByArea(perms, "u1");
    expect(summary.juridico).toBeGreaterThan(0);
    expect(summary.financeiro).toBeGreaterThan(0);
  });

  it("permissionCoverage conta quantos membros têm cada chave", () => {
    let perms = applyPreset({}, "u1", "juridico_analista");
    perms = applyPreset(perms, "u2", "juridico_analista");
    perms = setPermission(perms, "u3", "juridico.aprovar", true);
    const coverage = permissionCoverage(perms);
    expect(coverage["juridico.ver_fila"]).toBe(2);
    expect(coverage["juridico.aprovar"]).toBe(1);
    // chaves desconhecidas nunca aparecem
    expect(coverage["fake.super"]).toBeUndefined();
  });

  it("listPermissions só devolve chaves conhecidas", () => {
    const raw = { u1: { keys: { "juridico.solicitar": true, "fake.super": true } } };
    expect(listPermissions(raw, "u1")).toEqual(["juridico.solicitar"]);
  });
});
