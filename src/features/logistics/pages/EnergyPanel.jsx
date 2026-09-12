import { useEffect, useMemo, useState } from "react";
import { BatteryCharging, Clock, Gauge, Leaf, Loader2, PiggyBank, Zap } from "lucide-react";
import { resumoEnergia } from "../energyDomain.js";
import { planoRecargaInteligente } from "../smartChargingDomain.js";
import "./TodoGreenPages.css";

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moeda2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COR_FAIXA = { "fora-ponta": "#1f7a44", intermediario: "#b8860b", ponta: "#c0392b" };
const ROTULO_FAIXA = { "fora-ponta": "Fora de ponta", intermediario: "Intermediário", ponta: "Ponta" };
const hh = (h) => `${String(h).padStart(2, "0")}h`;

// Curva tarifária de 24h em SVG inline (sem biblioteca). Cada barra é uma hora,
// colorida pela faixa; a altura é a tarifa relativa à mais cara.
function CurvaTarifaria({ curva }) {
  const maxT = curva.reduce((m, p) => Math.max(m, p.tarifa), 0) || 1;
  const L = 32; const T = 8; const H = 96; const passo = 15; const larg = 11;
  const W = L + curva.length * passo + 8;
  return (
    <svg className="tdg-tarifa-svg" viewBox={`0 0 ${W} ${H + 34}`} role="img" aria-label="Curva de tarifa por hora do dia">
      {[0, 0.5, 1].map((f) => {
        const y = T + H - f * H;
        return <line key={f} x1={L} y1={y} x2={W - 4} y2={y} stroke="#e3ece7" strokeWidth="1" />;
      })}
      {curva.map((p, i) => {
        const alt = Math.max(2, (p.tarifa / maxT) * H);
        const x = L + i * passo;
        return (
          <g key={p.hora}>
            <rect x={x} y={T + H - alt} width={larg} height={alt} rx="2" fill={COR_FAIXA[p.faixa]}>
              <title>{`${hh(p.hora)} · ${ROTULO_FAIXA[p.faixa]} · ${moeda2.format(p.tarifa)}/kWh`}</title>
            </rect>
            {p.hora % 6 === 0 && <text x={x + larg / 2} y={H + T + 14} textAnchor="middle" fontSize="9" fill="#6d8377">{hh(p.hora)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

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
  const plano = useMemo(
    () => planoRecargaInteligente({
      energiaKwh: r.energiaKwh,
      potenciaKw: r.rede.potenciaTotalKw,
      base: r.energyCostPerKwh,
    }),
    [r],
  );

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

          {/* Recarga inteligente: quando puxar energia da rede própria custa
              menos. A tarifa não é plana — fora da ponta é mais barata. */}
          {plano.disponivel && (
            <div className="tdg-recarga">
              <h3><Clock size={16} /> Recarga inteligente</h3>
              <p className="tdg-recarga-nota">A tarifa varia pela hora (tarifa branca, régua padrão editável). Recarregar fora da ponta cobre a mesma energia por menos. A janela e a economia são calculadas sobre o consumo estimado.</p>

              <div className="tdg-recarga-grid">
                <div className="tdg-recarga-card">
                  <small>Janela ideal (fora de ponta)</small>
                  <strong>{hh(plano.janela.inicio)} → {hh(plano.janela.fim)}</strong>
                  <em>{inteiro.format(plano.janela.horas)}h · a rede repõe {numero.format(r.energiaKwh)} kWh em ~{numero.format(plano.horasParaRecarregar)}h a {numero.format(r.rede.potenciaTotalKw)} kW</em>
                </div>
                <div className="tdg-recarga-card destaque">
                  <small><PiggyBank size={13} /> Economia fora da ponta</small>
                  <strong>{moeda.format(plano.economia.economia)}</strong>
                  <em>−{numero.format(plano.economia.economiaPercent)}% vs. recarregar na ponta ({moeda2.format(plano.economia.porKwh)}/kWh de diferença)</em>
                </div>
              </div>

              <CurvaTarifaria curva={plano.curva} />
              <div className="tdg-tarifa-legenda">
                {["fora-ponta", "intermediario", "ponta"].map((f) => (
                  <span key={f}><i style={{ background: COR_FAIXA[f] }} />{ROTULO_FAIXA[f]}</span>
                ))}
              </div>
              {!plano.demanda.informada && (
                <p className="tdg-recarga-nota">Se todos os pontos recarregarem juntos, a demanda instantânea chega a {numero.format(plano.demanda.potenciaInstaladaKw)} kW. Cadastre a demanda contratada para o sistema avisar quando escalonar a recarga (peak shaving).</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
