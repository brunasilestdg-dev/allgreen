// ===== Formulários públicos: página, envio e gestão =====
//
// Contrato
// - Recebe: `request`, `env` e `url`; na gestão, também `user`.
// - Devolve: `handlePublicForm` — a página `/f/:slug` (HTML com CSP por
//   nonce) e o envio `POST /api/public-forms/:slug/submissions` (201 com
//   protocolo); `null` para outro caminho, para o roteador seguir adiante.
//   `handleForms` — `/api/forms/status|submissions|file` (GET) e
//   `/api/forms/publish|unpublish` (POST).
// - Quem chama: a tabela de rotas públicas (`handlePublicForm`) e a de
//   rotas autenticadas (`handleForms`, exige sessão e banco).
//   `PUBLIC_FORM_FILE_TYPES` também é usado pelo portal do cliente.
// - Autorização: o envio é anônimo, limitado por IP, com honeypot,
//   anti-robô (`exigirTurnstile`, só quando as duas chaves do Turnstile
//   existem), deduplicação por `submissionId` e anexos validados por tipo e
//   tamanho.
//   A gestão exige ser membro do espaço; publicar, ler respostas e baixar
//   anexos passam por `canManagePublicForm` (colaborador e gestor só veem
//   os formulários que `filterRecordsForViewer` libera).

import { randomHex, sha256 } from "../auth/credenciais.js";
import { moneyBRL } from "../lib/format.js";
import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { canManagePublicForm } from "../lib/record-permissions.js";
import { safeParseJson } from "../lib/safe-json.js";
import {
  caixaDoTurnstile,
  cspComTurnstile,
  exigirTurnstile,
  scriptDoTurnstile,
} from "../lib/turnstile.js";
import {
  filterRecordsForViewer,
  resolveViewerContext,
} from "../lib/visibility.js";
import { escMail, notifyNewNotifications } from "../mensageria/envio.js";
import { insertInteraction } from "./omnichannel.js";
import {
  normalizePublicForm,
  publicFormAnswerSummary,
  publicFormFieldIsVisible,
  validatePublicFormSubmission,
} from "../../src/features/forms/publicFormDomain.js";
import {
  buildProcessConnections,
  createProcessCase,
} from "../../src/features/processes/processDomain.js";

// ── Formulários públicos avançados ─────────────────────────────────────
export const PUBLIC_FORM_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const PUBLIC_FORM_MAX_FILE_BYTES = 300_000;
const PUBLIC_FORM_MAX_TOTAL_BYTES = 900_000;

const publicFormNotFound = () =>
  new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Formulário indisponível</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#211846"><h1>Este formulário não está disponível</h1><p>O endereço pode estar incorreto ou o formulário foi despublicado.</p></body></html>',
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );

const publicFieldInputHtml = (field) => {
  const esc = escMail;
  const id = `field-${field.id}`;
  const common = `id="${esc(id)}" data-field-input data-field-id="${esc(field.id)}" data-field-type="${esc(field.type)}"${field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : ""}${field.required ? " required" : ""}`;
  let input = "";
  if (field.type === "longtext")
    input = `<textarea ${common} rows="4"></textarea>`;
  else if (field.type === "select")
    input = `<select ${common}><option value="">Selecione...</option>${(field.options || []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>`;
  else if (field.type === "multiselect")
    input = `<select ${common} multiple size="${Math.min(6, Math.max(3, field.options?.length || 3))}">${(field.options || []).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>`;
  else if (field.type === "checkbox")
    input = `<label class="check-line"><input ${common} type="checkbox"><span>Sim</span></label>`;
  else if (field.type === "file")
    input = `<input ${common} type="file" ${field.multiple ? "multiple" : ""} accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp"><small class="file-hint">Até 3 arquivos por campo e 300 KB por arquivo.</small>`;
  else {
    const type =
      {
        number: "number",
        currency: "number",
        date: "date",
        datetime: "datetime-local",
        email: "email",
        phone: "tel",
      }[field.type] || "text";
    input = `<input ${common} type="${type}"${field.type === "currency" ? ' step="0.01" min="0"' : ""}>`;
  }
  const condition = field.condition?.fieldId
    ? ` data-condition-field="${esc(field.condition.fieldId)}" data-condition-operator="${esc(field.condition.operator)}" data-condition-value="${esc(field.condition.value)}"`
    : "";
  return `<div class="field" data-field-wrap="${esc(field.id)}"${condition}><label for="${esc(id)}">${esc(field.label)}${field.required ? " <b>*</b>" : ""}</label>${input}${field.help ? `<small>${esc(field.help)}</small>` : ""}<small class="field-error" data-error-for="${esc(field.id)}"></small></div>`;
};

function renderPublicForm(form, env = {}) {
  const esc = escMail;
  const nonce = randomHex(16);
  const endpoint = `/api/public-forms/${encodeURIComponent(form.slug)}/submissions`;
  const logo = form.appearance.logoUrl
    ? `<img class="logo" src="${esc(form.appearance.logoUrl)}" alt="">`
    : "";
  const contact = [
    form.contact.collectName
      ? `<div class="field"><label for="contact-name">Nome${form.contact.requireName ? " <b>*</b>" : ""}</label><input id="contact-name" name="contact-name" maxlength="120"${form.contact.requireName ? " required" : ""}><small class="field-error" data-error-for="name"></small></div>`
      : "",
    form.contact.collectEmail
      ? `<div class="field"><label for="contact-email">E-mail${form.contact.requireEmail ? " <b>*</b>" : ""}</label><input id="contact-email" name="contact-email" type="email" maxlength="160"${form.contact.requireEmail ? " required" : ""}><small class="field-error" data-error-for="email"></small></div>`
      : "",
    form.contact.collectPhone
      ? `<div class="field"><label for="contact-phone">Telefone${form.contact.requirePhone ? " <b>*</b>" : ""}</label><input id="contact-phone" name="contact-phone" type="tel" maxlength="40"${form.contact.requirePhone ? " required" : ""}><small class="field-error" data-error-for="phone"></small></div>`
      : "",
  ].join("");
  const signature = form.signature.enabled
    ? `<section class="special signature"><h2>Assinatura eletrônica${form.signature.required ? " *" : ""}</h2><p>${esc(form.signature.consentText)}</p><label for="signature-name">Nome de quem assina</label><input id="signature-name" maxlength="120"${form.signature.required ? " required" : ""}><canvas id="signature-pad" width="720" height="220" aria-label="Área para desenhar a assinatura"></canvas><button class="clear" type="button" id="signature-clear">Limpar desenho</button><label class="check-line"><input id="signature-consent" type="checkbox"${form.signature.required ? " required" : ""}><span>Confirmo esta assinatura eletrônica.</span></label><small class="field-error" data-error-for="signature"></small></section>`
    : "";
  const payment = form.payment.enabled
    ? `<section class="special payment"><h2>Pagamento${form.payment.required ? " *" : ""}</h2>${form.payment.amount > 0 ? `<strong class="amount">${moneyBRL(form.payment.amount)}</strong>` : ""}${form.payment.instructions ? `<p>${esc(form.payment.instructions)}</p>` : ""}${form.payment.method === "link" && form.payment.link ? `<a class="pay-link" href="${esc(form.payment.link)}" target="_blank" rel="noopener noreferrer">Abrir pagamento</a>` : ""}${form.payment.method === "pix" && form.payment.pixCode ? `<label for="pix-code">Pix copia e cola</label><div class="copy-row"><textarea id="pix-code" readonly>${esc(form.payment.pixCode)}</textarea><button type="button" id="copy-pix">Copiar Pix</button></div>` : ""}<label class="check-line"><input id="payment-ack" type="checkbox"${form.payment.required ? " required" : ""}><span>Confirmo que realizei o pagamento conforme as instruções.</span></label><small class="field-error" data-error-for="payment"></small></section>`
    : "";
  const privacy = form.privacy.consentRequired
    ? `<label class="check-line consent"><input id="privacy-consent" type="checkbox" required><span>${esc(form.privacy.consentText)}</span></label><small class="field-error" data-error-for="privacy"></small>`
    : "";
  const script = `<script nonce="${nonce}">(()=>{const f=document.getElementById('sf-public-form'),status=document.getElementById('sf-status'),submit=document.getElementById('sf-submit'),inputs=[...document.querySelectorAll('[data-field-input]')],wraps=[...document.querySelectorAll('[data-field-wrap]')];let drawing=false,drawn=false;const pad=document.getElementById('signature-pad'),ctx=pad?.getContext('2d');if(ctx){ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle=${JSON.stringify(form.appearance.textColor)};const point=e=>{const r=pad.getBoundingClientRect();return{x:(e.clientX-r.left)*(pad.width/r.width),y:(e.clientY-r.top)*(pad.height/r.height)}};pad.addEventListener('pointerdown',e=>{drawing=true;drawn=true;pad.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y)});pad.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke()});['pointerup','pointercancel'].forEach(n=>pad.addEventListener(n,()=>drawing=false));document.getElementById('signature-clear')?.addEventListener('click',()=>{ctx.clearRect(0,0,pad.width,pad.height);drawn=false})}document.getElementById('copy-pix')?.addEventListener('click',()=>{const el=document.getElementById('pix-code');navigator.clipboard?.writeText(el?.value||'');status.textContent='Código Pix copiado.'});const valueOf=id=>{const el=inputs.find(i=>i.dataset.fieldId===id);if(!el)return'';if(el.type==='checkbox')return el.checked;if(el.multiple&&el.tagName==='SELECT')return[...el.selectedOptions].map(o=>o.value);return el.value};const visible=w=>{const source=w.dataset.conditionField;if(!source)return true;const actual=valueOf(source),expected=w.dataset.conditionValue||'',op=w.dataset.conditionOperator||'equals';if(op==='not_equals')return String(actual)!==expected;if(op==='contains')return Array.isArray(actual)?actual.map(String).includes(expected):String(actual).includes(expected);return String(actual)===expected};const refresh=()=>wraps.forEach(w=>{const show=visible(w);w.hidden=!show;w.querySelectorAll('input,textarea,select').forEach(el=>{el.disabled=!show;if(show&&el.dataset.fieldInput&&${JSON.stringify(true)})el.required=el.hasAttribute('required')})});inputs.forEach(i=>i.addEventListener('change',refresh));refresh();const readFile=file=>new Promise((resolve,reject)=>{if(file.size>${PUBLIC_FORM_MAX_FILE_BYTES})return reject(new Error(file.name+' excede 300 KB.'));const reader=new FileReader();reader.onload=()=>resolve({id:crypto.randomUUID?.()||('file-'+Date.now()+'-'+Math.random()),name:file.name,type:file.type||'application/octet-stream',size:file.size,dataUrl:reader.result});reader.onerror=()=>reject(new Error('Não foi possível ler '+file.name));reader.readAsDataURL(file)});f.addEventListener('submit',async e=>{e.preventDefault();if(!f.reportValidity())return;submit.disabled=true;status.textContent='Enviando...';document.querySelectorAll('.field-error').forEach(el=>el.textContent='');try{const values={},attachments=[];for(const input of inputs){const wrap=input.closest('[data-field-wrap]');if(wrap?.hidden)continue;const fieldId=input.dataset.fieldId,type=input.dataset.fieldType;if(type==='file'){const files=[...(input.files||[])];if(files.length>3)throw new Error('Envie no máximo 3 arquivos por campo.');for(const file of files)attachments.push({...await readFile(file),fieldId});continue}values[fieldId]=valueOf(fieldId)}if(attachments.reduce((sum,item)=>sum+item.size,0)>${PUBLIC_FORM_MAX_TOTAL_BYTES})throw new Error('Os anexos excedem 900 KB no total.');const body={submissionId:crypto.randomUUID?.()||('submission-'+Date.now()+'-'+Math.random()),website:document.getElementById('website').value,turnstileToken:(f.querySelector('[name="cf-turnstile-response"]')||{}).value||'',contact:{name:document.getElementById('contact-name')?.value||'',email:document.getElementById('contact-email')?.value||'',phone:document.getElementById('contact-phone')?.value||''},values,attachments,signature:pad?{name:document.getElementById('signature-name')?.value||'',consent:!!document.getElementById('signature-consent')?.checked,dataUrl:drawn?pad.toDataURL('image/png'):''}:{},payment:{acknowledged:!!document.getElementById('payment-ack')?.checked},privacyConsent:document.getElementById('privacy-consent')?document.getElementById('privacy-consent').checked:true};const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok){if(d.errors)Object.entries(d.errors).forEach(([key,msg])=>{const el=document.querySelector('[data-error-for="'+CSS.escape(key)+'"]');if(el)el.textContent=msg});throw new Error(d.error||'Revise os campos informados.')}f.innerHTML='<div class="success"><span>✓</span><h2>Enviado com sucesso</h2><p>'+${JSON.stringify(form.appearance.successMessage)}+'</p><strong>Protocolo '+d.protocol+'</strong></div>';status.textContent=''}catch(error){status.textContent=error.message||'Não foi possível enviar agora.';submit.disabled=false;window.turnstile?.reset()}})})()</script>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(form.title)}</title><style>:root{--primary:${form.appearance.primaryColor};--bg:${form.appearance.backgroundColor};--card:${form.appearance.cardColor};--text:${form.appearance.textColor}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:clamp(14px,4vw,48px)}main{width:min(720px,100%);margin:0 auto}.card{padding:clamp(20px,5vw,42px);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:22px;background:var(--card);box-shadow:0 22px 60px rgba(35,24,80,.09)}.logo{display:block;max-width:180px;max-height:64px;object-fit:contain;margin:0 0 22px}h1{margin:0;font-size:clamp(1.55rem,4vw,2.2rem);line-height:1.1}header>p{margin:10px 0 26px;color:color-mix(in srgb,var(--text) 68%,transparent);line-height:1.55}form{display:grid;gap:18px}.field{display:grid;gap:7px}.field[hidden]{display:none}.field label,.special>label{font-size:.86rem;font-weight:750}.field b{color:var(--primary)}input,textarea,select{width:100%;padding:12px 13px;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);border-radius:11px;background:var(--card);color:var(--text);font:inherit}textarea{resize:vertical}select[multiple]{min-height:110px}.field small,.file-hint{color:color-mix(in srgb,var(--text) 58%,transparent);font-size:.74rem;line-height:1.4}.field-error{min-height:0;color:#c52233!important;font-weight:650}.check-line{display:flex!important;align-items:flex-start;gap:9px;font-weight:500!important;line-height:1.45}.check-line input{width:18px;height:18px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--primary)}.special{display:grid;gap:10px;padding:17px;border:1px solid color-mix(in srgb,var(--primary) 24%,transparent);border-radius:14px;background:color-mix(in srgb,var(--primary) 5%,var(--card))}.special h2{margin:0;font-size:1rem}.special p{margin:0;color:color-mix(in srgb,var(--text) 68%,transparent);font-size:.83rem;line-height:1.5}.amount{font-size:1.5rem}.signature canvas{width:100%;height:150px;border:1px dashed color-mix(in srgb,var(--text) 28%,transparent);border-radius:10px;background:#fff;touch-action:none}.clear{justify-self:start;border:0;background:transparent;color:var(--primary);font-weight:700;cursor:pointer}.copy-row{display:grid;grid-template-columns:1fr auto;gap:8px}.copy-row textarea{min-height:70px}.copy-row button,.pay-link{align-self:stretch;padding:10px 14px;border:0;border-radius:10px;background:color-mix(in srgb,var(--primary) 10%,var(--card));color:var(--primary);font-weight:750;text-decoration:none;cursor:pointer}.consent{padding-top:4px;font-size:.8rem}#sf-submit{min-height:48px;border:0;border-radius:12px;background:var(--primary);color:#fff;font-size:1rem;font-weight:800;cursor:pointer}#sf-submit:disabled{opacity:.55;cursor:wait}#sf-status{min-height:20px;margin:0;color:#c52233;font-size:.82rem;text-align:center}.honeypot{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;overflow:hidden}.success{display:grid;place-items:center;gap:9px;padding:28px 0;text-align:center}.success span{display:grid;width:54px;height:54px;place-items:center;border-radius:50%;background:#e5f7eb;color:#168447;font-size:1.8rem;font-weight:900}.success h2,.success p{margin:0}.success p{color:color-mix(in srgb,var(--text) 65%,transparent)}.success strong{margin-top:8px;padding:10px 13px;border-radius:9px;background:color-mix(in srgb,var(--primary) 9%,var(--card));color:var(--primary)}footer{margin-top:16px;text-align:center;color:color-mix(in srgb,var(--text) 45%,transparent);font-size:.72rem}@media(max-width:520px){body{padding:0}.card{min-height:100vh;border:0;border-radius:0}.copy-row{grid-template-columns:1fr}}</style></head><body><main><section class="card">${logo}<header><h1>${esc(form.title)}</h1><p>${esc(form.description)}</p></header><form id="sf-public-form"><div class="honeypot" aria-hidden="true"><label>Website<input id="website" autocomplete="off" tabindex="-1"></label></div>${contact}${(form.fields || []).map(publicFieldInputHtml).join("")}${signature}${payment}${privacy}${caixaDoTurnstile(env, "formulario")}<button id="sf-submit" type="submit">${esc(form.appearance.buttonLabel)}</button><p id="sf-status" role="status" aria-live="polite"></p></form></section>${form.appearance.showBranding ? "<footer>Formulário protegido por Seu Funcionário</footer>" : ""}</main>${scriptDoTurnstile(env, nonce)}${script}</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": cspComTurnstile(
        `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'; frame-ancestors *`,
        env,
      ),
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

const sanitizePublicFormValues = (form, rawValues) => {
  const values = {};
  const source =
    rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
      ? rawValues
      : {};
  for (const field of form.fields || []) {
    if (!publicFormFieldIsVisible(field, source) || field.type === "file") continue;
    const raw = source[field.id];
    if (field.type === "checkbox") values[field.id] = raw === true;
    else if (field.type === "multiselect")
      values[field.id] = (Array.isArray(raw) ? raw : [])
        .map((item) => String(item).slice(0, 100))
        .slice(0, 50);
    else if (["number", "currency"].includes(field.type))
      values[field.id] =
        raw === "" || raw == null ? "" : Number.isFinite(Number(raw)) ? Number(raw) : "";
    else values[field.id] = String(raw == null ? "" : raw).slice(0, 4000);
  }
  return values;
};

const sanitizePublicFormAttachments = (form, rawAttachments) => {
  const fileFields = new Set(
    (form.fields || []).filter((field) => field.type === "file").map((field) => field.id),
  );
  const attachments = [];
  const perField = new Map();
  let total = 0;
  for (const raw of Array.isArray(rawAttachments) ? rawAttachments.slice(0, 12) : []) {
    const fieldId = String(raw?.fieldId || "").slice(0, 100);
    const type = String(raw?.type || "").toLowerCase();
    const size = Math.max(0, Number(raw?.size) || 0);
    const dataUrl = String(raw?.dataUrl || "");
    if (
      !fileFields.has(fieldId) ||
      !PUBLIC_FORM_FILE_TYPES.has(type) ||
      size <= 0 ||
      size > PUBLIC_FORM_MAX_FILE_BYTES ||
      !dataUrl.startsWith(`data:${type};base64,`) ||
      dataUrl.length > Math.ceil(PUBLIC_FORM_MAX_FILE_BYTES * 1.5)
    )
      throw new Error("Um dos anexos é inválido ou excede 300 KB.");
    total += size;
    if (total > PUBLIC_FORM_MAX_TOTAL_BYTES)
      throw new Error("Os anexos excedem 900 KB no total.");
    const fieldCount = (perField.get(fieldId) || 0) + 1;
    if (fieldCount > 3)
      throw new Error("Envie no máximo 3 arquivos por campo.");
    perField.set(fieldId, fieldCount);
    attachments.push({
      id: /^[a-zA-Z0-9_-]{3,100}$/.test(String(raw.id || ""))
        ? String(raw.id)
        : crypto.randomUUID(),
      fieldId,
      name: String(raw.name || "arquivo")
        .replace(/[^\p{L}\p{N}._ -]/gu, "")
        .slice(0, 160),
      type,
      size,
      dataUrl,
    });
  }
  return attachments;
};

const sanitizePublicSignature = (form, signature) => {
  if (!form.signature?.enabled) return {};
  const dataUrl = String(signature?.dataUrl || "");
  if (
    dataUrl &&
    (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 350_000)
  )
    throw new Error("O desenho da assinatura é inválido ou muito grande.");
  return {
    name: String(signature?.name || "").trim().slice(0, 120),
    consent: signature?.consent === true,
    dataUrl,
    drawn: !!dataUrl,
    signedAt: new Date().toISOString(),
  };
};

const publicSubmissionTitle = (form, submission) => {
  const first = (form.fields || []).find(
    (field) =>
      field.type !== "file" &&
      publicFormFieldIsVisible(field, submission.values) &&
      submission.values?.[field.id] != null &&
      submission.values[field.id] !== "",
  );
  const answer = Array.isArray(submission.values?.[first?.id])
    ? submission.values[first.id].join(", ")
    : submission.values?.[first?.id];
  return String(
    answer || submission.contact.name || `${form.name} ${submission.protocol}`,
  )
    .trim()
    .slice(0, 150);
};

const publicSubmissionTask = (form, submission, kind, now) => ({
  id: crypto.randomUUID(),
  title: publicSubmissionTitle(form, submission),
  description: `${kind === "ticket" ? "Chamado" : "Tarefa"} criado pelo formulário público ${form.name}.\nProtocolo: ${submission.protocol}\n\n${publicFormAnswerSummary(form, submission.values)}`.trim(),
  priority:
    String(
      Object.entries(submission.values || {}).find(([fieldId]) =>
        /prioridade/i.test(
          form.fields.find((field) => field.id === fieldId)?.label || "",
        ),
      )?.[1] || "Média",
    ).slice(0, 20),
  status: "A fazer",
  startDate: "",
  due: "",
  estimatedDays: "1",
  baselineStart: "",
  baselineDue: "",
  area: kind === "ticket" ? "Atendimento" : form.destination.taskArea || "Operação",
  assigneeType: "real",
  assignee: "",
  assigneeId: "",
  project: "",
  projectId: form.destination.projectId || null,
  isMission: false,
  distribution: "atribuida",
  difficulty: "Simples",
  slots: "1",
  points: "",
  reward: "",
  approvalMode: "imediata",
  allowWithdrawal: true,
  assignees: [],
  interested: [],
  missionStatus: "",
  deliveries: [],
  visibility: "espaco_todo",
  sharedWith: [],
  sharedTeams: [],
  subtasks: [],
  dependsOn: [],
  attachments: (submission.attachments || []).map(({ dataUrl: _dataUrl, ...file }) => file),
  recurrence: { frequency: "none" },
  ownerId: form.workspaceOwnerId,
  businessId: form.businessId || null,
  sourcePublicFormId: form.id,
  sourcePublicFormSubmissionId: submission.id,
  publicProtocol: submission.protocol,
  recordType: kind === "ticket" ? "chamado" : "tarefa",
  createdAt: now,
  updatedAt: now,
});

async function appendPublicFormDestination(env, form, submission, now) {
  const type = form.destination?.type || "response";
  if (type === "response") return { status: "not_required", recordId: null };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await env.DB.prepare(
      "SELECT data, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(form.workspaceOwnerId)
      .first();
    if (!row) return { status: "failed", error: "Workspace não encontrado." };
    let data;
    try {
      data = JSON.parse(row.data) || {};
    } catch {
      return { status: "failed", error: "Workspace inválido." };
    }
    const beforeNotifications = Array.isArray(data.notifications)
      ? [...data.notifications]
      : [];
    let linkedRecord = null;
    if (type === "task" || type === "ticket") {
      linkedRecord = publicSubmissionTask(form, submission, type, now);
      data.tasks = [linkedRecord, ...(Array.isArray(data.tasks) ? data.tasks : [])];
    } else if (type === "lead") {
      linkedRecord = {
        id: crypto.randomUUID(),
        name: submission.contact.name || publicSubmissionTitle(form, submission),
        company:
          String(
            Object.entries(submission.values || {}).find(([fieldId]) =>
              /empresa|organiza/i.test(
                form.fields.find((field) => field.id === fieldId)?.label || "",
              ),
            )?.[1] || "",
          ).slice(0, 160),
        contact: submission.contact.email || submission.contact.phone || "",
        email: submission.contact.email || "",
        phone: submission.contact.phone || "",
        value: "",
        status: "Novo",
        next: "",
        notes: `Origem: formulário público ${form.name}\nProtocolo: ${submission.protocol}\n\n${publicFormAnswerSummary(form, submission.values)}`.trim(),
        interactions: [
          {
            id: crypto.randomUUID(),
            type: "Formulário público",
            note: `Resposta recebida com protocolo ${submission.protocol}.`,
            at: now.slice(0, 10),
            createdAt: now,
          },
        ],
        visibility: "espaco_todo",
        sharedWith: [],
        sharedTeams: [],
        ownerId: form.workspaceOwnerId,
        businessId: form.businessId || null,
        sourcePublicFormId: form.id,
        sourcePublicFormSubmissionId: submission.id,
        publicProtocol: submission.protocol,
        createdAt: now,
        updatedAt: now,
      };
      data.leads = [linkedRecord, ...(Array.isArray(data.leads) ? data.leads : [])];
    } else if (type === "process") {
      const process = (Array.isArray(data.processes) ? data.processes : []).find(
        (item) => item.id === form.destination.processId,
      );
      if (!process)
        return {
          status: "failed",
          error: "O processo de destino não está mais disponível.",
        };
      const processValues = {};
      for (const field of form.fields || []) {
        const processFieldId = field.processFieldId || field.id;
        if (process.fields?.some((item) => item.id === processFieldId))
          processValues[processFieldId] = submission.values?.[field.id];
      }
      const created = createProcessCase(process, processValues, {
        protocol: submission.protocol,
        requesterName: submission.contact.name,
        requesterEmail: submission.contact.email,
        ownerId: form.workspaceOwnerId,
        businessId: form.businessId,
      }, now);
      if (!created.caseRecord)
        return {
          status: "failed",
          error: "A resposta não atende aos campos obrigatórios do processo.",
        };
      const connections = buildProcessConnections(
        process,
        created.caseRecord,
        data.databases || [],
        {
          ownerId: form.workspaceOwnerId,
          businessId: form.businessId,
        },
      );
      linkedRecord = {
        ...created.caseRecord,
        sourcePublicFormId: form.id,
        sourcePublicFormSubmissionId: submission.id,
        linkedRecord: connections.linkedRecord,
        linkedTaskId: connections.task?.id || null,
      };
      data.processCases = [
        linkedRecord,
        ...(Array.isArray(data.processCases) ? data.processCases : []),
      ];
      data.formResponses = [
        {
          id: crypto.randomUUID(),
          processId: process.id,
          caseId: linkedRecord.id,
          values: linkedRecord.values,
          submittedAt: now,
          submittedBy: null,
          businessId: form.businessId || null,
          ownerId: form.workspaceOwnerId,
          visibility: "espaco_todo",
          sourcePublicFormId: form.id,
          sourcePublicFormSubmissionId: submission.id,
        },
        ...(Array.isArray(data.formResponses) ? data.formResponses : []),
      ];
      data.databases = connections.databases;
      if (connections.task)
        data.tasks = [
          connections.task,
          ...(Array.isArray(data.tasks) ? data.tasks : []),
        ];
    }
    if (!linkedRecord)
      return { status: "failed", error: "Destino não reconhecido." };
    data.notifications = [
      {
        id: crypto.randomUUID(),
        assigneeId: form.ownerId || form.workspaceOwnerId,
        ownerId: form.workspaceOwnerId,
        message: `Nova resposta em ${form.name}: ${submission.protocol}`,
        link: "formularios-publicos",
        read: false,
        visibility: "privado",
        createdAt: now,
      },
      ...(Array.isArray(data.notifications) ? data.notifications : []),
    ].slice(0, 50);
    const serialized = JSON.stringify(data);
    if (serialized.length > 900_000)
      return {
        status: "failed",
        error:
          "O workspace está no limite. A resposta foi preservada, mas a conversão precisa ser feita manualmente.",
      };
    const updated = await env.DB.prepare(
      `UPDATE workspaces
       SET data = ?, updated_at = ?, revision = revision + 1
       WHERE user_id = ? AND revision = ?
       RETURNING revision`,
    )
      .bind(
        serialized,
        now,
        form.workspaceOwnerId,
        Number(row.revision) || 0,
      )
      .first();
    if (updated) {
      try {
        await notifyNewNotifications(
          env,
          beforeNotifications,
          data.notifications,
        );
      } catch (error) {
        console.error("public form push", error);
      }
      return { status: "completed", recordId: linkedRecord.id };
    }
  }
  return {
    status: "failed",
    error: "O workspace mudou durante a conversão. A resposta foi preservada.",
  };
}

const publicSubmissionListItem = (row) => {
  const attachments = safeParseJson(row.attachments_json);
  const signature = safeParseJson(row.signature_json);
  const payment = safeParseJson(row.payment_json);
  return {
    id: row.id,
    formId: row.form_id,
    protocol: row.protocol,
    contact: {
      name: row.respondent_name || "",
      email: row.respondent_email || "",
      phone: row.respondent_phone || "",
    },
    values: safeParseJson(row.values_json),
    attachments: (Array.isArray(attachments) ? attachments : []).map(
      ({ dataUrl: _dataUrl, ...attachment }) => attachment,
    ),
    signature: {
      name: signature.name || "",
      consent: signature.consent === true,
      drawn: signature.drawn === true,
      signedAt: signature.signedAt || null,
    },
    payment: {
      acknowledged: payment.acknowledged === true,
      method: payment.method || "",
      amount: Number(payment.amount) || 0,
    },
    destination: row.destination,
    linkedRecordId: row.linked_record_id || null,
    conversionStatus: row.conversion_status,
    conversionError: row.conversion_error || "",
    submittedAt: row.submitted_at,
  };
};

export async function handlePublicForm(request, env, url) {
  if (!env.DB) return json({ error: "Formulários indisponíveis." }, 503);
  const pageMatch = url.pathname.match(/^\/f\/([a-z0-9-]+)\/?$/i);
  if (pageMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const row = await env.DB.prepare(
      "SELECT snapshot_json FROM public_forms WHERE slug = ? AND published = 1",
    )
      .bind(pageMatch[1])
      .first();
    if (!row) return publicFormNotFound();
    const form = normalizePublicForm(safeParseJson(row.snapshot_json));
    return renderPublicForm(form, env);
  }

  const submissionMatch = url.pathname.match(
    /^\/api\/public-forms\/([a-z0-9-]+)\/submissions\/?$/i,
  );
  if (!submissionMatch) return null;
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`public-form:${ip}`, 8))
    return json(
      { error: "Muitos envios em pouco tempo. Aguarde e tente novamente." },
      429,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, created_by, snapshot_json
       FROM public_forms WHERE slug = ? AND published = 1`,
  )
    .bind(submissionMatch[1])
    .first();
  if (!row) return json({ error: "Este formulário não está disponível." }, 404);
  const form = normalizePublicForm(safeParseJson(row.snapshot_json), {
    workspaceOwnerId: row.workspace_owner_id,
    ownerId: row.created_by,
  });
  if (String(body.website || "").trim())
    return json({ ok: true, protocol: "FORM-RECEBIDO" });
  const barradoNoFormulario = await exigirTurnstile(request, env, body, {
    acao: "formulario",
    responder: json,
  });
  if (barradoNoFormulario) return barradoNoFormulario;
  const contact = {
    name: String(body.contact?.name || "").trim().slice(0, 120),
    email: String(body.contact?.email || "").trim().toLowerCase().slice(0, 160),
    phone: String(body.contact?.phone || "").trim().slice(0, 40),
  };
  let attachments;
  let signature;
  try {
    attachments = sanitizePublicFormAttachments(form, body.attachments);
    signature = sanitizePublicSignature(form, body.signature);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  const values = sanitizePublicFormValues(form, body.values);
  const payment = form.payment.enabled
    ? {
        acknowledged: body.payment?.acknowledged === true,
        method: form.payment.method,
        amount: form.payment.amount,
      }
    : {};
  const cleanSubmission = {
    contact,
    values,
    attachments,
    signature,
    payment,
    privacyConsent: body.privacyConsent === true,
  };
  const validation = validatePublicFormSubmission(form, cleanSubmission);
  if (!validation.valid)
    return json(
      {
        error: "Revise os campos obrigatórios.",
        errors: validation.errors,
      },
      400,
    );
  const submissionKey = String(body.submissionId || "").slice(0, 120);
  if (!submissionKey)
    return json({ error: "Identificador do envio ausente." }, 400);
  const dedupe = await sha256(`${row.id}|${submissionKey}`);
  const previous = await env.DB.prepare(
    "SELECT protocol FROM public_form_submissions WHERE form_id = ? AND dedupe_key = ?",
  )
    .bind(row.id, dedupe)
    .first();
  if (previous) return json({ ok: true, protocol: previous.protocol, duplicate: true });
  const now = new Date().toISOString();
  const protocol = `${form.serviceCode || "FORM"}-${now.slice(0, 10).replaceAll("-", "")}-${randomHex(3).toUpperCase()}`;
  const submission = {
    id: crypto.randomUUID(),
    protocol,
    ...cleanSubmission,
  };
  await env.DB.prepare(
    `INSERT INTO public_form_submissions
      (id, form_id, workspace_owner_id, protocol, respondent_name,
       respondent_email, respondent_phone, values_json, attachments_json,
       signature_json, payment_json, destination, linked_record_id,
       conversion_status, conversion_error, dedupe_key, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '', ?, ?)`,
  )
    .bind(
      submission.id,
      row.id,
      row.workspace_owner_id,
      protocol,
      contact.name,
      contact.email,
      contact.phone,
      JSON.stringify(values),
      JSON.stringify(attachments),
      JSON.stringify(signature),
      JSON.stringify(payment),
      form.destination.type,
      form.destination.type === "response" ? "not_required" : "pending",
      dedupe,
      now,
    )
    .run();
  const conversion = await appendPublicFormDestination(
    env,
    form,
    submission,
    now,
  );
  await env.DB.prepare(
    `UPDATE public_form_submissions
       SET linked_record_id = ?, conversion_status = ?, conversion_error = ?
     WHERE id = ?`,
  )
    .bind(
      conversion.recordId || null,
      conversion.status,
      String(conversion.error || "").slice(0, 500),
      submission.id,
    )
    .run();
  try {
    await insertInteraction(env, row.workspace_owner_id, row.workspace_owner_id, {
      channel: "form",
      direction: "in",
      contactName: contact.name,
      contactHandle: contact.email || contact.phone,
      subject: `Formulário: ${form.name}`,
      body: publicFormAnswerSummary(form, values) || "(resposta sem texto)",
      meta: {
        publicFormId: form.id,
        submissionId: submission.id,
        protocol,
      },
    });
  } catch (error) {
    console.error("inbox from public form", error);
  }
  return json(
    {
      ok: true,
      protocol,
      conversionStatus: conversion.status,
    },
    201,
  );
}

export async function handleForms(request, env, user, url) {
  const action = url.pathname.replace("/api/forms/", "");
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
        filterRecordsForViewer(data.publicForms, user.id, ctx).map(
          (form) => form.id,
        ),
      );
    }
    const rows = await env.DB.prepare(
      `SELECT id, slug, published, updated_at AS updatedAt,
              (SELECT COUNT(*) FROM public_form_submissions s WHERE s.form_id = f.id) AS submissions
         FROM public_forms f
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
          published: item.published === 1,
          submissions: Number(item.submissions) || 0,
          url: `${url.origin}/f/${item.slug}`,
        })),
    });
  }

  if (action === "submissions" && request.method === "GET") {
    const formId = String(url.searchParams.get("form_id") || "").slice(0, 100);
    const formRow = await env.DB.prepare(
      "SELECT workspace_owner_id FROM public_forms WHERE id = ?",
    )
      .bind(formId)
      .first();
    if (!formRow) return json({ items: [] });
    if (
      formRow.workspace_owner_id !== ownerId ||
      !(await canManagePublicForm(env, user.id, ownerId, formId))
    )
      return json({ error: "Você não pode acessar estas respostas." }, 403);
    const rows = await env.DB.prepare(
      `SELECT id, form_id, protocol, respondent_name, respondent_email,
              respondent_phone, values_json, attachments_json, signature_json,
              payment_json, destination, linked_record_id, conversion_status,
              conversion_error, submitted_at
         FROM public_form_submissions
        WHERE form_id = ?
        ORDER BY submitted_at DESC
        LIMIT 300`,
    )
      .bind(formId)
      .all();
    return json({ items: (rows.results || []).map(publicSubmissionListItem) });
  }

  if (action === "file" && request.method === "GET") {
    const submissionId = String(
      url.searchParams.get("submission_id") || "",
    ).slice(0, 100);
    const attachmentId = String(
      url.searchParams.get("attachment_id") || "",
    ).slice(0, 100);
    const row = await env.DB.prepare(
      `SELECT s.form_id, s.workspace_owner_id, s.attachments_json
         FROM public_form_submissions s WHERE s.id = ?`,
    )
      .bind(submissionId)
      .first();
    if (
      !row ||
      row.workspace_owner_id !== ownerId ||
      !(await canManagePublicForm(env, user.id, ownerId, row.form_id))
    )
      return json({ error: "Arquivo não encontrado." }, 404);
    const attachments = safeParseJson(row.attachments_json);
    const attachment = (Array.isArray(attachments) ? attachments : []).find(
      (item) => item.id === attachmentId,
    );
    if (!attachment?.dataUrl) return json({ error: "Arquivo não encontrado." }, 404);
    const match = String(attachment.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match || !PUBLIC_FORM_FILE_TYPES.has(match[1]))
      return json({ error: "Arquivo inválido." }, 400);
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return new Response(bytes, {
      headers: {
        "content-type": match[1],
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name || "arquivo")}`,
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
  const formId = String(body.form?.id || body.id || "").slice(0, 100);
  if (!formId || !/^[a-zA-Z0-9_-]{3,100}$/.test(formId))
    return json({ error: "Identificador do formulário inválido." }, 400);
  const canManage =
    user.id === ownerId ||
    role === "admin" ||
    (await canManagePublicForm(env, user.id, ownerId, formId));
  if (!canManage)
    return json({ error: "Você não pode publicar este formulário." }, 403);

  if (action === "publish") {
    const form = normalizePublicForm(body.form, {
      workspaceOwnerId: ownerId,
      ownerId: body.form?.ownerId || user.id,
      businessId: body.form?.businessId || null,
    });
    const snapshot = JSON.stringify(form);
    if (snapshot.length > 350_000)
      return json({ error: "A configuração do formulário é muito grande." }, 413);
    if (form.slug.length < 3 || !form.title || form.fields.length < 1)
      return json(
        { error: "Informe título, endereço e pelo menos um campo." },
        400,
      );
    if (
      form.destination.type === "process" &&
      !form.destination.processId
    )
      return json({ error: "Escolha o processo de destino." }, 400);
    if (
      form.payment.enabled &&
      ((form.payment.method === "pix" && !form.payment.pixCode) ||
        (form.payment.method === "link" && !form.payment.link))
    )
      return json(
        { error: "Configure o Pix ou link de pagamento antes de publicar." },
        400,
      );
    const existing = await env.DB.prepare(
      "SELECT workspace_owner_id FROM public_forms WHERE id = ?",
    )
      .bind(formId)
      .first();
    if (existing && existing.workspace_owner_id !== ownerId)
      return json({ error: "Este formulário pertence a outro espaço." }, 403);
    const collision = await env.DB.prepare(
      "SELECT id FROM public_forms WHERE slug = ?",
    )
      .bind(form.slug)
      .first();
    if (collision && collision.id !== formId)
      return json(
        { error: "Este endereço já está em uso. Escolha outro." },
        409,
      );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO public_forms
        (id, workspace_owner_id, created_by, slug, snapshot_json,
         published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug, snapshot_json = excluded.snapshot_json,
         published = 1, updated_at = excluded.updated_at`,
    )
      .bind(
        formId,
        ownerId,
        form.ownerId || user.id,
        form.slug,
        snapshot,
        now,
        now,
      )
      .run();
    return json({
      ok: true,
      slug: form.slug,
      url: `${url.origin}/f/${form.slug}`,
      embedUrl: `${url.origin}/f/${form.slug}`,
      publishedAt: now,
    });
  }
  if (action === "unpublish") {
    await env.DB.prepare(
      `UPDATE public_forms
          SET published = 0, updated_at = ?
        WHERE id = ? AND workspace_owner_id = ?`,
    )
      .bind(new Date().toISOString(), formId, ownerId)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}
