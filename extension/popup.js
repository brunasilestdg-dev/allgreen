import { buildExtensionPrompt } from "./prompt.js";

const DEFAULT_BASE = "https://orianone.app";
const $ = (id) => document.getElementById(id);
let lastProposal = null;

const load = () =>
  new Promise((res) =>
    chrome.storage.local.get(["baseUrl", "token", "pendingSelection"], (v) => res(v || {})),
  );

async function init() {
  const { baseUrl, token, pendingSelection } = await load();
  $("baseUrl").value = baseUrl || DEFAULT_BASE;
  $("token").value = token || "";
  if (pendingSelection) {
    $("question").value = String(pendingSelection).slice(0, 400);
    chrome.storage.local.remove("pendingSelection");
  }
  if (!token) $("settings").classList.remove("hidden");
}

$("gear").addEventListener("click", () =>
  $("settings").classList.toggle("hidden"),
);

$("saveSettings").addEventListener("click", () => {
  chrome.storage.local.set(
    {
      baseUrl: $("baseUrl").value.trim() || DEFAULT_BASE,
      token: $("token").value.trim(),
    },
    () => {
      $("settings").classList.add("hidden");
      setStatus("Salvo.");
    },
  );
});

function setStatus(msg, isError) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
  el.classList.toggle("error", !!isError);
}

function formatProposal(action) {
  if (!action || typeof action !== "object") return "";
  if (action.tipo === "criar_tarefa")
    return [
      "Ação sugerida: criar tarefa",
      action.titulo ? `Título: ${action.titulo}` : "",
      action.cliente ? `Cliente: ${action.cliente}` : "",
      action.responsavel ? `Responsável: ${action.responsavel}` : "",
      action.prazo ? `Prazo: ${action.prazo}` : "",
      action.prioridade ? `Prioridade: ${action.prioridade}` : "",
    ].filter(Boolean).join("\n");
  if (action.tipo === "definir_proxima_acao")
    return [
      "Ação sugerida: atualizar próxima ação do CRM",
      action.cliente ? `Cliente: ${action.cliente}` : "",
      action.acao ? `Próxima ação: ${action.acao}` : "",
      action.prazo ? `Prazo: ${action.prazo}` : "",
    ].filter(Boolean).join("\n");
  if (action.tipo === "pesquisar_empresa")
    return `Ação sugerida: pesquisar empresa${action.cliente ? `\nCliente: ${action.cliente}` : ""}`;
  return "";
}

const canExecuteProposal = (action) =>
  ["criar_tarefa", "definir_proxima_acao", "pesquisar_empresa"].includes(action?.tipo);

// Extrai título, URL, seleção e texto da aba ativa.
async function getPageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { url: "", title: "", selection: "", pageText: "" };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: location.href,
        title: document.title,
        selection: String(window.getSelection() || ""),
        pageText: document.body ? document.body.innerText : "",
      }),
    });
    return result || { url: tab.url || "", title: tab.title || "", selection: "", pageText: "" };
  } catch {
    return { url: tab.url || "", title: tab.title || "", selection: "", pageText: "" };
  }
}

async function run(mode) {
  const { baseUrl, token } = await load();
  if (!token) {
    $("settings").classList.remove("hidden");
    setStatus("Cole seu token de acesso primeiro.", true);
    return;
  }
  setStatus("Consultando a IA...");
  lastProposal = null;
  $("result").classList.add("hidden");
  $("proposal").classList.add("hidden");
  $("execute").classList.add("hidden");
  $("copy").classList.add("hidden");
  try {
    const ctx = await getPageContext();
    ctx.question = $("question").value.trim();
    const prompt = buildExtensionPrompt(mode, ctx);
    const resp = await fetch(`${(baseUrl || DEFAULT_BASE).replace(/\/$/, "")}/api/todogreen/semente`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pergunta: prompt, tela: "extensao-navegador", historico: [] }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok)
      throw new Error(data.error || `Falha (${resp.status}). Verifique o token.`);
    const text = (data.resposta || data.content || "").trim() || "Sem resposta.";
    $("result").textContent = text;
    $("result").classList.remove("hidden");
    const proposal = formatProposal(data.proposta);
    if (proposal) {
      lastProposal = data.proposta;
      $("proposal").textContent = proposal;
      $("proposal").classList.remove("hidden");
      if (canExecuteProposal(lastProposal)) $("execute").classList.remove("hidden");
    }
    $("copy").classList.remove("hidden");
    setStatus("");
  } catch (e) {
    setStatus(e.message || "Erro ao consultar.", true);
  }
}

async function executeProposal() {
  const { baseUrl, token } = await load();
  if (!token || !lastProposal) return;
  $("execute").disabled = true;
  setStatus("Executando no ERP...");
  try {
    const resp = await fetch(`${(baseUrl || DEFAULT_BASE).replace(/\/$/, "")}/api/todogreen/semente`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ executar: lastProposal }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Falha (${resp.status}).`);
    $("proposal").textContent = data.resumo || "Ação executada no ERP.";
    $("proposal").classList.remove("hidden");
    $("execute").classList.add("hidden");
    lastProposal = null;
    setStatus("Ação registrada.");
  } catch (e) {
    setStatus(e.message || "Erro ao executar.", true);
  } finally {
    $("execute").disabled = false;
  }
}

document.querySelectorAll(".mode").forEach((btn) =>
  btn.addEventListener("click", () => run(btn.dataset.mode)),
);
$("ask").addEventListener("click", () => run("ask"));
$("execute").addEventListener("click", executeProposal);
$("copy").addEventListener("click", () => {
  navigator.clipboard
    .writeText($("result").textContent || "")
    .then(() => setStatus("Copiado."));
});

init();
