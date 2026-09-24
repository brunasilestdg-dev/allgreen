// ===== Turnstile no navegador =====
//
// Carrega o script da Cloudflare uma vez só, sob demanda, e sabe ler a chave
// pública no /api/config. Sem chave (Turnstile desligado no servidor), nada é
// baixado e as telas funcionam como antes.

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const MENSAGEM_SEM_WIDGET =
  "A verificação anti-robô não carregou. Confira a conexão ou libere challenges.cloudflare.com no bloqueador de anúncios.";

let carregamento = null;

export function carregarTurnstile() {
  if (typeof window === "undefined")
    return Promise.reject(new Error(MENSAGEM_SEM_WIDGET));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!carregamento)
    carregamento = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = () =>
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error(MENSAGEM_SEM_WIDGET));
      script.onerror = () => {
        // Deixa tentar de novo na próxima tela: o bloqueio pode ter sido
        // passageiro (rede do celular trocando, por exemplo).
        carregamento = null;
        script.remove();
        reject(new Error(MENSAGEM_SEM_WIDGET));
      };
      document.head.appendChild(script);
    });
  return carregamento;
}

let configuracao = null;

// A chave pública vem do mesmo /api/config que já traz o Google e o push.
export function lerChaveDoTurnstile() {
  if (!configuracao)
    configuracao = fetch("/api/config")
      .then((resposta) => (resposta.ok ? resposta.json() : {}))
      .then((dados) => String(dados?.turnstileSiteKey || ""))
      .catch(() => {
        configuracao = null;
        return "";
      });
  return configuracao;
}

// Opções comuns: aparência só quando precisa de interação (a maioria das
// pessoas não vê nada), idioma e largura acompanhando o formulário.
export const opcoesDoWidget = (siteKey, acao) => ({
  sitekey: siteKey,
  action: acao,
  language: "pt-br",
  size: "flexible",
  appearance: "interaction-only",
});
