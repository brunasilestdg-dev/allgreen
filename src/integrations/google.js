// ===== Integrações do Google =====
//
// Agenda e Gmail: montar a URL do evento, pedir o token de acesso pelo fluxo do
// próprio navegador e enviar. Tudo aqui fala com um serviço externo, e é por
// isso que não deveria morar no meio de App.jsx — quem procura "por que o
// e-mail não saiu" não devia atravessar vinte e cinco mil linhas de tela para
// achar a chamada.

import { addDaysYmd, addDaysYmdDashed } from "../domain/datas.js";

const localDateTimeParts = (ymd, hm, addMinutes = 0) => {
  const [y, mo, d] = String(ymd || "")
    .split("-")
    .map(Number);
  const [h, mi] = String(hm || "0:0")
    .split(":")
    .map(Number);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d, h || 0, (mi || 0) + addMinutes);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    y: dt.getFullYear(),
    mo: pad(dt.getMonth() + 1),
    d: pad(dt.getDate()),
    h: pad(dt.getHours()),
    mi: pad(dt.getMinutes()),
  };
};

const taskCalendarDetails = (task) =>
  [
    task.description,
    task.project ? `Projeto: ${task.project}` : "",
    task.assignee ? `Respons\u00e1vel: ${task.assignee}` : "",
  ]
    .filter(Boolean)
    .join("\n");

export const googleCalendarUrl = (task) => {
  if (!task?.due) return "";
  const text = encodeURIComponent(task.title || "Tarefa");
  const details = encodeURIComponent(taskCalendarDetails(task));
  if (task.time) {
    const s = localDateTimeParts(task.due, task.time, 0);
    const e = localDateTimeParts(
      task.due,
      task.time,
      task.durationMinutes || 60,
    );
    if (!s || !e) return "";
    const start = `${s.y}${s.mo}${s.d}T${s.h}${s.mi}00`;
    const end = `${e.y}${e.mo}${e.d}T${e.h}${e.mi}00`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&details=${details}`;
  }
  const start = addDaysYmd(task.due, 0);
  const end = addDaysYmd(task.due, 1);
  if (!start || !end) return "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&details=${details}`;
};

let gsiLoadPromise = null;
const loadGoogleIdentityScript = () => {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise((resolve, reject) => {
    const ready = () =>
      window.google?.accounts?.oauth2
        ? resolve()
        : reject(new Error("Login do Google indisponível."));
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener("load", ready, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = ready;
    s.onerror = () =>
      reject(new Error("Não foi possível carregar o login do Google."));
    document.body.appendChild(s);
  });
  return gsiLoadPromise;
};

export const requestGoogleAccessToken = async (clientId, scope) => {
  if (!clientId)
    throw new Error("Conexão com o Google ainda não está configurada.");
  await loadGoogleIdentityScript();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (resp) => {
        if (resp?.error) reject(new Error("Permissão do Google negada."));
        else resolve(resp.access_token);
      },
      error_callback: () =>
        reject(new Error("Não foi possível conectar com o Google.")),
    });
    client.requestAccessToken();
  });
};

const base64UrlFromText = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};

// Bytes de um arquivo → base64 padrão (para a parte de anexo do MIME). Em
// blocos para não montar a string byte a byte num PDF de MB.
export const base64FromBytes = (bytes) => {
  let binary = "";
  const bloco = 0x8000;
  for (let i = 0; i < bytes.length; i += bloco) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + bloco));
  }
  return btoa(binary);
};

const buildRawEmail = ({ to, cc, subject, body, attachments = [] }) => {
  // Higieniza destinatário e cópia contra injeção de cabeçalho (CR/LF viram
  // "Bcc:", "To:" extras no envelope). O assunto já é seguro por vir em
  // =?UTF-8?B?...?= (base64); o nome do anexo é higienizado abaixo.
  const safeTo = String(to || "").replace(/[\r\n]+/g, " ").trim();
  const safeCc = String(cc || "").replace(/[\r\n]+/g, " ").trim();
  const encodedSubject = `=?UTF-8?B?${base64UrlFromText(subject || "")}?=`;
  const ccHeader = safeCc ? [`Cc: ${safeCc}`] : [];
  let message;
  if (attachments.length) {
    // Com anexo: multipart/mixed — uma parte de texto e uma parte por arquivo.
    const boundary = `tdg_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const partes = [
      `To: ${safeTo}`,
      ...ccHeader,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body || "",
    ];
    for (const anexo of attachments) {
      const nome = String(anexo.filename || "anexo").replace(/["\r\n]/g, "");
      partes.push(
        `--${boundary}`,
        `Content-Type: ${anexo.mimeType || "application/octet-stream"}; name="${nome}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${nome}"`,
        "",
        // base64 quebrado em linhas de 76 (padrão MIME).
        (String(anexo.base64 || "").match(/.{1,76}/g) || []).join("\r\n"),
      );
    }
    partes.push(`--${boundary}--`);
    message = partes.join("\r\n");
  } else {
    message = [
      `To: ${safeTo}`,
      ...ccHeader,
      `Subject: ${encodedSubject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
      "",
      body || "",
    ].join("\r\n");
  }
  return base64UrlFromText(message)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const sendGmailReal = async (clientId, { to, cc, subject, body, attachments = [] }) => {
  const token = await requestGoogleAccessToken(
    clientId,
    "https://www.googleapis.com/auth/gmail.send",
  );
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: buildRawEmail({ to, cc, subject, body, attachments }) }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error?.message || "Não foi possível enviar o e-mail agora.",
    );
  }
  return res.json();
};

// Cria um RASCUNHO no Gmail (não envia) — com o mesmo MIME multipart do envio,
// então o anexo vai junto. É o que resolve "o rascunho não anexa o material":
// a compose por URL não carrega anexo; a API de drafts carrega.
export const createGmailDraftReal = async (clientId, { to, cc, subject, body, attachments = [] }) => {
  const token = await requestGoogleAccessToken(
    clientId,
    "https://www.googleapis.com/auth/gmail.compose",
  );
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: { raw: buildRawEmail({ to, cc, subject, body, attachments }) } }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Não foi possível criar o rascunho agora.");
  }
  return res.json();
};

export const createGoogleCalendarEventReal = async (clientId, task) => {
  const token = await requestGoogleAccessToken(
    clientId,
    "https://www.googleapis.com/auth/calendar.events",
  );
  const details = taskCalendarDetails(task);
  let body;
  if (task.time) {
    const s = localDateTimeParts(task.due, task.time, 0);
    const e = localDateTimeParts(
      task.due,
      task.time,
      task.durationMinutes || 60,
    );
    if (!s || !e) throw new Error("Data ou hora do compromisso inválida.");
    body = {
      summary: task.title || "Tarefa",
      description: details,
      start: {
        dateTime: `${s.y}-${s.mo}-${s.d}T${s.h}:${s.mi}:00`,
        timeZone: "America/Sao_Paulo",
      },
      end: {
        dateTime: `${e.y}-${e.mo}-${e.d}T${e.h}:${e.mi}:00`,
        timeZone: "America/Sao_Paulo",
      },
    };
  } else {
    body = {
      summary: task.title || "Tarefa",
      description: details,
      start: { date: addDaysYmdDashed(task.due, 0) },
      end: { date: addDaysYmdDashed(task.due, 1) },
    };
  }
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error?.message || "Não foi possível criar o evento agora.",
    );
  }
  return res.json();
};
