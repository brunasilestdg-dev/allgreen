/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaixaAtendimento from "./CustomerPortalCaixa.jsx";

// A tela não decide o caminho da mensagem — quem decide é o servidor. Estes
// testes garantem que ela mostra fielmente cada desfecho e não inventa nada.

afterEach(cleanup);

const escrever = (texto) => {
  fireEvent.change(screen.getByPlaceholderText(/onde está a carga/i), { target: { value: texto } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
};

describe("CaixaAtendimento", () => {
  it("mostra a resposta imediata da IA com o selo de respondido na hora", async () => {
    const enviar = vi.fn(async () => ({ tratamento: "respondido_ia", resposta: "Foram 3 entregas em julho.", triagem: { acao: "responder_ia" } }));
    render(<CaixaAtendimento enviar={enviar} setAviso={() => {}} onIr={() => {}} />);
    escrever("Quantas entregas foram feitas?");
    await waitFor(() => expect(screen.getByText(/Foram 3 entregas/)).toBeTruthy());
    expect(screen.getByText(/Respondido na hora/i)).toBeTruthy();
    expect(enviar).toHaveBeenCalledWith("caixa", { mensagem: "Quantas entregas foram feitas?" });
  });

  it("mostra o encaminhamento com protocolo, tipo e o atalho para Solicitações", async () => {
    const enviar = vi.fn(async () => ({ tratamento: "escalado", protocolo: "abcdef1234567890", triagem: { tipo: "nova_rota", urgencia: "normal" } }));
    const onIr = vi.fn();
    render(<CaixaAtendimento enviar={enviar} setAviso={() => {}} onIr={onIr} />);
    // Mensagem neutra: o desfecho vem do `enviar` mockado, e evita colidir com o
    // rótulo "Nova rota" que aparece no cartão de encaminhamento.
    escrever("Quero abrir um pedido");
    await waitFor(() => expect(screen.getByText(/Encaminhado para a equipe/i)).toBeTruthy());
    expect(screen.getByText(/#ABCDEF12/)).toBeTruthy();
    expect(screen.getByText(/Nova rota/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Acompanhar em Solicitações/i }));
    expect(onIr).toHaveBeenCalledWith("solicitacoes");
  });

  it("quando falta permissão, orienta em vez de engolir a mensagem", async () => {
    const enviar = vi.fn(async () => ({ tratamento: "sem_permissao", resposta: "Peça a um gestor da sua conta." }));
    render(<CaixaAtendimento enviar={enviar} setAviso={() => {}} onIr={() => {}} />);
    escrever("Preciso incluir uma nova rota");
    await waitFor(() => expect(screen.getByText(/Peça a um gestor/i)).toBeTruthy());
  });

  it("erro de rede vira aviso e uma mensagem de tente de novo, sem quebrar", async () => {
    const enviar = vi.fn(async () => { throw new Error("falhou"); });
    const setAviso = vi.fn();
    render(<CaixaAtendimento enviar={enviar} setAviso={setAviso} onIr={() => {}} />);
    escrever("Onde está minha carga?");
    await waitFor(() => expect(screen.getByText(/Tente de novo/i)).toBeTruthy());
    expect(setAviso).toHaveBeenCalledWith("falhou");
  });
});
