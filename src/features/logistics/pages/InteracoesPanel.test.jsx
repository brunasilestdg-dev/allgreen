/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import InteracoesPanel from "./InteracoesPanel.jsx";

afterEach(cleanup);

it("retoma somente a tarefa após falha, sem duplicar o contato e mantendo a oportunidade", async () => {
  const onRegistrar = vi.fn().mockResolvedValue(undefined);
  const onCriarTarefa = vi.fn().mockRejectedValueOnce(new Error("Rede indisponível")).mockResolvedValueOnce(undefined);
  render(<InteracoesPanel onRegistrar={onRegistrar} onCriarTarefa={onCriarTarefa}
    pessoas={[{ id: "u1", name: "Ana", email: "ana@example.com" }]}
    oportunidades={[{ id: "opp1", titulo: "Expansão" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar interação" }));
  fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Reunião de proposta" } });
  fireEvent.change(screen.getByLabelText("Próximo passo"), { target: { value: "Enviar proposta revisada" } });
  fireEvent.change(screen.getByLabelText("Responsável pelo follow-up"), { target: { value: "u1" } });
  fireEvent.change(screen.getByLabelText("Oportunidade relacionada"), { target: { value: "opp1" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar interação" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Contato salvo");
  expect(onRegistrar).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Assunto")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Tentar criar tarefa novamente" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(onRegistrar).toHaveBeenCalledTimes(1);
  expect(onCriarTarefa).toHaveBeenCalledTimes(2);
  expect(onCriarTarefa).toHaveBeenLastCalledWith(expect.objectContaining({
    opportunityId: "opp1", assigneeId: "u1", assignee: "Ana", title: "Enviar proposta revisada",
  }));
});

it("não promete criar tarefa quando a integração não está disponível", () => {
  render(<InteracoesPanel onRegistrar={vi.fn()} pessoas={[{ id: "u1", name: "Ana" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar interação" }));
  fireEvent.change(screen.getByLabelText("Próximo passo"), { target: { value: "Retornar ligação" } });
  expect(screen.getByLabelText("Responsável pelo follow-up")).toBeDisabled();
  expect(screen.getByText("O próximo passo será registrado no histórico, sem criar tarefa.")).toBeInTheDocument();
});
