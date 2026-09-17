/* Ajustes incrementais do shell All Green sem alterar a taxonomia/rotas do ERP.
   Mantém o código legado intacto e adiciona apenas a entrada externa do TMS. */

const TMS_MARKER = "data-allgreen-tms-link";

function substituirRotuloPrincipal(sidebar) {
  const walker = document.createTreeWalker(sidebar, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.nodeValue?.trim() === "Principal") {
      node.nodeValue = node.nodeValue.replace("Principal", "Visão geral");
    }
  }
}

function garantirAtalhoTms(sidebar) {
  const container = sidebar.querySelector(".tdg-verticais-links");
  if (!container || container.querySelector(`[${TMS_MARKER}]`)) return;

  const links = [...container.querySelectorAll(".tdg-vertical-link")];
  const greenmob = links.find((link) => /greenmob/i.test(link.textContent || ""));
  if (!greenmob) return;

  const tms = document.createElement("a");
  tms.href = "/portal-tms";
  tms.className = "tdg-vertical-link";
  tms.setAttribute(TMS_MARKER, "true");
  tms.setAttribute("aria-label", "Abrir TMS");

  const titulo = document.createElement("strong");
  titulo.textContent = "TMS";
  const descricao = document.createElement("span");
  descricao.textContent = "Torre de transporte, viagens, SLA e ocorrências";
  tms.append(titulo, descricao);

  greenmob.insertAdjacentElement("afterend", tms);
}

function aplicarAjustesMenu() {
  const sidebar = document.querySelector(".tdg-erp-sidebar");
  if (!sidebar) return;
  substituirRotuloPrincipal(sidebar);
  garantirAtalhoTms(sidebar);
}

let agendado = false;
function agendarAjuste() {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    aplicarAjustesMenu();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", agendarAjuste, { once: true });
  } else {
    agendarAjuste();
  }

  const observer = new MutationObserver(agendarAjuste);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
