import { useState } from "react";
import { AUTH_TOKEN_KEY } from "../../session/espacoVazio.js";
import { maskToken } from "./extensionAccess.js";

// O token que a extensão manda como Bearer é o mesmo da sessão do app. Lido
// uma vez ao montar: se a pessoa entrar de novo, a página recarrega e o cartão
// monta outra vez com o token novo.
const lerToken = () => {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

export function useExtensionToken(setToast) {
  const [token] = useState(lerToken);
  const [shown, setShown] = useState(false);
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setToast?.("Token copiado — cole na extensão");
    } catch {
      setToast?.("Não foi possível copiar agora");
    }
  };
  return {
    token,
    shown,
    value: shown ? token : maskToken(token),
    toggle: () => setShown((atual) => !atual),
    copy,
  };
}
