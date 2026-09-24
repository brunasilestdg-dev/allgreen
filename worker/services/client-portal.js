// ===== Portal do cliente do espaço (o genérico do app) =====
//
// É o portal que qualquer espaço publica para um cliente, com link
// individual. NÃO é o portal da To Do Green (todogreen-customer-portal.js).
//
// Contrato
// - Recebe: `request`, `env` e `url`; na gestão, também `user`.
// - Devolve: `handlePublicClientPortal` — a página `/portal/:token`, os
//   dados `GET /api/portal/:token`, o download de relatório e as ações
//   `POST /api/portal/:token/actions` (chamado, envio de documento,
//   decisão sobre entrega); `null` para caminho sem token válido, para o
//   roteador seguir adiante. `handleClientPortals` —
//   `/api/client-portals/status|events|file` (GET) e
//   `/api/client-portals/publish|revoke` (POST).
// - Quem chama: a tabela de rotas públicas (`handlePublicClientPortal`) e
//   a de rotas autenticadas (`handleClientPortals`, exige sessão e banco).
// - Autorização: no lado público, o token (48 a 128 hex, guardado só como
//   hash) é a credencial; expirado ou revogado responde como inexistente, e
//   as ações são limitadas por IP e deduplicadas por `requestId`. Na
//   gestão, precisa ser membro do espaço; publicar, revogar e ler eventos
//   ou arquivos passam por `canManageClientPortal`.

import { randomHex, sha256 } from "../auth/credenciais.js";
import { moneyBRL } from "../lib/format.js";
import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { canManageClientPortal } from "../lib/record-permissions.js";
import { safeParseJson } from "../lib/safe-json.js";
import {
  filterRecordsForViewer,
  resolveViewerContext,
} from "../lib/visibility.js";
import { escMail, notifyNewNotifications } from "../mensageria/envio.js";
import { PUBLIC_FORM_FILE_TYPES } from "./public-forms.js";
import {
  buildClientPortalSnapshot,
  clientPortalSummary,
  normalizeClientPortal,
  validateClientPortalAction,
} from "../../src/features/portal/clientPortalDomain.js";

// ── Portal do cliente ───────────────────────────────────────────────────
const CLIENT_PORTAL_TOKEN_PATTERN = /^[a-f0-9]{48,128}$/i;
const CLIENT_PORTAL_MAX_FILE_BYTES = 350_000;
const CLIENT_PORTAL_MAX_WORKSPACE_BYTES = 900_000;

const clientPortalUnavailable = () =>
  new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Portal indisponível</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#211846"><h1>Este portal não está disponível</h1><p>O link pode ter expirado, sido revogado ou estar incorreto.</p></body></html>',
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );

const clientPortalDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const clientPortalProtocol = () => {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PORTAL-${stamp}-${randomHex(3).toUpperCase()}`;
};

async function loadClientPortal(env, token, { touch = false } = {}) {
  if (!env.DB || !CLIENT_PORTAL_TOKEN_PATTERN.test(token || "")) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, created_by, config_json, status,
            expires_at, created_at, updated_at
       FROM client_portals
      WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first();
  if (!row || row.status !== "active") return null;
  if (row.expires_at && row.expires_at <= new Date().toISOString()) return null;
  const config = normalizeClientPortal(safeParseJson(row.config_json), {
    workspaceOwnerId: row.workspace_owner_id,
    ownerId: row.created_by,
  });
  const workspace = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(row.workspace_owner_id)
    .first();
  if (!workspace) return null;
  const data = safeParseJson(workspace.data);
  const snapshot = buildClientPortalSnapshot(data, config);
  if (touch)
    await env.DB.prepare(
      "UPDATE client_portals SET last_accessed_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), row.id)
      .run()
      .catch(() => {});
  return {
    row,
    config,
    data,
    revision: Number(workspace.revision) || 0,
    snapshot,
  };
}

const clientPortalStatusLabel = (status) => {
  const labels = {
    "A fazer": "A fazer",
    "Em andamento": "Em andamento",
    Aguardando: "Aguardando",
    Concluído: "Concluído",
    Novo: "Novo",
    Entregue: "Entregue",
    aprovado: "Aprovado",
    recusado: "Recusado",
  };
  return labels[status] || status || "Sem status";
};

function renderClientPortal(token, snapshot) {
  const esc = escMail;
  const portal = snapshot.portal || {};
  const permissions = portal.permissions || {};
  const summary = clientPortalSummary(snapshot);
  const primary = /^#[0-9a-f]{6}$/i.test(portal.appearance?.primaryColor || "")
    ? portal.appearance.primaryColor
    : "#0b9f8f";
  const accent = /^#[0-9a-f]{6}$/i.test(portal.appearance?.accentColor || "")
    ? portal.appearance.accentColor
    : "#16b8a6";
  const logo = portal.appearance?.logoUrl
    ? `<img class="logo" src="${esc(portal.appearance.logoUrl)}" alt="">`
    : `<span class="logo-fallback">${esc(
        (snapshot.business?.name || portal.clientName || "SF")
          .slice(0, 2)
          .toUpperCase(),
      )}</span>`;
  const cards = [
    ["Projetos", summary.projects],
    ["Tarefas abertas", summary.openTasks],
    ["Entregas para aprovar", summary.pendingDeliveries],
    ["Documentos", summary.documents],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`,
    )
    .join("");
  const projects = (snapshot.projects || [])
    .map(
      (project) => `<article class="card project-card">
        <div class="row between"><div><span class="eyebrow">Projeto</span><h3>${esc(
          project.name,
        )}</h3></div><strong class="progress-number">${project.progress}%</strong></div>
        ${project.objective ? `<p>${esc(project.objective)}</p>` : ""}
        <div class="progress"><span style="width:${Math.max(
          0,
          Math.min(100, Number(project.progress) || 0),
        )}%"></span></div>
        <small>${project.completedTasks} de ${project.taskCount} tarefas concluídas${
          project.endDate ? ` · previsão ${esc(clientPortalDate(project.endDate))}` : ""
        }</small>
        ${
          project.milestones?.length
            ? `<div class="milestones">${project.milestones
                .map(
                  (milestone) =>
                    `<span><b>${esc(milestone.title)}</b>${milestone.plannedDate ? ` · ${esc(clientPortalDate(milestone.plannedDate))}` : ""}</span>`,
                )
                .join("")}</div>`
            : ""
        }
      </article>`,
    )
    .join("");
  const tasks = (snapshot.tasks || [])
    .map((task) => {
      const latest = task.deliveries?.[task.deliveries.length - 1];
      const canDecide =
        permissions.approveDeliveries &&
        latest &&
        !latest.clientDecision;
      const delivery = latest
        ? `<div class="delivery">
            <div class="row between"><strong>Última entrega</strong><span class="badge">${esc(
              latest.clientDecision
                ? latest.clientDecision === "approved"
                  ? "Aprovada por você"
                  : "Ajustes solicitados"
                : "Aguardando sua análise",
            )}</span></div>
            ${latest.comment ? `<p>${esc(latest.comment)}</p>` : ""}
            ${
              canDecide
                ? `<form class="delivery-form" data-task="${esc(
                    task.id,
                  )}" data-delivery="${esc(latest.id)}">
                    <label>Comentário opcional<textarea name="feedback" maxlength="1600" placeholder="Registre sua observação"></textarea></label>
                    <div class="actions">
                      <button type="submit" name="decision" value="changes_requested" class="ghost">Solicitar ajustes</button>
                      <button type="submit" name="decision" value="approved">Aprovar entrega</button>
                    </div>
                  </form>`
                : ""
            }
          </div>`
        : "";
      return `<article class="card task-card">
        <div class="row between"><div><span class="eyebrow">${esc(
          task.project || "Tarefa",
        )}</span><h3>${esc(task.title)}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(task.status),
        )}</span></div>
        ${task.description ? `<p>${esc(task.description)}</p>` : ""}
        ${task.due ? `<small>Prazo: ${esc(clientPortalDate(task.due))}</small>` : ""}
        ${delivery}
      </article>`;
    })
    .join("");
  const documents = (snapshot.documents || [])
    .map(
      (document) => `<article class="card document-card">
        <div class="row between"><div><span class="eyebrow">${esc(
          document.type || "Documento",
        )}</span><h3>${esc(document.title)}</h3></div>${
          document.downloadable
            ? `<a class="button-link ghost" href="/api/portal/${esc(
                token,
              )}/download/${esc(document.id)}">Baixar relatório</a>`
            : ""
        }</div>
        ${
          document.content
            ? `<details><summary>Visualizar conteúdo</summary><pre>${esc(
                document.content,
              )}</pre></details>`
            : "<p>Documento compartilhado sem visualização de texto.</p>"
        }
      </article>`,
    )
    .join("");
  const quotes = (snapshot.quotes || [])
    .map(
      (quote) => `<article class="card">
        <div class="row between"><div><span class="eyebrow">Orçamento</span><h3>${esc(
          quote.clientName || "Proposta comercial",
        )}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(quote.status),
        )}</span></div>
        <div class="value">${moneyBRL(Number(quote.total) || 0)}</div>
        <ul class="items">${quote.items
          .map(
            (item) =>
              `<li><span>${esc(item.quantity)} × ${esc(item.name)}</span><strong>${moneyBRL(
                (Number(item.quantity) || 0) * (Number(item.price) || 0),
              )}</strong></li>`,
          )
          .join("")}</ul>
        ${quote.validUntil ? `<small>Válido até ${esc(clientPortalDate(quote.validUntil))}</small>` : ""}
      </article>`,
    )
    .join("");
  const orders = (snapshot.orders || [])
    .map(
      (order) => `<article class="card">
        <div class="row between"><div><span class="eyebrow">Pedido</span><h3>${esc(
          order.clientName || order.id,
        )}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(order.status),
        )}</span></div>
        <div class="value">${moneyBRL(Number(order.total) || 0)}</div>
        <ul class="items">${order.items
          .map(
            (item) =>
              `<li><span>${esc(item.quantity)} × ${esc(item.name)}</span></li>`,
          )
          .join("")}</ul>
      </article>`,
    )
    .join("");
  const trips = (snapshot.trips || [])
    .map(
      (trip) => `<article class="card trip-card">
        <div class="row between"><div><span class="eyebrow">Entrega</span><h3>${esc(
          trip.code || "Acompanhamento",
        )}</h3></div><span class="status">${esc(
          clientPortalStatusLabel(trip.status),
        )}</span></div>
        <div class="route"><span>${esc(trip.origin || "Origem")}</span><b>→</b><span>${esc(
          trip.destination || "Destino",
        )}</span></div>
        ${trip.eta ? `<small>Previsão: ${esc(clientPortalDate(trip.eta))}</small>` : ""}
        ${trip.occurrence ? `<p class="notice">${esc(trip.occurrence)}</p>` : ""}
      </article>`,
    )
    .join("");
  const section = (id, title, content) =>
    content
      ? `<section id="${id}"><div class="section-title"><span></span><h2>${title}</h2></div><div class="grid">${content}</div></section>`
      : "";
  const nonce = randomHex(16);
  const endpoint = `/api/portal/${token}/actions`;
  const interactionForms = `${
    permissions.openTickets
      ? `<article class="card action-card"><span class="eyebrow">Atendimento</span><h3>Abrir chamado</h3><form id="ticket-form"><label>Assunto<input name="title" maxlength="200" required></label><label>Descrição<textarea name="description" maxlength="4000" required></textarea></label><label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label><button type="submit">Enviar chamado</button></form></article>`
      : ""
  }${
    permissions.uploadDocuments
      ? `<article class="card action-card"><span class="eyebrow">Documentos</span><h3>Enviar documento</h3><form id="upload-form"><label>Arquivo<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx" required></label><label>Observação<textarea name="note" maxlength="1200"></textarea></label><button type="submit">Enviar documento</button></form></article>`
      : ""
  }`;
  const script = `<script nonce="${nonce}">(()=>{const endpoint=${JSON.stringify(
    endpoint,
  )},status=document.getElementById('portal-status');const requestId=()=>crypto.randomUUID?.()||('request-'+Date.now()+'-'+Math.random());const send=async body=>{status.textContent='Enviando...';const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,requestId:requestId()})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível concluir.');status.textContent='Concluído. Protocolo '+data.protocol;return data};document.querySelectorAll('.delivery-form').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const submitter=event.submitter;try{await send({type:'delivery',taskId:form.dataset.task,deliveryId:form.dataset.delivery,decision:submitter?.value||'',feedback:new FormData(form).get('feedback')||''});location.reload()}catch(error){status.textContent=error.message}}));document.getElementById('ticket-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);try{await send({type:'ticket',title:data.get('title'),description:data.get('description'),priority:data.get('priority')});form.reset()}catch(error){status.textContent=error.message}});const readFile=file=>new Promise((resolve,reject)=>{if(!file||!file.size)return reject(new Error('Selecione um arquivo.'));if(file.size>${CLIENT_PORTAL_MAX_FILE_BYTES})return reject(new Error('O arquivo excede 350 KB.'));const reader=new FileReader();reader.onload=()=>resolve({id:crypto.randomUUID?.()||('file-'+Date.now()),name:file.name,type:file.type||'application/octet-stream',size:file.size,dataUrl:reader.result});reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file)});document.getElementById('upload-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);try{await send({type:'upload',file:await readFile(data.get('file')),note:data.get('note')||''});form.reset()}catch(error){status.textContent=error.message}})})()</script>`;
  return { nonce, html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(
    portal.title,
  )}</title><style>*{box-sizing:border-box}body{--primary:${primary};--accent:${accent};margin:0;background:#f6f4fb;color:#211846;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}.top{padding:34px max(20px,calc((100vw - 1120px)/2));background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff}.brand,.row,.actions,.route{display:flex;align-items:center;gap:12px}.brand{margin-bottom:28px}.logo{width:44px;height:44px;object-fit:contain;border-radius:12px;background:#fff}.logo-fallback{display:grid;width:44px;height:44px;place-items:center;border-radius:12px;background:#fff;color:var(--primary);font-weight:900}.brand strong,.brand small{display:block}.brand small{opacity:.78}.top h1{max-width:760px;margin:0 0 8px;font-size:clamp(1.8rem,5vw,3rem)}.top p{max-width:760px;margin:0;line-height:1.6;opacity:.88}.wrap{max-width:1120px;margin:0 auto;padding:22px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:-48px}.metric,.card{background:#fff;border:1px solid #e6e2f2;border-radius:18px;box-shadow:0 12px 34px rgba(55,35,115,.07)}.metric{padding:18px}.metric strong,.metric span{display:block}.metric strong{font-size:1.8rem}.metric span{margin-top:3px;color:#746d88;font-size:.78rem}.section-title{display:flex;align-items:center;gap:9px;margin:32px 0 12px}.section-title span{width:5px;height:24px;border-radius:9px;background:linear-gradient(var(--primary),var(--accent))}.section-title h2{margin:0;font-size:1.18rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{padding:18px}.card h3{margin:3px 0 8px;font-size:1rem}.card p{color:#655e76;line-height:1.55}.between{justify-content:space-between}.eyebrow{color:var(--primary);font-size:.65rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.status,.badge{padding:5px 8px;border-radius:999px;background:#f0edf9;color:var(--primary);font-size:.68rem;font-weight:800}.progress{height:8px;margin:14px 0 8px;overflow:hidden;border-radius:9px;background:#ece8f5}.progress span{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--accent))}.progress-number,.value{color:var(--primary);font-size:1.3rem}.milestones{display:grid;gap:5px;margin-top:12px}.milestones span{padding:8px;border-radius:9px;background:#f8f7fc;font-size:.75rem}.delivery{margin-top:14px;padding:13px;border-radius:13px;background:#faf8ff;border:1px solid #ece7f8}.delivery textarea{min-height:68px}.actions{justify-content:flex-end;margin-top:8px}.actions button{width:auto}.document-card pre{max-height:320px;overflow:auto;white-space:pre-wrap;font:inherit;font-size:.8rem;line-height:1.55}.document-card summary{cursor:pointer;color:var(--primary);font-weight:800}.button-link,button{display:inline-flex;justify-content:center;padding:10px 13px;border:0;border-radius:10px;background:var(--primary);color:#fff;font:inherit;font-size:.78rem;font-weight:800;text-decoration:none;cursor:pointer}.ghost{background:#f0edf9;color:var(--primary)}label{display:grid;gap:5px;margin:10px 0;color:#655e76;font-size:.72rem;font-weight:800}input,textarea,select{width:100%;padding:10px;border:1px solid #ddd7ec;border-radius:9px;background:#fff;color:#211846;font:inherit}textarea{min-height:92px;resize:vertical}.items{padding:0;list-style:none}.items li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #eee}.route{justify-content:space-between;margin:14px 0;padding:12px;border-radius:12px;background:#f8f7fc}.notice{padding:9px;border-radius:9px;background:#fff4e5;color:#8a5300!important}.portal-status{position:sticky;bottom:12px;z-index:3;min-height:20px;margin:18px auto;padding:10px 14px;border-radius:11px;background:#211846;color:#fff;text-align:center;font-size:.78rem}.footer{padding:30px 20px;text-align:center;color:#88809a;font-size:.75rem}@media(max-width:760px){.metrics{grid-template-columns:repeat(2,1fr);margin-top:-32px}.grid{grid-template-columns:1fr}.wrap{padding:14px}.top{padding:26px 18px 54px}.between{align-items:flex-start}.actions{align-items:stretch;flex-direction:column}.actions button{width:100%}}</style></head><body><header class="top"><div class="brand">${logo}<div><strong>${esc(
    snapshot.business?.name || "Seu Funcionário",
  )}</strong><small>Portal seguro do cliente</small></div></div><h1>${esc(
    portal.title,
  )}</h1><p>${esc(
    portal.clientName ? `${portal.clientName}, ${portal.welcome}` : portal.welcome,
  )}</p></header><main class="wrap"><div class="metrics">${cards}</div>${section(
    "projetos",
    "Projetos",
    projects,
  )}${section("tarefas", "Tarefas e entregas", tasks)}${section(
    "documentos",
    "Documentos e relatórios",
    documents,
  )}${section("orcamentos", "Orçamentos", quotes)}${section(
    "pedidos",
    "Pedidos",
    orders,
  )}${section("entregas", "Acompanhamento de entregas", trips)}${section(
    "interagir",
    "Fale com a equipe",
    interactionForms,
  )}<p id="portal-status" class="portal-status" role="status">${
    portal.supportText
      ? esc(portal.supportText)
      : "Suas ações recebem protocolo e ficam registradas."
  }</p></main><footer class="footer">Acesso individual e restrito · Seu Funcionário</footer>${script}</body></html>` };
}

function sanitizeClientPortalFile(file) {
  if (!file || typeof file !== "object")
    throw new Error("Selecione um arquivo.");
  const name = String(file.name || "")
    .trim()
    .slice(0, 240);
  const type = String(file.type || "").toLowerCase();
  const size = Math.max(0, Number(file.size) || 0);
  const dataUrl = String(file.dataUrl || "");
  if (
    !name ||
    !PUBLIC_FORM_FILE_TYPES.has(type) ||
    !size ||
    size > CLIENT_PORTAL_MAX_FILE_BYTES
  )
    throw new Error("O arquivo não é permitido ou excede 350 KB.");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match || match[1].toLowerCase() !== type)
    throw new Error("O conteúdo do arquivo é inválido.");
  const estimatedBytes = Math.floor((match[2].replace(/=+$/, "").length * 3) / 4);
  if (estimatedBytes < 1 || estimatedBytes > CLIENT_PORTAL_MAX_FILE_BYTES)
    throw new Error("O conteúdo do arquivo excede 350 KB.");
  return {
    id: String(file.id || crypto.randomUUID()).slice(0, 100),
    name,
    type,
    size: estimatedBytes,
    dataUrl,
  };
}

const publicClientPortalEvent = (row) => {
  const payload = safeParseJson(row.payload_json);
  if (payload.file) {
    const { dataUrl: _dataUrl, ...metadata } = payload.file;
    payload.file = metadata;
  }
  return {
    id: row.id,
    portalId: row.portal_id,
    type: row.type,
    entityType: row.entity_type || "",
    entityId: row.entity_id || "",
    linkedRecordId: row.linked_record_id || "",
    protocol: row.protocol,
    payload,
    status: row.status,
    error: row.error || "",
    createdAt: row.created_at,
  };
};

async function applyClientPortalEvent(env, loaded, event, action) {
  const ownerId = loaded.row.workspace_owner_id;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const workspace = await env.DB.prepare(
      "SELECT data, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    if (!workspace)
      return { status: "failed", error: "Workspace não encontrado." };
    const data = safeParseJson(workspace.data);
    const snapshot = buildClientPortalSnapshot(data, loaded.config);
    const validation = validateClientPortalAction(action, snapshot);
    if (!validation.valid)
      return { status: "failed", error: validation.error };
    const beforeNotifications = Array.isArray(data.notifications)
      ? [...data.notifications]
      : [];
    const now = new Date().toISOString();
    let linkedRecordId = "";
    if (action.type === "ticket") {
      const task = {
        id: crypto.randomUUID(),
        title: `[Portal] ${String(action.title || "").trim().slice(0, 200)}`,
        description: `${String(action.description || "").trim().slice(0, 4000)}\n\nCliente: ${loaded.config.clientName || "não informado"}\nProtocolo: ${event.protocol}`,
        status: "A fazer",
        priority:
          action.priority === "Urgente"
            ? "Alta"
            : action.priority === "Alta"
              ? "Alta"
              : "Média",
        area: "Atendimento",
        assignee: "Atendimento",
        assigneeId: "",
        project: "",
        projectId: null,
        approvalMode: "imediata",
        visibility: "espaco_todo",
        sharedWith: [],
        sharedTeams: [],
        assignees: [],
        interested: [],
        deliveries: [],
        subtasks: [],
        dependsOn: [],
        attachments: [],
        recurrence: { frequency: "none" },
        ownerId,
        businessId: loaded.config.businessId || null,
        sourceClientPortalId: loaded.config.id,
        sourceClientPortalEventId: event.id,
        publicProtocol: event.protocol,
        createdAt: now,
        updatedAt: now,
      };
      data.tasks = [task, ...(Array.isArray(data.tasks) ? data.tasks : [])];
      linkedRecordId = task.id;
    } else if (action.type === "upload") {
      const document = {
        id: crypto.randomUUID(),
        title: action.file.name,
        type: "Documento enviado pelo cliente",
        category: "Portal do cliente",
        content: `Documento recebido pelo portal de ${loaded.config.clientName || "cliente"}.\nProtocolo: ${event.protocol}${action.note ? `\nObservação: ${String(action.note).slice(0, 1200)}` : ""}`,
        status: "Recebido",
        ownerId,
        businessId: loaded.config.businessId || null,
        visibility: "espaco_todo",
        sharedWith: [],
        sharedTeams: [],
        sourceClientPortalId: loaded.config.id,
        sourceClientPortalEventId: event.id,
        portalAttachment: {
          id: action.file.id,
          name: action.file.name,
          type: action.file.type,
          size: action.file.size,
        },
        createdAt: now,
        updatedAt: now,
      };
      data.documents = [
        document,
        ...(Array.isArray(data.documents) ? data.documents : []),
      ];
      linkedRecordId = document.id;
    } else if (action.type === "delivery") {
      data.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map((task) => {
        if (task.id !== action.taskId) return task;
        return {
          ...task,
          clientApprovalStatus:
            action.decision === "approved" ? "approved" : "changes_requested",
          clientApprovalFeedback: String(action.feedback || "").slice(0, 1600),
          clientApprovalAt: now,
          deliveries: (Array.isArray(task.deliveries) ? task.deliveries : []).map(
            (delivery) =>
              delivery.id === action.deliveryId
                ? {
                    ...delivery,
                    clientDecision: action.decision,
                    clientFeedback: String(action.feedback || "").slice(0, 1600),
                    clientDecidedAt: now,
                    clientProtocol: event.protocol,
                  }
                : delivery,
          ),
          updatedAt: now,
        };
      });
      linkedRecordId = action.taskId;
    }
    data.notifications = [
      {
        id: crypto.randomUUID(),
        assigneeId: loaded.config.ownerId || ownerId,
        ownerId,
        message:
          action.type === "ticket"
            ? `Novo chamado de ${loaded.config.clientName || "cliente"}: ${event.protocol}`
            : action.type === "upload"
              ? `Novo documento no portal: ${event.protocol}`
              : `Cliente respondeu sobre uma entrega: ${event.protocol}`,
        link: "portal-cliente",
        read: false,
        visibility: "privado",
        createdAt: now,
      },
      ...(Array.isArray(data.notifications) ? data.notifications : []),
    ].slice(0, 50);
    const serialized = JSON.stringify(data);
    if (serialized.length > CLIENT_PORTAL_MAX_WORKSPACE_BYTES)
      return {
        status: "failed",
        error:
          "O workspace está no limite. A solicitação foi preservada para tratamento manual.",
      };
    const updated = await env.DB.prepare(
      `UPDATE workspaces
          SET data = ?, updated_at = ?, revision = revision + 1
        WHERE user_id = ? AND revision = ?
        RETURNING revision`,
    )
      .bind(serialized, now, ownerId, Number(workspace.revision) || 0)
      .first();
    if (!updated) continue;
    await notifyNewNotifications(
      env,
      beforeNotifications,
      data.notifications,
    ).catch((error) => console.error("client portal push", error));
    return { status: "applied", linkedRecordId };
  }
  return {
    status: "failed",
    error: "O workspace mudou durante a ação. O registro foi preservado.",
  };
}

export async function handlePublicClientPortal(request, env, url) {
  if (!env.DB) return json({ error: "Portal indisponível." }, 503);
  const pageMatch = url.pathname.match(/^\/portal\/([a-f0-9]{48,128})\/?$/i);
  const dataMatch = url.pathname.match(
    /^\/api\/portal\/([a-f0-9]{48,128})\/?$/i,
  );
  const actionMatch = url.pathname.match(
    /^\/api\/portal\/([a-f0-9]{48,128})\/actions\/?$/i,
  );
  const downloadMatch = url.pathname.match(
    /^\/api\/portal\/([a-f0-9]{48,128})\/download\/([a-zA-Z0-9_-]{3,100})\/?$/,
  );
  const token =
    pageMatch?.[1] || dataMatch?.[1] || actionMatch?.[1] || downloadMatch?.[1];
  if (!token) return null;
  const loaded = await loadClientPortal(env, token, {
    touch: !!pageMatch || !!dataMatch,
  });
  if (!loaded)
    return pageMatch ? clientPortalUnavailable() : json({ error: "Portal não encontrado." }, 404);
  if (pageMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const rendered = renderClientPortal(token, loaded.snapshot);
    return new Response(rendered.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; script-src 'nonce-${rendered.nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (dataMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    return json({
      ...loaded.snapshot,
      summary: clientPortalSummary(loaded.snapshot),
    });
  }
  if (downloadMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const document = (loaded.snapshot.documents || []).find(
      (item) => item.id === downloadMatch[2] && item.downloadable,
    );
    if (!document) return json({ error: "Relatório não encontrado." }, 404);
    return new Response(document.content || "Relatório sem conteúdo textual.", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          `${document.title || "relatorio"}.txt`,
        )}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`client-portal:${ip}:${loaded.row.id}`, 20))
    return json({ error: "Muitas tentativas. Aguarde um minuto." }, 429);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const action = {
    type: String(body.type || "").slice(0, 80),
    title: String(body.title || "").trim().slice(0, 200),
    description: String(body.description || "").trim().slice(0, 4000),
    priority: String(body.priority || "").slice(0, 40),
    note: String(body.note || "").trim().slice(0, 1200),
    taskId: String(body.taskId || "").slice(0, 100),
    deliveryId: String(body.deliveryId || "").slice(0, 100),
    decision: String(body.decision || "").slice(0, 40),
    feedback: String(body.feedback || "").trim().slice(0, 1600),
    file: body.file,
  };
  if (action.type === "upload") {
    try {
      action.file = sanitizeClientPortalFile(body.file);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  }
  const validation = validateClientPortalAction(action, loaded.snapshot);
  if (!validation.valid) return json({ error: validation.error }, 400);
  const requestId = String(body.requestId || "").slice(0, 160);
  if (!requestId) return json({ error: "Identificador do envio obrigatório." }, 400);
  const dedupeKey = await sha256(`${loaded.row.id}:${requestId}`);
  const previous = await env.DB.prepare(
    `SELECT protocol, status, error
       FROM client_portal_events
      WHERE portal_id = ? AND dedupe_key = ?`,
  )
    .bind(loaded.row.id, dedupeKey)
    .first();
  if (previous)
    return json({
      ok: previous.status === "applied",
      protocol: previous.protocol,
      status: previous.status,
      error: previous.error || "",
      duplicate: true,
    });
  const now = new Date().toISOString();
  const event = {
    id: crypto.randomUUID(),
    protocol: clientPortalProtocol(),
  };
  const payload = {
    title: action.title,
    description: action.description,
    priority: action.priority,
    note: action.note,
    feedback: action.feedback,
    decision: action.decision,
    clientName: loaded.config.clientName,
    clientEmail: loaded.config.clientEmail,
    file: action.file || null,
  };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO client_portal_events
      (id, portal_id, workspace_owner_id, type, entity_type, entity_id,
       protocol, payload_json, status, error, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', '', ?, ?)`,
  )
    .bind(
      event.id,
      loaded.row.id,
      loaded.row.workspace_owner_id,
      action.type,
      action.type === "delivery"
        ? "task"
        : action.type === "upload"
          ? "document"
          : "ticket",
      action.taskId || null,
      event.protocol,
      JSON.stringify(payload),
      dedupeKey,
      now,
    )
    .run();
  const applied = await applyClientPortalEvent(env, loaded, event, action);
  await env.DB.prepare(
    `UPDATE client_portal_events
        SET linked_record_id = ?, status = ?, error = ?
      WHERE id = ?`,
  )
    .bind(
      applied.linkedRecordId || null,
      applied.status,
      applied.error || "",
      event.id,
    )
    .run();
  return json(
    {
      ok: applied.status === "applied",
      protocol: event.protocol,
      status: applied.status,
      error: applied.error || "",
    },
    applied.status === "applied" ? 201 : 202,
  );
}

export async function handleClientPortals(request, env, user, url) {
  const action = url.pathname.replace("/api/client-portals/", "");
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (action === "status" && request.method === "GET") {
    let visibleIds = null;
    if (role === "colaborador" || role === "gestor") {
      const workspace = await env.DB.prepare(
        "SELECT data FROM workspaces WHERE user_id = ?",
      )
        .bind(ownerId)
        .first();
      const data = safeParseJson(workspace?.data);
      const ctx = resolveViewerContext(data, user.id);
      visibleIds = new Set(
        filterRecordsForViewer(data.clientPortals, user.id, ctx).map(
          (portal) => portal.id,
        ),
      );
    }
    const rows = await env.DB.prepare(
      `SELECT id, status, expires_at AS expiresAt,
              last_accessed_at AS lastAccessedAt, updated_at AS updatedAt,
              (SELECT COUNT(*) FROM client_portal_events e WHERE e.portal_id = p.id) AS events
         FROM client_portals p
        WHERE workspace_owner_id = ?
        ORDER BY updated_at DESC`,
    )
      .bind(ownerId)
      .all();
    return json({
      items: (rows.results || [])
        .filter((item) => !visibleIds || visibleIds.has(item.id))
        .map((item) => ({
          ...item,
          active: item.status === "active",
          events: Number(item.events) || 0,
        })),
    });
  }
  if (action === "events" && request.method === "GET") {
    const portalId = String(url.searchParams.get("portal_id") || "").slice(
      0,
      100,
    );
    const portalRow = await env.DB.prepare(
      "SELECT workspace_owner_id FROM client_portals WHERE id = ?",
    )
      .bind(portalId)
      .first();
    if (
      !portalRow ||
      portalRow.workspace_owner_id !== ownerId ||
      !(await canManageClientPortal(env, user.id, ownerId, portalId))
    )
      return json({ error: "Você não pode acessar este portal." }, 403);
    const rows = await env.DB.prepare(
      `SELECT id, portal_id, type, entity_type, entity_id, linked_record_id,
              protocol, payload_json, status, error, created_at
         FROM client_portal_events
        WHERE portal_id = ?
        ORDER BY created_at DESC
        LIMIT 300`,
    )
      .bind(portalId)
      .all();
    return json({ items: (rows.results || []).map(publicClientPortalEvent) });
  }
  if (action === "file" && request.method === "GET") {
    const eventId = String(url.searchParams.get("event_id") || "").slice(0, 100);
    const row = await env.DB.prepare(
      `SELECT portal_id, workspace_owner_id, payload_json
         FROM client_portal_events
        WHERE id = ? AND type = 'upload'`,
    )
      .bind(eventId)
      .first();
    if (
      !row ||
      row.workspace_owner_id !== ownerId ||
      !(await canManageClientPortal(env, user.id, ownerId, row.portal_id))
    )
      return json({ error: "Arquivo não encontrado." }, 404);
    const file = safeParseJson(row.payload_json)?.file;
    if (!file?.dataUrl) return json({ error: "Arquivo não encontrado." }, 404);
    const match = String(file.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match || !PUBLIC_FORM_FILE_TYPES.has(match[1]))
      return json({ error: "Arquivo inválido." }, 400);
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return new Response(bytes, {
      headers: {
        "content-type": match[1],
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          file.name || "arquivo",
        )}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const portalId = String(body.portal?.id || body.id || "").slice(0, 100);
  if (!portalId || !/^[a-zA-Z0-9_-]{3,100}$/.test(portalId))
    return json({ error: "Identificador do portal inválido." }, 400);
  const canManage =
    user.id === ownerId ||
    role === "admin" ||
    (await canManageClientPortal(env, user.id, ownerId, portalId));
  if (!canManage)
    return json({ error: "Você não pode publicar este portal." }, 403);
  if (action === "publish") {
    const portal = normalizeClientPortal(body.portal, {
      workspaceOwnerId: ownerId,
      ownerId: user.id,
      businessId: body.portal?.businessId || null,
    });
    portal.ownerId = user.id;
    portal.workspaceOwnerId = ownerId;
    if (!portal.clientName || !portal.title)
      return json({ error: "Informe o cliente e o título do portal." }, 400);
    if (
      portal.expiresAt &&
      new Date(portal.expiresAt).getTime() <= Date.now()
    )
      return json({ error: "A validade precisa estar no futuro." }, 400);
    const config = JSON.stringify(portal);
    if (config.length > 180_000)
      return json({ error: "A configuração do portal é muito grande." }, 413);
    const existing = await env.DB.prepare(
      "SELECT workspace_owner_id FROM client_portals WHERE id = ?",
    )
      .bind(portalId)
      .first();
    if (existing && existing.workspace_owner_id !== ownerId)
      return json({ error: "Este portal pertence a outro espaço." }, 403);
    const token = randomHex(32);
    const tokenHash = await sha256(token);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO client_portals
        (id, workspace_owner_id, created_by, token_hash, config_json, status,
         expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         token_hash = excluded.token_hash, config_json = excluded.config_json,
         status = 'active', expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
      .bind(
        portal.id,
        ownerId,
        portal.ownerId || user.id,
        tokenHash,
        config,
        portal.expiresAt || null,
        now,
        now,
      )
      .run();
    return json({
      ok: true,
      url: `${url.origin}/portal/${token}`,
      publishedAt: now,
    });
  }
  if (action === "revoke") {
    await env.DB.prepare(
      `UPDATE client_portals
          SET status = 'revoked', updated_at = ?
        WHERE id = ? AND workspace_owner_id = ?`,
    )
      .bind(new Date().toISOString(), portalId, ownerId)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}
