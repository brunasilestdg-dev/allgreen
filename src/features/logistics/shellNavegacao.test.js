import { describe, expect, it } from "vitest";
import {
  permissaoDaPagina,
  trilhaDaPagina,
  todoGreenRouteToPage,
} from "./LogisticsVertical.jsx";
import { hasTodoGreenPermission } from "./logisticsVerticalDomain.js";

// O esqueleto da vertical passou a ler menu, trilha e permissão da MESMA
// configuração. Antes, a permissão só filtrava o botão do menu; a tela em si
// renderizava para quem chegasse por URL, histórico ou atualização de página.
// Estes testes prendem os dois elos: a trilha sai do config e a permissão da
// rota é a mesma que esconde o botão.

describe("permissão da tela vem do config, não do menu", () => {
  it("telas restritas declaram a permissão que o menu já usa", () => {
    expect(permissaoDaPagina("acessos")).toBe("access:manage");
    expect(permissaoDaPagina("integracoes")).toBe("integration:manage");
    expect(permissaoDaPagina("conectores")).toBe("integration:manage");
    expect(permissaoDaPagina("fiscal")).toBe("fiscal:manage");
    expect(permissaoDaPagina("planner")).toBe("planner:manage");
  });

  it("conectores de negócio é visível para quem administra integrações (não é dev-only)", () => {
    // A Central de Integrações (dev-only) escondia o \"Conectar monday.com\" do
    // owner/admin. Conectores de negócio abre a autorização das contas externas
    // por `integration:manage` — sem exigir o perfil de desenvolvedor.
    const pagina = todoGreenRouteToPage("/todogreen/conectores");
    expect(pagina).toBe("conectores");
    expect(hasTodoGreenPermission("owner", permissaoDaPagina(pagina))).toBe(true);
    expect(hasTodoGreenPermission("admin", permissaoDaPagina(pagina))).toBe(true);
    expect(hasTodoGreenPermission("operacoes", permissaoDaPagina(pagina))).toBe(true);
    expect(hasTodoGreenPermission("motorista", permissaoDaPagina(pagina))).toBe(false);
  });

  it("telas abertas continuam livres e clientes aceita permissões comerciais equivalentes", () => {
    expect(permissaoDaPagina("dashboard")).toBe("");
    expect(permissaoDaPagina("clientes")).toEqual(["crm:manage", "clients:manage", "clients:read"]);
    expect(permissaoDaPagina("desconhecida")).toBe("");
  });

  it("motorista não passa numa tela administrativa nem chegando pela rota", () => {
    // É exatamente o furo que o menu sozinho não fecha: esconder o botão não
    // impede quem digita /todogreen/acessos. A rota confere o mesmo papel.
    const pagina = todoGreenRouteToPage("/todogreen/acessos");
    expect(hasTodoGreenPermission("motorista", permissaoDaPagina(pagina))).toBe(false);
    expect(hasTodoGreenPermission("owner", permissaoDaPagina(pagina))).toBe(true);
  });
});

describe("a trilha sai da mesma configuração do menu", () => {
  it("no painel a trilha é só a raiz", () => {
    expect(trilhaDaPagina("dashboard").map((p) => p.label)).toEqual(["Visão geral"]);
  });

  it("uma tela comercial mostra área e tela", () => {
    expect(trilhaDaPagina("precificacao").map((p) => p.label)).toEqual([
      "Visão geral",
      "Comercial",
      "Precificação",
    ]);
  });

  it("uma tela administrativa mostra a área de administração", () => {
    expect(trilhaDaPagina("rasci").map((p) => p.label)).toEqual([
      "Visão geral",
      "Administração",
      "RASCI",
    ]);
  });

  it("uma ferramenta de Configurações é de topo, sem área lateral duplicada", () => {
    // Integrações e Acessos vivem no menu Configurações, não repetidos na
    // Administração: a trilha é só "Visão geral › <ferramenta>".
    expect(trilhaDaPagina("acessos").map((p) => p.label)).toEqual([
      "Visão geral",
      "Acessos",
    ]);
  });

  it("cada passo da trilha carrega uma rota navegável", () => {
    for (const passo of trilhaDaPagina("integracoes"))
      expect(passo.route.startsWith("/todogreen/")).toBe(true);
  });
});
