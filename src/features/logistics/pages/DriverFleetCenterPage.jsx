import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  Clock3,
  Gauge,
  MapPin,
  RefreshCw,
  Route,
  ShieldCheck,
  Truck,
  UserRoundCheck,
} from "lucide-react";
import { fleetAlerts, fleetVehicleMetrics, summarizeFleet } from "../todoGreenFleetDomain.js";
import "./TodoGreenPages.css";

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
    const current = grouped.get(driver) || {
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
    grouped.set(driver, current);
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

function FleetCard({ vehicle, operations }) {
  const metrics = fleetVehicleMetrics(vehicle);
  const alerts = fleetAlerts(vehicle);
  const fields = vehicle.fields || {};
  const latest = latestOperationForVehicle(operations, vehicle);
  return (
    <article className={`df-fleet-card ${alerts.length ? "risk" : ""}`}>
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
        <small>Margem acumulada {BRL.format(metrics.margin)}</small>
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
  const [operationsFromApi, setOperationsFromApi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
      const [payload, loadedOperations] = await Promise.all([
        requestFleet(authHeaders),
        providedOperations ? Promise.resolve(providedOperations) : requestOperations(authHeaders),
      ]);
      setFleet(payload.vehicles || []);
      if (!providedOperations) setOperationsFromApi(loadedOperations || []);
    } catch (reason) {
      setError(reason.message);
      setToast?.(reason.message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, providedOperations, setToast]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => summarizeFleet(fleet), [fleet]);
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
          <button type="button" onClick={() => go("/todogreen/frota")}>Abrir frota</button>
        </article>
        <article>
          <ShieldCheck size={20} />
          <span><strong>Rastreamento Tracker</strong><small>Conecte posições, eventos e última leitura quando a credencial estiver ativa.</small></span>
          <button type="button" onClick={() => go("/todogreen/rastreamento")}>Abrir Tracker</button>
        </article>
      </section>

      <div className="df-layout">
        <section>
          <header className="df-section-head"><div><Clock3 size={18} /><span><strong>{isPortal ? "Minha operação" : "Gestão do motorista"}</strong><small>Visão por pessoa, rota ativa e risco de atraso.</small></span></div></header>
          <div className="df-driver-list">
            {drivers.length ? drivers.map((row) => <DriverCard key={row.driver} row={row} />) : <p className="tdg-empty-access">Nenhum motorista vinculado a operações ainda.</p>}
          </div>
        </section>

        <section>
          <header className="df-section-head"><div><Gauge size={18} /><span><strong>{isPortal ? "Veículo e telemetria" : "Gestão da frota"}</strong><small>Veículo, telemetria, bateria, custo e alertas.</small></span></div></header>
          <div className="df-fleet-list">
            {fleet.length ? fleet.map((vehicle) => <FleetCard key={vehicle.id} vehicle={vehicle} operations={operations} />) : <p className="tdg-empty-access">Nenhum veículo cadastrado na frota.</p>}
          </div>
        </section>
      </div>

      <section className="df-readiness">
        <header><AlertTriangle size={18} /><strong>O que ainda depende de integração real</strong></header>
        <div>
          <span><MapPin size={15} /> Localização em tempo real, trajeto, velocidade, deslocamento/parada e cerca virtual dependem do Tracker enviar esses eventos.</span>
          <span><Truck size={15} /> Bloqueio remoto, RFID, horímetro e voltagem exigem suporte do hardware/API contratada.</span>
          <span><UserRoundCheck size={15} /> Jornada do motorista fica operacional com check-in/check-out e app dedicado numa próxima etapa.</span>
        </div>
      </section>
    </section>
  );
}
