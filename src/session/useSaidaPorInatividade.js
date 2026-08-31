import { useEffect } from "react";

// Meia hora sem tocar na tela e a sessão se encerra sozinha. Sessão esquecida
// aberta não pode existir: em computador compartilhado, "esqueci de sair"
// vira outra pessoa dentro da conta.
export const MS_DE_INATIVIDADE = 30 * 60 * 1000;

export function useSaidaPorInatividade(aoExpirar, ms = MS_DE_INATIVIDADE) {
  useEffect(() => {
    if (!aoExpirar) return undefined;
    let timer;
    const rearmar = () => {
      clearTimeout(timer);
      timer = setTimeout(aoExpirar, ms);
    };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart"];
    eventos.forEach((nome) => window.addEventListener(nome, rearmar, { passive: true }));
    rearmar();
    return () => {
      clearTimeout(timer);
      eventos.forEach((nome) => window.removeEventListener(nome, rearmar));
    };
  }, [aoExpirar, ms]);
}
