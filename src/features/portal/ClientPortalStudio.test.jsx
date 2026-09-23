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
import ClientPortalStudio from "./ClientPortalStudio.jsx";
import { normalizeClientPortal } from "./clientPortalDomain.js";

const authHeaders = () => ({ authorization: "Bearer token" });
const response = (data, ok = true) =>
  Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  });

const business = { id: "business-portal", name: "Empresa Teste" };
const user = { id: "user-portal", name: "Renata" };

const baseDb = {
  user,
  businesses: [business],
  clientPortals: [],
  projects: [
    {
      id: "project-visible",
      name: "Projeto Alfa",
      status: "Em andamento",
      businessId: business.id,
    },
  ],
  tasks: [
    {
      id: "task-visible",
      title: "Validar entrega",
      projectId: "project-visible",
      businessId: business.id,
    },
  ],
  documents: [
    {
      id: "document-visible",
      title: "Relatório executivo",
      businessId: business.id,
    },
  ],
  quotes: [],
  orders: [],
  trips: [],
};

const existingPortal = normalizeClientPortal(
  {
    id: "portal-ui",
    name: "Acesso Alfa",
    clientName: "Cliente Alfa",
    clientEmail: "cliente@example.com",
    title: "Acompanhamento Alfa",
    resources: {
      projectIds: ["project-visible"],
      taskIds: [],
      documentIds: ["document-visible"],
      reportIds: ["document-visible"],
    },
  },
  {
    ownerId: user.id,
    workspaceOwnerId: user.id,
    businessId: business.id,
    now: "2026-07-29T20:00:00.000Z",
  },
);

function Harness({ initial, onChange = () => {}, toast = vi.fn() }) {
  const [db, setDb] = useState(initial);
  const update = (action) =>
    setDb((current) => {
      const next = typeof action === "function" ? action(current) : action;
      onChange(next);
      return next;
    });
  return (
    <ClientPortalStudio
      db={db}
      update={update}
      business={business}
      setToast={toast}
      authHeaders={authHeaders}
      ownerId={user.id}
    />
  );
}

describe("interface do portal do cliente", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => response({ items: [] })));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("cria um acesso e salva somente os registros escolhidos", async () => {
    let latest = null;
    render(
      <Harness
        initial={baseDb}
        onChange={(value) => {
          latest = value;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Criar portal" }));
    fireEvent.change(screen.getByLabelText("Cliente"), {
      target: { value: "Cliente Novo" },
    });
    fireEvent.click(screen.getByText("Projetos"));
    fireEvent.click(screen.getByLabelText(/Projeto Alfa/));
    fireEvent.click(screen.getByText("Documentos"));
    fireEvent.click(screen.getAllByLabelText(/Relatório executivo/)[0]);

    await waitFor(() =>
      expect(latest.clientPortals[0]).toMatchObject({
        clientName: "Cliente Novo",
        resources: {
          projectIds: ["project-visible"],
          documentIds: ["document-visible"],
        },
      }),
    );
    expect(latest.clientPortals[0].resources.taskIds).toEqual([]);
  });

  it("publica, copia o novo link e nunca envia o token para o workspace", async () => {
    const toast = vi.fn();
    fetch.mockImplementation((url) => {
      if (String(url).startsWith("/api/client-portals/status"))
        return response({ items: [] });
      if (String(url).startsWith("/api/client-portals/publish"))
        return response({
          ok: true,
          url: "https://app.test/portal/a".padEnd(88, "a"),
          publishedAt: "2026-07-29T21:00:00.000Z",
        });
      return response({});
    });
    render(
      <Harness
        initial={{ ...baseDb, clientPortals: [existingPortal] }}
        toast={toast}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Publicar portal" }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/client-portals/publish"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"portal-ui"'),
        }),
      ),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/portal/"),
    );
    expect(toast).toHaveBeenCalledWith("Novo link seguro copiado.");
    expect(existingPortal).not.toHaveProperty("token");
  });

  it("mostra protocolos e baixa anexos usando a sessão autenticada", async () => {
    const objectUrl = vi.fn(() => "blob:portal-file");
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: objectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fetch.mockImplementation((url) => {
      if (String(url).startsWith("/api/client-portals/status"))
        return response({
          items: [{ id: "portal-ui", active: true, events: 1 }],
        });
      if (String(url).startsWith("/api/client-portals/events"))
        return response({
          items: [
            {
              id: "event-upload",
              type: "upload",
              protocol: "PORTAL-20260729-A1B2C3",
              status: "applied",
              createdAt: "2026-07-29T21:00:00.000Z",
              payload: {
                note: "Documento fiscal",
                file: { name: "comprovante.txt", size: 2 },
              },
            },
          ],
        });
      if (String(url).startsWith("/api/client-portals/file"))
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(new Blob(["Hi"], { type: "text/plain" })),
        });
      return response({});
    });
    render(
      <Harness initial={{ ...baseDb, clientPortals: [existingPortal] }} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Interações/ }));
    expect(
      await screen.findByText("PORTAL-20260729-A1B2C3"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /comprovante.txt/ }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/client-portals/file"),
        { headers: { authorization: "Bearer token" } },
      ),
    );
    expect(objectUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
