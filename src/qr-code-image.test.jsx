// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QrCodeImage from "./components/QrCodeImage.jsx";

const toDataURL = vi.fn();
vi.mock("qrcode", () => ({ default: { toDataURL } }));

describe("QrCodeImage", () => {
  afterEach(() => {
    cleanup();
    toDataURL.mockReset();
  });

  it("gera o QR no aparelho e oferece o download", async () => {
    toDataURL.mockResolvedValue("data:image/png;base64,ABC");
    render(<QrCodeImage value="000201-pix" label="QR de teste" fileName="qr.png" />);
    const img = await screen.findByRole("img", { name: "QR de teste" });
    expect(img).toHaveAttribute("src", "data:image/png;base64,ABC");
    expect(toDataURL).toHaveBeenCalledWith("000201-pix", expect.objectContaining({ errorCorrectionLevel: "M" }));
    expect(screen.getByRole("link", { name: "Baixar QR Code" })).toHaveAttribute("download", "qr.png");
  });

  it("some sem travar a tela quando a geração falha", async () => {
    toDataURL.mockRejectedValue(new Error("sem canvas"));
    const { container } = render(<QrCodeImage value="000201-pix" label="QR de teste" />);
    await waitFor(() => expect(container.querySelector(".qr-image")).toBeNull());
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("não mostra nada sem valor", () => {
    const { container } = render(<QrCodeImage value="" label="QR vazio" />);
    expect(container).toBeEmptyDOMElement();
    expect(toDataURL).not.toHaveBeenCalled();
  });
});
