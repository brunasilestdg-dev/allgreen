import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const clientsSource = fs.readFileSync(
  path.join(process.cwd(), "src/features/logistics/pages/ClientsPage.jsx"),
  "utf8",
);

const css = fs.readFileSync(
  path.join(process.cwd(), "src/features/logistics/TodoGreenCommercialExperience.css"),
  "utf8",
);

describe("design system de botões To Do Green", () => {
  it("remove a aparência nativa e define a base visual na vertical e no acesso", () => {
    expect(css).toContain(':where(.tdg, .auth-shell:has(.tdg-auth-marca)) button');
    expect(css).toMatch(/appearance:\s*none/);
    expect(css).toMatch(/border:\s*1px solid/);
    expect(css).toMatch(/border-radius:\s*10px/);
    expect(css).toMatch(/font:\s*inherit/);
    expect(css).toMatch(/min-height:\s*38px/);
  });

  it("mantém estados perceptíveis para teclado, indisponibilidade e interação", () => {
    expect(css).toContain("button:hover:not(:disabled)");
    expect(css).toContain("button:active:not(:disabled)");
    expect(css).toContain("button:focus-visible");
    expect(css).toContain("button:disabled");
    expect(css).toContain('button[aria-disabled="true"]');
  });

  it("define variações de ação principal, ícone e perigo", () => {
    expect(css).toContain(".tdg-action");
    expect(css).toContain(".icon-button");
    expect(css).toContain('[class*="danger"]');
  });
});


describe("indicadores acionáveis do CRM", () => {
  it("renderiza os cinco indicadores como botões acessíveis", () => {
    expect(clientsSource).toContain('aria-label={`Ver todas as ${command.totalAccounts} contas da carteira`}');
    expect(clientsSource).toContain('aria-label={`Abrir ${command.openOpportunities} oportunidades`}');
    expect(clientsSource).toContain('aria-label={`Abrir forecast ponderado de ${BRL.format(command.weightedPipeline)}`}');
    expect(clientsSource).toContain('aria-label={`Filtrar ${command.overdueActions} ações atrasadas`}');
    expect(clientsSource).toContain('aria-label={`Filtrar ${command.relationshipGaps} contas com mapa incompleto`}');
  });

  it("liga cada indicador a uma rota ou filtro real", () => {
    expect(clientsSource).toContain('onNavigate?.("/todogreen/oportunidades")');
    expect(clientsSource).toContain('onNavigate?.("/todogreen/funil")');
    expect(clientsSource).toContain('setQuickFilter("overdue")');
    expect(clientsSource).toContain('setFilter("no-decision")');
    expect(clientsSource).toContain('setViewMode("cards")');
  });
});
