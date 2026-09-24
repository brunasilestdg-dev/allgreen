// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { CHANGELOG_ENTRIES } from "./App";

const user = {
  id: "user-changelog",
  name: "Renata Silva",
  email: "renata@example.com",
};

const businessDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: null,
  businesses: [],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
  contacts: [],
  deliveryZones: [],
  vehicles: [],
  trips: [],
  developmentPlans: [],
  notifications: [],
  teams: [],
  projects: [],
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
  localStorage.setItem("seu-funcionario-auth-token", "token-changelog");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/collab")
        return response({ members: [], invites: [], spaces: [] });
      return response({});
    }),
  );

describe("painel de novidades", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mostra a bolinha de novidade não vista e some depois de abrir o painel", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    const trigger = screen.getByRole("button", { name: "Novidades" });
    expect(trigger.querySelector(".notif-dot")).toBeInTheDocument();

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Novidades" });
    expect(
      screen.getByText(CHANGELOG_ENTRIES[0].title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CHANGELOG_ENTRIES[CHANGELOG_ENTRIES.length - 1].title),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog", { name: "Novidades" })).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Novidades" }).querySelector(".notif-dot"),
    ).not.toBeInTheDocument();
  });

  it("não mostra a bolinha quando a última novidade já foi vista antes", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    localStorage.setItem("sf-changelog-seen", CHANGELOG_ENTRIES[0].id);
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });

    expect(
      screen.getByRole("button", { name: "Novidades" }).querySelector(".notif-dot"),
    ).not.toBeInTheDocument();
  });
});
