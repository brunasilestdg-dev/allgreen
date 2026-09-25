// ===== Chamadas do fluxo de acesso =====
//
// Toda rota de acesso responde JSON; quando o corpo não é JSON (servidor fora
// do ar devolvendo página de erro), vira `{}` e a tela mostra a mensagem
// padrão em vez de "Unexpected token <". Cada função devolve
// `{ ok, status, data }` e NÃO lança por status HTTP — só por falha de rede,
// que a tela traduz com `mensagemDeFalha`.

import { authHeaders } from "../../session/armazenamento.js";

async function lerResposta(response) {
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return lerResposta(response);
}

// `turnstileToken` é o token do anti-robô da tela ("" com o Turnstile
// desligado); o Worker só o exige quando as duas chaves existem.

// Login e criação de conta usam o mesmo formulário.
export const entrarOuCriarConta = (mode, { name, email, password, turnstileToken }) =>
  postJson(`/api/auth/${mode === "login" ? "login" : "register"}`, {
    name,
    email,
    password,
    turnstileToken,
  });

export const confirmarCodigoDeEmail = (email, code) =>
  postJson("/api/auth/verify", { email, code });

export const reenviarCodigoDeEmail = (email, turnstileToken) =>
  postJson("/api/auth/resend", { email, turnstileToken });

export const pedirCodigoDeRecuperacao = (email, turnstileToken) =>
  postJson("/api/auth/forgot", { email, turnstileToken });

export const redefinirSenha = ({ email, code, password }) =>
  postJson("/api/auth/reset", { email, code, password });

export const entrarComGoogle = (credential) => postJson("/api/auth/google", { credential });

// Exige a senha atual: é a troca da senha provisória no primeiro acesso.
export const trocarSenha = ({ currentPassword, newPassword }) =>
  postJson("/api/auth/password", { currentPassword, newPassword }, authHeaders());

// Pedido de acesso à To Do Green, sem login: um administrador decide no app.
export const solicitarAcessoToDoGreen = (pedido, turnstileToken) =>
  postJson("/api/todogreen/solicitar-acesso", { ...pedido, turnstileToken });

// Revalida no servidor o token guardado no navegador.
export const consultarSessao = async () =>
  lerResposta(await fetch("/api/auth/session", { headers: authHeaders() }));

// Convite de colaboração: o token do link é a credencial da consulta.
export const lerConviteDeColaboracao = async (token) =>
  lerResposta(await fetch(`/api/collab/invite-info?token=${encodeURIComponent(token)}`));

export const aceitarConviteDeColaboracao = (corpo) =>
  postJson("/api/collab/invite/accept", corpo, authHeaders());

// Entrada num espaço compartilhado pelo código `?convite=` da URL.
