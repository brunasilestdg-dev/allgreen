/* @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MS_DE_INATIVIDADE, useSaidaPorInatividade } from "./useSaidaPorInatividade.js";

function Vigiado({ aoExpirar, ms }) {
  useSaidaPorInatividade(aoExpirar, ms);
  return <p>conteúdo</p>;
}

describe("saída por inatividade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expira depois de 30 minutos parado — e nem um segundo antes", () => {
    const aoExpirar = vi.fn();
    render(<Vigiado aoExpirar={aoExpirar} />);
    vi.advanceTimersByTime(MS_DE_INATIVIDADE - 1000);
    expect(aoExpirar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it("qualquer interação rearma o relógio", () => {
    const aoExpirar = vi.fn();
    render(<Vigiado aoExpirar={aoExpirar} ms={10_000} />);
    vi.advanceTimersByTime(9_000);
    fireEvent.keyDown(window, { key: "a" });
    vi.advanceTimersByTime(9_000);
    expect(aoExpirar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it("sem callback (fora da vertical), não arma nada", () => {
    render(<Vigiado aoExpirar={null} ms={1_000} />);
    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
  });

  it("desmontar cancela o relógio", () => {
    const aoExpirar = vi.fn();
    const { unmount } = render(<Vigiado aoExpirar={aoExpirar} ms={1_000} />);
    unmount();
    vi.advanceTimersByTime(5_000);
    expect(aoExpirar).not.toHaveBeenCalled();
  });
});
