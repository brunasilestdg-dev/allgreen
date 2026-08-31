/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CentralRfqPage from "./CentralRfqPage.jsx";

afterEach(cleanup);

const doc = (extra = {}) => ({
  id: "hab-1",
  tipo: "APOLICE-RCTR-C",
  categoria: "seguros",
  titulo: "Apólice RCTR-C",
  numero: "654 66 04001125",
  orgao: "Porto Seguro",
  unidade: "EMPRESA",
  emitidoEm: "",
  venceEm: "2026-08-13",
  permanente: false,
  arquivoNome: "03-SEG_APOLICE-RCTR-C_EMPRESA_V2026-08-13.pdf",
  revision: 2,
  ...extra,
});

describe("Central de RFQ", () => {
  it("a apólice vencida aparece como VENCIDO com o motivo, não como uma linha qualquer", () => {
    render(<CentralRfqPage habilitacao={[doc()]} podeEditar />);
    expect(screen.getByText("Apólice RCTR-C")).toBeInTheDocument();
    expect(screen.getByText("VENCIDO")).toBeInTheDocument();
    expect(screen.getByText(/Venceu há/)).toBeInTheDocument();
  });

  it("o painel destaca o que trava um RFQ agora", () => {
    render(<CentralRfqPage habilitacao={[doc()]} podeEditar />);
    expect(screen.getByText("Travando RFQ agora")).toBeInTheDocument();
    expect(screen.getByText("essencial vencido ou ausente")).toBeInTheDocument();
  });

  it("o kit com essencial vencido aparece TRAVADO, e o kit é conferido antes de sair", () => {
    render(<CentralRfqPage habilitacao={[doc()]} podeEditar />);
    fireEvent.click(screen.getByRole("button", { name: /^Kits/ }));
    expect(screen.getByText("Kit B — Cotação de transporte")).toBeInTheDocument();
    expect(screen.getAllByText(/Travado por/).length).toBeGreaterThan(0);
  });

  it("quem não tem compliance:manage lê e não cadastra", () => {
    render(<CentralRfqPage habilitacao={[doc()]} podeEditar={false} />);
    expect(screen.getByText("Apólice RCTR-C")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo documento/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("o que falta lista o essencial primeiro e cadastra já com o tipo escolhido", () => {
    render(<CentralRfqPage habilitacao={[doc()]} podeEditar />);
    fireEvent.click(screen.getByRole("button", { name: /^O que falta/ }));
    expect(screen.getByText("CND Federal (RFB/PGFN)")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Cadastrar/ })[0]);
    // O formulário abre com o título do catálogo preenchido: o que a casa já
    // sabe não se digita de novo.
    expect(screen.getByRole("heading", { name: "Novo documento no acervo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Cartão CNPJ");
  });

  it("gravar manda o nome padronizado, gerado e não digitado", async () => {
    const onCriarDocumento = vi.fn().mockResolvedValue({});
    render(<CentralRfqPage habilitacao={[]} podeEditar onCriarDocumento={onCriarDocumento} />);
    fireEvent.click(screen.getByRole("button", { name: /Novo documento/ }));
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "CLCB-BOMBEIROS" } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "MATRIZ-SP" } });
    fireEvent.change(screen.getByLabelText("Vence em"), { target: { value: "2027-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Gravar documento/ }));
    await waitFor(() => expect(onCriarDocumento).toHaveBeenCalled());
    expect(onCriarDocumento.mock.calls[0][0].arquivoNome)
      .toBe("02-LIC_CLCB-BOMBEIROS_MATRIZ-SP_V2027-02-01.pdf");
  });

  it("editar manda a revisão junto — sem ela duas pessoas se sobrescrevem", async () => {
    const onAtualizarDocumento = vi.fn().mockResolvedValue({});
    render(<CentralRfqPage habilitacao={[doc()]} podeEditar onAtualizarDocumento={onAtualizarDocumento} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Vence em"), { target: { value: "2027-02-13" } });
    fireEvent.click(screen.getByRole("button", { name: /Gravar documento/ }));
    await waitFor(() => expect(onAtualizarDocumento).toHaveBeenCalled());
    expect(onAtualizarDocumento.mock.calls[0][1].revision).toBe(2);
  });

  it("pedido fechado sem motivo é apontado na tela", () => {
    render(
      <CentralRfqPage
        habilitacao={[]}
        rfq={[{ id: "r1", titulo: "RFQ last mile", cliente: "DHL", etapa: "perdido", motivo: "", enviados: [] }]}
        podeEditar
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Pedidos/ }));
    expect(screen.getByText(/Fechado sem motivo registrado/)).toBeInTheDocument();
  });

  it("marcar como enviado guarda a lista exata do que saiu", async () => {
    const onAtualizarRfq = vi.fn().mockResolvedValue({});
    render(
      <CentralRfqPage
        habilitacao={[
          { id: "d1", tipo: "CARTAO-CNPJ", titulo: "Cartão CNPJ", emitidoEm: "2099-01-01", numero: "1", arquivoNome: "01-SOC_CARTAO-CNPJ_MATRIZ-SP_E2099-01-01.pdf" },
        ]}
        habilitacaoKits={[{ id: "k1", chave: "meu-kit", nome: "Meu kit", descricao: "", tipos: ["CARTAO-CNPJ"], revision: 1 }]}
        rfq={[{ id: "r1", titulo: "RFQ", cliente: "DHL", etapa: "montando", kit: "meu-kit", enviados: [], revision: 4 }]}
        podeEditar
        onAtualizarRfq={onAtualizarRfq}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Pedidos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Marcar como enviado/ }));
    await waitFor(() => expect(onAtualizarRfq).toHaveBeenCalled());
    const corpo = onAtualizarRfq.mock.calls[0][1];
    expect(corpo.etapa).toBe("enviado");
    expect(corpo.enviados).toHaveLength(1);
    expect(corpo.enviados[0]).toContain("Cartão CNPJ");
    expect(corpo.revision).toBe(4);
  });
});
