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
});
