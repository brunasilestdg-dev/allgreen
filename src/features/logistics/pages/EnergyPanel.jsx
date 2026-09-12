import { useEffect, useMemo, useState } from "react";
import { BatteryCharging, Gauge, Leaf, Loader2, Zap } from "lucide-react";
import { resumoEnergia } from "../energyDomain.js";
import "./TodoGreenPages.css";

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Painel de energia reaproveitável: puxa a frota e os pontos de recarga, e
// monta a visão com energyDomain. Usado na página própria (Energia) e embutido
// na Central ESG — um componente só, para as duas superfícies não divergirem.
export default function EnergyPanel({ authHeaders }) {
  const [fleet, setFleet] = useState([]);
  const [pontos, setPontos] = useState([]);
  const [estado, setEstado] = useState("carregando");

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch("/api/todogreen/fleet", { headers: authHeaders?.() || {} })
        .then((r) => (r.ok ? r.json() : { vehicles: [] }))
        .catch(() => ({ vehicles: [] })),
      fetch("/api/todogreen/records/pontosRecarga", { headers: authHeaders?.() || {} })
        .then((r) => (r.ok ? r.json() : { registros: [] }))
        .catch(() => ({ registros: [] })),
    ]).then(([f, p]) => {
      if (!vivo) return;
      setFleet(f.vehicles || []);
      setPontos(p.registros || []);
      setEstado("ok");
    });
    return () => { vivo = false; };
  }, [authHeaders]);

  const r = useMemo(() => resumoEnergia(fleet, pontos), [fleet, pontos]);

  if (estado === "carregando") {
    return (
      <section className="tdg-panel">
        <div className="tdg-esg-carregando"><Loader2 className="girando" size={20} /> Carregando energia da frota...</div>
      </section>
    );
  }

  return (
    <section className="tdg-panel tdg-energia">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">ENERGIA</span>
          <h2>Consumo, custo e capacidade de recarga</h2>
          <p>O consumo é estimado a partir do hodômetro e do consumo de cada veículo (km × kWh/km) — não é medição por sessão de recarga. A tarifa usada é a régua do motor ({numero.format(r.energyCostPerKwh)} R$/kWh).</p>
        </div>
        <Zap size={22} />
      </div>

      {!r.disponivel ? (
        <div className="tdg-empty-access"><Gauge size={18} />O consumo aparece quando a frota tiver hodômetro e consumo (kWh/km) cadastrados. A rede de recarga já conta {inteiro.format(r.rede.pontos)} ponto(s).</div>
      ) : (
        <>
          <div className="tdg-energia-metrics">
            <article><small>Energia estimada</small><strong>{numero.format(r.energiaKwh)} kWh</strong></article>
            <article><small>Custo estimado</small><strong>{moeda.format(r.custoEstimado)}</strong></article>
            <article><small>Emissões da operação</small><strong>{numero.format(r.emissoesKg / 1000)} t</strong></article>
            <article><small>Frota elétrica</small><strong>{inteiro.format(r.frota.eletricos)}/{inteiro.format(r.frota.total)}</strong></article>
          </div>

          <div className="tdg-energia-cols">
            <div className="tdg-energia-rede">
              <h3><BatteryCharging size={16} /> Rede de recarga própria</h3>
              <ul>
                <li><span>Pontos ativos</span><strong>{inteiro.format(r.rede.ativos)}/{inteiro.format(r.rede.pontos)}</strong></li>
                <li><span>Potência instalada</span><strong>{numero.format(r.rede.potenciaTotalKw)} kW</strong></li>
                <li><span>Servem pesado</span><strong>{inteiro.format(r.rede.servemPesado)}</strong></li>
              </ul>
            </div>

            {r.topConsumidores.length > 0 && (
              <div className="tdg-energia-top">
                <h3><Leaf size={16} /> Maiores consumidores</h3>
                <ul>
                  {r.topConsumidores.map((v) => (
                    <li key={v.id}>
                      <span>{v.prefixo || v.placa}</span>
                      <strong>{numero.format(v.energiaKwh)} kWh</strong>
                      <em>{moeda.format(v.custoEstimado)}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
