import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Zap } from "lucide-react";
import {
  viabilitySnapshotBlockers,
} from "../viabilitySnapshotDomain.js";

// ===== Viabilidade operacional da oportunidade (seções 47–50) =====
//
// A informação no momento da decisão: antes de precificar e liberar a
// proposta, a oportunidade mostra o ÚLTIMO snapshot (rota, veículo, energia,
// SOC de chegada, custo, CO2) com proveniência — "47,8 kWh estimados ·
// confiança média" e, ao expandir, fonte/tipo/versão/premissas. Registrar de
// novo com as mesmas premissas NÃO cria versão (o hash decide); mudança real
// cria v+1 e a anterior fica na história. A liberação da proposta é checada no
// servidor; aqui só se mostra o mesmo veredito.

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const CONFIANCA_PT = { HIGH: "alta", MEDIUM: "média", LOW: "baixa", UNKNOWN: "desconhecida" };
const TIPO_PT = { MEASURED: "medido", INFORMED: "informado", IMPORTED: "importado", EXTERNAL: "fonte externa", DERIVED: "derivado", ESTIMATED: "estimado" };
const FALTA_PT = { opportunityId: "oportunidade", distanceKm: "distância", veiculo: "veículo", energyKwh: "energia (kWh)", cost: "custo", snapshot_ausente: "snapshot" };

const dataHora = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? new Date(t).toLocaleString("pt-BR") : "—";
};

const FORM_VAZIO = {
  scenarioId: "",
  origin: "",
  destination: "",
  distanceKm: "",
  vehicleClass: "van",
  referenceVehicle: "",
  batteryCapacityKwh: "",
  consumptionKwhPerKm: "",
  socPercent: "100",
  reservePercent: "15",
  payloadKg: "",
  maxPayloadKg: "",
  elevationGainM: "",
  temperatureC: "",
  cost: "",
  costPerDelivery: "",
  avoidedCo2: "",
};

export function ResumoProveniencia({ snapshot }) {
  if (!snapshot) return null;
  const fontes = Array.isArray(snapshot.dataSources) ? snapshot.dataSources : [];
  const premissas = Array.isArray(snapshot.assumptions) ? snapshot.assumptions : [];
  return (
    <details className="tdg-viab-prov">
      <summary>
        <Zap size={14} aria-hidden="true" />
        {snapshot.energyKwh !== null && snapshot.energyKwh !== undefined
          ? `${NUM.format(snapshot.energyKwh)} kWh estimados`
          : "Energia não estimada"}
        {" · "}confiança {CONFIANCA_PT[snapshot.confidence] || snapshot.confidence || "desconhecida"}
        {snapshot.arrivalSoc !== null && snapshot.arrivalSoc !== undefined ? ` · chegada ~${NUM.format(snapshot.arrivalSoc)}% SOC` : ""}
      </summary>
      <ul>
        {fontes.map((f, i) => (
          <li key={`${f.id || f.source}-${i}`}>
            <strong>{f.source || f.id}</strong> — {TIPO_PT[f.measurementType] || f.measurementType || "informado"}
            {f.calculationVersion ? ` · ${f.calculationVersion}` : ""}
            {f.confidence ? ` · confiança ${CONFIANCA_PT[f.confidence] || f.confidence}` : ""}
            {f.capturedAt ? ` · ${dataHora(f.capturedAt)}` : ""}
            {Array.isArray(f.fields) && f.fields.length ? ` · campos: ${f.fields.join(", ")}` : ""}
          </li>
        ))}
        {snapshot.energyModelVersion && <li>Modelo de energia: {snapshot.energyModelVersion}</li>}
        {snapshot.routingEngine && <li>Motor de rota: {snapshot.routingEngine} {snapshot.routingEngineVersion}</li>}
        {premissas.length > 0 && <li>Premissas: {premissas.join(" · ")}</li>}
        <li>Esquema: {snapshot.schemaVersion} · hash {snapshot.contentHash}</li>
      </ul>
    </details>
  );
}

export default function OpportunityViabilityPanel({ oportunidade, cenarios = [], authHeaders, setToast }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(() => ({
    ...FORM_VAZIO,
    distanceKm: oportunidade?.distanciaKm ? String(oportunidade.distanciaKm) : "",
    vehicleClass: oportunidade?.tipoVeiculo || "van",
  }));

  // O id sai do objeto ANTES do callback: dependência estável, memoização
  // preservável pelo React Compiler (regra preserve-manual-memoization).
  const oportunidadeId = oportunidade?.id || "";
  const cenariosDaOportunidade = useMemo(
    () => (Array.isArray(cenarios) ? cenarios : []).filter((c) => c?.opportunityId === oportunidadeId),
    [cenarios, oportunidadeId],
  );

  const carregar = useCallback(async () => {
    if (!oportunidadeId) return;
    try {
      const r = await fetch(`/api/todogreen/viability-snapshots?opportunityId=${encodeURIComponent(oportunidadeId)}`, {
        headers: authHeaders?.() || {},
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não foi possível ler a viabilidade.");
      setDados(corpo);
      setErro("");
    } catch (e) {
      setErro(e.message || "Viabilidade indisponível.");
    } finally {
      setCarregando(false);
    }
  }, [authHeaders, oportunidadeId]);

  useEffect(() => {
    const agendamento = setTimeout(() => { carregar(); }, 0);
    return () => clearTimeout(agendamento);
  }, [carregar]);

  const ultimo = dados?.latest?.snapshot || null;
  const faltas = dados?.latest ? (dados.blockers?.length ? dados.blockers : viabilitySnapshotBlockers(ultimo)) : [];

  const campo = (chave) => (e) => setForm((a) => ({ ...a, [chave]: e.target.value }));
  const num = (v) => (v === "" || v === null || v === undefined ? undefined : Number(v));

  const registrar = async (evento) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      const temEnergia = num(form.batteryCapacityKwh) > 0 && num(form.consumptionKwhPerKm) > 0 && num(form.distanceKm) > 0;
      const corpo = {
        opportunityId: oportunidade.id,
        scenarioId: form.scenarioId,
        origin: form.origin,
        destination: form.destination,
        distanceKm: num(form.distanceKm),
        vehicleClass: form.vehicleClass,
        referenceVehicle: form.referenceVehicle,
        cost: num(form.cost),
        costPerDelivery: num(form.costPerDelivery),
        avoidedCo2: num(form.avoidedCo2),
        ...(temEnergia
          ? {
              energy: {
                vehicle: {
                  id: form.referenceVehicle,
                  vehicleClass: form.vehicleClass,
                  batteryCapacityKwh: num(form.batteryCapacityKwh),
                  consumptionKwhPerKm: num(form.consumptionKwhPerKm),
                  socPercent: num(form.socPercent),
                  reservePercent: num(form.reservePercent),
                  payloadKg: num(form.payloadKg),
                  maxPayloadKg: num(form.maxPayloadKg),
                },
                route: {
                  distanceKm: num(form.distanceKm),
                  elevationGainM: num(form.elevationGainM),
                  temperatureC: num(form.temperatureC),
                },
              },
            }
          : {}),
      };
      const r = await fetch("/api/todogreen/viability-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify(corpo),
      });
      const resposta = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resposta.error || "Não foi possível registrar a viabilidade.");
      if (resposta.changed === false) {
        setToast?.(`Nada mudou: a viabilidade continua na v${resposta.snapshot.version}.`);
      } else {
        const f = resposta.blockers || [];
        setToast?.(f.length
          ? `Viabilidade v${resposta.snapshot.version} registrada com faltas: ${f.map((x) => FALTA_PT[x] || x).join(", ")}.`
          : `Viabilidade v${resposta.snapshot.version} registrada — proposta liberada.`);
      }
      setAberto(false);
      await carregar();
    } catch (e) {
      setToast?.(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="tdg-opp-bloco tdg-viab" data-testid="viabilidade-operacional">
      <div className="tdg-viab-head">
        <h4>Viabilidade operacional</h4>
        {dados?.latest ? (
          dados.liberada
            ? <span className="tdg-viab-selo ok"><CheckCircle2 size={14} aria-hidden="true" /> v{dados.latest.version} · libera proposta</span>
            : <span className="tdg-viab-selo falta"><AlertTriangle size={14} aria-hidden="true" /> v{dados.latest.version} · faltam {faltas.map((x) => FALTA_PT[x] || x).join(", ")}</span>
        ) : (
          !carregando && !erro && <span className="tdg-viab-selo falta"><AlertTriangle size={14} aria-hidden="true" /> sem snapshot — proposta não libera</span>
        )}
      </div>

      {erro && (
        <p className="tdg-opp-ressalva" role="alert">
          Viabilidade indisponível: {erro} <button type="button" onClick={carregar}>Tentar novamente</button>
        </p>
      )}
      {carregando && !dados && <p className="tdg-opp-ressalva">Lendo viabilidade…</p>}

      {ultimo && (
        <>
          <div className="tdg-opp-numeros">
            <article><small>Rota</small><span>{[ultimo.origin, ultimo.destination].filter(Boolean).join(" → ") || "—"}</span></article>
            <article><small>Distância</small><span>{ultimo.distanceKm !== null && ultimo.distanceKm !== undefined ? `${NUM.format(ultimo.distanceKm)} km` : "—"}</span></article>
            <article><small>Veículo</small><span>{ultimo.referenceVehicle || ultimo.vehicleClass || "—"}</span></article>
            <article><small>Energia</small><span>{ultimo.energyKwh !== null && ultimo.energyKwh !== undefined ? `${NUM.format(ultimo.energyKwh)} kWh` : "—"}</span></article>
            <article><small>SOC chegada</small><span>{ultimo.arrivalSoc !== null && ultimo.arrivalSoc !== undefined ? `${NUM.format(ultimo.arrivalSoc)}%` : "—"}{ultimo.chargingRequired ? " · recarga" : ""}</span></article>
            <article><small>Custo</small><span>{ultimo.cost !== null && ultimo.cost !== undefined ? BRL.format(ultimo.cost) : "—"}</span></article>
            <article><small>CO₂ evitado</small><span>{ultimo.avoidedCo2 !== null && ultimo.avoidedCo2 !== undefined ? `${NUM.format(ultimo.avoidedCo2)} kg` : "—"}</span></article>
          </div>
          <ResumoProveniencia snapshot={ultimo} />
          <p className="tdg-opp-ressalva">
            <History size={13} aria-hidden="true" /> v{dados.latest.version} registrada em {dataHora(dados.latest.createdAt)}
            {dados.versions?.length > 1 ? ` · ${dados.versions.length} versões (imutáveis)` : ""}
          </p>
        </>
      )}

      {!aberto ? (
        <button type="button" className="tdg-viab-acao" onClick={() => setAberto(true)}>
          {ultimo ? "Recalcular viabilidade" : "Registrar viabilidade"}
        </button>
      ) : (
        <form className="tdg-viab-form" onSubmit={registrar}>
          {cenariosDaOportunidade.length > 0 && (
            <label>
              <span>Cenário de precificação</span>
              <select value={form.scenarioId} onChange={campo("scenarioId")}>
                <option value="">Oportunidade (sem cenário)</option>
                {cenariosDaOportunidade.map((c) => <option key={c.id} value={c.id}>{c.id.slice(0, 8)} · {c.result?.productName || c.productId || "cenário"}</option>)}
              </select>
            </label>
          )}
          <label><span>Origem</span><input value={form.origin} onChange={campo("origin")} placeholder="Base / CD" /></label>
          <label><span>Destino</span><input value={form.destination} onChange={campo("destination")} placeholder="Cliente / hub" /></label>
          <label><span>Distância (km)</span><input type="number" min="0" step="0.1" value={form.distanceKm} onChange={campo("distanceKm")} required /></label>
          <label><span>Classe do veículo</span><input value={form.vehicleClass} onChange={campo("vehicleClass")} placeholder="van, vuc, truck…" /></label>
          <label><span>Veículo de referência</span><input value={form.referenceVehicle} onChange={campo("referenceVehicle")} placeholder="VAN-082" /></label>
          <label><span>Bateria (kWh)</span><input type="number" min="0" step="0.1" value={form.batteryCapacityKwh} onChange={campo("batteryCapacityKwh")} /></label>
          <label><span>Consumo (kWh/km)</span><input type="number" min="0" step="0.01" value={form.consumptionKwhPerKm} onChange={campo("consumptionKwhPerKm")} /></label>
          <label><span>SOC inicial (%)</span><input type="number" min="0" max="100" value={form.socPercent} onChange={campo("socPercent")} /></label>
          <label><span>Reserva mínima (%)</span><input type="number" min="0" max="95" value={form.reservePercent} onChange={campo("reservePercent")} /></label>
          <label><span>Carga (kg)</span><input type="number" min="0" value={form.payloadKg} onChange={campo("payloadKg")} /></label>
          <label><span>Carga máxima (kg)</span><input type="number" min="0" value={form.maxPayloadKg} onChange={campo("maxPayloadKg")} /></label>
          <label><span>Subida acumulada (m)</span><input type="number" min="0" value={form.elevationGainM} onChange={campo("elevationGainM")} /></label>
          <label><span>Temperatura (°C)</span><input type="number" value={form.temperatureC} onChange={campo("temperatureC")} /></label>
          <label><span>Custo da operação (R$)</span><input type="number" min="0" step="0.01" value={form.cost} onChange={campo("cost")} /></label>
          <label><span>Custo por entrega (R$)</span><input type="number" min="0" step="0.01" value={form.costPerDelivery} onChange={campo("costPerDelivery")} /></label>
          <label><span>CO₂ evitado (kg)</span><input type="number" min="0" step="0.1" value={form.avoidedCo2} onChange={campo("avoidedCo2")} /></label>
          <p className="tdg-opp-ressalva">
            A energia é estimada no servidor pelo mesmo modelo do pré-flight quando bateria, consumo e distância são informados; sem eles, o snapshot fica sem energia e a proposta não libera.
          </p>
          <div className="tdg-viab-acoes">
            <button type="submit" disabled={salvando}>{salvando ? "Registrando…" : "Registrar snapshot"}</button>
            <button type="button" onClick={() => setAberto(false)} disabled={salvando}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
