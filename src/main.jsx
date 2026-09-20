import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { chaveDeRecuperacao, deveRecarregarPorVersaoTrocada } from "./features/app/chunkRecovery.js";
import "./styles.css";
import "./features/logistics/LogisticsVertical.css";
import "./features/logistics/TodoGreenWorkspace.css";
import "./features/logistics/TodoGreenCommercialExperience.css";
import "./features/logistics/TodoGreenMotion.css";
import "./features/logistics/LogisticsVerticalNavigation.css";
import "./features/logistics/LogisticsVerticalAccess.css";
import "./features/logistics/LogisticsVerticalEnterprise.css";
import "./features/logistics/LogisticsVerticalRecovery.css";
import "./features/logistics/LogisticsVerticalEnterpriseRefinement.css";
import "./features/logistics/LogisticsVerticalEnterpriseShellPolish.css";
import "./features/logistics/ErpHomeEnterprise.css";
import "./features/logistics/LogisticsVerticalMenuCompact.css";
import "./features/logistics/AllGreenVisualSystemV2.css";
import "./features/logistics/AllGreenMenuDensityFix.css";
import "./features/logistics/AllGreenTaskExperienceV3.css";
import "./features/logistics/allGreenMenuEnhancements.js";
import "./features/logistics/LogisticsVerticalRecovery.js";
import "./features/logistics/LogisticsVerticalCredentials.js";
// WorkCenterV2 é lazy-loaded quando acessado (ARQ-01 otimização)

const reportError = (message, stack, componentStack, kind = "erro") => {
  try {
    fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: String(message || "").slice(0, 500),
        stack: String(stack || "").slice(0, 4000),
        componentStack: String(componentStack || "").slice(0, 4000),
        url: location.href,
        // Separa "versão trocada debaixo da aba" de bug de verdade: sem isso os
        // dois chegavam ao log como o mesmo "Algo deu errado" e não dava para
        // saber qual estava acontecendo de fato.
        kind,
      }),
    }).catch(() => {});
  } catch {}
};

// Deploy novo, aba antiga: o pedaço com hash que a aba vai buscar já não existe
// no servidor. É a maior fonte do "Algo deu errado" que some ao recarregar —
// ver src/features/app/chunkRecovery.js. Recarregar aqui é a cura (a única),
// não um disfarce: acontece UMA vez por versão publicada e só para esta classe
// de erro. Qualquer outra falha continua aparecendo.
function recuperarDeVersaoTrocada(erro) {
  const versao = window.__SF_APP_VERSION__ || "local";
  let jaTentouNestaVersao = true;
  try {
    jaTentouNestaVersao = sessionStorage.getItem(chaveDeRecuperacao(versao)) === "1";
  } catch {
    jaTentouNestaVersao = true;
  }
  if (!deveRecarregarPorVersaoTrocada({ erro, jaTentouNestaVersao })) return false;
  reportError(erro?.message || String(erro), erro?.stack, "", "versao-trocada");
  try {
    sessionStorage.setItem(chaveDeRecuperacao(versao), "1");
  } catch {
    return false;
  }
  location.reload();
  return true;
}

window.addEventListener("error", (event) => {
  if (recuperarDeVersaoTrocada(event.error || event.message)) return;
  reportError(event.message, event.error?.stack);
});
window.addEventListener("unhandledrejection", (event) => {
  if (recuperarDeVersaoTrocada(event.reason)) return;
  reportError(
    event.reason?.message || String(event.reason || "unhandled rejection"),
    event.reason?.stack,
  );
});
// O Vite avisa a falha de pré-carregamento antes de o React estourar; pegar
// aqui evita a tela de erro em vez de consertá-la depois.
window.addEventListener("vite:preloadError", (event) => {
  if (recuperarDeVersaoTrocada(event.payload || event.detail)) event.preventDefault?.();
});

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    if (recuperarDeVersaoTrocada(error)) return;
    reportError(error?.message || String(error), error?.stack, info?.componentStack);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <strong>All Green</strong>
          <h1>Algo deu errado</h1>
          <p>
            Encontramos um problema inesperado. Seus dados estão salvos; tente
            recarregar a página.
          </p>
          <button onClick={() => location.reload()}>Recarregar</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

import {
  INTERACTION_EVENTS,
  UPDATE_EVENT,
  isEditableElement,
  reloadKey,
  shouldAnnounce,
  shouldAutoReload,
} from "./features/app/updateDomain.js";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "local";
const BUILD_TIME = import.meta.env.VITE_BUILD_TIME || "";

window.__SF_APP_VERSION__ = APP_VERSION;
window.__SF_BUILD_TIME__ = BUILD_TIME;

const announceUpdate = (detail = {}) => {
  window.__SF_UPDATE_AVAILABLE__ = true;
  window.__SF_LATEST_VERSION__ = detail.latestVersion || "";
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail }));
};

// Basta um toque, uma tecla ou um texto colado para esta aba deixar de ser
// "intocada" — e, a partir daí, quem decide quando atualizar é quem está nela.
let interagiu = false;
for (const evento of INTERACTION_EVENTS)
  window.addEventListener(evento, () => {
    interagiu = true;
  }, { once: true, capture: true, passive: true });

const jaRecarregou = (versao) => {
  try {
    return sessionStorage.getItem(reloadKey(versao)) === "1";
  } catch {
    // Sem sessionStorage não dá para saber se já recarregou; não arriscar.
    return true;
  }
};

const recarregarSePuder = (latestVersion) => {
  const pode = shouldAutoReload({
    currentVersion: APP_VERSION,
    latestVersion,
    interacted: interagiu,
    hasFocusedField: isEditableElement(document.activeElement),
    alreadyReloaded: jaRecarregou(latestVersion),
  });
  if (!pode) return false;
  try {
    sessionStorage.setItem(reloadKey(latestVersion), "1");
  } catch {}
  location.reload();
  return true;
};

const checkPublishedVersion = async () => {
  try {
    const response = await fetch(
      `/api/status?client=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`,
      { cache: "no-store" },
    );
    const status = await response.json();
    const latestVersion = status?.version;
    if (shouldAnnounce({ currentVersion: APP_VERSION, latestVersion })) {
      // O aviso vem SEMPRE: é ele que devolve a escolha para quem está usando.
      // O recarregamento automático só acontece por cima disso, e só em aba que
      // ninguém tocou — recarregar no meio de um texto joga fora o que foi
      // escrito, sem aviso e sem desfazer.
      announceUpdate({ currentVersion: APP_VERSION, latestVersion });
      window.setTimeout(() => recarregarSePuder(latestVersion), 250);
    }
  } catch {
    // Sem rede, o app continua usando a versão instalada.
  }
};

// A checagem de versão fica FORA do registro do service worker, de propósito.
// Ela morava dentro dele: bastava o registro falhar — navegação privada, alguma
// política do navegador, um erro qualquer — para o catch engolir tudo e a
// pessoa nunca mais ser avisada de uma versão nova. Uma aba pode ficar aberta
// por dias.
checkPublishedVersion();
// A titular pediu 14/09: "precisa que todos os usuários sempre vejam a
// última atualização". Reduzimos o intervalo de 5 min → 60 s: o custo é
// uma requisição /api/status pequena a cada minuto (aba em foco), e o
// benefício é que a versão nova aparece perto do imediato para quem
// deixou a aba aberta. A janela de descoberta pelo SW já cai junto no
// bloco abaixo.
window.setInterval(checkPublishedVersion, 60_000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "sf-push-navigate") {
      window.dispatchEvent(
        new CustomEvent("sf-push-navigate", { detail: { link: event.data.link } }),
      );
    }
  });
  window.addEventListener("load", async () => {
    try {
      let controlled = !!navigator.serviceWorker.controller;
      const swUrl = `/sw.js?v=${encodeURIComponent(APP_VERSION)}`;
      const registration = await navigator.serviceWorker.register(swUrl, {
        updateViaCache: "none",
      });
      const watchInstalling = (worker) => {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && controlled) announceUpdate();
        });
      };
      watchInstalling(registration.installing);
      registration.addEventListener("updatefound", () =>
        watchInstalling(registration.installing),
      );
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (controlled) announceUpdate();
        controlled = true;
      });
      // Mesma cadência do checkPublishedVersion (60 s): o SW procura versão
      // nova ao mesmo tempo em que o app pergunta a versão publicada, para
      // as duas coisas convergirem juntas.
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, 60_000);
    } catch {
      // O aplicativo continua funcionando normalmente sem o modo instalável.
    }
  });
}
