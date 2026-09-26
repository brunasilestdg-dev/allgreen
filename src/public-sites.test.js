import { describe, expect, it } from "vitest";
import { sanitizeSiteHtml, siteSlug } from "../worker.js";

describe("publicação segura de sites", () => {
  it("normaliza o endereço público", () => {
    expect(siteSlug("  Ateliê da Lúna!  ")).toBe("atelie-da-luna");
  });

  it("remove scripts e manipuladores perigosos do HTML publicado", () => {
    const result = sanitizeSiteHtml(
      '<main onclick="steal()"><a href="javascript:steal()">Oi</a><script>steal()</script><iframe src="https://evil.test"></iframe></main>',
    );

    expect(result).not.toMatch(/<script|onclick|javascript:|iframe/i);
    expect(result).toContain("<main>");
    expect(result).toContain("Oi");
  });

  it("remove o manipulador separado por barra, que o navegador também executa", () => {
    // O navegador trata "/" como separador de atributo: estes rodavam o
    // handler porque a regra antiga exigia espaço antes do "on".
    expect(sanitizeSiteHtml("<svg/onload=alert(1)>")).toBe("<svg>");
    expect(sanitizeSiteHtml("<img/onerror=alert(1) src=x>")).toBe("<img src=x>");
    expect(sanitizeSiteHtml('<img src="x"/onerror=alert(1)>')).toBe('<img src="x">');
    expect(sanitizeSiteHtml("<img src='x' /onerror=alert(1)>")).toBe("<img src='x'>");
  });

  it("não corta um caminho de URL que só se parece com manipulador", () => {
    const links = '<a href="/online=1">A</a><a href="https://exemplo.com/onboarding=2">B</a>';
    expect(sanitizeSiteHtml(links)).toBe(links);
  });
});
