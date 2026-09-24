import { useCallback, useEffect, useRef, useState } from "react";
import { consultarSessao } from "../features/auth/authApi.js";
import { cleanDb } from "./armazenamento.js";
import { ACTIVE_USER_KEY, AUTH_TOKEN_KEY } from "./espacoVazio.js";

// ===== Status da sessão: "checking" | "authenticated" | "anonymous" =====
//
// O usuário salvo no navegador é só cache de interface; nunca é prova de
// sessão. Enquanto o Worker não valida o token, a vertical To Do Green não é
// renderizada. Este hook é a única peça que decide o status; `useDatabase`
// (App.jsx) o consome para saber quando pode gravar e sincronizar.
//
// `setDb` é o setter do banco local: numa sessão recusada (401) o hook limpa o
// banco junto com o token, para a conta cacheada não reabrir o produto.

export const statusInicialDaSessao = (userId) => {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) && userId ? "checking" : "anonymous";
  } catch {
    return "anonymous";
  }
};

export function useStatusDaSessao(userId, setDb) {
  const [sessionStatus, setSessionStatus] = useState(() => statusInicialDaSessao(userId));
  // A revalidação é por usuário (efeito keyed em `userId`), nunca por render:
  // o setter fica numa ref para uma identidade nova não disparar outra consulta.
  const setDbRef = useRef(setDb);
  useEffect(() => {
    setDbRef.current = setDb;
  }, [setDb]);

  // Sair sem apagar nada além da identidade: o `db` volta ao vazio, mas a
  // cópia do espaço gravada no navegador continua lá para a próxima entrada.
  const encerrarSessaoLocal = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
    setDbRef.current(cleanDb(null));
    setSessionStatus("anonymous");
  }, []);

  useEffect(() => {
    if (!userId || !localStorage.getItem(AUTH_TOKEN_KEY)) {
      setSessionStatus("anonymous");
      return;
    }
    let cancelled = false;
    setSessionStatus("checking");
    consultarSessao()
      .then(({ status, ok, data }) => {
        if (cancelled) return;
        // Só 401 é o servidor dizendo "esta sessão não existe mais" — os
        // outros erros (429 de limite de tentativas, 5xx passageiro, banco
        // fora do ar por um instante) não provam nada sobre o token, e
        // derrubar a sessão por causa deles tira do ar quem só teve azar de
        // pegar o servidor num pico. Sem essa distinção, um limite de
        // tentativas por IP compartilhado (escritório, rede móvel) já bastava
        // para deslogar todo mundo daquele IP no minuto seguinte.
        if (status === 401) {
          encerrarSessaoLocal();
          return;
        }
        if (ok && data.user) {
          setDbRef.current((current) => ({ ...current, user: data.user }));
          setSessionStatus("authenticated");
          return;
        }
        // Sem confirmação do servidor, a conta cacheada não abre o produto.
        setSessionStatus("anonymous");
      })
      .catch(() => {
        if (!cancelled) setSessionStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, encerrarSessaoLocal]);

  const markSessionAuthenticated = useCallback(
    () => setSessionStatus("authenticated"),
    [],
  );

  return { sessionStatus, markSessionAuthenticated, encerrarSessaoLocal };
}
