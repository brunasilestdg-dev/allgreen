// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { documentFingerprint, makeSignature } from "./App";

const user = { id: "user-sig", name: "Renata Silva", email: "renata@example.com" };
const business = {
  id: "business-sig-1",
  name: "Doces da Ana",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const CONTEUDO = "Contrato de prestação de serviços.\nValor: R$ 2.500,00";

const doc = (extra = {}) => ({
  id: "doc-sig-1",
  businessId: business.id,
  ownerId: user.id,
  title: "Contrato do cliente",
  type: "Contrato",
  content: CONTEUDO,
  signatures: [],
  visibility: "privado",
  sharedWith: [],
  sharedTeams: [],
  project: "",
  versions: [],
  updatedAt: "2026-07-20T12:00:00.000Z",
  ...extra,
});

const businessDb = (documents = [doc()]) => ({
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
  taxProfile: { isMEI: false, dueDay: 20, cnpj: "", dasHistory: {} },
  documents,
  presentations: [],
  contentPlan: [],
  sheets: [],
  analyses: [],
  brainstorms: [],
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
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-sig");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const abrirDocumentos = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
  fireEvent.click(screen.getByRole("button", { name: "Documentos" }));
  await screen.findByRole("heading", {
    name: "Crie, edite e leve seu trabalho com você",
  });
};

describe("Assinatura eletrônica de documentos", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("assina o documento com o nome já preenchido e mostra o selo de assinado", async () => {
    seedLoggedIn(businessDb());
    await abrirDocumentos();

    fireEvent.click(screen.getByRole("button", { name: /Assinar/ }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/assinatura eletrônica simples/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Renata Silva")).toBeInTheDocument();

    // Sem o aceite, o botão de assinar fica bloqueado.
    const confirmar = within(dialog).getByRole("button", {
      name: /Assinar documento/,
    });
    expect(confirmar).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Assinar documento/ }));

    expect(await screen.findByText(/^Assinado \(1\)$/)).toBeInTheDocument();
  });

  it("avisa no cartão quando o documento foi alterado depois de assinado", async () => {
    const assinatura = makeSignature({
      id: "sig-antiga",
      signerName: "Renata Silva",
      content: "Texto original que já não está mais aqui",
      signedAt: "2026-07-21T10:00:00.000Z",
    });
    seedLoggedIn(businessDb([doc({ signatures: [assinatura] })]));
    await abrirDocumentos();

    expect(
      await screen.findByText("Alterado após assinar"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Assinado \(1\)$/)).not.toBeInTheDocument();
  });

  it("mostra código, data e integridade das assinaturas ao editar o documento", async () => {
    const assinatura = makeSignature({
      id: "sig-valida",
      signerName: "Renata Silva",
      signerEmail: "renata@example.com",
      signerRole: "Contratada",
      content: CONTEUDO,
      signedAt: "2026-07-21T10:00:00.000Z",
    });
    expect(assinatura.fingerprint).toBe(documentFingerprint(CONTEUDO));
    seedLoggedIn(businessDb([doc({ signatures: [assinatura] })]));
    await abrirDocumentos();

    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Renata Silva — Contratada"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(`Código: ${assinatura.code}`),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Documento íntegro/)).toBeInTheDocument();
  });
});
