// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = {
  id: "user-push",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-push-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
  contacts: [],
  timeEntries: [],
  transactions: [],
  financeSettings: {},
  documents: [],
  sites: [],
  history: [],
  certificates: [],
  conversations: [],
  media: [],
  emailDrafts: [],
  customSpecialists: [],
  pluggedTools: [],
  selectedConversationId: null,
  journeys: {},
  preferences: {
    theme: "light",
    specialist: "Diretor",
    mode: "business",
    modeChosen: true,
  },
  ...overrides,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-push");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const VAPID_PUBLIC_KEY =
  "BEa6RPkBtRlZB3zsc7CJpieeD8RLYLSjWQbfWX69nASq9GcrzQNRHwKgO3T2wYgq8GRi6baoREH4uVvGPxsZC9Y";

describe("notificações do navegador (Web Push) em Configurações", () => {
  let subscribeMock;
  let getSubscriptionMock;
  let requestPermissionMock;

  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");

    getSubscriptionMock = vi.fn().mockResolvedValue(null);
    subscribeMock = vi.fn().mockResolvedValue({
      endpoint: "https://push.example.com/ep-test",
      toJSON: () => ({
        endpoint: "https://push.example.com/ep-test",
        keys: { p256dh: "fake-p256dh", auth: "fake-auth" },
      }),
    });
    const registration = {
      pushManager: {
        getSubscription: getSubscriptionMock,
        subscribe: subscribeMock,
      },
    };
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ...navigator.serviceWorker,
        ready: Promise.resolve(registration),
        addEventListener: vi.fn(),
        register: vi.fn().mockResolvedValue(registration),
        controller: null,
      },
    });
    vi.stubGlobal("PushManager", function () {});
    requestPermissionMock = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", { requestPermission: requestPermissionMock });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ativa as notificações: pede permissão, assina o push e envia a assinatura ao servidor", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config")
        return response({ videoEnabled: false, vapidPublicKey: VAPID_PUBLIC_KEY });
      if (url === "/api/push/subscribe") return response({ ok: true });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const enableButton = await screen.findByRole("button", {
      name: "Ativar notificações",
    });
    fireEvent.click(enableButton);

    await waitFor(() => expect(requestPermissionMock).toHaveBeenCalled());
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/push/subscribe",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const [, subscribeCallOptions] = fetchMock.mock.calls.find(
      ([url]) => url === "/api/push/subscribe",
    );
    expect(JSON.parse(subscribeCallOptions.body)).toEqual({
      endpoint: "https://push.example.com/ep-test",
      keys: { p256dh: "fake-p256dh", auth: "fake-auth" },
    });

    expect(
      await screen.findByRole("button", { name: "Desativar notificações" }),
    ).toBeInTheDocument();
  });

  it("desativa as notificações: cancela a assinatura no navegador e avisa o servidor", async () => {
    const subscription = {
      endpoint: "https://push.example.com/ep-existing",
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    getSubscriptionMock.mockResolvedValue(subscription);

    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config")
        return response({ videoEnabled: false, vapidPublicKey: VAPID_PUBLIC_KEY });
      if (url === "/api/push/unsubscribe") return response({ ok: true });
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    const disableButton = await screen.findByRole("button", {
      name: "Desativar notificações",
    });
    fireEvent.click(disableButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/push/unsubscribe",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalled());

    expect(
      await screen.findByRole("button", { name: "Ativar notificações" }),
    ).toBeInTheDocument();
  });
});
