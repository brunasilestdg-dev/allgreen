import { useCallback, useMemo, useState } from "react";
import { MapPin, QrCode, Receipt, Zap } from "lucide-react";
import {
  findStations,
  createReservation,
  reservationStatus,
  buildAuthQrPayload,
  liveSessionMetrics,
  closeSession,
  loyaltyPoints,
  PAYMENT_METHODS,
  CONNECTOR_TYPES,
} from "../greenOnB2cDomain.js";
import "./TodoGreenPages.css";

// Green On App B2C — a jornada do usuário fim a fim, do "onde é que eu
// carrego" até o recibo, tudo no motor puro. Sem GPS de verdade — a
// origem vem de um preset. Sem pagamento real — greenpay/cartão são
// modo declarativo.

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const STATIONS = [
  { id: "SP-VC-01", nome: "Green On · Vila Clementino", plugues: ["CCS2", "Type2"], disponiveis: 2, precoPorKwh: 1.9, local: { lat: -23.598, lon: -46.641 } },
  { id: "SP-PN-02", nome: "Green On · Paulista", plugues: ["CCS2", "CHAdeMO"], disponiveis: 1, precoPorKwh: 2.1, local: { lat: -23.561, lon: -46.656 } },
  { id: "SP-LP-03", nome: "Green On · Lapa (CCS2 + kW alto)", plugues: ["CCS2"], disponiveis: 0, precoPorKwh: 2.5, local: { lat: -23.53, lon: -46.71 } },
  { id: "SP-MC-04", nome: "Parceiro roaming · Moema", plugues: ["Type2"], disponiveis: 3, precoPorKwh: 1.7, local: { lat: -23.60, lon: -46.66 } },
];

export default function GreenOnAppPage() {
  const [origem] = useState({ lat: -23.55, lon: -46.63 });
  const [filtro, setFiltro] = useState({ plug: "CCS2", precoMaximoReais: "3.0", apenasDisponiveis: true, raioKm: "20" });
  const [reserva, setReserva] = useState(null);
  const [sessao, setSessao] = useState({ ativa: false, precoPorKwh: 1.9, kwh: 15, tempoMinutos: 20, potenciaKw: 60, socPct: 72 });
  const [fechamento, setFechamento] = useState(null);
  const [metodo, setMetodo] = useState("greenpay");

  const stationsFiltradas = useMemo(
    () => findStations(STATIONS, {
      origem,
      plug: filtro.plug || undefined,
      precoMaximoReais: filtro.precoMaximoReais ? Number(filtro.precoMaximoReais) : undefined,
      apenasDisponiveis: !!filtro.apenasDisponiveis,
      raioKm: Number(filtro.raioKm) || 50,
    }),
    [origem, filtro],
  );

  // O relógio congela na hora que a reserva é criada — o painel não precisa
  // refazer o cálculo a cada render (e o compilador React exige que a chamada
  // seja pura durante o render).
  const statusReserva = useMemo(
    () => (reserva ? reservationStatus(reserva, reserva.reservadaEmMs + 60000) : null),
    [reserva],
  );
  const qr = useMemo(() => (reserva ? buildAuthQrPayload({ stationId: reserva.stationId, connectorId: 1, userId: reserva.userId, agoraMs: reserva.reservadaEmMs }) : null), [reserva]);

  const live = useMemo(() => liveSessionMetrics({
    kwh: sessao.kwh, tempoMs: (sessao.tempoMinutos || 0) * 60000, kwAtual: sessao.potenciaKw, socPct: sessao.socPct, precoPorKwh: sessao.precoPorKwh,
  }), [sessao]);

  const reservar = useCallback((station) => {
    setReserva(createReservation({
      stationId: station.id,
      connectorId: 1,
      userId: "user-demo",
      agoraMs: Date.now(),
      toleranciaMinutos: 15,
    }));
    setFechamento(null);
    setSessao((s) => ({ ...s, ativa: false, precoPorKwh: station.precoPorKwh }));
  }, []);

  const iniciar = useCallback(() => setSessao((s) => ({ ...s, ativa: true })), []);
  const encerrar = useCallback(() => {
    const r = closeSession({
      sessionId: `sess-${Date.now()}`,
      kwh: sessao.kwh,
      tempoMs: (sessao.tempoMinutos || 0) * 60000,
      precoPorKwh: sessao.precoPorKwh,
      metodo,
    });
    setFechamento(r);
    setSessao((s) => ({ ...s, ativa: false }));
  }, [sessao.kwh, sessao.tempoMinutos, sessao.precoPorKwh, metodo]);

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>GREEN ON APP · B2C</span>
          <h2>Jornada do usuário: mapa → reserva → recarga → recibo</h2>
          <p>Motor completo da experiência que o app B2C entrega. Preço mostrado é preço travado da sessão; reserva perde validade com tolerância; sessão sem medição confiável &ldquo;precisa de revisão&rdquo; em vez de cobrar estimando.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><MapPin size={20} /></span><div><strong>Buscar estação</strong><small>{stationsFiltradas.length} resultado(s)</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Plugue</span>
            <select value={filtro.plug} onChange={(e) => setFiltro({ ...filtro, plug: e.target.value })}>
              <option value="">qualquer</option>
              {CONNECTOR_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label><span>Preço máx (R$/kWh)</span><input type="number" min="0" step="0.1" value={filtro.precoMaximoReais} onChange={(e) => setFiltro({ ...filtro, precoMaximoReais: e.target.value })} /></label>
          <label><span>Raio (km)</span><input type="number" min="1" value={filtro.raioKm} onChange={(e) => setFiltro({ ...filtro, raioKm: e.target.value })} /></label>
          <label><span>Só disponíveis</span>
            <select value={filtro.apenasDisponiveis ? "sim" : "nao"} onChange={(e) => setFiltro({ ...filtro, apenasDisponiveis: e.target.value === "sim" })}>
              <option value="sim">sim</option>
              <option value="nao">não</option>
            </select>
          </label>
        </div>
        {stationsFiltradas.length === 0 ? (
          <p className="tdg-driver-nota">Nenhuma estação satisfaz esses critérios. Amplie o raio, aumente o preço máximo ou remova o filtro de disponibilidade.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Estação</th><th>Dist.</th><th>Plugues</th><th>Livres</th><th>R$/kWh</th><th></th></tr></thead>
              <tbody>
                {stationsFiltradas.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.nome}</strong><br /><small>{s.id}</small></td>
                    <td>{s.distanciaKm != null ? `${numero.format(s.distanciaKm)} km` : "—"}</td>
                    <td>{(s.plugues || []).join(", ")}</td>
                    <td>{s.disponiveis}</td>
                    <td>{moeda.format(s.precoPorKwh)}</td>
                    <td><button className="tdg-action" type="button" onClick={() => reservar(s)}>Reservar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {reserva && (
        <article className="tdg-panel">
          <div className="tdg-work-area-heading"><span><QrCode size={20} /></span><div><strong>Reserva ativa</strong><small>{statusReserva?.valid ? `expira em ${Math.max(0, Math.floor((statusReserva.restanteMs || 0) / 60000))} min` : `${statusReserva?.motivo || "?"}`}</small></div></div>
          <p className="tdg-driver-nota">Chegou na estação? Escaneie o QR:</p>
          <pre style={{ background: "var(--tdg-surface-soft, #f5f6f4)", padding: 12, borderRadius: 8, overflow: "auto" }}>{qr?.url}</pre>
          <div className="tdg-recarga-form-actions">
            <button className="tdg-action" type="button" onClick={iniciar} disabled={!statusReserva?.valid}>Iniciar recarga</button>
          </div>
        </article>
      )}

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Zap size={20} /></span><div><strong>Sessão ao vivo</strong><small>{sessao.ativa ? "carregando" : "aguardando"}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>kWh entregues</span><input type="number" min="0" step="0.1" value={sessao.kwh} onChange={(e) => setSessao({ ...sessao, kwh: Number(e.target.value) || 0 })} /></label>
          <label><span>Tempo (min)</span><input type="number" min="0" value={sessao.tempoMinutos} onChange={(e) => setSessao({ ...sessao, tempoMinutos: Number(e.target.value) || 0 })} /></label>
          <label><span>Potência (kW)</span><input type="number" min="0" step="0.1" value={sessao.potenciaKw} onChange={(e) => setSessao({ ...sessao, potenciaKw: Number(e.target.value) || 0 })} /></label>
          <label><span>SOC (%)</span><input type="number" min="0" max="100" value={sessao.socPct} onChange={(e) => setSessao({ ...sessao, socPct: Number(e.target.value) || 0 })} /></label>
        </div>
        <div className="tdg-recarga-metrics">
          <article><small>kWh</small><strong>{numero.format(live.kwh)}</strong></article>
          <article><small>Tempo</small><strong>{live.tempoMinutos} min</strong></article>
          <article><small>Potência</small><strong>{numero.format(live.potenciaKw)} kW</strong></article>
          <article><small>SOC</small><strong>{live.socPct != null ? `${live.socPct}%` : "—"}</strong></article>
          <article><small>Custo travado</small><strong>{live.custoEstimadoReais != null ? moeda.format(live.custoEstimadoReais) : "—"}</strong></article>
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Receipt size={20} /></span><div><strong>Encerrar e pagar</strong><small>método selecionado</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Método</span>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className="tdg-recarga-form-actions">
            <button className="tdg-action" type="button" onClick={encerrar}>Encerrar recarga</button>
          </div>
        </div>
        {fechamento && (
          fechamento.precisaRevisao ? (
            <p className="tdg-driver-nota">Sessão SEM medição confiável (kWh = 0). Não vai cobrar. Motivo: <strong>{fechamento.motivoRevisao}</strong>.</p>
          ) : (
            <>
              <div className="tdg-recarga-metrics">
                <article><small>Total pago</small><strong>{moeda.format(fechamento.valorReais)}</strong></article>
                <article><small>Método</small><strong>{fechamento.metodo}</strong></article>
                <article><small>Pontos fidelidade</small><strong>+{loyaltyPoints(fechamento.valorReais)}</strong></article>
              </div>
              <div className="tdg-tabela-frame">
                <table className="tdg-tabela">
                  <thead><tr><th>Linha</th><th>Detalhe</th><th>R$</th></tr></thead>
                  <tbody>
                    {fechamento.recibo.linhas.map((l, i) => (
                      <tr key={i}><td>{l.label}</td><td>{l.detalhe}</td><td>{moeda.format(l.valor)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </article>
    </div>
  );
}
