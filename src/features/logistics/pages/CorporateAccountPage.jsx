import { useMemo, useState } from "react";
import { Receipt, Zap } from "lucide-react";
import {
  normalizarLimites,
  autorizarSessao,
  faturaConsolidada,
  custoPorKm,
} from "../corporateAccountDomain.js";
import "./TodoGreenPages.css";

// Green On B2B — conta corporativa (bloco 13). Limite por sessão/dia/mês por
// motorista/veículo, autorização antes de cobrar, fatura consolidada por
// período. Aqui a tela é o "simulador" da política: você digita a régua e as
// sessões, e ela mostra o que passaria e o que seria recusado — sem tocar em
// dado de produção.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const numeroKwh = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const inicioDoMes = () => `${new Date().toISOString().slice(0, 7)}-01`;
const hoje = () => new Date().toISOString().slice(0, 10);

const LIMITE_CAMPOS = [
  { key: "porSessaoKwh", rotulo: "Por sessão · kWh" },
  { key: "porSessaoReais", rotulo: "Por sessão · R$" },
  { key: "porDiaKwh", rotulo: "Por dia · kWh" },
  { key: "porDiaReais", rotulo: "Por dia · R$" },
  { key: "porMesKwh", rotulo: "Por mês · kWh" },
  { key: "porMesReais", rotulo: "Por mês · R$" },
];

export default function CorporateAccountPage() {
  const [limites, setLimites] = useState({});
  const [demanda, setDemanda] = useState({ kwh: "", reais: "" });
  const [sessoes] = useState([]);
  const [ciclo, setCiclo] = useState({ inicioYmd: inicioDoMes(), fimYmd: hoje() });
  const [kmCiclo, setKmCiclo] = useState("");

  const autorizacao = useMemo(
    () => autorizarSessao({ demanda: { kwh: Number(demanda.kwh) || 0, reais: Number(demanda.reais) || 0 }, limites: normalizarLimites(limites), sessoesAnteriores: sessoes, hojeYmd: hoje() }),
    [demanda, limites, sessoes],
  );
  const fatura = useMemo(() => faturaConsolidada(sessoes, ciclo), [sessoes, ciclo]);
  const cKm = useMemo(() => custoPorKm(fatura, Number(kmCiclo) || 0), [fatura, kmCiclo]);

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>GREEN ON · B2B</span>
          <h2>Conta corporativa</h2>
          <p>Empresa é a pagadora, motorista tem teto configurado por sessão/dia/mês (kWh e R$), fatura sai da soma das sessões medidas. A tela abaixo simula a régua: se o limite recusa, você vê antes de virar surpresa no fim do mês.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Zap size={20} /></span><div><strong>Régua de limites</strong><small>vazio = sem teto; 0 = proibido</small></div></div>
        <div className="tdg-recarga-form">
          {LIMITE_CAMPOS.map((c) => (
            <label key={c.key}><span>{c.rotulo}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={limites[c.key] ?? ""} onChange={(e) => setLimites({ ...limites, [c.key]: e.target.value })} placeholder="—" /></label>
          ))}
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Zap size={20} /></span><div><strong>Simular sessão</strong><small>{autorizacao.autorizada ? "Autorizada" : `Recusada · ${autorizacao.motivo}`}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>kWh pedidos</span><input type="number" min="0" step="0.01" inputMode="decimal" value={demanda.kwh} onChange={(e) => setDemanda({ ...demanda, kwh: e.target.value })} placeholder="ex.: 40" /></label>
          <label><span>R$ estimados</span><input type="number" min="0" step="0.01" inputMode="decimal" value={demanda.reais} onChange={(e) => setDemanda({ ...demanda, reais: e.target.value })} placeholder="ex.: 68.00" /></label>
        </div>
        <p className="tdg-driver-nota">{autorizacao.autorizada ? "A régua permite iniciar a recarga com estes parâmetros." : `A régua trava esta sessão pelo limite “${autorizacao.limiteQueBateu}”. Ajuste a régua ou os valores para autorizar.`}</p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Receipt size={20} /></span><div><strong>Fatura do ciclo</strong><small>{sessoes.length ? `${sessoes.length} sessões` : "sem sessões medidas ainda"}</small></div></div>
        <div className="tdg-recarga-filtros">
          <label>De <input type="date" value={ciclo.inicioYmd} onChange={(e) => setCiclo({ ...ciclo, inicioYmd: e.target.value })} /></label>
          <label>Até <input type="date" value={ciclo.fimYmd} onChange={(e) => setCiclo({ ...ciclo, fimYmd: e.target.value })} /></label>
          <label>Km rodados no ciclo <input type="number" min="0" step="1" value={kmCiclo} onChange={(e) => setKmCiclo(e.target.value)} placeholder="opcional" /></label>
        </div>
        <div className="tdg-recarga-metrics">
          <article><small>Total do ciclo</small><strong>{moeda.format(fatura.totalReais)}</strong></article>
          <article><small>Energia</small><strong>{numeroKwh.format(fatura.totalKwh)} kWh</strong></article>
          <article><small>Custo por km</small><strong>{cKm == null ? "—" : moeda.format(cKm)}</strong></article>
        </div>
        <p className="tdg-driver-nota">A fatura é DERIVADA das sessões medidas — nunca digitada. Quando houver sessão real de recarga corporativa, os totais aparecem aqui agrupados por veículo e motorista. Custo por km só é mostrado quando você informa o km rodado (sem denominador, não invento).</p>
      </article>
    </div>
  );
}
