// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicFormsStudio from "./PublicFormsStudio.jsx";
import { normalizePublicForm } from "./publicFormDomain.js";

const authHeaders = () => ({ authorization: "Bearer token" });
const response = (data, ok = true) =>
  Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  });

const business = { id: "b1", name: "Empresa Teste" };
const user = { id: "u1", name: "Renata" };

function Harness({ initial, onChange = () => {}, toast = vi.fn() }) {
  const [db, setDb] = useState(initial);
  const update = (action) =>
    setDb((current) => {
      const next = typeof action === "function" ? action(current) : action;
      onChange(next);
      return next;
    });
  return (
    <PublicFormsStudio
      db={db}
      update={update}
      business={business}
      setToast={toast}
      authHeaders={authHeaders}
    />
  );
}

const baseDb = {
  user,
  publicForms: [],
  processes: [],
};

const existingForm = normalizePublicForm(
  {
    id: "form-ui-1",
    name: "Captação comercial",
    slug: "captacao-comercial",
    destination: { type: "lead" },
    fields: [
      {
        id: "need",
        label: "Necessidade",
        type: "select",
        required: true,
        options: ["Consultoria", "Outro"],
      },
      {
        id: "details",
        label: "Detalhes",
        type: "longtext",
        condition: { fieldId: "need", operator: "equals", value: "Outro" },
      },
    ],
  },
  { ownerId: user.id, workspaceOwnerId: user.id, businessId: business.id },
);

describe("interface de formulários públicos", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response({ items: [] })),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("cria um formulário a partir do processo existente", async () => {
    let latest = null;
    render(
      <Harness
        initial={{
          ...baseDb,
          processes: [
            {
              id: "process-1",
              name: "Solicitação de coleta",
              serviceCode: "COL",
              active: true,
              businessId: business.id,
              fields: [
                {
                  id: "address",
                  name: "Endereço",
                  type: "text",
                  required: true,
                },
              ],
            },
          ],
        }}
        onChange={(value) => {
          latest = value;
        }}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Ou reutilize um processo já configurado"),
      { target: { value: "process-1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Criar formulário" }));
    expect(
      await screen.findByRole("heading", { name: "Solicitação de coleta" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Endereço")).toBeInTheDocument();
    expect(latest.publicForms[0].destination).toMatchObject({
      type: "process",
      processId: "process-1",
    });
  });

  it("edita a condição e publica o snapshot pelo endpoint autenticado", async () => {
    const toast = vi.fn();
    fetch.mockImplementation((url) => {
      if (String(url).startsWith("/api/forms/status"))
        return response({ items: [] });
      if (String(url).startsWith("/api/forms/publish"))
        return response({
          ok: true,
          slug: "captacao-comercial",
          url: "https://app.test/f/captacao-comercial",
          publishedAt: "2026-07-29T20:00:00.000Z",
        });
      return response({});
    });
    render(
      <Harness
        initial={{ ...baseDb, publicForms: [existingForm] }}
        toast={toast}
      />,
    );
    expect(screen.getByDisplayValue("Outro")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Outro"), {
      target: { value: "Consultoria" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    fireEvent.click(screen.getByRole("button", { name: "Publicar agora" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/forms/publish"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"captacao-comercial"'),
        }),
      ),
    );
    expect(await screen.findByText("Formulário publicado")).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Formulário publicado");
  });

  it("mostra respostas, protocolo, conversão, assinatura e anexos", async () => {
    fetch.mockImplementation((url) => {
      if (String(url).startsWith("/api/forms/status"))
        return response({
          items: [
            {
              id: existingForm.id,
              slug: existingForm.slug,
              published: true,
              submissions: 1,
              url: "https://app.test/f/captacao-comercial",
            },
          ],
        });
      if (String(url).startsWith("/api/forms/submissions"))
        return response({
          items: [
            {
              id: "submission-1",
              protocol: "LEAD-20260729-A1B2C3",
              contact: {
                name: "Cliente Teste",
                email: "cliente@example.com",
                phone: "",
              },
              values: { need: "Consultoria" },
              attachments: [
                {
                  id: "attachment-1",
                  name: "briefing.pdf",
                  size: 2048,
                },
              ],
              signature: { consent: true, name: "Cliente Teste" },
              payment: { acknowledged: true },
              destination: "lead",
              conversionStatus: "completed",
              submittedAt: "2026-07-29T20:00:00.000Z",
            },
          ],
        });
      return response({});
    });
    render(<Harness initial={{ ...baseDb, publicForms: [existingForm] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Respostas" }));
    expect(await screen.findByText("Cliente Teste")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cliente Teste"));
    expect(screen.getByText(/LEAD-20260729-A1B2C3/)).toBeInTheDocument();
    expect(screen.getByText(/Assinado por Cliente Teste/)).toBeInTheDocument();
    expect(screen.getByText("Pagamento informado")).toBeInTheDocument();
    expect(
      screen.getByText("Pagamento informado pela pessoa"),
    ).toBeInTheDocument();
    expect(screen.getByText("briefing.pdf")).toBeInTheDocument();
  });
});
