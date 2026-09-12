import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

// Debug/verificação do #81: o mapa REALMENTE renderiza e a rota é desenhada?
// jsdom não tem layout nem canvas, então isto só se prova no navegador. A rede
// externa é dublada no gateway canônico do backend para o teste ser
// determinístico e não depender de sair para a internet.
test("roteirização mostra o mapa e desenha a rota com várias paradas", async ({ page }) => {
  // Tiles do OSM → um PNG 1x1 transparente.
  const pngVazio = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route(/tile\.openstreetmap\.org/, (rota) =>
    rota.fulfill({ status: 200, contentType: "image/png", body: pngVazio }));
  await page.route(/\/api\/todogreen\/maps\/geocode$/, (rota) => {
    const q = rota.request().postDataJSON()?.q || "";
    const mapa = {
      Santos: { lat: "-23.96", lon: "-46.33" },
      Osasco: { lat: "-23.53", lon: "-46.79" },
      Campinas: { lat: "-22.90", lon: "-47.06" },
    };
    const chave = Object.keys(mapa).find((k) => q.includes(k));
    const ponto = chave ? [{ ...mapa[chave], display_name: `${chave}, São Paulo, Brasil` }] : [];
    return rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ponto) });
  });
  await page.route(/\/api\/todogreen\/maps\/route$/, (rota) =>
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

  // #91: marcar uma parada como recarga soma 1h30 ao total. O toggle é um
  // botão rotulado "Recarga" (antes era um checkbox oculto).
  await page.locator(".tdg-roteirizacao-recarga").nth(1).click();
  await expect(page.locator(".tdg-roteirizacao-resumo")).toContainText("recarga(s) de 1h30");

  // #92: otimizar a ordem reordena e mantém a rota (3 paradas seguem lá).
  await page.getByRole("button", { name: /Otimizar ordem/ }).click();
  await expect(page.locator(".tdg-roteirizacao-resumo")).toContainText("3 paradas");
});

// #90: carregadores elétricos no mapa. A busca agora é gratuita (OpenStreetMap
// via backend, sem chave). A chamada ao backend é dublada para o teste ser
// determinístico e não depender de rede — o formato já é o canônico do mapa.
test("roteirização mostra carregadores elétricos com foco em pesados", async ({ page }) => {
  const pngVazio = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route(/tile\.openstreetmap\.org/, (rota) =>
    rota.fulfill({ status: 200, contentType: "image/png", body: pngVazio }));
  // Backend de carregadores → dois pontos: um DC rápido (pesado) e um AC lento.
  await page.route(/\/api\/todogreen\/carregadores$/, (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    return rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fonte: "OpenStreetMap",
        pontos: [
          { id: "1", nome: "Eletroposto BR-116", cidade: "Registro", coord: [-20, -47], potenciaKw: 150, tipos: ["CCS"], pesados: true },
          { id: "2", nome: "AC lento", cidade: "Bauru", coord: [-19, -46], potenciaKw: 22, tipos: ["Type 2"], pesados: false },
        ],
      }),
    });
  });

  await criarConta(page, contaNova("carreg"));
  await habilitarTodoGreen(page, "owner");
  await page.goto("/todogreen/roteirizacao");
  await expect(page.locator(".tdg-roteirizacao-mapa")).toHaveClass(/leaflet-container/);

  await page.getByRole("button", { name: /^Carregadores/ }).click();

  // A linha de resumo confirma a contagem e destaca os que servem pesado.
  await expect(page.locator(".tdg-roteirizacao-carregadores-info")).toContainText("2 carregador(es)");
  await expect(page.locator(".tdg-roteirizacao-carregadores-info")).toContainText("1");
  // Os pinos de carregador aparecem no mapa (um pesado, um leve).
  expect(await page.locator(".tdg-mapa-pin-carregador").count()).toBe(2);
  expect(await page.locator(".tdg-mapa-pin-carregador .pesado").count()).toBe(1);
});
