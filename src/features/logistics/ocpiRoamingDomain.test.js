import { describe, it, expect } from "vitest";
import {
  isCountryCode,
  isPartyId,
  isEvseUid,
  isConnectorId,
  buildLocationId,
  buildEvseUid,
  normalizeToken,
  authorizeRoamingSession,
  splitRoamingSession,
  buildRoamingStatement,
  TOKEN_TYPES,
} from "./ocpiRoamingDomain.js";

describe("ocpiRoamingDomain", () => {
  it("validadores OCPI aceitam formatos válidos e recusam inválidos", () => {
    expect(isCountryCode("BR")).toBe(true);
    expect(isCountryCode("Br")).toBe(false);
    expect(isPartyId("TGN")).toBe(true);
    expect(isPartyId("TG")).toBe(false);
    expect(isEvseUid("BR*TGN*L01*E1")).toBe(true);
    expect(isEvseUid("")).toBe(false);
    expect(isConnectorId("1")).toBe(true);
    expect(isConnectorId("XXXXX")).toBe(false);
  });

  it("buildLocationId monta id no formato ISO", () => {
    expect(buildLocationId({ countryCode: "br", partyId: "tgn", localId: "sp01" })).toBe("BR*TGN*LSP01");
    expect(buildLocationId({ countryCode: "brasil", partyId: "tgn", localId: "sp01" })).toBeNull();
  });

  it("buildEvseUid encadeia location + evse", () => {
    const loc = buildLocationId({ countryCode: "BR", partyId: "TGN", localId: "001" });
    expect(buildEvseUid(loc, "1")).toBe("BR*TGN*L001*E1");
    expect(buildEvseUid(null, "1")).toBeNull();
    expect(buildEvseUid(loc, "")).toBeNull();
  });

  it("normalizeToken aplica default APP_USER e trata whitelist inválida", () => {
    const t = normalizeToken({ uid: "abc 123", type: "?", whitelist: "?" });
    expect(t.uid).toBe("ABC123");
    expect(t.type).toBe("APP_USER");
    expect(t.whitelist).toBe("ALLOWED");
    expect(TOKEN_TYPES).toContain(t.type);
  });

  it("authorizeRoamingSession recusa token inválido/sem uid/whitelist NEVER", () => {
    expect(authorizeRoamingSession({ uid: "", valid: true }).authorized).toBe(false);
    expect(authorizeRoamingSession({ uid: "X", valid: false }).authorized).toBe(false);
    expect(authorizeRoamingSession({ uid: "X", valid: true, whitelist: "NEVER" }).authorized).toBe(false);
  });

  it("authorizeRoamingSession com ALLOWED_OFFLINE aceita quando request.online=false", () => {
    const t = { uid: "X", valid: true, whitelist: "ALLOWED_OFFLINE" };
    expect(authorizeRoamingSession(t, { online: false }).reason).toBe("aceito-offline");
    expect(authorizeRoamingSession(t, { online: true }).reason).toBe("aceito");
  });

  it("splitRoamingSession devolve zeros para custo <= 0", () => {
    const s = splitRoamingSession({ custoBrutoReais: 0 });
    expect(s.cpoReceita).toBe(0);
    expect(s.emspTaxa).toBe(0);
    expect(s.custoCliente).toBe(0);
  });

  it("splitRoamingSession aplica taxa percentual limitada a [0,100]", () => {
    const s = splitRoamingSession({ custoBrutoReais: 100, taxaRoamingPct: 15 });
    expect(s.cpoReceita).toBe(100);
    expect(s.emspTaxa).toBe(15);
    expect(s.custoCliente).toBe(115);
    // negativo vira 0
    expect(splitRoamingSession({ custoBrutoReais: 100, taxaRoamingPct: -5 }).emspTaxa).toBe(0);
    // acima de 100 vira 100
    expect(splitRoamingSession({ custoBrutoReais: 100, taxaRoamingPct: 200 }).emspTaxa).toBe(100);
  });

  it("buildRoamingStatement agrupa por CPO e ordena por gasto do cliente", () => {
    const st = buildRoamingStatement([
      { parceiroCpoId: "cpo-A", custoBrutoReais: 50 },
      { parceiroCpoId: "cpo-B", custoBrutoReais: 30 },
      { parceiroCpoId: "cpo-A", custoBrutoReais: 20 },
      { parceiroCpoId: null, custoBrutoReais: 100 },   // ignorado
      { parceiroCpoId: "cpo-C", custoBrutoReais: 0 },  // ignorado
    ], 10);
    expect(st.contagem).toBe(3);
    expect(st.totalCpo).toBe(100);
    expect(st.totalTaxa).toBe(10);
    expect(st.totalCliente).toBe(110);
    expect(st.parceiros[0].parceiroCpoId).toBe("cpo-A");
    expect(st.parceiros[0].sessoes).toBe(2);
  });
});
