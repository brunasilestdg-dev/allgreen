import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

const viewports = [
  { name: "1440", width: 1440, height: 960 },
  { name: "1024", width: 1024, height: 900 },
  { name: "900", width: 900, height: 820 },
  { name: "mobile", width: 390, height: 844 },
];

const layoutProblems = () => {
  const viewport = window.innerWidth;
  // Aqui medimos as superfícies que precisam caber no visor. Conteúdos como
  // tabelas e Kanban podem ter rolagem interna; tratá-los como estouro da
  // página esconderia uma falha real sob centenas de falsos positivos.
  const surfaces = [
    "main.tdg",
    ".tdg-shell-header",
    ".tdg-erp-sidebar",
    ".tdg-sidebar-search",
    "[role=dialog]",
  ];
  const offenders = surfaces.flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter((element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.left < -1 || box.right > viewport + 1);
    })
    .map((element) => {
      const box = element.getBoundingClientRect();
      return element.tagName.toLowerCase() + " " + (element.className || element.getAttribute("role") || "")
        + " left=" + Math.round(box.left) + " right=" + Math.round(box.right) + " viewport=" + viewport;
    });
  return { documentWidth: document.documentElement.scrollWidth, viewport, offenders };
};

test.describe("layout crítico da To Do Green", () => {
  test("menu e superfícies principais cabem em desktop, tablet e mobile", async ({ page }) => {
    test.setTimeout(180_000);
    await criarConta(page, contaNova("visual"));
    await habilitarTodoGreen(page, "owner");

    for (const viewport of viewports) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize(viewport);
        await page.goto("/todogreen/dashboard");
        await expect(page.locator("main.tdg")).toBeVisible();
        await page.waitForTimeout(300);

        const result = await page.evaluate(layoutProblems);
        expect(result.documentWidth, `${viewport.name}: rolagem horizontal no ERP`).toBeLessThanOrEqual(result.viewport + 1);
        expect(result.offenders, `${viewport.name}: controles saindo da tela`).toEqual([]);

        const nav = page.locator(".tdg-erp-sidebar");
        if (viewport.name !== "mobile") await expect(nav).toBeVisible();
        if (viewport.name === "mobile") {
          const navBox = await nav.boundingBox();
          expect(navBox?.width || 0, "mobile: menu lateral maior que o visor").toBeLessThanOrEqual(viewport.width + 1);
          const searchBox = await page.getByLabel("Buscar funcionalidades").boundingBox();
          expect(searchBox?.x || 0, "mobile: busca do menu fora da tela").toBeGreaterThanOrEqual(0);
          expect((searchBox?.x || 0) + (searchBox?.width || 0), "mobile: busca do menu cortada").toBeLessThanOrEqual(viewport.width + 1);
        }
      });
    }
  });
});
