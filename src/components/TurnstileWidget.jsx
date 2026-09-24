import { useCallback, useEffect, useRef, useState } from "react";
import { carregarTurnstile, opcoesDoWidget } from "./turnstile.js";

// Estado do token de uma tela. O token vale uma vez: depois de cada envio,
// `renovar()` pede outro ao widget. `obterToken()` espera o widget terminar
// (ele leva um instante depois que a tela abre) em vez de recusar quem
// preencheu rápido — ou quem o navegador preencheu sozinho.
export function useTurnstile(siteKey) {
  const [erro, setErro] = useState("");
  const [geracao, setGeracao] = useState(0);
  const tokenRef = useRef("");
  const esperando = useRef([]);

  const aoToken = useCallback((token) => {
    tokenRef.current = token || "";
    if (token) {
      setErro("");
      esperando.current.splice(0).forEach((resolver) => resolver(token));
    }
  }, []);

  const obterToken = useCallback(
    (limiteMs = 8000) => {
      if (!siteKey) return Promise.resolve("");
      if (tokenRef.current) return Promise.resolve(tokenRef.current);
      return new Promise((resolver) => {
        esperando.current.push(resolver);
        setTimeout(() => resolver(tokenRef.current), limiteMs);
      });
    },
    [siteKey],
  );

  const renovar = useCallback(() => {
    tokenRef.current = "";
    setGeracao((atual) => atual + 1);
  }, []);

  return { siteKey, erro, setErro, aoToken, obterToken, renovar, geracao };
}

// Widget anti-robô da Cloudflare. Sem `siteKey` não desenha nada.
export default function TurnstileWidget({ turnstile, acao = "entrada" }) {
  const { siteKey, aoToken, setErro, geracao } = turnstile;
  const caixa = useRef(null);
  const widget = useRef(null);

  // `aoToken` e `setErro` são estáveis (useCallback sem dependências e setter
  // do useState): o widget só é refeito quando muda a chave ou a ação.
  useEffect(() => {
    if (!siteKey) return undefined;
    let ativo = true;
    carregarTurnstile()
      .then((api) => {
        if (!ativo || !caixa.current) return;
        widget.current = api.render(caixa.current, {
          ...opcoesDoWidget(siteKey, acao),
          callback: (token) => aoToken(token),
          "expired-callback": () => aoToken(""),
          "timeout-callback": () => aoToken(""),
          "error-callback": () => {
            aoToken("");
            setErro(
              "A verificação anti-robô falhou. Recarregue a página e tente de novo.",
            );
          },
        });
      })
      .catch((falha) => {
        if (ativo) setErro(falha.message);
      });
    return () => {
      ativo = false;
      if (widget.current != null) window.turnstile?.remove(widget.current);
      widget.current = null;
      aoToken("");
    };
  }, [siteKey, acao, aoToken, setErro]);

  // Cada envio gasta o token; `renovar()` muda a geração e o widget refaz.
  useEffect(() => {
    if (geracao && widget.current != null) window.turnstile?.reset(widget.current);
  }, [geracao]);

  if (!siteKey) return null;
  return <div ref={caixa} className="turnstile-widget" />;
}
