/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BusinessProfileStudio from "./features/business-profile/BusinessProfileStudio.jsx";

afterEach(cleanup);

describe("central do negócio", () => {
  it("seleciona atividade, recomenda pacotes e salva o perfil", () => {
    const business = {
      id: "b1",
      name: "Canal da Renata",
      segment: "Conteúdo",
      menuMode: "all",
    };
    const update = vi.fn();
    const setToast = vi.fn();

    render(
      <BusinessProfileStudio
        business={business}
        update={update}
        go={vi.fn()}
        setToast={setToast}
      />,
    );

    fireEvent.change(screen.getByLabelText("Atividade principal"), {
      target: { value: "midia" },
    });
    fireEvent.change(screen.getByLabelText("Atividade específica"), {
      target: { value: "Podcaster" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));

    expect(update).toHaveBeenCalledTimes(1);
    const saved = update.mock.calls[0][0]({ businesses: [business] });
    expect(saved.businesses[0]).toMatchObject({
      industryCategoryId: "midia",
      industryActivity: "Podcaster",
      businessTypeId: "criador",
      menuMode: "custom",
    });
    expect(saved.businesses[0].enabledPacks).toContain("conteudo");
    expect(setToast).toHaveBeenCalledWith(
      "Perfil e funções do negócio atualizados",
    );
  });

  it("permite ativar todos os pacotes sem perder o tipo escolhido", () => {
    render(
      <BusinessProfileStudio
        business={{
          id: "b2",
          name: "Negócio híbrido",
          industryCategoryId: "outros",
          businessTypeId: "outro",
          menuMode: "custom",
          enabledPacks: ["clientes"],
        }}
        update={vi.fn()}
        go={vi.fn()}
        setToast={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ativar tudo" }));
    expect(screen.getByText(/Todas as funções ficarão visíveis/)).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Mostrar tudo/ }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
