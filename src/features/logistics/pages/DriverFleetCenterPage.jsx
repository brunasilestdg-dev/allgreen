import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  Calculator,
  Clock3,
  Gauge,
  MapPin,
  Plus,
  RefreshCw,
  Route,
  Scale,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  UserRoundCheck,
  Wrench,
} from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { VEHICLE_CLASSES, vehicleClass } from "../vehicleClassDomain.js";
import { fleetAlerts, fleetVehicleMetrics, summarizeFleet } from "../todoGreenFleetDomain.js";
import { preverManutencao, taxaKmPorDia } from "../predictiveMaintenanceDomain.js";
import {
  dimensionarFrota,
  PREMISSAS_DIMENSIONAMENTO_FIELDS,
  PREMISSAS_DIMENSIONAMENTO_PADRAO,
} from "../fleetSizingDomain.js";
import {
  compararDieselEletrico,
  PREMISSAS_COMPARACAO_FIELDS,
  PREMISSAS_COMPARACAO_PADRAO,
} from "../fleetComparisonDomain.js";
import "./TodoGreenPages.css";
import { comRotulo } from "../rotulosDomain.js";

const ENERGY_LABELS = { electric: "Elétrico", hybrid: "Híbrido", biomethane: "Biometano", diesel: "Diesel" };
const STATUS_OPTIONS = [
  { id: "available", label: "Disponível" },
  { id: "in-operation", label: "Em operação" },
  { id: "maintenance", label: "Manutenção" },
  { id: "reserved", label: "Reserva" },
  { id: "blocked", label: "Bloqueado" },
  { id: "inactive", label: "Inativo" },
];
const MAINT_STATUS = { open: "Aberta", in_progress: "Em andamento", done: "Concluída", canceled: "Cancelada" };

const fleetApi = async (path, authHeaders, options = {}) => {
  const result = await fetch(`/api/todogreen/fleet${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error || "Não foi possível falar com a Frota.");
  return payload;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const requestFleet = async (authHeaders) => {
  const result = await fetch("/api/todogreen/fleet", { headers: authHeaders?.() || {} });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error || "Não foi possível carregar a frota.");
  return payload;
};

const requestOperations = async (authHeaders) => {
  const result = await fetch("/api/todogreen/records/operations?limit=500", { headers: authHeaders?.() || {} });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error || "Não foi possível carregar as operações.");
  return payload.registros || payload.operations || [];
};

const requestEconomics = async (authHeaders) => {
  try {
    const result = await fetch("/api/todogreen/fleet/economics", { headers: authHeaders?.() || {} });
    const payload = await result.json().catch(() => ({}));
    return result.ok ? (payload.economics || []) : [];
  } catch {
    return []; // a economia é um enriquecimento; sem ela o cockpit segue funcionando
  }
};

const text = (value, fallback = "Não informado") => String(value || "").trim() || fallback;
const dateTime = (value) => {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : String(value);
};
const isLate = (operation, now = new Date()) => {
  if (operation.entregueEm || !operation.prometidoEm) return false;
  const promised = new Date(operation.prometidoEm);
  return Number.isFinite(promised.getTime()) && promised < now;
};
const latestOperationForVehicle = (operations, vehicle) => {
  const plate = String(vehicle.plate || "").toUpperCase();
  return operations.find((operation) => String(operation.placa || "").toUpperCase() === plate);
};

const driverRows = (operations = []) => {
  const grouped = new Map();
  for (const operation of operations) {
    const driver = text(operation.motorista, "Motorista não informado");
    // Agrupa pelo motoristaId quando existe — nome pode repetir entre pessoas ou
    // mudar para a mesma pessoa; o id é a identidade. Sem id (registro legado),
    // cai no nome, isolado por prefixo para não colidir com um id.
    const key = operation.motoristaId ? `id:${operation.motoristaId}` : `nome:${driver}`;
    const current = grouped.get(key) || {
      key,
      driverId: operation.motoristaId || "",
      driver,
      operations: 0,
      activeRoutes: 0,
      incidents: 0,
      deliveries: 0,
      packages: 0,
      distanceKm: 0,
      latest: null,
      plates: new Set(),
      late: 0,
    };
    current.operations += 1;
    current.incidents += Number(operation.ocorrencias || 0);
    current.deliveries += Number(operation.entregas || 0);
    current.packages += Number(operation.pacotes || 0);
    current.distanceKm += Number(operation.distanciaKm || 0);
    if (!operation.entregueEm && !["delivered", "cancelled"].includes(operation.situacao)) current.activeRoutes += 1;
    if (operation.placa) current.plates.add(operation.placa);
    if (isLate(operation)) current.late += 1;
    const currentDate = new Date(current.latest?.atualizadoEm || current.latest?.dataServico || 0).getTime();
    const nextDate = new Date(operation.atualizadoEm || operation.dataServico || 0).getTime();
    if (!current.latest || nextDate >= currentDate) current.latest = operation;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((item) => ({ ...item, plates: [...item.plates] }))
    .sort((a, b) => b.activeRoutes - a.activeRoutes || b.late - a.late || b.operations - a.operations);
};

function Metric({ label, value, detail, tone = "" }) {
  return <article className={`df-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function DriverCard({ row }) {
  const latest = row.latest || {};
  return (
    <article className={`df-driver-card ${row.late ? "risk" : ""}`}>
      <header>
        <UserRoundCheck size={19} />
        <span><strong>{row.driver}</strong><small>{row.plates.length ? row.plates.join(", ") : "Sem placa vinculada"}</small></span>
        {row.late ? <b>Atraso</b> : <b>Em rota</b>}
      </header>
      <dl>
        <div><dt>Rotas ativas</dt><dd>{row.activeRoutes}</dd></div>
        <div><dt>Entregas</dt><dd>{row.deliveries.toLocaleString("pt-BR")}</dd></div>
        <div><dt>Km</dt><dd>{NUM.format(row.distanceKm)}</dd></div>
        <div><dt>Ocorrências</dt><dd>{row.incidents}</dd></div>
      </dl>
      <p>{text(latest.referencia, "Sem rota recente")} · {text(latest.origem, "origem")} para {text(latest.destino, "destino")}</p>
      <small>ETA: {dateTime(latest.etaEm)} · Prometido: {dateTime(latest.prometidoEm)}</small>
    </article>
  );
}

const statusLabel = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.label || id;

const ROTULO_FAIXA_MANUT = { critico: "Revisão iminente", atencao: "Revisão se aproximando", "sem-ritmo": "Revisão prevista", ok: "" };

function FleetCard({ vehicle, operations, economia, onEdit, onApplyStatus }) {
  const metrics = fleetVehicleMetrics(vehicle);
  const alerts = fleetAlerts(vehicle);
  const fields = vehicle.fields || {};
  const latest = latestOperationForVehicle(operations, vehicle);
  const sugestao = economia?.statusSugerido;
  // Manutenção preditiva: o ritmo de km vem das operações reais da placa; a
  // previsão cruza o marco de km com a data agendada. Sem hodômetro, some.
  const plate = String(vehicle.plate || "").toUpperCase();
  const opsDaPlaca = operations.filter((o) => String(o.placa || "").toUpperCase() === plate);
  const previsao = preverManutencao({
    odometerKm: vehicle.odometerKm || fields.odometerKm,
    kmPorDia: taxaKmPorDia(opsDaPlaca),
    nextMaintenanceAt: vehicle.nextMaintenanceAt,
  });
  const mostrarPrevisao = previsao.disponivel && previsao.faixa !== "ok";
  return (
    <article
      className={`df-fleet-card ${alerts.length || previsao.faixa === "critico" ? "risk" : ""}${onEdit ? " df-clickable" : ""}`}
      onClick={onEdit ? () => onEdit(vehicle) : undefined}
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onKeyDown={onEdit ? (e) => { if (e.key === "Enter") onEdit(vehicle); } : undefined}
    >
      <header>
        <Truck size={19} />
        <span><strong>{text(vehicle.prefix, vehicle.plate || "Veículo")}</strong><small>{text(vehicle.plate, "sem placa")} · {text(vehicle.operationalUnit, "sem unidade")}</small></span>
        <b>{text(vehicle.status, "status")}</b>
      </header>
      <div className="df-fleet-grid">
        <span><small>Motorista</small><strong>{text(fields.currentDriver || latest?.motorista)}</strong></span>
        <span><small>Localização</small><strong>{text(fields.lastAddress || latest?.ultimaPosicaoEm, "Sem posição")}</strong></span>
        <span><small>Velocidade</small><strong>{fields.speedKmh ? `${NUM.format(fields.speedKmh)} km/h` : "Sem leitura"}</strong></span>
        <span><small>Hodometro</small><strong>{NUM.format(vehicle.odometerKm || fields.odometerKm || 0)} km</strong></span>
        <span><small>Horímetro</small><strong>{fields.hourmeter ? `${NUM.format(fields.hourmeter)} h` : "Não informado"}</strong></span>
        <span><small>Bateria</small><strong>{NUM.format(vehicle.batterySohPercent || 0)}% SOH</strong></span>
      </div>
      <footer>
        <small>Autonomia real {NUM.format(vehicle.realRangeKm || 0)} km · eficiência {NUM.format(metrics.rangeEfficiencyPercent)}%</small>
        <small>
          Custo {BRL.format(metrics.costPerKm)}/km
          {metrics.realizedCostPerKm > 0 ? " (realizado)" : " (projetado)"} · Margem {BRL.format(metrics.margin)}
        </small>
        {economia && (
          <small>
            Manutenção real {BRL.format(economia.manutencao.total)}
            {economia.manutencao.abertas ? ` · ${economia.manutencao.abertas} OS aberta(s)` : ""}
            {" · "}{economia.operacoes.operacoes} viagem(ns), {NUM.format(economia.operacoes.kmTotal)} km
            {economia.manutencaoPorKm != null ? ` · ${BRL.format(economia.manutencaoPorKm)}/km manut.` : ""}
          </small>
        )}
        {mostrarPrevisao && (
          <span className={`df-manut-prev f-${previsao.faixa}`}>
            <strong>{ROTULO_FAIXA_MANUT[previsao.faixa]}:</strong> {previsao.mensagem}
          </span>
        )}
        {sugestao && (
          <span className="df-status-suggest">
            Sugerido: <strong>{statusLabel(sugestao.status)}</strong> — {sugestao.motivo}
            {onApplyStatus && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onApplyStatus(vehicle, sugestao.status); }}>
                Aplicar
              </button>
            )}
          </span>
        )}
      </footer>
      {alerts.length > 0 && <div className="df-alerts">{alerts.map((alert) => <em key={alert.code}>{alert.message}</em>)}</div>}
    </article>
  );
}

export default function DriverFleetCenterPage({
  authHeaders,
  operations: providedOperations,
  onNavigate,
  setToast,
  mode = "management",
}) {
  const [fleet, setFleet] = useState([]);
  const [economics, setEconomics] = useState([]);
  const [operationsFromApi, setOperationsFromApi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [editing, setEditing] = useState(null); // null | {} (novo) | veículo (editar)
  const [importando, setImportando] = useState(false);
  const [dimensionando, setDimensionando] = useState(false);
  const [comparando, setComparando] = useState(false);
  const isPortal = mode === "driver-portal";
  const operations = providedOperations || operationsFromApi;

  const go = (route) => {
    if (onNavigate && String(route).startsWith("/todogreen")) {
      onNavigate(route);
      return;
    }
    if (typeof window !== "undefined") window.location.assign(route);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [payload, loadedOperations, loadedEconomics] = await Promise.all([
        requestFleet(authHeaders),
        providedOperations ? Promise.resolve(providedOperations) : requestOperations(authHeaders),
        requestEconomics(authHeaders),
      ]);
      setFleet(payload.vehicles || []);
      setEconomics(loadedEconomics || []);
      setCanWrite(Boolean(payload.access?.canWrite));
      if (!providedOperations) setOperationsFromApi(loadedOperations || []);
    } catch (reason) {
      setError(reason.message);
      setToast?.(reason.message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, providedOperations, setToast]);

  useEffect(() => { load(); }, [load]);

  const salvarVeiculo = async (dados) => {
    try {
      if (dados.id) {
        await fleetApi(`/${dados.id}`, authHeaders, { method: "PATCH", body: JSON.stringify(dados) });
      } else {
        await fleetApi("", authHeaders, { method: "POST", body: JSON.stringify(dados) });
      }
      setEditing(null);
      setToast?.("Veículo salvo.");
      await load();
    } catch (reason) {
      setToast?.(reason.message);
    }
  };

  const aplicarStatusSugerido = async (vehicle, status) => {
    try {
      await fleetApi(`/${vehicle.id}`, authHeaders, { method: "PATCH", body: JSON.stringify({ status, revision: vehicle.revision }) });
      setToast?.("Status do veículo atualizado.");
      await load();
    } catch (reason) {
      setToast?.(reason.message);
    }
  };

  const arquivarVeiculo = async (veiculo) => {
    if (typeof window !== "undefined" && !window.confirm(`Arquivar o veículo ${veiculo.prefix || veiculo.plate}?`)) return;
    try {
      await fleetApi(`/${veiculo.id}`, authHeaders, { method: "DELETE" });
      setEditing(null);
      setToast?.("Veículo arquivado.");
      await load();
    } catch (reason) {
      setToast?.(reason.message);
    }
  };

  const summary = useMemo(() => summarizeFleet(fleet), [fleet]);
  const economicsByVehicle = useMemo(() => {
    const map = {};
    for (const e of economics) map[e.vehicleId] = e;
    return map;
  }, [economics]);
  const drivers = useMemo(() => driverRows(operations), [operations]);
  const lateOperations = operations.filter((operation) => isLate(operation)).length;
  const noPosition = operations.filter((operation) => !operation.ultimaPosicaoEm && !operation.latitude && !operation.longitude).length;
  const operationalAlerts = lateOperations + noPosition + summary.batteryRisks + summary.autonomyRisks;

  return (
    <section className="tdg-panel tdg-page df-center">
      <header className="tdg-page-title">
        <div>
          <span>{isPortal ? "CENTRAL OPERACIONAL" : "GESTÃO OPERACIONAL"}</span>
          <h2>{isPortal ? "Portal do motorista" : "Gestão operacional de frota"}</h2>
          <p>
            {isPortal
              ? "Acesso diário para rota, jornada, veículo, telemetria disponível, alertas e produtividade."
              : "Visão gerencial de motoristas, frota, jornada, rota, telemetria disponível, alertas e produtividade."}
          </p>
        </div>
        <div className="df-title-actions">
          {!isPortal && canWrite && (
            <button type="button" className="tdg-action" onClick={() => setEditing({})}>
              <Plus size={17} />Novo veículo
            </button>
          )}
          {!isPortal && canWrite && (
            <button type="button" className="tdg-secondary-action" onClick={() => setImportando(true)}>
              <Upload size={17} />Importar frota
            </button>
          )}
          {!isPortal && (
            <button type="button" className="tdg-secondary-action" onClick={() => setDimensionando(true)}>
              <Calculator size={17} />Dimensionar
            </button>
          )}
          {!isPortal && (
            <button type="button" className="tdg-secondary-action" onClick={() => setComparando(true)}>
              <Scale size={17} />Diesel × elétrico
            </button>
          )}
          {!isPortal && (
            <button type="button" className="tdg-secondary-action" onClick={() => go("/portal-motorista")}>
              <UserRoundCheck size={17} />Abrir portal motorista
            </button>
          )}
          <button type="button" className="tdg-secondary-action" onClick={load} disabled={loading}>
            <RefreshCw size={17} />{loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </header>

      {error && <div className="tdg-page-error">{error}</div>}

      <div className="df-metrics">
        <Metric label="Motoristas em operação" value={drivers.filter((item) => item.activeRoutes).length} detail={`${drivers.length} com registro operacional`} />
        <Metric label="Veículos em operação" value={summary.inOperation} detail={`${summary.available} disponíveis`} />
        <Metric label="Alertas" value={operationalAlerts} detail="prazo, posição, bateria e autonomia" tone={operationalAlerts ? "risk" : "good"} />
        <Metric label="Utilização" value={`${NUM.format(summary.utilizationPercent)}%`} detail="base ativa da frota" />
      </div>

      <section className="df-command">
        <article>
          <Route size={20} />
          <span><strong>Rotas e jornada</strong><small>{isPortal ? "Consulte viagem, ETA, status e últimas ocorrências vinculadas ao motorista." : "Use Operações para criar viagem, vincular motorista, placa, ETA e ocorrências."}</small></span>
          <button type="button" onClick={() => go("/todogreen/operacoes")}>Abrir operações</button>
        </article>
        <article>
          <BatteryCharging size={20} />
          <span><strong>Frota elétrica</strong><small>Controle autonomia real, SOH da bateria, manutenção e disponibilidade.</small></span>
          {canWrite
            ? <button type="button" onClick={() => setEditing({})}>Cadastrar veículo</button>
            : <button type="button" onClick={load}>Atualizar frota</button>}
        </article>
        <article>
          <ShieldCheck size={20} />
          <span><strong>Torre TMS</strong><small>Acompanhe rotas, posições recebidas, SLA e exceções na operação própria.</small></span>
          <button type="button" onClick={() => go("/portal-tms/mapa")}>Abrir mapa da frota</button>
        </article>
      </section>

      <div className="df-layout">
        <section>
          <header className="df-section-head"><div><Clock3 size={18} /><span><strong>{isPortal ? "Minha operação" : "Gestão do motorista"}</strong><small>Visão por pessoa, rota ativa e risco de atraso.</small></span></div></header>
          <div className="df-driver-list">
            {drivers.length ? drivers.map((row) => <DriverCard key={row.key} row={row} />) : <p className="tdg-empty-access">Nenhum motorista vinculado a operações ainda.</p>}
          </div>
        </section>

        <section>
          <header className="df-section-head"><div><Gauge size={18} /><span><strong>{isPortal ? "Veículo e telemetria" : "Gestão da frota"}</strong><small>Veículo, telemetria, bateria, custo e alertas.</small></span></div></header>
          <div className="df-fleet-list">
            {fleet.length ? fleet.map((vehicle) => <FleetCard key={vehicle.id} vehicle={vehicle} operations={operations} economia={economicsByVehicle[vehicle.id]} onEdit={!isPortal && canWrite ? setEditing : undefined} onApplyStatus={!isPortal && canWrite ? aplicarStatusSugerido : undefined} />) : <p className="tdg-empty-access">{canWrite ? "Nenhum veículo cadastrado ainda. Use “Novo veículo”." : "Nenhum veículo cadastrado na frota."}</p>}
          </div>
        </section>
      </div>

      <section className="df-readiness">
        <header><AlertTriangle size={18} /><strong>O que ainda depende de integração real</strong></header>
        <div>
          <span><MapPin size={15} /> Localização em tempo real, trajeto, velocidade, deslocamento/parada e cerca virtual dependem da integração telemática enviar esses eventos.</span>
          <span><Truck size={15} /> Bloqueio remoto, RFID, horímetro e voltagem exigem suporte do hardware/API contratada.</span>
          <span><UserRoundCheck size={15} /> Jornada do motorista fica operacional com check-in/check-out e app dedicado numa próxima etapa.</span>
        </div>
      </section>

      {editing && (
        <VehicleModal
          vehicle={editing}
          authHeaders={authHeaders}
          onClose={() => setEditing(null)}
          onSave={salvarVeiculo}
          onArchive={arquivarVeiculo}
          setToast={setToast}
        />
      )}

      {importando && (
        <FleetImportModal
          authHeaders={authHeaders}
          placasExistentes={fleet.map((v) => v.plate)}
          onClose={() => setImportando(false)}
          onDone={async () => { setImportando(false); await load(); }}
          setToast={setToast}
        />
      )}

      {dimensionando && (
        <FleetSizingModal
          autonomiaSugerida={autonomiaMediaFrota(fleet)}
          onClose={() => setDimensionando(false)}
        />
      )}

      {comparando && <FleetComparisonModal onClose={() => setComparando(false)} />}
    </section>
  );
}

// Autonomia de referência a partir da frota já cadastrada: média das autonomias
// reais (senão nominais) dos elétricos. Só uma sugestão editável; 0 quando não há.
function autonomiaMediaFrota(fleet = []) {
  const valores = fleet
    .filter((v) => (v.energyType || "electric") === "electric")
    .map((v) => Number(v.realRangeKm) || Number(v.nominalRangeKm) || 0)
    .filter((n) => n > 0);
  if (!valores.length) return 0;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

// Dimensionar frota: quantos elétricos cobrem a operação, dada a demanda diária
// e a autonomia/janela de recarga. Calculadora pura — recalcula ao digitar,
// nada é gravado. As premissas são referências a confirmar; a operação manda.
function FleetSizingModal({ autonomiaSugerida = 0, onClose }) {
  const [kmPorDia, setKmPorDia] = useState("");
  const [autonomiaKm, setAutonomiaKm] = useState(autonomiaSugerida ? String(autonomiaSugerida) : "");
  const [premissas, setPremissas] = useState(PREMISSAS_DIMENSIONAMENTO_PADRAO);

  const setPremissa = (chave, valor) =>
    setPremissas((atual) => ({ ...atual, [chave]: valor === "" ? "" : Number(valor) }));

  const resultado = useMemo(
    () => dimensionarFrota({ kmPorDia: Number(kmPorDia) || 0 }, { autonomiaKm: Number(autonomiaKm) || 0 }, premissas),
    [kmPorDia, autonomiaKm, premissas],
  );
  const r = resultado.resumo;
  const gargaloRotulo = { autonomia: "Autonomia e recarga", demanda: "Quilometragem" };

  return (
    <Modal onClose={onClose} title="Dimensionar frota elétrica" wide>
      <div className="df-sizing">
        <p className="tdg-rel-ressalva">
          Quantos elétricos cobrem a operação — contando a autonomia por ciclo e a janela de
          recarga (o que o diesel não tem). As premissas são referências; a operação real manda.
        </p>

        <div className="df-sizing-form">
          <label>
            <span>Quilometragem diária da operação (todos os veículos)</span>
            <div className="df-sizing-input"><input type="number" min="0" inputMode="decimal" value={kmPorDia} onChange={(e) => setKmPorDia(e.target.value)} placeholder="ex.: 1000" /><em>km/dia</em></div>
          </label>
          <label>
            <span>Autonomia real do veículo{autonomiaSugerida ? ` (média da frota: ${autonomiaSugerida} km)` : ""}</span>
            <div className="df-sizing-input"><input type="number" min="0" inputMode="decimal" value={autonomiaKm} onChange={(e) => setAutonomiaKm(e.target.value)} placeholder="ex.: 235" /><em>km</em></div>
          </label>
        </div>

        <details className="df-sizing-premissas">
          <summary>Premissas (referências a confirmar)</summary>
          <div className="df-sizing-form">
            {PREMISSAS_DIMENSIONAMENTO_FIELDS.map((f) => (
              <label key={f.chave}>
                <span>{f.rotulo}</span>
                <div className="df-sizing-input">
                  <input type="number" min={f.min} max={f.max} inputMode="decimal" value={premissas[f.chave]} onChange={(e) => setPremissa(f.chave, e.target.value)} />
                  <em>{f.sufixo}</em>
                </div>
              </label>
            ))}
          </div>
        </details>

        {resultado.disponivel ? (
          <div className="df-sizing-resultado">
            <div className="df-sizing-destaque">
              <small>Frota necessária</small>
              <strong>{r.veiculosTotal}</strong>
              <span>{r.veiculosPorDemanda} para a demanda + {r.veiculosReserva} de reserva</span>
            </div>
            <div className="df-sizing-numeros">
              <div><small>Km por veículo/dia</small><strong>{NUM.format(r.kmPorVeiculoDia)} km</strong></div>
              <div><small>Recargas por veículo/dia</small><strong>{r.recargasPorVeiculoDia}</strong></div>
              <div><small>Horas dirigindo</small><strong>{NUM.format(r.horasDirigindoPorVeiculo)} h</strong></div>
              <div><small>Horas em recarga</small><strong>{NUM.format(r.horasRecargaPorVeiculo)} h</strong></div>
              <div><small>Autonomia útil (com folga)</small><strong>{NUM.format(r.autonomiaUtilKm)} km</strong></div>
              <div><small>O que aperta primeiro</small><strong>{gargaloRotulo[r.gargalo] || "—"}</strong></div>
            </div>
          </div>
        ) : (
          <div className="df-sizing-avisos">
            {resultado.avisos.map((a) => (
              <p key={a} className="tdg-rel-aviso"><AlertTriangle size={16} />{a}</p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Comparar diesel × elétrico lado a lado: custo operacional mensal, CO₂ e o
// payback do que o elétrico custa a mais na compra. Calculadora pura — o lado
// diesel é referência de mercado a confirmar, nunca custo gravado.
function FleetComparisonModal({ onClose }) {
  const [kmMes, setKmMes] = useState("");
  const [valorEletrico, setValorEletrico] = useState("");
  const [valorDiesel, setValorDiesel] = useState("");
  const [premissas, setPremissas] = useState(PREMISSAS_COMPARACAO_PADRAO);

  const setPremissa = (chave, valor) =>
    setPremissas((atual) => ({ ...atual, [chave]: valor === "" ? "" : Number(valor) }));

  const c = useMemo(
    () => compararDieselEletrico(
      { kmMes: Number(kmMes) || 0, valorEletrico: Number(valorEletrico) || 0, valorDiesel: Number(valorDiesel) || 0 },
      premissas,
    ),
    [kmMes, valorEletrico, valorDiesel, premissas],
  );
  const d = c.delta;

  return (
    <Modal onClose={onClose} title="Diesel × elétrico: custo, CO₂ e payback" wide>
      <div className="df-compare">
        <p className="tdg-rel-ressalva">
          Os dois lado a lado. O lado elétrico usa os fatores do motor; o lado diesel é
          <strong> referência de mercado a confirmar</strong> — a operação real manda.
        </p>

        <div className="df-compare-form">
          <label>
            <span>Quilometragem mensal da operação</span>
            <div className="df-sizing-input"><input type="number" min="0" inputMode="decimal" value={kmMes} onChange={(e) => setKmMes(e.target.value)} placeholder="ex.: 5000" /><em>km/mês</em></div>
          </label>
          <label>
            <span>Valor de compra — elétrico</span>
            <div className="df-sizing-input"><input type="number" min="0" inputMode="decimal" value={valorEletrico} onChange={(e) => setValorEletrico(e.target.value)} placeholder="ex.: 800000" /><em>R$</em></div>
          </label>
          <label>
            <span>Valor de compra — diesel</span>
            <div className="df-sizing-input"><input type="number" min="0" inputMode="decimal" value={valorDiesel} onChange={(e) => setValorDiesel(e.target.value)} placeholder="ex.: 500000" /><em>R$</em></div>
          </label>
        </div>

        <details className="df-sizing-premissas">
          <summary>Premissas (elétrico do motor · diesel a confirmar)</summary>
          <div className="df-compare-premissas">
            {["eletrico", "diesel"].map((lado) => (
              <div key={lado} className={`df-compare-premissa-grupo ${lado}`}>
                <h4>{lado === "eletrico" ? "Elétrico" : "Diesel (referência)"}</h4>
                {PREMISSAS_COMPARACAO_FIELDS.filter((f) => f.lado === lado).map((f) => (
                  <label key={f.chave}>
                    <span>{f.rotulo}</span>
                    <div className="df-sizing-input">
                      <input type="number" min={f.min} max={f.max} step="any" inputMode="decimal" value={premissas[f.chave]} onChange={(e) => setPremissa(f.chave, e.target.value)} />
                      <em>{f.sufixo}</em>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </details>

        {c.disponivel ? (
          <>
            <div className="df-compare-lados">
              <div className="df-compare-lado diesel">
                <h4>Diesel</h4>
                <div><small>Combustível/mês</small><strong>{BRL.format(c.diesel.combustivelMes)}</strong></div>
                <div><small>Manutenção/mês</small><strong>{BRL.format(c.diesel.manutencaoMes)}</strong></div>
                <div className="op"><small>Operacional/mês</small><strong>{BRL.format(c.diesel.operacionalMes)}</strong></div>
                <div><small>CO₂/mês</small><strong>{NUM.format(c.diesel.co2Mes)} kg</strong></div>
              </div>
              <div className="df-compare-lado eletrico">
                <h4>Elétrico</h4>
                <div><small>Energia/mês</small><strong>{BRL.format(c.eletrico.energiaMes)}</strong></div>
                <div><small>Manutenção/mês</small><strong>{BRL.format(c.eletrico.manutencaoMes)}</strong></div>
                <div className="op"><small>Operacional/mês</small><strong>{BRL.format(c.eletrico.operacionalMes)}</strong></div>
                <div><small>CO₂/mês</small><strong>{NUM.format(c.eletrico.co2Mes)} kg</strong></div>
              </div>
            </div>

            <div className="df-compare-destaques">
              <div className="ganho">
                <small>Economia operacional</small>
                <strong>{BRL.format(d.economiaOperacionalMes)}/mês</strong>
                <span>{BRL.format(d.economiaOperacionalAno)}/ano</span>
              </div>
              <div className="ganho">
                <small>CO₂ evitado</small>
                <strong>{NUM.format(d.co2EvitadoMesKg)} kg/mês</strong>
                <span>{NUM.format(d.co2EvitadoAnoKg / 1000)} t/ano</span>
              </div>
              <div className="ganho">
                <small>Payback do elétrico</small>
                {d.paybackMeses != null
                  ? <><strong>{d.paybackMeses === 0 ? "imediato" : `${NUM.format(d.paybackMeses)} meses`}</strong><span>{d.capexDelta > 0 ? `${BRL.format(d.capexDelta)} a mais na compra` : "não custa mais na compra"}</span></>
                  : <><strong>—</strong><span>informe o valor dos dois veículos</span></>}
              </div>
            </div>
            {c.avisos.length > 0 && c.avisos.map((a) => (
              <p key={a} className="tdg-rel-ressalva">{a}</p>
            ))}
          </>
        ) : (
          <div className="df-sizing-avisos">
            {c.avisos.map((a) => (
              <p key={a} className="tdg-rel-aviso"><AlertTriangle size={16} />{a}</p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Importar a frota em massa: cola a planilha, vê o retrato (novos/duplicados/
// inválidos) e confirma. A análise é a mesma camada pura do servidor; aqui é só
// a prévia. O servidor RE-VALIDA e é a autoridade sobre a deduplicação.
function FleetImportModal({ authHeaders, placasExistentes, onClose, onDone, setToast }) {
  const [texto, setTexto] = useState("");
  const [analise, setAnalise] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const analisar = async () => {
    setAnalisando(true);
    setResultado(null);
    try {
      const { analisarPlanilhaDeFrota } = await import("../fleetImportDomain.js");
      setAnalise(await analisarPlanilhaDeFrota(texto, { placasExistentes }));
    } catch (reason) {
      setToast?.(reason.message || "Não foi possível ler a planilha.");
    } finally {
      setAnalisando(false);
    }
  };

  const usarModelo = async () => {
    const { MODELO_CSV_FROTA } = await import("../fleetImportDomain.js");
    setTexto(MODELO_CSV_FROTA);
    setAnalise(null);
    setResultado(null);
  };

  const importar = async () => {
    if (!analise?.importaveis?.length) return;
    setEnviando(true);
    try {
      const r = await fleetApi("/importar", authHeaders, {
        method: "POST",
        body: JSON.stringify({ veiculos: analise.importaveis }),
      });
      setResultado(r);
      setToast?.(r.criados === 1 ? "1 veículo importado." : `${r.criados} veículos importados.`);
      if (r.criados > 0 && (!r.ignorados || r.ignorados.length === 0)) {
        await onDone();
        return;
      }
    } catch (reason) {
      setToast?.(reason.message);
    } finally {
      setEnviando(false);
    }
  };

  const resumo = analise?.resumo;
  return (
    <Modal onClose={onClose} title="Importar frota (planilha)">
      <div className="df-import">
        <p className="tdg-rel-ressalva">
          Cole as linhas da planilha (CSV: valores separados por vírgula ou ponto e vírgula, com
          cabeçalho). Colunas reconhecidas: <strong>Prefixo, Placa, Classe, Fabricante, Modelo,
          Ano, Unidade, Capacidade (kg), Bateria (kWh), Consumo (kWh/km), Autonomia (km),
          Hodômetro (km), Valor de aquisição</strong>. A frota é cadastrada como elétrica.
        </p>
        <textarea
          className="df-import-text"
          rows={7}
          placeholder="Prefixo,Placa,Classe,Autonomia (km)&#10;TDG-001,ABC1D23,VUC,240"
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAnalise(null); setResultado(null); }}
        />
        <div className="df-import-actions">
          <button type="button" className="tdg-secondary-action" onClick={usarModelo}>Usar modelo</button>
          <button type="button" className="tdg-action" onClick={analisar} disabled={!texto.trim() || analisando}>
            {analisando ? "Analisando..." : "Analisar"}
          </button>
        </div>

        {resumo && (
          <>
            <div className="df-import-resumo">
              <span className="ok">{resumo.novos} novos</span>
              <span>{resumo.duplicados} duplicados</span>
              <span className={resumo.invalidos ? "erro" : ""}>{resumo.invalidos} inválidos</span>
              <span className="total">{resumo.total} linhas</span>
            </div>
            {resumo.total > 0 && (
              <div className="df-import-lista">
                {analise.linhas.map((l) => (
                  <div key={l.numero} className={`df-import-linha ${l.status}`}>
                    <strong>{l.veiculo.plate || "(sem placa)"}</strong>
                    <span>{l.veiculo.prefix}</span>
                    <span>{l.status === "novo" ? (l.classeNome || l.veiculo.vehicleClass) : (l.erro || l.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {resultado && (
          <div className="df-import-resultado">
            <p><strong>{resultado.criados}</strong> veículo(s) cadastrado(s).</p>
            {resultado.ignorados?.length > 0 && (
              <ul>
                {resultado.ignorados.map((ig, i) => (
                  <li key={`${ig.placa}-${i}`}>{ig.placa}: {ig.motivo}</li>
                ))}
              </ul>
            )}
            <button type="button" className="tdg-action" onClick={onDone}>Concluir</button>
          </div>
        )}

        {resumo && !resultado && (
          <div className="df-import-confirmar">
            <button type="button" className="tdg-secondary-action" onClick={onClose}>Cancelar</button>
            <button type="button" className="tdg-action" onClick={importar} disabled={!resumo.novos || enviando}>
              {enviando ? "Importando..." : `Importar ${resumo.novos} veículo(s)`}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const VEHICLE_BLANK = {
  prefix: "", plate: "", manufacturer: "", model: "", vehicleClass: "", energyType: "electric",
  status: "available", operationalUnit: "", costCenter: "", payloadKg: "", odometerKm: "", batterySohPercent: "",
  // Energia e perfil físico (seção 38): alimentam o modelo de energia, o
  // truck costing do Valhalla, o pré-flight e o smart charging.
  batteryCapacityKwh: "", energyConsumptionKwhPerKm: "", nominalRangeKm: "",
  heightM: "", widthM: "", lengthM: "", tareKg: "", grossWeightKg: "", axles: "",
  connectorType: "", maxChargingPowerKw: "", referenceConsumptionKwhKm: "",
};

function VehicleModal({ vehicle, authHeaders, onClose, onSave, onArchive, setToast }) {
  const vehicleId = vehicle?.id || "";
  const editando = Boolean(vehicleId);
  const [form, setForm] = useState({ ...VEHICLE_BLANK, ...vehicle });
  const [orders, setOrders] = useState([]);
  const [novaOrdem, setNovaOrdem] = useState("");
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  // Só as energias que a classe aceita — o servidor recusa carreta elétrica, e a
  // tela não deve nem oferecer.
  const energiasDaClasse = vehicleClass(form.vehicleClass)?.energias || Object.keys(ENERGY_LABELS);

  const carregarOrdens = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { orders: lista } = await fleetApi(`/${vehicleId}/maintenance`, authHeaders);
      setOrders(lista || []);
    } catch { /* silencioso: a manutenção é secundária ao cadastro */ }
  }, [vehicleId, authHeaders]);

  useEffect(() => { carregarOrdens(); }, [carregarOrdens]);

  const submeter = (e) => {
    e.preventDefault();
    if (!String(form.prefix).trim()) { setToast?.("Informe o prefixo do veículo."); return; }
    onSave(form);
  };

  const criarOrdem = async () => {
    if (!novaOrdem.trim()) return;
    try {
      await fleetApi(`/${vehicleId}/maintenance`, authHeaders, { method: "POST", body: JSON.stringify({ title: novaOrdem }) });
      setNovaOrdem("");
      await carregarOrdens();
    } catch (reason) { setToast?.(reason.message); }
  };

  const mudarOrdem = async (ordem, status) => {
    try {
      await fleetApi(`/${vehicleId}/maintenance/${ordem.id}`, authHeaders, {
        method: "PATCH", body: JSON.stringify({ status, revision: ordem.revision }),
      });
      await carregarOrdens();
    } catch (reason) { setToast?.(reason.message); }
  };

  return (
    <Modal title={editando ? `Veículo ${vehicle.prefix || vehicle.plate || ""}`.trim() : "Novo veículo"} onClose={onClose} wide>
      <form className="tdg-planner-form" onSubmit={submeter}>
        <div className="tdg-planner-grid3">
          <label>Prefixo<input autoFocus value={form.prefix} onChange={set("prefix")} maxLength={50} placeholder="TG-001" /></label>
          <label>Placa<input value={form.plate} onChange={set("plate")} maxLength={20} placeholder="ABC1D23" /></label>
          <label>Status
            <select value={form.status} onChange={set("status")}>
              {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="tdg-planner-grid3">
          <label>Classe
            <select value={form.vehicleClass} onChange={(e) => {
              const classe = e.target.value;
              const energias = vehicleClass(classe)?.energias || [];
              // Se a energia atual não cabe na nova classe, recua para a primeira válida.
              setForm((f) => ({ ...f, vehicleClass: classe, energyType: energias.includes(f.energyType) ? f.energyType : (energias[0] || f.energyType) }));
            }}>
              <option value="">— selecione —</option>
              {VEHICLE_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Energia
            <select value={form.energyType} onChange={set("energyType")}>
              {energiasDaClasse.map((en) => <option key={en} value={en}>{comRotulo(ENERGY_LABELS, en)}</option>)}
            </select>
          </label>
          <label>Unidade operacional<input value={form.operationalUnit} onChange={set("operationalUnit")} maxLength={120} /></label>
        </div>
        <div className="tdg-planner-grid3">
          <label>Fabricante<input value={form.manufacturer} onChange={set("manufacturer")} maxLength={100} /></label>
          <label>Modelo<input value={form.model} onChange={set("model")} maxLength={100} /></label>
          <label>Centro de custo<input value={form.costCenter} onChange={set("costCenter")} maxLength={120} /></label>
        </div>
        <div className="tdg-planner-grid3">
          <label>Capacidade (kg)<input type="number" min="0" value={form.payloadKg} onChange={set("payloadKg")} /></label>
          <label>Hodômetro (km)<input type="number" min="0" value={form.odometerKm} onChange={set("odometerKm")} /></label>
          <label>SOH bateria (%)<input type="number" min="0" max="100" value={form.batterySohPercent} onChange={set("batterySohPercent")} /></label>
        </div>
        <div className="tdg-planner-grid3">
          <label>Bateria (kWh)<input type="number" min="0" step="0.1" value={form.batteryCapacityKwh ?? ""} onChange={set("batteryCapacityKwh")} /></label>
          <label>Consumo nominal (kWh/km)<input type="number" min="0" step="0.01" value={form.energyConsumptionKwhPerKm ?? ""} onChange={set("energyConsumptionKwhPerKm")} /></label>
          <label>Autonomia nominal (km)<input type="number" min="0" value={form.nominalRangeKm ?? ""} onChange={set("nominalRangeKm")} /></label>
        </div>
        <fieldset className="df-perfil-fisico">
          <legend>Perfil físico e recarga — roteirização de pesados (Valhalla), pré-flight e smart charging</legend>
          <div className="tdg-planner-grid3">
            <label>Altura (m)<input type="number" min="0" step="0.01" value={form.heightM ?? ""} onChange={set("heightM")} /></label>
            <label>Largura (m)<input type="number" min="0" step="0.01" value={form.widthM ?? ""} onChange={set("widthM")} /></label>
            <label>Comprimento (m)<input type="number" min="0" step="0.01" value={form.lengthM ?? ""} onChange={set("lengthM")} /></label>
          </div>
          <div className="tdg-planner-grid3">
            <label>Tara (kg)<input type="number" min="0" value={form.tareKg ?? ""} onChange={set("tareKg")} /></label>
            <label>PBT (kg)<input type="number" min="0" value={form.grossWeightKg ?? ""} onChange={set("grossWeightKg")} /></label>
            <label>Eixos<input type="number" min="0" step="1" value={form.axles ?? ""} onChange={set("axles")} /></label>
          </div>
          <div className="tdg-planner-grid3">
            <label>Conector
              <select value={form.connectorType || ""} onChange={set("connectorType")}>
                <option value="">—</option>
                <option value="CCS2">CCS2</option>
                <option value="CHADEMO">CHAdeMO</option>
                <option value="TYPE2">Tipo 2 (AC)</option>
                <option value="GBT">GB/T</option>
                <option value="MCS">MCS</option>
              </select>
            </label>
            <label>Potência máx. de recarga (kW)<input type="number" min="0" value={form.maxChargingPowerKw ?? ""} onChange={set("maxChargingPowerKw")} /></label>
            <label>Consumo de referência (kWh/km)<input type="number" min="0" step="0.01" value={form.referenceConsumptionKwhKm ?? ""} onChange={set("referenceConsumptionKwhKm")} /></label>
          </div>
        </fieldset>

        {editando && (
          <div className="tdg-planner-checklist">
            <div className="tdg-section-head">
              <h3><Wrench size={15} /> Ordens de manutenção</h3>
            </div>
            {orders.length === 0 && <p className="tdg-planner-col-empty">Nenhuma ordem registrada.</p>}
            {orders.map((o) => (
              <div className="df-maint-row" key={o.id}>
                <span><strong>{o.title}</strong><small>{comRotulo(MAINT_STATUS, o.status)}</small></span>
                {o.status !== "done" && o.status !== "canceled" && (
                  <button type="button" className="tdg-planner-icon" title="Concluir" onClick={() => mudarOrdem(o, "done")}>✓</button>
                )}
              </div>
            ))}
            <div className="df-maint-add">
              <input value={novaOrdem} onChange={(e) => setNovaOrdem(e.target.value)} placeholder="+ Nova ordem de manutenção" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criarOrdem(); } }} maxLength={200} />
            </div>
          </div>
        )}

        <div className="tdg-form-actions tdg-planner-taskactions">
          {editando && (
            <button type="button" className="tdg-planner-danger" onClick={() => onArchive(vehicle)}>
              <Trash2 size={15} /> Arquivar
            </button>
          )}
          <span className="tdg-planner-spacer" />
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="tdg-action">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
