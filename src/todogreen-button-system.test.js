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

const verticalCss = fs.readFileSync(
  path.join(process.cwd(), "src/features/logistics/LogisticsVertical.css"),
  "utf8",
);

const tmsCss = fs.readFileSync(
  path.join(process.cwd(), "src/features/logistics/TmsPortal.css"),
  "utf8",
);

// Tokens `--tdg-*` declarados no PRIMEIRO bloco aberto por `seletor {`
// (comentários fora, para um exemplo em prosa não contar como declaração).
const tokensDoBloco = (texto, seletor) => {
  const limpo = texto.replace(/\/\*[\s\S]*?\*\//g, "");
  const inicio = limpo.indexOf(`${seletor} {`);
  expect(inicio, `bloco ${seletor}`).toBeGreaterThanOrEqual(0);
  const corpo = limpo.slice(inicio, limpo.indexOf("}", inicio));
  return [...corpo.matchAll(/(--tdg-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
};

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


describe("geometria dos botões do menu", () => {
  it("preserva alinhamento à esquerda, largura e seta compacta do acordeão", () => {
    expect(css).toContain(".tdg .tdg-erp-sidebar .tdg-nav-area-cabeca > button:first-child");
    expect(css).toContain("justify-content: flex-start");
    expect(css).toContain(".tdg .tdg-erp-sidebar .tdg-nav-area-itens button");
    expect(css).toContain(".tdg .tdg-erp-sidebar .tdg-nav-area-seta");
    expect(css).toMatch(/flex:\s*0 0 28px/);
  });
});

describe("telas do ERP embutidas no Portal TMS", () => {
  // O portal monta a Roteirização (com o Despacho Inteligente) e a configuração
  // do rastreador FORA do escopo `.tdg`. Sem os tokens, `.tdg-action` ficava
  // com fundo transparente e texto branco — "Fechar" e "Otimizar rotas"
  // sumiam —; sem a regra-base, botão sem classe saía com a cara do navegador.
  it("reinjeta em .tms-portal todos os tokens canônicos da vertical", () => {
    const canonicos = tokensDoBloco(verticalCss, ".tdg");
    const noPortal = new Set(tokensDoBloco(tmsCss, ".tms-portal"));
    expect(canonicos.length).toBeGreaterThan(0);
    expect(canonicos.filter((token) => !noPortal.has(token))).toEqual([]);
  });

  it("os tokens apontam para a paleta do próprio portal, não para uma paralela", () => {
    expect(tmsCss).toMatch(/--tdg-green:\s*var\(--tms-green\)/);
    expect(tmsCss).toMatch(/--tdg-line:\s*var\(--tms-border\)/);
    expect(tmsCss).toMatch(/--tdg-muted:\s*var\(--tms-muted\)/);
    expect(tmsCss).toMatch(/--tdg-card:\s*var\(--tms-card\)/);
    expect(tmsCss).toMatch(/--tdg-ink:\s*var\(--tms-ink\)/);
  });

  it("dá aos botões das páginas embutidas a base da vertical sem tocar nos do TMS", () => {
    expect(tmsCss).toContain(":where(.tms-portal .tdg-page) button {");
    expect(tmsCss).toContain(":where(.tms-portal .tdg-page) button:disabled");
    expect(tmsCss).toContain(":where(.tms-portal .tdg-page) button:hover:not(:disabled)");
    expect(tmsCss).toContain(".tms-portal .tdg-page .tdg-action {");
    expect(tmsCss).toContain(".tms-portal .tdg-page .tdg-action-ghost {");
    // A regra-base é de especificidade zero de propósito: `.tdg-action` e a
    // variante fantasma precisam continuar vencendo, como dentro de `.tdg`.
    expect(tmsCss).not.toMatch(/^\.tms-portal \.tdg-page button\b/m);
    // A fantasma vem depois da principal: mesma especificidade, a última vence.
    expect(tmsCss.indexOf(".tms-portal .tdg-page .tdg-action-ghost {"))
      .toBeGreaterThan(tmsCss.indexOf(".tms-portal .tdg-page .tdg-action {"));
  });
});
