// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense, lazy } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Renderiza o LegalHub REAL (não mockado) em modo TDG forçado. Este teste
// existe para pegar a classe de bug que quebrou a página no ERP: uma
// referência a `tdgLegal`/`tdgLegalRecords` ANTES da declaração (Temporal
// Dead Zone) fazia o `useMemo` de `records` lançar `ReferenceError` no
// primeiro render e o "Jurídico" nem abria. Um teste unitário puro não
// pega isso — precisa renderizar o componente.

const LegalHub = lazy(() => import("./features/legal/LegalHub.jsx"));

describe("LegalHub — abertura da página (regressão de TDZ)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("abre no modo TDG (tdgAvailable forçado) sem crashar", async () => {
    // Silencia o fetch: o hook `useTdgLegalRecords` chama
    // `/api/todogreen/records/legal` no mount; devolvemos lista vazia.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ registros: [] }) }),
      ),
    );
    render(
      <Suspense fallback={<span>carregando</span>}>
        <LegalHub
          db={{ user: { id: "u1", name: "Renata" } }}
          update={() => {}}
          setToast={() => {}}
          authHeaders={() => ({})}
          business={{ name: "TDG" }}
          viewer={{ userId: "u1", role: "head_juridico", isOwner: false }}
          tdgAvailable
        />
      </Suspense>,
    );
    // Header do LegalHub — se subiu, aparece "Central Jurídica".
    expect(await screen.findByText(/Central Jurídica/i)).toBeInTheDocument();
    // Badge do modo canônico TDG aparece só no header quando o hub está no ERP.
    expect(await screen.findByText(/Jurídico canônico TDG/i)).toBeInTheDocument();
  });

  it("abre na aba passada por `initialTab` (subitem da sidebar do ERP)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ registros: [] }) })),
    );
    render(
      <Suspense fallback={<span>carregando</span>}>
        <LegalHub
          db={{ user: { id: "u1", name: "Renata" } }}
          update={() => {}}
          setToast={() => {}}
          authHeaders={() => ({})}
          business={{ name: "TDG" }}
          viewer={{ userId: "u1", role: "head_juridico", isOwner: false }}
          tdgAvailable
          initialTab="contratos"
        />
      </Suspense>,
    );
    // Aba Contratos renderiza o botão "Novo contrato" no header.
    expect(await screen.findByText(/Novo contrato/i)).toBeInTheDocument();
  });

  it("abre no modo solicitante (fora do ERP) sem crashar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    render(
      <Suspense fallback={<span>carregando</span>}>
        <LegalHub
          db={{ user: { id: "u2", name: "Carlos" } }}
          update={() => {}}
          setToast={() => {}}
          authHeaders={() => ({})}
          business={{ name: "Loja" }}
          viewer={{ userId: "u2", role: "colaborador", isOwner: false }}
        />
      </Suspense>,
    );
    // Se renderizou sem crashar, o header aparece; o texto da caixa de aviso
    // do formulário de solicitação também.
    expect(await screen.findByText(/Central Jurídica/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Solicitações não substituem parecer formal/i),
    ).toBeInTheDocument();
  });
});
