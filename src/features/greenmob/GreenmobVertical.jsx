import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Car,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  ListChecks,
  Plus,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  MetricCard,
  PageHeader,
} from "../../design-system/index.js";
import VerticalSwitcher from "../verticals/VerticalSwitcher.jsx";
import {
  GREENMOB_CLIENT_TYPES,
  GREENMOB_LOSS_REASONS,
  GREENMOB_PIPELINE_STAGES,
  createGreenmobLead,
  isOpen,
  leadAlerts,
  pipelineSummary,
  stageById,
  stageMetrics,
  weightedMonthlyRevenue,
} from "./greenmobCrmDomain.js";
import {
  CONTRACT_STATUS,
  VEHICLE_STATUS,
  createRentalContract,
  createRentalVehicle,
  excessKmCharge,
  fleetStatusSummary,
  monthlyRecurringRevenue,
  registerReturn,
} from "./greenmobRentalDomain.js";
import "./greenmob.css";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const NAV_TABS = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard },
  { id: "crm", label: "CRM Greenmob", icon: Users },
  { id: "pipeline", label: "Funil", icon: ClipboardList },
  { id: "frota", label: "Frota", icon: Car },
  { id: "contratos", label: "Contratos", icon: FileCheck2 },
];

const VEHICLE_STATUS_LABEL = {
  disponivel: "Disponível",
  reservado: "Reservado",
  "em-preparacao": "Em preparação",
  locado: "Locado",
  manutencao: "Manutenção",
  avaria: "Avaria",
  inativo: "Inativo",
};

const CONTRACT_STATUS_LABEL = {
  rascunho: "Rascunho",
  assinado: "Assinado",
  reservado: "Reservado",
  entregue: "Entregue",
  ativo: "Ativo",
  renovado: "Renovado",
  devolvido: "Devolvido",
  cancelado: "Cancelado",
};

function readGreenmob(db) {
  const raw = db?.greenmob || {};
  return {
    leads: Array.isArray(raw.leads) ? raw.leads : [],
    vehicles: Array.isArray(raw.vehicles) ? raw.vehicles : [],
    contracts: Array.isArray(raw.contracts) ? raw.contracts : [],
  };
}

function writeGreenmob(update, mutator) {
  update((current) => {
    const previous = readGreenmob(current);
    const next = mutator(previous) || previous;
    return { ...current, greenmob: next };
  });
}

function AtalhoVoltar() {
  return (
    <a href="/todogreen" className="greenmob-back" aria-label="Voltar ao ambiente To Do Green">
      <ArrowLeft size={16} aria-hidden="true" />
      <span>Voltar ao ERP</span>
    </a>
  );
}

function DashboardPanel({ data }) {
  const funil = useMemo(() => pipelineSummary(data.leads), [data.leads]);
  const status = useMemo(
    () => fleetStatusSummary(data.vehicles, data.contracts),
    [data.vehicles, data.contracts],
  );
  const mrr = useMemo(() => monthlyRecurringRevenue(data.contracts), [data.contracts]);
  return (
    <div className="greenmob-grid">
      <MetricCard label="Leads abertos" value={number.format(funil.open)} icon={Users} hint={`${funil.ativos} contratos ativos`} />
      <MetricCard label="MRR (mensalidades ativas)" value={BRL.format(mrr)} icon={FileCheck2} hint={`${status.locados} veículos em locação`} />
      <MetricCard label="Frota total" value={number.format(status.total)} icon={Car} hint={`${status.disponiveis} disponíveis`} />
      <MetricCard label="Ocupação" value={`${status.ocupacaoPercent}%`} icon={LayoutDashboard} hint={`${status.reservados} reservados`} />
      <MetricCard label="Manutenção / avaria" value={number.format(status.manutencao + status.avaria)} icon={Wrench} hint={`${status.manutencao} manutenção · ${status.avaria} avaria`} />
      <MetricCard label="Forecast MRR (funil)" value={BRL.format(funil.forecastMonthlyRevenue)} icon={ClipboardList} hint={`Contratos ponderados: ${BRL.format(funil.forecastContractValue)}`} />
    </div>
  );
}

function PipelineBoard({ data }) {
  const metricas = useMemo(() => stageMetrics(data.leads), [data.leads]);
  const abertos = useMemo(() => data.leads.filter(isOpen), [data.leads]);
  return (
    <div className="greenmob-pipeline">
      <div className="greenmob-stages">
        {metricas.map((etapa) => (
          <div key={etapa.id} className="greenmob-stage">
            <div className="greenmob-stage-title">{etapa.name}</div>
            <div className="greenmob-stage-count">{etapa.total}</div>
            <div className="greenmob-stage-hint">
              Frota {etapa.frota} · MRR ponderado {BRL.format(etapa.mrr)}
            </div>
          </div>
        ))}
      </div>
      <Card title="Leads em curso" kicker={`${abertos.length} abertos`}>
        {abertos.length === 0 && (
          <p className="greenmob-empty">Sem leads em aberto no funil de locação.</p>
        )}
        {abertos.length > 0 && (
          <ul className="greenmob-list">
            {abertos.map((lead) => {
              const stage = stageById(lead.stageId);
              const alertas = leadAlerts(lead);
              return (
                <li key={lead.id}>
                  <div className="greenmob-list-title">
                    <strong>{lead.clientName || "Lead sem nome"}</strong>
                    <Badge>{stage?.name || lead.stageId}</Badge>
                  </div>
                  <div className="greenmob-list-meta">
                    {lead.fleetSize || 0} veículos ·{" "}
                    {BRL.format(lead.proposedMonthlyBRL || 0)}/mês ·{" "}
                    Ponderado {BRL.format(weightedMonthlyRevenue(lead))}/mês
                  </div>
                  {alertas.length > 0 && (
                    <div className="greenmob-list-alerts" role="status">
                      {alertas.map((a) => (
                        <span key={a}>{a}</span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

const NEW_LEAD = () => ({
  clientName: "",
  clientType: "PJ - Empresa",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  city: "",
  state: "",
  fleetSize: "",
  expectedMonthlyKm: "",
  desiredTermMonths: "",
  proposedMonthlyBRL: "",
  stageId: "lead",
  ownerId: "",
  expectedStart: "",
  notes: "",
  lossReason: "",
});

function CrmPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_LEAD());
  const [saving, setSaving] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (!form.clientName.trim()) {
      setToast?.("Informe o nome do cliente antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      const novo = createGreenmobLead(form);
      writeGreenmob(update, (current) => ({
        ...current,
        leads: [...current.leads, novo],
      }));
      setForm(NEW_LEAD());
      setToast?.("Lead Greenmob registrado.");
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível salvar o lead.");
    } finally {
      setSaving(false);
    }
  };

  const mudarEtapa = (lead, stageId) => {
    writeGreenmob(update, (current) => ({
      ...current,
      leads: current.leads.map((item) =>
        item.id === lead.id ? { ...item, stageId, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  const remover = (lead) => {
    writeGreenmob(update, (current) => ({
      ...current,
      leads: current.leads.filter((item) => item.id !== lead.id),
    }));
    setToast?.("Lead removido.");
  };

  return (
    <div className="greenmob-crm">
      <Card title="Novo lead" kicker="Pipeline Greenmob (locação)">
        <form className="greenmob-form" onSubmit={submit}>
          <label>
            Cliente
            <input
              type="text"
              value={form.clientName}
              onChange={(event) => setForm({ ...form, clientName: event.target.value })}
            />
          </label>
          <label>
            Tipo de cliente
            <select
              value={form.clientType}
              onChange={(event) => setForm({ ...form, clientType: event.target.value })}
            >
              {GREENMOB_CLIENT_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
            </select>
          </label>
          <label>
            Contato (nome)
            <input
              type="text"
              value={form.contactName}
              onChange={(event) => setForm({ ...form, contactName: event.target.value })}
            />
          </label>
          <label>
            Contato (e-mail)
            <input
              type="email"
              value={form.contactEmail}
              onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
            />
          </label>
          <label>
            Cidade
            <input
              type="text"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
          </label>
          <label>
            UF
            <input
              type="text"
              maxLength="2"
              value={form.state}
              onChange={(event) => setForm({ ...form, state: event.target.value })}
            />
          </label>
          <label>
            Frota desejada (veículos)
            <input
              type="number"
              min="0"
              value={form.fleetSize}
              onChange={(event) => setForm({ ...form, fleetSize: event.target.value })}
            />
          </label>
          <label>
            Uso previsto (km/mês)
            <input
              type="number"
              min="0"
              value={form.expectedMonthlyKm}
              onChange={(event) => setForm({ ...form, expectedMonthlyKm: event.target.value })}
            />
          </label>
          <label>
            Prazo do contrato (meses)
            <input
              type="number"
              min="0"
              value={form.desiredTermMonths}
              onChange={(event) => setForm({ ...form, desiredTermMonths: event.target.value })}
            />
          </label>
          <label>
            Mensalidade proposta por veículo (R$)
            <input
              type="number"
              min="0"
              value={form.proposedMonthlyBRL}
              onChange={(event) => setForm({ ...form, proposedMonthlyBRL: event.target.value })}
            />
          </label>
          <label>
            Etapa do funil
            <select
              value={form.stageId}
              onChange={(event) => setForm({ ...form, stageId: event.target.value })}
            >
              {GREENMOB_PIPELINE_STAGES.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.name}</option>
              ))}
            </select>
          </label>
          <label>
            Previsão de início
            <input
              type="date"
              value={form.expectedStart}
              onChange={(event) => setForm({ ...form, expectedStart: event.target.value })}
            />
          </label>
          <label className="greenmob-form-full">
            Observações
            <textarea
              rows="2"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          <div className="greenmob-form-actions">
            <Button type="submit" icon={Plus} loading={saving}>Salvar lead</Button>
          </div>
        </form>
      </Card>

      <Card title="Leads registrados" kicker={`${data.leads.length} no total`}>
        {data.leads.length === 0 && (
          <p className="greenmob-empty">Nenhum lead cadastrado ainda.</p>
        )}
        {data.leads.length > 0 && (
          <table className="greenmob-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Frota</th>
                <th>Mensal/veículo</th>
                <th>Etapa</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {data.leads.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.clientName || "—"}</td>
                  <td>{lead.clientType}</td>
                  <td>{lead.fleetSize || 0}</td>
                  <td>{BRL.format(lead.proposedMonthlyBRL || 0)}</td>
                  <td>
                    <select
                      value={lead.stageId}
                      onChange={(event) => mudarEtapa(lead, event.target.value)}
                    >
                      {GREENMOB_PIPELINE_STAGES.map((stage) => (
                        <option key={stage.id} value={stage.id}>{stage.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => remover(lead)}
                      aria-label={`Remover lead ${lead.clientName || "cliente"}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.leads.some((l) => l.lossReason) && (
          <p className="greenmob-help">
            Motivos de perda registrados aparecem no relatório do funil. Padrões:{" "}
            {GREENMOB_LOSS_REASONS.join(", ")}.
          </p>
        )}
      </Card>
    </div>
  );
}

const NEW_VEHICLE = () => ({
  plate: "",
  brand: "",
  model: "",
  year: "",
  color: "",
  status: "disponivel",
  batteryCapacityKwh: "",
  rangeKm: "",
  odometerKm: "",
  monthlyBaselineBRL: "",
});

function FleetPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_VEHICLE());
  const status = useMemo(
    () => fleetStatusSummary(data.vehicles, data.contracts),
    [data.vehicles, data.contracts],
  );

  const submit = (event) => {
    event.preventDefault();
    if (!form.plate.trim()) {
      setToast?.("Placa é obrigatória.");
      return;
    }
    const novo = createRentalVehicle(form);
    writeGreenmob(update, (current) => ({
      ...current,
      vehicles: [...current.vehicles, novo],
    }));
    setForm(NEW_VEHICLE());
    setToast?.("Veículo Greenmob cadastrado.");
  };

  const remover = (veiculo) => {
    writeGreenmob(update, (current) => ({
      ...current,
      vehicles: current.vehicles.filter((item) => item.id !== veiculo.id),
    }));
    setToast?.("Veículo removido.");
  };

  const trocarStatus = (veiculo, novoStatus) => {
    writeGreenmob(update, (current) => ({
      ...current,
      vehicles: current.vehicles.map((item) =>
        item.id === veiculo.id ? { ...item, status: novoStatus, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  return (
    <div className="greenmob-fleet">
      <div className="greenmob-grid">
        <MetricCard label="Disponíveis" value={number.format(status.disponiveis)} icon={Car} />
        <MetricCard label="Locados" value={number.format(status.locados)} icon={FileCheck2} />
        <MetricCard label="Reservados" value={number.format(status.reservados)} icon={ClipboardList} />
        <MetricCard label="Manutenção/Avaria" value={number.format(status.manutencao + status.avaria)} icon={Wrench} />
      </div>

      <Card title="Novo veículo" kicker="Cadastro da frota">
        <form className="greenmob-form" onSubmit={submit}>
          <label>
            Placa
            <input
              type="text"
              value={form.plate}
              onChange={(event) => setForm({ ...form, plate: event.target.value })}
            />
          </label>
          <label>
            Marca
            <input
              type="text"
              value={form.brand}
              onChange={(event) => setForm({ ...form, brand: event.target.value })}
            />
          </label>
          <label>
            Modelo
            <input
              type="text"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
            />
          </label>
          <label>
            Ano
            <input
              type="number"
              min="0"
              value={form.year}
              onChange={(event) => setForm({ ...form, year: event.target.value })}
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {VEHICLE_STATUS.map((s) => (
                <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s] || s}</option>
              ))}
            </select>
          </label>
          <label>
            Bateria (kWh)
            <input
              type="number"
              min="0"
              value={form.batteryCapacityKwh}
              onChange={(event) => setForm({ ...form, batteryCapacityKwh: event.target.value })}
            />
          </label>
          <label>
            Autonomia (km)
            <input
              type="number"
              min="0"
              value={form.rangeKm}
              onChange={(event) => setForm({ ...form, rangeKm: event.target.value })}
            />
          </label>
          <label>
            Odômetro (km)
            <input
              type="number"
              min="0"
              value={form.odometerKm}
              onChange={(event) => setForm({ ...form, odometerKm: event.target.value })}
            />
          </label>
          <label>
            Mensalidade base sugerida (R$)
            <input
              type="number"
              min="0"
              value={form.monthlyBaselineBRL}
              onChange={(event) => setForm({ ...form, monthlyBaselineBRL: event.target.value })}
            />
          </label>
          <div className="greenmob-form-actions">
            <Button type="submit" icon={Plus}>Cadastrar veículo</Button>
          </div>
        </form>
      </Card>

      <Card title="Frota cadastrada" kicker={`${data.vehicles.length} veículos`}>
        {data.vehicles.length === 0 && (
          <p className="greenmob-empty">Nenhum veículo cadastrado.</p>
        )}
        {data.vehicles.length > 0 && (
          <table className="greenmob-table">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Modelo</th>
                <th>Status</th>
                <th>Autonomia</th>
                <th>Odômetro</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {data.vehicles.map((veiculo) => (
                <tr key={veiculo.id}>
                  <td>{veiculo.plate}</td>
                  <td>{[veiculo.brand, veiculo.model].filter(Boolean).join(" ") || "—"}</td>
                  <td>
                    <select
                      value={veiculo.status}
                      onChange={(event) => trocarStatus(veiculo, event.target.value)}
                    >
                      {VEHICLE_STATUS.map((s) => (
                        <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s] || s}</option>
                      ))}
                    </select>
                  </td>
                  <td>{veiculo.rangeKm ? `${number.format(veiculo.rangeKm)} km` : "—"}</td>
                  <td>{veiculo.odometerKm ? `${number.format(veiculo.odometerKm)} km` : "—"}</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => remover(veiculo)}
                      aria-label={`Remover ${veiculo.plate}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const NEW_CONTRACT = () => ({
  number: "",
  clientName: "",
  clientDocument: "",
  vehicleId: "",
  status: "rascunho",
  startDate: "",
  endDate: "",
  monthlyBRL: "",
  monthlyKmAllowance: "",
  excessKmPriceBRL: "",
  handoverOdometerKm: "",
  depositBRL: "",
  notes: "",
});

function ContractsPanel({ data, update, setToast }) {
  const [form, setForm] = useState(NEW_CONTRACT());
  const [odometroDevolucao, setOdometroDevolucao] = useState({});

  const submit = (event) => {
    event.preventDefault();
    if (!form.clientName.trim()) {
      setToast?.("Informe o cliente do contrato.");
      return;
    }
    const novo = createRentalContract({
      ...form,
      handoverOdometerKm: form.handoverOdometerKm === "" ? null : form.handoverOdometerKm,
    });
    writeGreenmob(update, (current) => ({
      ...current,
      contracts: [...current.contracts, novo],
    }));
    setForm(NEW_CONTRACT());
    setToast?.("Contrato salvo.");
  };

  const mudarStatus = (contrato, novoStatus) => {
    writeGreenmob(update, (current) => ({
      ...current,
      contracts: current.contracts.map((item) =>
        item.id === contrato.id ? { ...item, status: novoStatus, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  };

  const devolver = (contrato) => {
    const leitura = odometroDevolucao[contrato.id];
    const atualizado = registerReturn(contrato, {
      returnOdometerKm: leitura === "" || leitura === undefined ? contrato.handoverOdometerKm : leitura,
      source: "manual",
    });
    writeGreenmob(update, (current) => ({
      ...current,
      contracts: current.contracts.map((item) =>
        item.id === contrato.id ? atualizado : item,
      ),
    }));
    setToast?.("Contrato marcado como devolvido.");
  };

  const remover = (contrato) => {
    writeGreenmob(update, (current) => ({
      ...current,
      contracts: current.contracts.filter((item) => item.id !== contrato.id),
    }));
    setToast?.("Contrato removido.");
  };

  return (
    <div className="greenmob-contracts">
      <Card title="Novo contrato" kicker="Locação de veículos">
        <form className="greenmob-form" onSubmit={submit}>
          <label>
            Número/Referência
            <input
              type="text"
              value={form.number}
              onChange={(event) => setForm({ ...form, number: event.target.value })}
            />
          </label>
          <label>
            Cliente
            <input
              type="text"
              value={form.clientName}
              onChange={(event) => setForm({ ...form, clientName: event.target.value })}
            />
          </label>
          <label>
            CNPJ/CPF
            <input
              type="text"
              value={form.clientDocument}
              onChange={(event) => setForm({ ...form, clientDocument: event.target.value })}
            />
          </label>
          <label>
            Veículo (placa)
            <select
              value={form.vehicleId}
              onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}
            >
              <option value="">Selecione...</option>
              {data.vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.plate} — {[v.brand, v.model].filter(Boolean).join(" ")}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {CONTRACT_STATUS.map((s) => (
                <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s] || s}</option>
              ))}
            </select>
          </label>
          <label>
            Início
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
            />
          </label>
          <label>
            Término previsto
            <input
              type="date"
              value={form.endDate}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
            />
          </label>
          <label>
            Mensalidade (R$)
            <input
              type="number"
              min="0"
              value={form.monthlyBRL}
              onChange={(event) => setForm({ ...form, monthlyBRL: event.target.value })}
            />
          </label>
          <label>
            Franquia mensal (km)
            <input
              type="number"
              min="0"
              value={form.monthlyKmAllowance}
              onChange={(event) => setForm({ ...form, monthlyKmAllowance: event.target.value })}
            />
          </label>
          <label>
            Preço km excedente (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.excessKmPriceBRL}
              onChange={(event) => setForm({ ...form, excessKmPriceBRL: event.target.value })}
            />
          </label>
          <label>
            Odômetro na entrega (km)
            <input
              type="number"
              min="0"
              value={form.handoverOdometerKm}
              onChange={(event) => setForm({ ...form, handoverOdometerKm: event.target.value })}
            />
          </label>
          <label>
            Caução (R$)
            <input
              type="number"
              min="0"
              value={form.depositBRL}
              onChange={(event) => setForm({ ...form, depositBRL: event.target.value })}
            />
          </label>
          <label className="greenmob-form-full">
            Observações
            <textarea
              rows="2"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          <div className="greenmob-form-actions">
            <Button type="submit" icon={Plus}>Salvar contrato</Button>
          </div>
        </form>
      </Card>

      <Card title="Contratos" kicker={`${data.contracts.length} no total`}>
        {data.contracts.length === 0 && (
          <p className="greenmob-empty">Nenhum contrato cadastrado.</p>
        )}
        {data.contracts.length > 0 && (
          <table className="greenmob-table greenmob-table--wide">
            <thead>
              <tr>
                <th>Referência</th>
                <th>Cliente</th>
                <th>Veículo</th>
                <th>Status</th>
                <th>Mensal / Franquia</th>
                <th>Excedente</th>
                <th aria-label="ações" />
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((contrato) => {
                const veiculo = data.vehicles.find((v) => v.id === contrato.vehicleId);
                const leituraAtual = veiculo?.odometerKm ?? null;
                const excesso = excessKmCharge(contrato, leituraAtual);
                return (
                  <tr key={contrato.id}>
                    <td>{contrato.number || "—"}<br /><small>{contrato.startDate || "sem início"}</small></td>
                    <td>{contrato.clientName}</td>
                    <td>{veiculo ? veiculo.plate : "—"}</td>
                    <td>
                      <select
                        value={contrato.status}
                        onChange={(event) => mudarStatus(contrato, event.target.value)}
                      >
                        {CONTRACT_STATUS.map((s) => (
                          <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s] || s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {BRL.format(contrato.monthlyBRL || 0)}
                      <br />
                      <small>{contrato.monthlyKmAllowance || 0} km/mês</small>
                    </td>
                    <td>
                      {excesso.chargeBRL === null ? (
                        <span className="greenmob-note-warn">{excesso.reason}</span>
                      ) : (
                        <>
                          {BRL.format(excesso.chargeBRL)}<br />
                          <small>{excesso.excessKm} km — {excesso.reason}</small>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="greenmob-return">
                        <input
                          type="number"
                          min="0"
                          placeholder="Odômetro devolução"
                          value={odometroDevolucao[contrato.id] ?? ""}
                          onChange={(event) => setOdometroDevolucao((prev) => ({ ...prev, [contrato.id]: event.target.value }))}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => devolver(contrato)}
                          disabled={contrato.status === "devolvido"}
                        >
                          Registrar devolução
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          onClick={() => remover(contrato)}
                          aria-label={`Remover contrato ${contrato.number || contrato.clientName}`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export default function GreenmobVertical({ db, update, setToast }) {
  const [tab, setTab] = useState("dashboard");
  const data = useMemo(() => readGreenmob(db), [db]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Greenmob | Locação de veículos elétricos";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="greenmob-shell">
      <PageHeader
        kicker="Greenmob"
        title="Locação de veículos elétricos"
        subtitle="CRM próprio, frota, contratos e devolução — a experiência da locação sem confundir com o CRM logístico."
        actions={<AtalhoVoltar />}
      />
      <nav className="greenmob-tabs" aria-label="Áreas da vertical Greenmob">
        {NAV_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`greenmob-tab ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <section className="greenmob-content">
        {tab === "dashboard" && (
          <>
            <DashboardPanel data={data} />
            <Card title="Verticais da plataforma" kicker="Compartilham a mesma base de usuários, clientes e ativos">
              <VerticalSwitcher current="greenmob" />
            </Card>
          </>
        )}
        {tab === "crm" && <CrmPanel data={data} update={update} setToast={setToast} />}
        {tab === "pipeline" && <PipelineBoard data={data} />}
        {tab === "frota" && <FleetPanel data={data} update={update} setToast={setToast} />}
        {tab === "contratos" && <ContractsPanel data={data} update={update} setToast={setToast} />}
      </section>
      <footer className="greenmob-foot">
        <ListChecks size={14} aria-hidden="true" />
        <span>
          Dados de leads, frota e contratos da Greenmob ficam no espaço de
          trabalho. Um veículo Greenmob pode operar na To Do Green — evitar
          duplicar cadastro depende do ID do veículo compartilhado.
        </span>
      </footer>
    </div>
  );
}
