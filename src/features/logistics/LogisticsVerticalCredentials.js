import { startUserSession } from "../../session/armazenamento.js";
import { carregarTurnstile, lerChaveDoTurnstile, opcoesDoWidget } from "../../components/turnstile.js";
import "./LogisticsVerticalCredentials.css";

const LEGACY_AUTH_TOKEN_KEY = "seu-funcionario-auth-token";
let observer;
let retryTimer;

const setStatus = (root, message, type = "error") => {
  const status = root.querySelector(".tdg-login-status");
  if (!status) return;
  if (status.textContent !== message) status.textContent = message;
  status.className = `tdg-login-status show ${type}`;
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a solicitação.");
  return data;
};

// ===== Anti-robô (Turnstile) =====
// O mesmo widget da tela de entrada. Sem chave no servidor, nada é baixado e
// o formulário segue como sempre. O token vale uma vez: renova a cada envio.
const montarTurnstile = async (form) => {
  const caixa = form?.querySelector(".tdg-turnstile");
  if (!caixa || caixa.dataset.montado) return;
  caixa.dataset.montado = "1";
  const siteKey = await lerChaveDoTurnstile();
  if (!siteKey || !caixa.isConnected) return;
  try {
    const api = await carregarTurnstile();
    if (!caixa.isConnected) return;
    caixa.dataset.widget = api.render(caixa, {
      ...opcoesDoWidget(siteKey, "entrada"),
      callback: (token) => {
        caixa.dataset.token = token;
      },
      "expired-callback": () => {
        caixa.dataset.token = "";
      },
      "error-callback": () => {
        caixa.dataset.token = "";
      },
    });
  } catch {
    // Sem o widget, o servidor recusa com a mensagem de verificação; o
    // formulário continua de pé para a pessoa tentar de novo.
  }
};

// Espera até 8 s pelo token (o widget termina logo depois de a tela abrir).
const tokenDoFormulario = async (form) => {
  const caixa = form?.querySelector(".tdg-turnstile");
  if (!caixa || !(await lerChaveDoTurnstile())) return "";
  for (let tentativa = 0; tentativa < 40 && !caixa.dataset.token; tentativa += 1)
    await new Promise((resolver) => setTimeout(resolver, 200));
  return caixa.dataset.token || "";
};

const renovarTurnstile = (form) => {
  const caixa = form?.querySelector(".tdg-turnstile");
  if (!caixa?.dataset.widget) return;
  caixa.dataset.token = "";
  window.turnstile?.reset(caixa.dataset.widget);
};

const saveSession = (payload) => {
  if (!payload?.token || !payload?.user?.id || !payload?.user?.email)
    throw new Error("Login sem sessão válida.");
  // Compatibilidade temporária: o App principal ainda usa este token para
  // decidir se deve validar a sessão. O cookie HttpOnly continua ativo em
  // paralelo e será o caminho definitivo quando o gate global for migrado.
  localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, payload.token);
  startUserSession(payload.user);
};

const isTodoGreenRoute = () =>
  typeof window !== "undefined" && /(^|\/)todogreen(\/|$)/i.test(window.location.pathname);

const loginHtml = () => `
  <section class="tdg-login-box" aria-label="Acesso To Do Green">
    <h2>Entrar</h2>
    <p>Use o e-mail e a senha inicial recebidos. No primeiro acesso, altere a senha antes de usar a operação.</p>
    <form class="tdg-login-form">
      <label><span>E-mail</span><input name="email" type="email" autocomplete="username" required placeholder="nome@todogreen.com.br" /></label>
      <label><span>Senha</span><input name="password" type="password" autocomplete="current-password" required placeholder="Senha inicial" /></label>
      <div class="tdg-turnstile"></div>
      <div class="tdg-login-actions">
        <button class="tdg-login-primary" type="submit">Entrar</button>
        <button class="tdg-login-secondary" type="button" data-tdg-reset>Alterar senha inicial</button>
      </div>
    </form>
    <div class="tdg-login-help">Os usuários recebem e-mail e senha inicial. Depois do primeiro acesso, a senha deve ser substituída por uma senha pessoal.</div>
    <div class="tdg-login-status" role="status" aria-live="polite"></div>
  </section>
`;

const resetHtml = () => `
  <section class="tdg-login-box" aria-label="Alterar senha inicial">
    <h2>Alterar senha</h2>
    <p>Informe o e-mail recebido. Enviaremos um código para confirmar a troca da senha inicial.</p>
    <form class="tdg-password-form" data-step="request">
      <label><span>E-mail</span><input name="email" type="email" autocomplete="username" required /></label>
      <div class="tdg-turnstile"></div>
      <button class="tdg-login-primary" type="submit">Enviar código</button>
      <button class="tdg-login-secondary" type="button" data-tdg-back>Voltar para login</button>
    </form>
    <form class="tdg-password-form" data-step="confirm" hidden>
      <label><span>Código</span><input name="code" inputmode="numeric" maxlength="6" required placeholder="000000" /></label>
      <label><span>Nova senha</span><input name="password" type="password" autocomplete="new-password" required minlength="8" /></label>
      <button class="tdg-login-primary" type="submit">Salvar nova senha</button>
      <button class="tdg-login-secondary" type="button" data-tdg-back>Voltar para login</button>
    </form>
    <div class="tdg-login-status" role="status" aria-live="polite"></div>
  </section>
`;

const bindLogin = (card) => {
  const form = card.querySelector(".tdg-login-form");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");
    try {
      setStatus(card, "Validando acesso...", "ok");
      const turnstileToken = await tokenDoFormulario(form);
      const payload = await postJson("/api/auth/login", { email, password, turnstileToken });
      saveSession(payload);
      setStatus(card, "Acesso validado. Carregando ambiente...", "ok");
      setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setStatus(card, error.message || "E-mail ou senha inválidos.", "error");
    } finally {
      renovarTurnstile(form);
    }
  });
  card.querySelector("[data-tdg-reset]")?.addEventListener("click", () => renderReset(card));
  montarTurnstile(form);
};

const bindReset = (card) => {
  const requestForm = card.querySelector('[data-step="request"]');
  const confirmForm = card.querySelector('[data-step="confirm"]');
  let resetEmail = "";
  requestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(requestForm);
    resetEmail = String(data.get("email") || "").trim().toLowerCase();
    try {
      setStatus(card, "Enviando código...", "ok");
      const turnstileToken = await tokenDoFormulario(requestForm);
      await postJson("/api/auth/forgot", { email: resetEmail, turnstileToken });
      requestForm.hidden = true;
      confirmForm.hidden = false;
      setStatus(card, "Código enviado. Informe o código e a nova senha.", "ok");
    } catch (error) {
      setStatus(card, error.message || "Não foi possível enviar o código.", "error");
    } finally {
      renovarTurnstile(requestForm);
    }
  });
  montarTurnstile(requestForm);
  confirmForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(confirmForm);
    const code = String(data.get("code") || "").trim();
    const password = String(data.get("password") || "");
    try {
      setStatus(card, "Salvando nova senha...", "ok");
      const payload = await postJson("/api/auth/reset", { email: resetEmail, code, password });
      saveSession(payload);
      setStatus(card, "Senha alterada. Carregando ambiente...", "ok");
      setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setStatus(card, error.message || "Não foi possível alterar a senha.", "error");
    }
  });
  card.querySelectorAll("[data-tdg-back]").forEach((button) => button.addEventListener("click", () => renderLogin(card)));
};

const renderLogin = (card) => {
  card.dataset.tdgCredentials = "ready";
  card.querySelector(".tdg-login-box")?.remove();
  card.insertAdjacentHTML("beforeend", loginHtml());
  bindLogin(card);
};

const renderReset = (card) => {
  card.dataset.tdgCredentials = "ready";
  card.querySelector(".tdg-login-box")?.remove();
  card.insertAdjacentHTML("beforeend", resetHtml());
  bindReset(card);
};

// Gravar textContent troca o nó de texto mesmo quando o valor é idêntico, e a
// troca conta como mutação — que reacorda o observador que chamou esta função.
// Como ela roda a cada mutação, gravar sem comparar prende a aba num laço.
const setTextIfChanged = (element, value) => {
  if (element && element.textContent !== value) element.textContent = value;
};

const ensureCredentialsLogin = () => {
  if (!isTodoGreenRoute()) return false;
  const card = document.querySelector(".tdg-denied-card");
  if (!card) return false;
  // "Confirmando permissão" usa o mesmo cartão que "acesso negado" — a
  // diferença é só o `aria-busy` no <main> pai, ligado enquanto a checagem
  // ainda está no ar. Sem essa distinção, QUALQUER pessoa autorizada via
  // "Login privado" nesse instante normal de carregamento, antes do painel
  // de verdade aparecer. Devolver falso aqui deixa `scheduleEnsure` tentar de
  // novo — se a resposta for negação de verdade, o cartão perde o
  // `aria-busy` e a próxima tentativa mostra o formulário.
  if (card.closest('[aria-busy="true"]')) return false;
  setTextIfChanged(card.querySelector("h1"), "Acesso To Do Green");
  setTextIfChanged(card.querySelector(".tdg-kicker"), "LOGIN PRIVADO");
  if (!card.querySelector(".tdg-login-box")) renderLogin(card);
  else bindLogin(card);
  return true;
};

// A tela de acesso pode demorar um instante para aparecer quando o app volta
// do segundo plano, então vale insistir. Mas quem já tem acesso nunca vai ver
// essa tela: sem um limite, a insistência viraria um temporizador eterno
// rodando por baixo da vertical inteira. Cinco segundos cobrem a renderização
// e param.
const RETRY_LIMIT = 40;

const scheduleEnsure = (tentativa = 0) => {
  window.clearTimeout(retryTimer);
  if (tentativa >= RETRY_LIMIT) return;
  retryTimer = window.setTimeout(() => {
    if (!ensureCredentialsLogin() && isTodoGreenRoute()) scheduleEnsure(tentativa + 1);
  }, 120);
};

if (typeof window !== "undefined") {
  const start = () => {
    ensureCredentialsLogin();
    observer?.disconnect();
    observer = new MutationObserver(() => ensureCredentialsLogin());
    observer.observe(document.body, { childList: true, subtree: true });
    // Envolvido numa função própria: ligado direto, o ouvinte passaria o objeto
    // do evento como contador de tentativas e o limite nunca seria atingido.
    ["pageshow", "focus", "popstate", "hashchange"].forEach((eventName) =>
      window.addEventListener(eventName, () => scheduleEnsure()),
    );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleEnsure();
    });
    scheduleEnsure();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
