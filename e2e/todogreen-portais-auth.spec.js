import { expect, test } from "@playwright/test";
import { api, contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

test.describe("portais autenticados da To Do Green", () => {
  test("cliente vinculado entra no próprio portal com a sessão real", async ({ browser }) => {
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext();
    const clientContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const clientPage = await clientContext.newPage();

    await criarConta(ownerPage, contaNova("portal-owner"));
    await habilitarTodoGreen(ownerPage, "owner");
    const clienteUsuario = await criarConta(clientPage, contaNova("portal-client"));

    const criado = await api(ownerPage, "/api/todogreen/clients", {
      method: "POST",
      body: {
        nome: "Cliente Portal E2E",
        status: "ativo",
        portalEnabled: true,
        crm: { stage: "Ativo", source: "e2e" },
      },
    });
    expect(criado.status).toBe(201);
    const clientId = criado.corpo.id;
    expect(clientId).toBeTruthy();

    const vinculo = await api(ownerPage, "/api/todogreen/clients", {
      method: "PUT",
      body: {
        clientId,
        email: clienteUsuario.email,
        papel: "cliente_gestor",
        enviarConvite: false,
      },
    });
    expect(vinculo.status).toBe(200);

    await clientPage.goto("/portal-cliente");
    await expect(clientPage.getByRole("heading", { name: "Cliente Portal E2E" })).toBeVisible({ timeout: 30_000 });
    await expect(clientPage.getByRole("navigation", { name: "Navegação do portal" })).toBeVisible();
    await expect(clientPage.getByText("Portal indisponível")).toHaveCount(0);

    await ownerContext.close();
    await clientContext.close();
  });

  test("motorista cadastrado abre o portal operacional, não a central de frota", async ({ browser }) => {
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext();
    const driverContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const driverPage = await driverContext.newPage();

    await criarConta(ownerPage, contaNova("driver-owner"));
    await habilitarTodoGreen(ownerPage, "owner");
    const motoristaUsuario = await criarConta(driverPage, contaNova("driver-self"));
    await habilitarTodoGreen(driverPage, "motorista");

    const motorista = await api(ownerPage, "/api/todogreen/master-data/drivers", {
      method: "POST",
      body: {
        driverCode: `E2E-${Date.now().toString(36)}`,
        fullName: "Motorista Portal E2E",
        document: "12345678901",
        availabilityStatus: "available",
        cnhNumber: "99999999999",
        cnhCategory: "D",
        cnhExpiresAt: "2030-01-01",
        status: "active",
        userEmail: motoristaUsuario.email,
      },
    });
    expect(motorista.status).toBe(201);

    await driverPage.goto("/portal-motorista");
    await expect(driverPage.getByRole("heading", { name: /Olá,/i })).toBeVisible({ timeout: 30_000 });
    await expect(driverPage.locator(".tdg-driver-app")).toBeVisible();
    await expect(driverPage.locator(".tdg-fleet-center")).toHaveCount(0);
    // O app abre na seção "Hoje"; "Minha rota" é a seção Rota — como o motorista
    // chega nela: pela navegação de baixo, não por padrão.
    await driverPage.getByRole("navigation", { name: "Seções do app do motorista" }).getByRole("button", { name: /Rota/ }).click();
    await expect(driverPage.getByRole("heading", { name: "Minha rota" })).toBeVisible();

    await ownerContext.close();
    await driverContext.close();
  });
});
