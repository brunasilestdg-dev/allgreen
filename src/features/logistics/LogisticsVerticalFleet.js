import "./LogisticsVerticalFleet.css";
import { fleetAlerts, summarizeFleet } from "./todoGreenFleetDomain.js";

const TOKEN_KEY = "seu-funcionario-auth-token";
let vehicles = [];
let canWrite = false;
let loading = false;
let showForm = false;
let search = "";
let statusFilter = "all";

const token = () => localStorage.getItem(TOKEN_KEY) || "";
const api = async (path = "", options = {}) => {
  const response = await fetch(`/api/todogreen/fleet${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir.");
  return payload;
};
const label = (value) => ({ available:"Disponível", "in-operation":"Em operação", maintenance:"Manutenção", reserved:"Reserva", blocked:"Bloqueado", inactive:"Inativo", electric:"Elétrico", biomethane:"Biometano", hybrid:"Híbrido", diesel:"Diesel", moving:"Em deslocamento", stopped:"Parado" }[value] || String(value || ""));
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const filtered = () => vehicles.filter((v) => (statusFilter === "all" || v.status === statusFilter) && (!search || `${v.prefix} ${v.plate} ${v.manufacturer} ${v.model} ${v.operationalUnit} ${v.fields?.currentDriver || ""} ${v.fields?.currentRoute || ""} ${v.fields?.lastAddress || ""}`.toLowerCase().includes(search.toLowerCase())));

const ensureTab = () => {
  // A Frota já existe na navegação React da área Operação. Este módulo antigo
  // ainda renderiza o conteúdo técnico, mas não cria mais uma aba paralela na
  // navegação principal.
};

// Esconde só o que precisa dar lugar à frota — não a barra de navegação nem o
// cabeçalho. A versão antiga escondia "tudo, exceto uma lista de classes", e
// essa lista citava `.tdg-hero`: uma classe que não existe mais no cabeçalho
// (hoje `.tdg-shell-header`). Resultado: título, busca e o menu de "Gestão e
// configurações" desapareciam inteiros sempre que a aba Frota ficava ativa.
const hideOtherContent = (active) => {
  const main = document.querySelector("main.tdg"); if (!main) return;
  const pageContent = main.querySelector("[data-tdg-page-content]");
  if (pageContent) pageContent.style.display = active ? "none" : "";
  const workCenterRoot = main.querySelector("[data-tdg-work-center-root]");
  if (active && workCenterRoot) workCenterRoot.style.display = "none";
};

const form = () => !showForm ? "" : `<form class="tdg-fleet-form" data-fleet-form>
<label><span>Prefixo</span><input name="prefix" required placeholder="TG-001"></label><label><span>Placa</span><input name="plate"></label><label><span>Status</span><select name="status"><option value="available">Disponível</option><option value="in-operation">Em operação</option><option value="maintenance">Manutenção</option><option value="reserved">Reserva</option><option value="blocked">Bloqueado</option></select></label>
<label><span>Fabricante</span><input name="manufacturer"></label><label><span>Modelo</span><input name="model"></label><label><span>Ano</span><input name="modelYear" type="number"></label>
<label><span>Energia</span><select name="energyType"><option value="electric">Elétrico</option><option value="biomethane">Biometano</option><option value="hybrid">Híbrido</option><option value="diesel">Diesel</option></select></label><label><span>Unidade</span><input name="operationalUnit"></label><label><span>Centro de custo</span><input name="costCenter"></label>
<label><span>Capacidade kg</span><input name="payloadKg" type="number" step="0.01"></label><label><span>Autonomia nominal km</span><input name="nominalRangeKm" type="number" step="0.01"></label><label><span>Autonomia real km</span><input name="realRangeKm" type="number" step="0.01"></label>
<label><span>Hodômetro km</span><input name="odometerKm" type="number" step="0.01"></label><label><span>SOH bateria %</span><input name="batterySohPercent" type="number" value="100" min="0" max="100"></label><label><span>Próxima manutenção</span><input name="nextMaintenanceAt" type="date"></label><label><span>Documento vence</span><input name="nextDocumentDueAt" type="date"></label>
<label><span>Motorista atual</span><input name="currentDriver"></label><label><span>RFID motorista</span><input name="driverRfid"></label><label><span>Status da jornada</span><select name="journeyStatus"><option value="">Não informado</option><option value="aguardando">Aguardando</option><option value="em_jornada">Em jornada</option><option value="pausado">Pausado</option><option value="encerrado">Encerrado</option></select></label>
<label><span>Rota atual</span><input name="currentRoute"></label><label><span>Última localização</span><input name="lastAddress"></label><label><span>Ponto de referência</span><input name="referencePoint"></label>
<label><span>Cerca virtual</span><input name="geofence"></label><label><span>Movimento</span><select name="movementState"><option value="">Não informado</option><option value="moving">Em deslocamento</option><option value="stopped">Parado</option></select></label><label><span>Velocidade km/h</span><input name="speedKmh" type="number" step="0.01"></label>
<label><span>Horímetro h</span><input name="hourmeter" type="number" step="0.01"></label><label><span>Voltagem bateria</span><input name="batteryVoltage" type="number" step="0.01"></label><label><span>Último evento</span><input name="lastEvent"></label>
<div class="tdg-fleet-actions full"><button class="tdg-action" type="submit">Cadastrar veículo</button><button class="tdg-login-secondary" type="button" data-fleet-cancel>Cancelar</button></div></form>`;

const card = (vehicle) => {
  const alerts = fleetAlerts(vehicle); const margin = Number(vehicle.revenueAccumulated || 0) - Number(vehicle.costAccumulated || 0);
  const fields = vehicle.fields || {};
  return `<article class="tdg-fleet-card" data-fleet-id="${vehicle.id}"><header><span>${vehicle.prefix} · ${vehicle.plate || "sem placa"}</span><strong>${vehicle.manufacturer || "Fabricante"} ${vehicle.model || ""}</strong><small>${label(vehicle.energyType)} · ${vehicle.operationalUnit || "Sem unidade"}</small>${alerts.map((a) => `<em class="tdg-fleet-alert">${a.message}</em>`).join("")}</header>
<select data-fleet-status ${canWrite ? "" : "disabled"}>${["available","in-operation","maintenance","reserved","blocked","inactive"].map((s) => `<option value="${s}" ${s===vehicle.status?"selected":""}>${label(s)}</option>`).join("")}</select>
<div><small>Autonomia</small><strong>${Number(vehicle.realRangeKm||0).toFixed(0)} km</strong></div><div><small>SOH bateria</small><strong>${Number(vehicle.batterySohPercent||0).toFixed(0)}%</strong></div><div><small>Margem acumulada</small><strong>${money(margin)}</strong></div>
<div class="tdg-fleet-telemetry"><span><small>Motorista</small><strong>${fields.currentDriver || "Não informado"}</strong></span><span><small>Localização</small><strong>${fields.lastAddress || "Sem posição"}</strong></span><span><small>Rota</small><strong>${fields.currentRoute || "Sem rota"}</strong></span><span><small>Movimento</small><strong>${label(fields.movementState) || "Não informado"}</strong></span><span><small>Velocidade</small><strong>${fields.speedKmh ? `${Number(fields.speedKmh).toFixed(0)} km/h` : "Sem leitura"}</strong></span><span><small>Horímetro</small><strong>${fields.hourmeter ? `${Number(fields.hourmeter).toFixed(0)} h` : "Não informado"}</strong></span><span><small>Voltagem</small><strong>${fields.batteryVoltage ? `${Number(fields.batteryVoltage).toFixed(1)} V` : "Sem leitura"}</strong></span><span><small>Cerca</small><strong>${fields.geofence || "Não informada"}</strong></span></div></article>`;
};

const renderFleet = () => {
  const root = document.querySelector("[data-tdg-fleet-root]"); if (!root) return;
  const summary = summarizeFleet(vehicles); const rows = filtered();
  root.innerHTML = `<section class="tdg-panel tdg-fleet"><div class="tdg-fleet-head"><div><span class="tdg-kicker">FROTA</span><h2>Gestão da frota sustentável</h2><p>Disponibilidade, autonomia, bateria, manutenção, custos, receita e risco por veículo.</p></div>${canWrite ? '<button class="tdg-action" type="button" data-fleet-new>+ Novo veículo</button>' : ""}</div>
<div class="tdg-fleet-metrics"><article><small>Total</small><strong>${summary.total}</strong></article><article><small>Disponíveis</small><strong>${summary.available}</strong></article><article><small>Em operação</small><strong>${summary.inOperation}</strong></article><article><small>Manutenção</small><strong>${summary.maintenance}</strong></article><article><small>Margem</small><strong>${money(summary.margin)}</strong></article><article><small>Riscos bateria</small><strong>${summary.batteryRisks}</strong></article></div>
<div class="tdg-fleet-toolbar"><input data-fleet-search value="${search}" placeholder="Buscar prefixo, placa, modelo ou unidade"><select data-fleet-filter><option value="all">Todos os status</option>${["available","in-operation","maintenance","reserved","blocked","inactive"].map((s)=>`<option value="${s}" ${s===statusFilter?"selected":""}>${label(s)}</option>`).join("")}</select></div>${form()}<div class="tdg-fleet-list">${loading ? '<div class="tdg-fleet-empty">Carregando frota...</div>' : rows.length ? rows.map(card).join("") : '<div class="tdg-fleet-empty">Nenhum veículo cadastrado com os filtros atuais.</div>'}</div></section>`;
  root.querySelector("[data-fleet-new]")?.addEventListener("click",()=>{showForm=true;renderFleet();}); root.querySelector("[data-fleet-cancel]")?.addEventListener("click",()=>{showForm=false;renderFleet();});
  root.querySelector("[data-fleet-search]")?.addEventListener("input",(e)=>{search=e.target.value;renderFleet();}); root.querySelector("[data-fleet-filter]")?.addEventListener("change",(e)=>{statusFilter=e.target.value;renderFleet();});
  root.querySelector("[data-fleet-form]")?.addEventListener("submit", async (event)=>{event.preventDefault(); const data=Object.fromEntries(new FormData(event.currentTarget).entries()); try{const payload=await api("",{method:"POST",body:JSON.stringify(data)}); vehicles=[payload.vehicle,...vehicles];showForm=false;renderFleet();}catch(error){alert(error.message);}});
  root.querySelectorAll("[data-fleet-id]").forEach((row)=>row.querySelector("[data-fleet-status]")?.addEventListener("change",async(e)=>{const current=vehicles.find(v=>v.id===row.dataset.fleetId);try{const payload=await api(`/${current.id}`,{method:"PATCH",body:JSON.stringify({revision:current.revision,status:e.target.value})});vehicles=vehicles.map(v=>v.id===current.id?payload.vehicle:v);renderFleet();}catch(error){alert(error.message);await load();}}));
};

const load = async () => { loading=true;renderFleet();try{const payload=await api();vehicles=payload.vehicles||[];canWrite=!!payload.access?.canWrite;}catch(error){console.error(error);}finally{loading=false;renderFleet();} };
const render = () => { ensureTab(); const active=location.pathname.startsWith("/todogreen/frota"); hideOtherContent(active); let root=document.querySelector("[data-tdg-fleet-root]"); if(active&&!root){root=document.createElement("div");root.dataset.tdgFleetRoot="true";(document.querySelector("main.tdg .tdg-erp-stage") || document.querySelector("main.tdg"))?.appendChild(root);load();} if(root) root.style.display=active?"":"none"; if(active) renderFleet(); };
// `[data-tdg-page-content]` só existe depois que o React termina de verificar
// acesso e montar a vertical inteira — um número fixo de tentativas
// (`setTimeout(render, 0/100)`) adivinhava esse tempo e, numa sessão nova
// (mais chamadas de rede antes do primeiro render), perdia a janela: a aba
// "Frota" simplesmente não aparecia, sem erro nenhum. Esperar só por
// `main.tdg` não bastava — ele pode existir num commit do React anterior ao
// que acrescenta `[data-tdg-page-content]`, e `render()` rodar entre os dois
// deixava o conteúdo do dashboard sem esconder. Em vez de adivinhar, espera o
// elemento que `render()` de fato precisa — um observer de UM disparo só, que
// se desliga assim que o encontra.
const waitForShell = () => {
  if (document.querySelector("[data-tdg-page-content]")) { render(); return; }
  const alvo = document.getElementById("root") || document.body;
  const observer = new MutationObserver(() => {
    if (!document.querySelector("[data-tdg-page-content]")) return;
    observer.disconnect();
    render();
  });
  observer.observe(alvo, { childList: true, subtree: true });
};
if(typeof window!=="undefined"){const start=()=>{waitForShell();addEventListener("popstate",render);addEventListener("pageshow",render);addEventListener("tdg:rota",render);};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",start,{once:true}):start();}
