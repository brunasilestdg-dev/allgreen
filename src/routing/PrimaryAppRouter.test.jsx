/* @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePrimaryRoute } from "./PrimaryAppRouter.jsx";

describe("roteador principal", () => {
  it("resolve páginas públicas antes da autenticação", () => {
    expect(resolvePrimaryRoute("/s/minha-loja/contato", false)).toEqual({
      kind: "public-site", slug: "minha-loja", page: "contato",
    });
  });

  it("separa cliente, TMS, motorista, central de frota e vertical interna", () => {
    expect(resolvePrimaryRoute("/portal-cliente/operacoes", true).kind).toBe("customer-portal");
    expect(resolvePrimaryRoute("/portal-tms", true).kind).toBe("tms-portal");
    expect(resolvePrimaryRoute("/portal-tms/roteirizacao", true).kind).toBe("tms-portal");
    expect(resolvePrimaryRoute("/portal-motorista/rotas", true).kind).toBe("driver-portal");
    expect(resolvePrimaryRoute("/central-motorista", true).kind).toBe("driver-portal");
    expect(resolvePrimaryRoute("/motorista-frota", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/central-frota", true).kind).toBe("driver-fleet-portal");
    expect(resolvePrimaryRoute("/portal-colaborador", true).kind).toBe("colaborador-portal");
    expect(resolvePrimaryRoute("/portal-colaborador/notas", true).kind).toBe("colaborador-portal");
    expect(resolvePrimaryRoute("/todogreen/precificacao", true).kind).toBe("todogreen");
  });

  it("usa a raiz como entrada da To Do Green e preserva o portal escolhido", () => {
    expect(resolvePrimaryRoute("/", false).kind).toBe("todogreen-login");
    expect(resolvePrimaryRoute("/portal-cliente", false).kind).toBe("customer-login");
    expect(resolvePrimaryRoute("/portal-motorista", false).kind).toBe("driver-login");
    expect(resolvePrimaryRoute("/portal-colaborador", false).kind).toBe("colaborador-login");
    // O TMS tem a própria entrada no login (aba "Portal TMS"), como cliente e
    // motorista — para quem entra pelo TMS voltar ao TMS depois de autenticar.
    expect(resolvePrimaryRoute("/portal-tms", false).kind).toBe("tms-login");
  });

  it("usa o login da To Do Green para as rotas internas sem sessão", () => {
    expect(resolvePrimaryRoute("/todogreen/clientes", false).kind).toBe("todogreen-login");
    expect(resolvePrimaryRoute("/portal-tms/fiscal", false).kind).toBe("tms-login");
  });

  it("abre o convite individual da To Do Green sem reutilizar uma sessão", () => {
    expect(resolvePrimaryRoute("/todogreen/convite/token-opaco", false)).toEqual({
      kind: "todogreen-access-invite",
      token: "token-opaco",
    });
  });

  it("entrega as demais rotas ao ambiente principal", () => {
    expect(resolvePrimaryRoute("/", true).kind).toBe("workspace");
  });

  it("reconhece as verticais irmãs Green On e Greenmob quando autenticado", () => {
    expect(resolvePrimaryRoute("/greenon", true).kind).toBe("greenon");
    expect(resolvePrimaryRoute("/greenon/crm", true).kind).toBe("greenon");
    expect(resolvePrimaryRoute("/greenmob", true).kind).toBe("greenmob");
    expect(resolvePrimaryRoute("/greenmob/contratos", true).kind).toBe("greenmob");
  });

  it("Green On e Greenmob caem no login padrão sem sessão (não confundem com portais externos)", () => {
    expect(resolvePrimaryRoute("/greenon", false).kind).toBe("login");
    expect(resolvePrimaryRoute("/greenmob", false).kind).toBe("login");
  });
});

// Seções 22–23 da consolidação: ERP, TMS e Central de Frota compartilham UMA
// identidade e UMA sessão (o token do app, na mesma origem) — o RBAC decide o
// que cada um vê, não um segundo login. Já os portais externos (cliente,
// motorista, colaborador) nunca montam o shell interno.
describe("SSO interno e isolamento dos portais externos", () => {
  const internos = ["/todogreen", "/todogreen/operacoes", "/portal-tms", "/portal-tms/roteirizacao", "/central-frota", "/motorista-frota"];
  const externos = ["/portal-cliente", "/portal-cliente/operacoes", "/portal-motorista", "/portal-motorista/rotas", "/central-motorista", "/portal-colaborador", "/portal-colaborador/notas"];
  const KINDS_INTERNOS = new Set(["todogreen", "tms-portal", "driver-fleet-portal", "workspace", "todogreen-activation", "design-system"]);

  it("usuário interno autenticado navega entre ERP, TMS e Central de Frota sem relogar", () => {
    for (const rota of internos) {
      const { kind } = resolvePrimaryRoute(rota, true);
      expect(kind, rota).not.toMatch(/login$/);
      expect(KINDS_INTERNOS.has(kind), `${rota} → ${kind}`).toBe(true);
    }
  });

  it("sem sessão, cada porta interna pede login UMA vez e preserva o destino", () => {
    expect(resolvePrimaryRoute("/todogreen/operacoes", false).kind).toBe("todogreen-login");
    expect(resolvePrimaryRoute("/portal-tms/roteirizacao", false).kind).toBe("tms-login");
    // A Central de Frota é tela interna: sem sessão cai no login padrão da
    // plataforma, nunca num portal externo.
    expect(resolvePrimaryRoute("/central-frota", false).kind).toMatch(/login$/);
  });

  it("portal externo autenticado nunca resolve para o shell interno", () => {
    for (const rota of externos) {
      const { kind } = resolvePrimaryRoute(rota, true);
      expect(KINDS_INTERNOS.has(kind), `${rota} → ${kind}`).toBe(false);
      expect(["customer-portal", "driver-portal", "colaborador-portal"]).toContain(kind);
    }
  });

  it("componentes dos portais externos não importam o shell interno nem os registros do ERP", () => {
    // Guarda estática (mesma técnica de moduleNavLabels.test.js): um import de
    // LogisticsVertical/TmsPortal/useVerticalRecords num portal externo seria
    // custo interno, margem e dados de outro cliente a um passo da tela.
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const portais = [
      "features/logistics/CustomerPortal.jsx",
      "features/logistics/CustomerPortalOperations.jsx",
      "features/logistics/pages/DriverPortalPage.jsx",
      "features/logistics/pages/ColaboradorPortalPage.jsx",
    ];
    const proibidos = /from "[^"]*(LogisticsVertical|TmsPortal|TodoGreenWorkspace|ErpHome|useVerticalRecords|DriverFleetCenterPage|LogisticsVerticalWorkCenter)[^"]*"/;
    for (const arquivo of portais) {
      const fonte = fs.readFileSync(path.join(raiz, arquivo), "utf8");
      expect(fonte, arquivo).not.toMatch(proibidos);
    }
  });
});
