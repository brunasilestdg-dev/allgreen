import { useMemo, useState } from "react";
import { BatteryCharging, Sun, Waves } from "lucide-react";
import {
  peakShavingSummary,
  energyMixKwh,
  renewableShareBess,
  bestBessChargeWindow,
  bessCycleCount,
  chargingLoss,
} from "../energyBessSolarDomain.js";
import "./TodoGreenPages.css";

// Energia: BESS + solar + peak shaving (bloco 15). Aprofunda o módulo de
// energia existente com corte de pico contra a demanda contratada, mix por
// fonte, fração renovável e perda tomada→bateria. Sem dado, a tela mostra
// null em vez de zero — zero é diferente de "sem medição".

const numeroKwh = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const numeroKw = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const janelasVazias = [
  { kwGrid: 0, kwSolar: 0, kwBess: 0 },
  { kwGrid: 0, kwSolar: 0, kwBess: 0 },
];

export default function EnergyPeakSavingsPage() {
  const [teto, setTeto] = useState("100");
  const [janelas, setJanelas] = useState(janelasVazias);
  const [mix, setMix] = useState({ redeKwh: "60", solarKwh: "25", bessKwh: "15", outraKwh: "0" });
  const [bessLimpoPct, setBessLimpoPct] = useState("100");
  const [capBess, setCapBess] = useState("");
  const [perda, setPerda] = useState({ entregueTomadaKwh: "40", carregadoBateriaKwh: "36" });

  const shaving = useMemo(() => peakShavingSummary(janelas, Number(teto) || 0), [janelas, teto]);
  const mixCalc = useMemo(
    () => energyMixKwh({
      redeKwh: Number(mix.redeKwh) || 0,
      solarKwh: Number(mix.solarKwh) || 0,
      bessKwh: Number(mix.bessKwh) || 0,
      outraKwh: Number(mix.outraKwh) || 0,
    }),
    [mix],
  );
  const renovavel = useMemo(() => renewableShareBess(mixCalc, Number(bessLimpoPct) || 0), [mixCalc, bessLimpoPct]);
  const melhorJanela = useMemo(
    () => bestBessChargeWindow([
      { horaInicio: 0, tarifaReais: 0.35 },
      { horaInicio: 2, tarifaReais: 0.30 },
      { horaInicio: 18, tarifaReais: 1.20 },
    ], 4),
    [],
  );
  const ciclos = useMemo(() => bessCycleCount([], Number(capBess) || 0), [capBess]);
  const perdaCalc = useMemo(
    () => chargingLoss({
      entregueTomadaKwh: Number(perda.entregueTomadaKwh) || 0,
      carregadoBateriaKwh: Number(perda.carregadoBateriaKwh) || 0,
    }),
    [perda],
  );

  const atualizarJanela = (i, campo, valor) => {
    const copia = janelas.slice();
    copia[i] = { ...copia[i], [campo]: Number(valor) || 0 };
    setJanelas(copia);
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>ENERGIA · BESS E SOLAR</span>
          <h2>Peak shaving, mix e perda</h2>
          <p>Corte de pico contra a demanda contratada, participação de cada fonte, fração renovável ajustada pela origem do BESS e perda entre tomada e bateria. Ausência de dado devolve travessão — não invento 0.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Waves size={20} /></span><div><strong>Peak shaving</strong><small>{shaving.ultrapassagens} ultrapassagem(ns) nas {shaving.janelas} janela(s)</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Demanda contratada (kW)</span><input type="number" min="0" step="0.1" value={teto} onChange={(e) => setTeto(e.target.value)} /></label>
          {janelas.map((j, i) => (
            <div key={i} style={{ display: "contents" }}>
              <label><span>Janela {i + 1} · Rede kW</span><input type="number" min="0" step="0.1" value={j.kwGrid} onChange={(e) => atualizarJanela(i, "kwGrid", e.target.value)} /></label>
              <label><span>Janela {i + 1} · Solar kW</span><input type="number" min="0" step="0.1" value={j.kwSolar} onChange={(e) => atualizarJanela(i, "kwSolar", e.target.value)} /></label>
              <label><span>Janela {i + 1} · BESS kW</span><input type="number" min="0" step="0.1" value={j.kwBess} onChange={(e) => atualizarJanela(i, "kwBess", e.target.value)} /></label>
            </div>
          ))}
        </div>
        <div className="tdg-recarga-metrics">
          <article><small>Pico da rede</small><strong>{numeroKw.format(shaving.picoRedeKw)} kW</strong></article>
          <article><small>Pico local (rede+solar+BESS)</small><strong>{numeroKw.format(shaving.picoLocalKw)} kW</strong></article>
          <article><small>Excedente vs. teto</small><strong>{shaving.excedenteRedeKw == null ? "—" : `${numeroKw.format(shaving.excedenteRedeKw)} kW`}</strong></article>
          <article><small>Alívio BESS+solar</small><strong>{numeroKwh.format(shaving.alivioBessSolarKwh)} kWh</strong></article>
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Sun size={20} /></span><div><strong>Mix de energia entregue</strong><small>{mixCalc.totalKwh > 0 ? `${numeroKwh.format(mixCalc.totalKwh)} kWh` : "sem medição"}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Rede (kWh)</span><input type="number" min="0" value={mix.redeKwh} onChange={(e) => setMix({ ...mix, redeKwh: e.target.value })} /></label>
          <label><span>Solar (kWh)</span><input type="number" min="0" value={mix.solarKwh} onChange={(e) => setMix({ ...mix, solarKwh: e.target.value })} /></label>
          <label><span>BESS (kWh)</span><input type="number" min="0" value={mix.bessKwh} onChange={(e) => setMix({ ...mix, bessKwh: e.target.value })} /></label>
          <label><span>Outra (kWh)</span><input type="number" min="0" value={mix.outraKwh} onChange={(e) => setMix({ ...mix, outraKwh: e.target.value })} /></label>
          <label><span>BESS carregado por fonte limpa (%)</span><input type="number" min="0" max="100" value={bessLimpoPct} onChange={(e) => setBessLimpoPct(e.target.value)} /></label>
        </div>
        <div className="tdg-recarga-metrics">
          <article><small>Rede</small><strong>{mixCalc.redePct == null ? "—" : `${mixCalc.redePct}%`}</strong></article>
          <article><small>Solar</small><strong>{mixCalc.solarPct == null ? "—" : `${mixCalc.solarPct}%`}</strong></article>
          <article><small>BESS</small><strong>{mixCalc.bessPct == null ? "—" : `${mixCalc.bessPct}%`}</strong></article>
          <article><small>Renovável efetiva</small><strong>{renovavel == null ? "—" : `${renovavel}%`}</strong></article>
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><BatteryCharging size={20} /></span><div><strong>BESS: janela e perda</strong><small>{melhorJanela ? `carregar entre ${melhorJanela.horaInicio}h e ${melhorJanela.horaFim}h` : "sem tarifa configurada"}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Capacidade nominal (kWh)</span><input type="number" min="0" value={capBess} onChange={(e) => setCapBess(e.target.value)} placeholder="para contar ciclos" /></label>
          <label><span>Entregue na tomada (kWh)</span><input type="number" min="0" value={perda.entregueTomadaKwh} onChange={(e) => setPerda({ ...perda, entregueTomadaKwh: e.target.value })} /></label>
          <label><span>Aceito pela bateria (kWh)</span><input type="number" min="0" value={perda.carregadoBateriaKwh} onChange={(e) => setPerda({ ...perda, carregadoBateriaKwh: e.target.value })} /></label>
        </div>
        <div className="tdg-recarga-metrics">
          <article><small>Ciclos equivalentes</small><strong>{ciclos == null ? "—" : ciclos}</strong></article>
          <article><small>Perda tomada→bateria</small><strong>{perdaCalc == null ? "—" : `${numeroKwh.format(perdaCalc.perdaKwh)} kWh`}</strong></article>
          <article><small>Eficiência efetiva</small><strong>{perdaCalc == null ? "—" : `${perdaCalc.eficienciaPct}%`}</strong></article>
        </div>
      </article>
    </div>
  );
}
