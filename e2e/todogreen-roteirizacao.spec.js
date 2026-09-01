import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

// Debug/verificação do #81: o mapa REALMENTE renderiza e a rota é desenhada?
// jsdom não tem layout nem canvas, então isto só se prova no navegador. A rede
// externa (tiles, Nominatim, OSRM) é dublada para o teste ser determinístico e
// não depender de sair para a internet.
test("roteirização mostra o mapa e desenha a rota com várias paradas", async ({ page }) => {
  // Tiles do OSM → um PNG 1x1 transparente.
  const pngVazio = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route(/tile\.openstreetmap\.org/, (rota) =>
    rota.fulfill({ status: 200, contentType: "image/png", body: pngVazio }));
  await page.route(/nominatim\.openstreetmap\.org/, (rota) => {
    const q = new URL(rota.request().url()).searchParams.get("q") || "";
    const mapa = {
      Santos: { lat: "-23.96", lon: "-46.33" },
      Osasco: { lat: "-23.53", lon: "-46.79" },
      Campinas: { lat: "-22.90", lon: "-47.06" },
    };
    const chave = Object.keys(mapa).find((k) => q.includes(k));
    const ponto = chave ? [{ ...mapa[chave], display_name: `${chave}, São Paulo, Brasil` }] : [];
    return rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ponto) });
  });
  await page.route(/router\.project-osrm\.org/, (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        routes: [{
          distance: 120000,
          duration: 7200,
          geometry: { coordinates: [[-46.33, -23.96], [-46.79, -23.53], [-47.06, -22.90]] },
        }],
      }),
    }));

  await criarConta(page, contaNova("rota"));
  await habilitarTodoGreen(page, "owner");
  await page.goto("/todogreen/roteirizacao");

  // O Leaflet adiciona a classe leaflet-container ao PRÓPRIO container (não a
  // um filho). O mapa existe e tem tamanho real (o bug do "mapa cinza" é altura 0).
  const mapa = page.locator(".tdg-roteirizacao-mapa");
  await expect(mapa).toHaveClass(/leaflet-container/);
  const caixa = await mapa.boundingBox();
  expect(caixa.width).toBeGreaterThan(200);
  expect(caixa.height).toBeGreaterThan(200);
  // Os controles de zoom do Leaflet só aparecem se o mapa inicializou.
  await expect(page.locator(".leaflet-control-zoom")).toBeVisible();

  // Três paradas.
  const inputs = page.locator(".tdg-roteirizacao-campo input");
  await inputs.nth(0).fill("Santos");
  await inputs.nth(1).fill("Osasco");
  await page.getByRole("button", { name: /Adicionar parada/ }).click();
  await page.locator(".tdg-roteirizacao-campo input").nth(2).fill("Campinas");
  await page.getByRole("button", { name: /Traçar rota/ }).click();

  // O resumo com a distância prova que a rota foi calculada e desenhada.
  await expect(page.locator(".tdg-roteirizacao-resumo")).toContainText("120 km");
  await expect(page.locator(".tdg-roteirizacao-resumo")).toContainText("3 paradas");
  // E a polyline SVG existe dentro do mapa.
  expect(await page.locator(".tdg-roteirizacao-mapa path").count()).toBeGreaterThan(0);

});
