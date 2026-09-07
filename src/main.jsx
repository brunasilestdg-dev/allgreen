import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./features/logistics/LogisticsVertical.css";
import "./features/logistics/TodoGreenWorkspace.css";
import "./features/logistics/TodoGreenCommercialExperience.css";
import "./features/logistics/TodoGreenMotion.css";
import "./features/logistics/LogisticsVerticalNavigation.css";
import "./features/logistics/LogisticsVerticalAccess.css";
import "./features/logistics/LogisticsVerticalEnterprise.css";
import "./features/logistics/LogisticsVerticalRecovery.css";
import "./features/logistics/LogisticsVerticalRecovery.js";
import "./features/logistics/LogisticsVerticalCredentials.js";
// WorkCenterV2 é lazy-loaded quando acessado (ARQ-01 otimização)
import "./features/logistics/LogisticsVerticalFleet.js";

const reportError = (message, stack, componentStack) => {
  try {
    fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: String(message || "").slice(0, 500),
        stack: String(stack || "").slice(0, 4000),
        componentStack: String(componentStack || "").slice(0, 4000),
        url: location.href,
      }),
    }).catch(() => {});
  } catch {}
};

window.addEventListener("error", (event) => {
  reportError(event.message, event.error?.stack);
});
window.addEventListener("unhandledrejection", (event) => {
  reportError(
    event.reason?.message || String(event.reason || "unhandled rejection"),
    event.reason?.stack,
  );
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
    reportError(error?.message || String(error), error?.stack, info?.componentStack);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <strong>{/^\/todogreen(?:\/|$)/.test(location.pathname) ? "To Do Green" : "Seu Funcionário"}</strong>
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
window.setInterval(checkPublishedVersion, 5 * 60_000);

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
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, 5 * 60_000);
    } catch {
      // O aplicativo continua funcionando normalmente sem o modo instalável.
    }
  });
}
