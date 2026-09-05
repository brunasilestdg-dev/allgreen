import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BatteryCharging,
  Boxes,
  Cable,
  CircleDollarSign,
  Copy,
  FileCheck2,
  Gauge,
  KeyRound,
  MapPinned,
  PackageSearch,
  RefreshCw,
  Route,
  ScanLine,
  Trash2,
  Truck,
  Waypoints,
  Zap,
} from "lucide-react";
import {
  authHeaders,
  createTmsApiKey,
  createTmsShipmentManual,
  listTmsFleetPositions,
  listTmsManualClients,
  listTmsManualContracts,
  loadTmsPortalData,
  registerTmsPodManual,
  revokeTmsApiKey,
  scanTmsTrackId,
} from "./tmsPortalData.js";
import "./TmsPortal.css";
import "./TmsApiManager.css";
// Reaproveita o estilo do pino (divIcon) e do container do mapa já validados
// no RoteirizacaoPage — mesma técnica, mesma folha.
import "./pages/TodoGreenPages.css";

// Roteirização dinâmica de verdade: a mesma tela que já otimiza a ordem das
// paradas, calcula recarga, pedágio e carregadores no ERP, agora dentro do
// portal TMS (antes aqui só havia painel de vitrine). Lazy para não pesar o
// bundle de quem abre o TMS só para ver a torre de controle.
const RoteirizacaoDinamica = lazy(() => import("./pages/RoteirizacaoPage.jsx"));

const SECTIONS = [
  { id: "controle", label: "Torre de controle", icon: Gauge },
  { id: "mapa", label: "Mapa de frota", icon: MapPinned },
  { id: "bipagem", label: "Bipagem", icon: ScanLine },
  { id: "cargas", label: "Cargas e pedidos", icon: PackageSearch },
  { id: "fracionada", label: "Carga fracionada", icon: Boxes },
  { id: "roteirizacao", label: "Roteirização", icon: Route },
  { id: "viagens", label: "Viagens", icon: Truck },
  { id: "fiscal", label: "CT-e, MDF-e e CIOT", icon: FileCheck2 },
  { id: "faturamento", label: "Faturamento", icon: CircleDollarSign },
  { id: "integracoes", label: "Integrações e API", icon: Cable },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const labelStatus = (value) => String(value || "—")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const pathSection = () => {
  if (typeof window === "undefined") return "controle";
  const part = window.location.pathname.replace(/^\/portal-tms\/?/, "").split("/")[0];
  return SECTIONS.some((item) => item.id === part) ? part : "controle";
};

function StatusPill({ value }) {
  const normalized = String(value || "").toLowerCase();
  const tone = ["completed", "concluida", "autorizado", "issued", "closed", "ativa", "ready"].includes(normalized)
    ? "ok"
    : ["cancelled", "canceled", "cancelado", "error", "erro", "failed", "revogada"].includes(normalized)
      ? "danger"
      : "pending";
  return <span className={`tms-status ${tone}`}>{labelStatus(value)}</span>;
}

function Metric({ label, value, detail, alert = false, onClick, acao }) {
  const classe = `tms-metric ${alert && Number(value) > 0 ? "is-alert" : ""}${onClick ? " is-acao" : ""}`;
  // Central de ação: o indicador não é só número, é a porta pra resolver. Quando
  // tem para onde levar, vira botão que navega direto pra seção que trata a fila.
  if (onClick) {
    return (
      <button type="button" className={classe} onClick={onClick}>
        <span>{label}</span>
        <strong>{value ?? 0}</strong>
        <small>{acao || detail}</small>
      </button>
    );
  }
  return (
    <article className={classe}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
      <small>{detail}</small>
    </article>
  );
}

const Empty = ({ children }) => <div className="tms-empty">{children}</div>;

// Caixa do Brasil, com folga, para o mapa não sair do país — mesmo limite do
// RoteirizacaoPage.jsx. Marcadores são círculos numerados via divIcon (não
// ícone-imagem do Leaflet, que quebra no bundle do Vite).
const LIMITES_BRASIL = [[-34.9, -74.2], [5.6, -33.7]];
const CORES_STATUS_VEICULO = {
  available: "#0b9f8f", "in-operation": "#2563eb", maintenance: "#d97706",
  reserved: "#7c3aed", blocked: "#dc2626", inactive: "#6b7280",
};

// Idade da posição: há quanto tempo foi a última leitura do rastreador. Acima de
// 15 min a posição é "velha" (rastreador sem enviar) — a operação precisa saber
// que o ponto no mapa pode não ser onde o veículo está agora.
const POSICAO_VELHA_MIN = 15;
const idadeDaPosicao = (atualizadoEm, agora = Date.now()) => {
  const t = atualizadoEm ? Date.parse(atualizadoEm) : NaN;
  if (!Number.isFinite(t)) return { texto: "sem sinal", velha: true, semSinal: true };
  const min = Math.max(0, Math.round((agora - t) / 60000));
  const velha = min > POSICAO_VELHA_MIN;
  if (min < 1) return { texto: "agora", velha: false };
  if (min < 60) return { texto: `há ${min} min`, velha };
  const h = Math.floor(min / 60);
  if (h < 24) return { texto: `há ${h} h`, velha: true };
  return { texto: `há ${Math.floor(h / 24)} d`, velha: true };
};

const pinoVeiculo = (veiculo, agora = Date.now()) => {
  const idade = idadeDaPosicao(veiculo.atualizadoEm, agora);
  return L.marker([veiculo.lat, veiculo.lng], {
    icon: L.divIcon({
      className: `tdg-mapa-pin${idade.velha ? " velha" : ""}`,
      html: `<span style="background:${CORES_STATUS_VEICULO[veiculo.status] || "#6b7280"}">${veiculo.prefixo || veiculo.placa || "?"}</span>`,
      iconSize: [30, 26],
      iconAnchor: [15, 13],
    }),
  }).bindPopup(
    `<strong>${veiculo.prefixo} — ${veiculo.placa}</strong><br>${veiculo.motorista || "Sem motorista vinculado"}<br><small>Posição ${idade.texto}${veiculo.atualizadoEm ? ` · ${new Date(veiculo.atualizadoEm).toLocaleString("pt-BR")}` : ""}</small>`,
  );
};

function FleetMap() {
  const [veiculos, setVeiculos] = useState([]);
  const [error, setError] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  const containerRef = useRef(null);
  const mapaRef = useRef(null);
  const camadaRef = useRef(null);

  const carregar = useCallback(() => {
    listTmsFleetPositions()
      .then((result) => { setVeiculos(result?.veiculos || []); setError(""); setAgora(Date.now()); })
      .catch((reason) => setError(reason?.message || "Não foi possível carregar as posições da frota."));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Atualização automática: a posição vem do rastreador e envelhece sozinha. A
  // cada 45s recarrega as posições e reavalia a idade (o mapa não fica mostrando
  // um ponto de 1h atrás como se fosse agora).
  useEffect(() => {
    const id = setInterval(() => { carregar(); }, 45000);
    return () => clearInterval(id);
  }, [carregar]);

  useEffect(() => {
    if (mapaRef.current || !containerRef.current) return undefined;
    const mapa = L.map(containerRef.current, { scrollWheelZoom: true, maxBounds: LIMITES_BRASIL, maxBoundsViscosity: 0.9 })
      .setView([-15.78, -47.93], 4);
    mapa.setMinZoom(4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
    mapaRef.current = mapa;
    const recalc = () => mapa.invalidateSize();
    requestAnimationFrame(recalc);
    const observer = new ResizeObserver(recalc);
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); mapa.remove(); mapaRef.current = null; };
  }, []);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (camadaRef.current) camadaRef.current.remove();
    const camada = L.layerGroup(veiculos.map((v) => pinoVeiculo(v, agora))).addTo(mapa);
    camadaRef.current = camada;
  }, [veiculos, agora]);

  const frota = veiculos
    .map((v) => ({ ...v, idade: idadeDaPosicao(v.atualizadoEm, agora) }))
    .sort((a, b) => Number(b.idade.velha) - Number(a.idade.velha));
  const velhas = frota.filter((v) => v.idade.velha).length;

  return (
    <section className="tms-panel">
      <div className="tms-panel-head">
        <div><span>Posição em tempo real</span><h2>Mapa de frota</h2></div>
        <button type="button" className="tms-api-mini-button" onClick={carregar}><RefreshCw size={14} /> Atualizar</button>
      </div>
      {error ? <p className="tms-api-inline-error">{error}</p> : null}
      {!veiculos.length && !error ? <Empty>Nenhum veículo com posição recente. A posição vem do rastreador — sincronize a frota primeiro.</Empty> : null}
      {frota.length > 0 && (
        <div className="tms-frota-idade" aria-label="Idade da última posição por veículo">
          <p className="tms-frota-idade-resumo">Atualiza sozinho a cada 45s · {velhas > 0 ? `${velhas} com posição velha (> ${POSICAO_VELHA_MIN} min)` : "todas as posições recentes"}</p>
          <div className="tms-frota-idade-chips">
            {frota.map((v) => (
              <span key={v.id || v.placa || v.prefixo} className={`tms-frota-chip${v.idade.velha ? " velha" : ""}`} title={v.motorista || "Sem motorista vinculado"}>
                <strong>{v.prefixo || v.placa || "?"}</strong>
                <em>{v.idade.texto}</em>
              </span>
            ))}
          </div>
        </div>
      )}
      <div ref={containerRef} className="tdg-roteirizacao-mapa" aria-label="Mapa de frota" />
    </section>
  );
}

const ENTREGUE_OU_CANCELADA = new Set(["completed", "concluida", "delivered", "entregue", "cancelled", "canceled", "cancelado"]);

// Rótulos em português dos tipos de evento relevantes pra bipagem (o núcleo
// aceita mais tipos — CREATED/CANCELLED não fazem sentido bipados numa
// esteira, ficam só na API/tela de detalhe).
const TIPOS_EVENTO_BIPAGEM = [
  { valor: "PICKED_UP", rotulo: "Coleta" },
  { valor: "ARRIVED_AT_HUB", rotulo: "Chegou no hub" },
  { valor: "DEPARTED_FROM_HUB", rotulo: "Saiu do hub" },
  { valor: "IN_TRANSIT", rotulo: "Em trânsito" },
  { valor: "REACHED_DESTINATION", rotulo: "Chegou no destino" },
  { valor: "DELIVERY_ATTEMPT", rotulo: "Tentativa de entrega" },
  { valor: "DELIVERED", rotulo: "Entregue" },
  { valor: "EXCEPTION", rotulo: "Ocorrência" },
];

// Bipagem: um leitor físico de código de barras é, pro navegador, só um
// teclado que digita muito rápido e aperta Enter — não precisa de driver nem
// integração nenhuma, só um campo de texto com foco esperando o Enter. A
// câmera do celular é a mesma ideia, só que o "Enter" vem do ZXing decodando
// o quadro do vídeo. Os dois caem na mesma função de confirmar.
function ScanSection() {
  const [eventType, setEventType] = useState("PICKED_UP");
  const [codigo, setCodigo] = useState("");
  const [historico, setHistorico] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [usandoCamera, setUsandoCamera] = useState(false);
  const [erroCamera, setErroCamera] = useState("");
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const controlesRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [usandoCamera]);

  const confirmarCodigo = useCallback(async (trackId) => {
    const valor = String(trackId || "").trim();
    if (!valor || enviando) return;
    setEnviando(true);
    try {
      const resultado = await scanTmsTrackId({ trackId: valor, eventType });
      setHistorico((atual) => [{
        ok: true, trackId: valor, quando: new Date(),
        mensagem: `${resultado.pacote?.descricao || resultado.pacote?.trackId} — OS ${resultado.pedido?.numero}`,
      }, ...atual].slice(0, 30));
    } catch (reason) {
      setHistorico((atual) => [{ ok: false, trackId: valor, quando: new Date(), mensagem: reason?.message || "Falha ao bipar." }, ...atual].slice(0, 30));
    } finally {
      setEnviando(false);
      setCodigo("");
      inputRef.current?.focus();
    }
  }, [eventType, enviando]);

  const aoTeclar = (event) => {
    if (event.key === "Enter") { event.preventDefault(); confirmarCodigo(codigo); }
  };

  useEffect(() => {
    if (!usandoCamera) return undefined;
    let cancelado = false;
    import("@zxing/browser").then(({ BrowserMultiFormatReader }) => {
      if (cancelado || !videoRef.current) return;
      const leitor = new BrowserMultiFormatReader();
      leitor.decodeFromVideoDevice(undefined, videoRef.current, (resultado) => {
        if (resultado) confirmarCodigo(resultado.getText());
      }).then((controles) => { controlesRef.current = controles; })
        .catch((erro) => setErroCamera(erro?.message || "Não foi possível abrir a câmera."));
    });
    return () => { cancelado = true; controlesRef.current?.stop(); controlesRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usandoCamera]);

  return (
    <section className="tms-panel">
      <div className="tms-panel-head"><div><span>Leitura de volume</span><h2>Bipagem</h2></div></div>
      <div className="tms-api-card">
        <p>Escolha o evento uma vez e bipe os volumes em sequência — leitor físico (USB/Bluetooth), câmera do celular ou digite o Track ID à mão.</p>
        <div className="tms-api-form">
          <label>
            <span>Evento desta leva</span>
            <select className="tms-api-input" value={eventType} onChange={(event) => setEventType(event.target.value)}>
              {TIPOS_EVENTO_BIPAGEM.map((item) => <option key={item.valor} value={item.valor}>{item.rotulo}</option>)}
            </select>
          </label>
          <label>
            <span>Track ID</span>
            <input
              ref={inputRef} className="tms-api-input" value={codigo} disabled={enviando}
              onChange={(event) => setCodigo(event.target.value)} onKeyDown={aoTeclar}
              placeholder="Bipe com o leitor ou digite e pressione Enter" autoFocus
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="tms-api-mini-button" onClick={() => setUsandoCamera((atual) => !atual)}>
              {usandoCamera ? "Fechar câmera" : "Usar câmera do celular"}
            </button>
          </div>
          {usandoCamera ? (
            <div>
              {erroCamera ? <p className="tms-api-inline-error">{erroCamera}</p> : null}
              <video ref={videoRef} style={{ width: "100%", maxWidth: 420, borderRadius: 8 }} muted playsInline />
            </div>
          ) : null}
        </div>
      </div>
      <div className="tms-api-card">
        <h3>Últimas leituras</h3>
        {!historico.length ? <Empty>Nenhuma leitura ainda.</Empty> : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {historico.map((item, indice) => (
              <li key={`${item.trackId}-${indice}`} style={{ color: item.ok ? "var(--tms-accent, #0b9f8f)" : "#dc2626", fontSize: 13 }}>
                <strong>{item.trackId}</strong> — {item.mensagem} <small>{item.quando.toLocaleTimeString("pt-BR")}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function OrdersTable({ rows = [], onRegistrarPod }) {
  if (!rows.length) return <Empty>Nenhuma ordem de serviço registrada.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>OS</th><th>Origem</th><th>Destino</th><th>Quantidade</th><th>Valor</th><th>Status</th>{onRegistrarPod ? <th /> : null}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.number || row.id}</strong></td>
            <td>{row.origin?.city || row.origin?.cidade || row.origin?.name || row.origin?.address || "—"}</td>
            <td>{row.destination?.city || row.destination?.cidade || row.destination?.name || row.destination?.address || "—"}</td>
            <td>{number.format(row.quantity || 0)} {row.chargeUnit || ""}</td>
            <td>{money.format(row.netAmount || 0)}</td>
            <td><StatusPill value={row.status} /></td>
            {onRegistrarPod ? (
              <td>{!ENTREGUE_OU_CANCELADA.has(String(row.status || "").toLowerCase()) ? (
                <button type="button" className="tms-api-mini-button" onClick={() => onRegistrarPod(row)}>Registrar entrega</button>
              ) : null}</td>
            ) : null}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OperationsTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhuma movimentação do TMS registrada.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Referência</th><th>Trecho</th><th>Veículo</th><th>Motorista</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.reference || row.id}</strong><small>{row.serviceDate || ""}</small></td>
            <td>{row.origin || "—"} <span className="tms-arrow">→</span> {row.destination || "—"}</td>
            <td>{row.vehiclePlate || "—"}</td>
            <td>{row.driverName || "—"}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function FiscalTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhum CT-e ou MDF-e disponível para este acesso.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Documento</th><th>Número</th><th>Emissão</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{String(row.docType || "").toUpperCase()}</strong></td>
            <td>{row.number || "—"}{row.series ? ` / ${row.series}` : ""}</td>
            <td>{row.issuedAt || "—"}</td>
            <td>{money.format(row.serviceValue || 0)}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CiotTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhum CIOT preparado ou emitido.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Registro</th><th>CIOT</th><th>Trecho</th><th>Veículo</th><th>Frete</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.number || row.id}</strong></td>
            <td>{row.ciotCode || "Aguardando"}</td>
            <td>{row.origin || "—"} <span className="tms-arrow">→</span> {row.destination || "—"}</td>
            <td>{row.vehiclePlate || "—"}</td>
            <td>{money.format(row.freightAmount || 0)}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ControlTower({ data, onSection }) {
  const indicators = data?.indicators || {};
  return (
    <>
      <div className="tms-metrics">
        <Metric label="OS abertas" value={indicators.ordersOpen} detail="pedidos ainda em execução" acao="Abrir cargas e pedidos →" onClick={() => onSection("cargas")} />
        <Metric label="Em trânsito" value={indicators.operationsInTransit} detail="movimentações sem conclusão" acao="Acompanhar viagens →" onClick={() => onSection("viagens")} />
        <Metric label="TMS sem vínculo" value={indicators.unlinkedExternalDocs} detail="documentos para tratar" alert acao="Tratar em cargas e pedidos →" onClick={() => onSection("cargas")} />
        <Metric label="Faturar" value={indicators.billingPending} detail="itens elegíveis" acao="Ir para faturamento →" onClick={() => onSection("faturamento")} />
        <Metric label="CT-e pendente" value={indicators.ctePending} detail="ainda não autorizado" alert acao="Emitir no fiscal →" onClick={() => onSection("fiscal")} />
        <Metric label="MDF-e pendente" value={indicators.mdfePending} detail="ainda não autorizado" alert acao="Emitir no fiscal →" onClick={() => onSection("fiscal")} />
        <Metric label="CIOT pendente" value={indicators.ciotPending} detail="ainda não emitido" alert acao="Emitir no fiscal →" onClick={() => onSection("fiscal")} />
      </div>

      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Esteira operacional</span><h2>First, middle e last mile em uma só execução</h2></div></div>
        <div className="tms-flow">
          {[
            ["Pedido", "Portal, arquivo ou API", ScanLine, "cargas"],
            ["First mile", "Coleta e chegada à base", MapPinned, "viagens"],
            ["Consolidação", "Agrupamento para transferência", Boxes, "fracionada"],
            ["Middle mile", "Transferência entre bases", Waypoints, "viagens"],
            ["Desconsolidação", "Separação para distribuição", Boxes, "fracionada"],
            ["Last mile", "Roteiro, entrega e POD", Truck, "roteirizacao"],
            ["Fiscal", "CT-e, MDF-e e CIOT", FileCheck2, "fiscal"],
            ["Faturamento", "Cobrança após execução", CircleDollarSign, "faturamento"],
          ].map(([title, detail, Icon, destino]) => (
            <button
              type="button"
              className="tms-flow-step"
              key={title}
              onClick={() => onSection(destino)}
              title={`Abrir ${title}`}
            >
              <div className="tms-flow-icon"><Icon size={19} /></div>
              <div><strong>{title}</strong><small>{detail}</small></div>
              <ArrowRight size={15} className="tms-flow-go" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="tms-panel">
        <div className="tms-panel-head">
          <div><span>Execução</span><h2>Movimentações recentes</h2></div>
          <button type="button" className="tms-link" onClick={() => onSection("viagens")}>Ver viagens</button>
        </div>
        <OperationsTable rows={data?.recent?.operations} />
      </section>
    </>
  );
}

// Roteirização do TMS: hero elétrico enxuto + o otimizador real embutido. A
// tela abaixo é a mesma do ERP (múltiplas paradas, "Otimizar ordem", recarga
// 1h30, pedágios, carregadores para pesados) — deixou de ser vitrine e virou
// ferramenta de trabalho dentro do portal.
function ElectricRouting({ setToast }) {
  return (
    <div className="tms-stack">
      <section className="tms-panel tms-route-hero tms-electric-hero">
        <BatteryCharging size={30} />
        <div>
          <span>ROTEIRIZAÇÃO ELÉTRICA DINÂMICA</span>
          <h2>Planeje a rota entendendo bateria, carga e carregador</h2>
          <p>Adicione as paradas abaixo, otimize a ordem para tirar o zigue-zague, marque as recargas (soma 1h30 cada), veja pedágios e carregadores com foco em pesados. Autonomia, reserva e conector entram na conta.</p>
        </div>
        <span className="tms-electric-live"><Zap size={14} /> Otimização ativa</span>
      </section>

      <Suspense fallback={<div className="tms-loading"><RefreshCw size={22} className="spin" /><span>Abrindo roteirização...</span></div>}>
        {/* authHeaders é obrigatório: sem ele, Pedágios/Carregadores/IA chamam a
            API sem token e tomam 401 ("sessão expirada" falso). */}
        <RoteirizacaoDinamica setToast={setToast} authHeaders={authHeaders} />
      </Suspense>
    </div>
  );
}

function FractionalCargo() {
  return (
    <div className="tms-two-columns">
      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Modelo operacional</span><h2>Carga fracionada</h2></div></div>
        <div className="tms-feature-list">
          <div><Boxes size={20} /><span><strong>Volumes e unidades logísticas</strong><small>Track ID, peso, dimensões, NF-e, código de barras, pallet, gaiola ou mala.</small></span></div>
          <div><Waypoints size={20} /><span><strong>Consolidação por trecho</strong><small>Agrupa remessas em uma transferência sem perder o vínculo de cada volume.</small></span></div>
          <div><ScanLine size={20} /><span><strong>Cross-docking e leitura</strong><small>Entrada, triagem, transferência, desconsolidação e saída por evento.</small></span></div>
          <div><Route size={20} /><span><strong>Última milha</strong><small>Após a desconsolidação, os volumes entram na roteirização local e seguem até o POD.</small></span></div>
        </div>
      </section>
    </div>
  );
}

// Cadastro manual — a mesma regra de negócio da API pública, só que direto
// pela sessão de quem está no painel: precisa de cliente com contrato
// aprovado e assinado (é o próprio contrato que dá o preço), origem e
// destino. Sem isso, abrir uma OS obrigava a gerar chave de API e chamar por
// fora do ERP.
function NewOrderForm({ onReload }) {
  const [clientes, setClientes] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [clientId, setClientId] = useState("");
  const [contractId, setContractId] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [observacoes, setObservacoes] = useState("");
  const [carregandoContratos, setCarregandoContratos] = useState(false);
  const [criado, setCriado] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTmsManualClients()
      .then((result) => setClientes(result?.clientes || []))
      .catch(() => setClientes([]));
  }, []);

  useEffect(() => {
    setContractId("");
    setContratos([]);
    if (!clientId) return;
    setCarregandoContratos(true);
    listTmsManualContracts(clientId)
      .then((result) => setContratos(result?.contratos || []))
      .catch(() => setContratos([]))
      .finally(() => setCarregandoContratos(false));
  }, [clientId]);

  const criar = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setCriado(null);
    try {
      const registro = await createTmsShipmentManual({
        clientId,
        contractId,
        origin: { address: origem },
        destination: { address: destino },
        quantity: Number(quantidade) || 1,
        notes: observacoes,
      });
      setCriado(registro);
      setOrigem("");
      setDestino("");
      setQuantidade(1);
      setObservacoes("");
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível criar a carga.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tms-api-card">
      <h3>Nova carga manual</h3>
      <p>Mesma regra da API pública: o cliente precisa de um contrato aprovado e assinado — é ele que dá o preço da OS.</p>
      <form className="tms-api-form" onSubmit={criar}>
        <label>
          <span>Cliente</span>
          <select className="tms-api-input" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
            <option value="">Selecione</option>
            {clientes.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </select>
        </label>
        <label>
          <span>Contrato {carregandoContratos ? "(carregando...)" : ""}</span>
          <select className="tms-api-input" value={contractId} onChange={(event) => setContractId(event.target.value)} required disabled={!clientId || carregandoContratos}>
            <option value="">Selecione</option>
            {contratos.map((item) => <option key={item.id} value={item.id}>{item.titulo} — {money.format(item.valorMensal || 0)}</option>)}
          </select>
          {clientId && !carregandoContratos && !contratos.length ? <small className="tms-api-inline-error">Este cliente não tem contrato aprovado e assinado.</small> : null}
        </label>
        <label>
          <span>Origem</span>
          <input className="tms-api-input" value={origem} onChange={(event) => setOrigem(event.target.value)} placeholder="Endereço ou referência de coleta" required />
        </label>
        <label>
          <span>Destino</span>
          <input className="tms-api-input" value={destino} onChange={(event) => setDestino(event.target.value)} placeholder="Endereço ou referência de entrega" required />
        </label>
        <label>
          <span>Quantidade</span>
          <input className="tms-api-input" type="number" min="1" value={quantidade} onChange={(event) => setQuantidade(event.target.value)} />
        </label>
        <label>
          <span>Observações, opcional</span>
          <input className="tms-api-input" value={observacoes} onChange={(event) => setObservacoes(event.target.value)} />
        </label>
        {error ? <p className="tms-api-inline-error">{error}</p> : null}
        {criado ? <p style={{ color: "var(--tms-accent, #0b9f8f)", fontWeight: 700 }}>OS {criado.shipmentNumber} criada.</p> : null}
        <button className="tms-api-submit" type="submit" disabled={saving || !contractId}>{saving ? "Criando..." : "Criar carga"}</button>
      </form>
    </div>
  );
}

// Captura de POD com assinatura na hora — o canvas gera um PNG pequeno
// (data URI), que cabe direto no campo document_url existente sem precisar
// de armazenamento de arquivo (S3/R2) que este projeto não tem configurado.
function PodCaptureForm({ pedido, onClose, onReload }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [recipientName, setRecipientName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let SignaturePad;
    let cancelado = false;
    import("signature_pad").then((mod) => {
      if (cancelado || !canvasRef.current) return;
      SignaturePad = mod.default;
      const canvas = canvasRef.current;
      const proporcao = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * proporcao;
      canvas.height = canvas.offsetHeight * proporcao;
      canvas.getContext("2d").scale(proporcao, proporcao);
      padRef.current = new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" });
    });
    return () => { cancelado = true; padRef.current?.off(); };
  }, []);

  const limpar = () => padRef.current?.clear();

  const registrar = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const assinatura = padRef.current && !padRef.current.isEmpty() ? padRef.current.toDataURL("image/png") : "";
      await registerTmsPodManual(pedido.id, { recipientName, documentUrl: assinatura });
      await onReload();
      onClose();
    } catch (reason) {
      setError(reason?.message || "Não foi possível registrar a entrega.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tms-api-card">
      <h3>Registrar entrega — {pedido.number || pedido.id}</h3>
      <p>Nome de quem recebeu e a assinatura na tela. Ao salvar, a OS fecha e entra na régua de faturamento.</p>
      <form className="tms-api-form" onSubmit={registrar}>
        <label>
          <span>Recebido por</span>
          <input className="tms-api-input" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Nome de quem assinou" required />
        </label>
        <div>
          <span style={{ display: "block", marginBottom: 6, color: "var(--tms-muted)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Assinatura</span>
          <canvas ref={canvasRef} aria-label="Área para assinar com o dedo ou mouse" style={{ width: "100%", height: 160, border: "1px solid var(--tms-line, #dce7e2)", borderRadius: 8, touchAction: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="tms-api-mini-button" onClick={limpar}>Limpar assinatura</button>
        </div>
        {error ? <p className="tms-api-inline-error">{error}</p> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="tms-api-submit" type="submit" disabled={saving}>{saving ? "Registrando..." : "Confirmar entrega"}</button>
          <button type="button" className="tms-api-mini-button" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// Seção "cargas": cadastro manual + lista + registro de entrega, com o
// controle de qual OS está com o modal de POD aberto.
function CargasSection({ data, onReload }) {
  const [pedidoParaPod, setPedidoParaPod] = useState(null);
  return (
    <div className="tms-stack">
      <section className="tms-panel"><div className="tms-panel-head"><div><span>Cadastro</span><h2>Nova carga</h2></div></div><NewOrderForm onReload={onReload} /></section>
      {pedidoParaPod ? (
        <section className="tms-panel">
          <PodCaptureForm pedido={pedidoParaPod} onClose={() => setPedidoParaPod(null)} onReload={onReload} />
        </section>
      ) : null}
      <section className="tms-panel"><div className="tms-panel-head"><div><span>Entrada operacional</span><h2>Cargas e ordens de serviço</h2></div></div><OrdersTable rows={data?.recent?.orders} onRegistrarPod={setPedidoParaPod} /></section>
    </div>
  );
}

const SCOPE_LABELS = {
  "shipments:read": "Consultar cargas",
  "shipments:write": "Criar cargas",
  "tracking:write": "Enviar tracking",
  "pod:write": "Enviar POD",
  "fiscal:read": "Consultar CT-e/MDF-e",
  "ciot:read": "Consultar CIOT",
  "billing:read": "Consultar faturamento",
};

function ApiManager({ api, onReload }) {
  const availableScopes = api?.availableScopes || [];
  const keys = api?.keys || [];
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [scopes, setScopes] = useState(["shipments:read"]);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleScope = (scope) => {
    setScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };

  const issueKey = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await createTmsApiKey({ name, clientId, scopes });
      setCreated(result);
      setName("");
      setClientId("");
      setScopes(["shipments:read"]);
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível criar a chave.");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (key) => {
    if (!window.confirm(`Revogar a chave ${key.name}? A integração para de funcionar imediatamente.`)) return;
    setError("");
    try {
      await revokeTmsApiKey(key.id);
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível revogar a chave.");
    }
  };

  const copyCreatedKey = async () => {
    if (!created?.key) return;
    try { await navigator.clipboard.writeText(created.key); } catch { /* o valor continua visível */ }
  };

  return (
    <div className="tms-api-manager">
      <div className="tms-api-grid">
        <div className="tms-api-card">
          <h3>Nova chave de integração</h3>
          <p>Crie uma credencial por cliente ou parceiro. A chave completa aparece uma única vez.</p>
          <form className="tms-api-form" onSubmit={issueKey}>
            <label>
              <span>Nome da integração</span>
              <input className="tms-api-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Amazon produção" required />
            </label>
            <label>
              <span>Cliente ID, opcional</span>
              <input className="tms-api-input" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Limita a chave a um cliente" />
            </label>
            <div>
              <span style={{ display: "block", marginBottom: 6, color: "var(--tms-muted)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Permissões</span>
              <div className="tms-api-scopes">
                {availableScopes.map((scope) => (
                  <label className="tms-api-scope" key={scope}>
                    <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                    <span>{SCOPE_LABELS[scope] || scope}</span>
                  </label>
                ))}
              </div>
            </div>
            {error ? <p className="tms-api-inline-error">{error}</p> : null}
            <button className="tms-api-submit" type="submit" disabled={saving || !scopes.length}>{saving ? "Criando..." : "Gerar chave TMS"}</button>
          </form>
        </div>

        <div className="tms-api-card">
          <h3>Endpoints</h3>
          <p>API versionada e independente da sessão do ERP.</p>
          <div className="tms-api-endpoints">
            <code>POST {api?.basePath || "/api/tms/v1"}/shipments</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/shipments/:id</code>
            <code>POST {api?.basePath || "/api/tms/v1"}/shipments/:id/tracking</code>
            <code>POST {api?.basePath || "/api/tms/v1"}/shipments/:id/pod</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/fiscal</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/ciot</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/invoices</code>
            <code>OpenAPI: {api?.documentationPath || "/api/tms/v1/openapi.json"}</code>
          </div>
        </div>
      </div>

      {created?.key ? (
        <div className="tms-api-secret">
          <strong>Chave criada. Copie agora.</strong>
          <small>Depois que esta tela atualizar, o segredo completo não será mostrado de novo.</small>
          <div className="tms-api-secret-row">
            <code>{created.key}</code>
            <button type="button" className="tms-api-mini-button" onClick={copyCreatedKey}><Copy size={14} /> Copiar</button>
          </div>
        </div>
      ) : null}

      <div className="tms-api-card">
        <h3>Chaves do TMS</h3>
        <p>{api?.activeKeys || 0} chave(s) ativa(s). Cada chave pode ter escopo e cliente próprios.</p>
        <div className="tms-api-keys">
          {!keys.length ? <Empty>Nenhuma chave TMS criada ainda.</Empty> : keys.map((key) => (
            <div className={`tms-api-key-row ${key.revokedAt ? "is-revoked" : ""}`} key={key.id}>
              <div>
                <strong><KeyRound size={12} style={{ marginRight: 6, verticalAlign: -2 }} />{key.name}</strong>
                <small>{key.keyPrefix}•••• · {key.clientId ? `cliente ${key.clientId}` : "todos os clientes"} · {(key.scopes || []).join(", ")}</small>
              </div>
              {key.revokedAt ? <StatusPill value="revogada" /> : <button type="button" className="tms-api-mini-button" onClick={() => revoke(key)}><Trash2 size={13} /> Revogar</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Integrations({ data, onReload }) {
  const rows = [
    { name: "TRACK3R", detail: "Importação, documentos e ocorrências", value: data?.integrations?.track3r },
    { name: "CIOT / ANTT", detail: "Integração direta e certificado", value: data?.integrations?.ciot },
    { name: "Fiscal / SEFAZ", detail: "CT-e e MDF-e", value: data?.integrations?.fiscal },
    { name: "API TMS", detail: "API externa própria para clientes e parceiros", value: data?.integrations?.api },
  ];
  return (
    <section className="tms-panel">
      <div className="tms-panel-head"><div><span>Conectividade</span><h2>Integrações do TMS</h2></div></div>
      <div className="tms-integration-list">
        {rows.map((row) => (
          <div key={row.name}>
            <div className="tms-integration-icon"><Cable size={19} /></div>
            <span><strong>{row.name}</strong><small>{row.detail}</small></span>
            <StatusPill value={row.value?.status || "configurar"} />
          </div>
        ))}
      </div>
      <div className="tms-api-note">
        <div>
          <strong>API TMS externa ativa</strong>
          <p>Clientes e parceiros podem criar shipments, consultar cargas, enviar tracking/POD e consultar CT-e, MDF-e, CIOT e faturamento sem entrar no ERP. A autenticação usa chaves próprias `tdg_live_`, com isolamento por cliente e escopo.</p>
        </div>
      </div>
      <ApiManager api={data?.integrations?.api} onReload={onReload} />
    </section>
  );
}

export default function TmsPortal() {
  const [section, setSection] = useState(pathSection);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Toast enxuto para a roteirização (que fala por setToast). Carrega um nonce
  // para o timer reiniciar mesmo quando a MESMA mensagem é mostrada de novo
  // (senão o React descarta o re-render e o toast some antes da hora).
  const [toast, setToast] = useState({ msg: "", n: 0 });
  const mostrarToast = useCallback((msg) => setToast((atual) => ({ msg: msg || "", n: atual.n + 1 })), []);
  useEffect(() => {
    if (!toast.msg) return undefined;
    const id = setTimeout(() => setToast((atual) => ({ ...atual, msg: "" })), 4200);
    return () => clearTimeout(id);
  }, [toast.n, toast.msg]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadTmsPortalData());
      setError("");
    } catch (reason) {
      setError(reason?.message || "Não foi possível abrir o Portal TMS.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onPopState = () => setSection(pathSection());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next) => {
    const valid = SECTIONS.some((item) => item.id === next) ? next : "controle";
    window.history.pushState({}, "", valid === "controle" ? "/portal-tms" : `/portal-tms/${valid}`);
    setSection(valid);
  }, []);

  const active = useMemo(() => SECTIONS.find((item) => item.id === section) || SECTIONS[0], [section]);
  let content;
  if (section === "controle") content = <ControlTower data={data} onSection={navigate} />;
  if (section === "mapa") content = <FleetMap />;
  if (section === "bipagem") content = <ScanSection />;
  if (section === "cargas") content = <CargasSection data={data} onReload={load} />;
  if (section === "fracionada") content = <FractionalCargo />;
  if (section === "roteirizacao") content = <ElectricRouting setToast={mostrarToast} />;
  if (section === "viagens") content = <section className="tms-panel"><div className="tms-panel-head"><div><span>Execução</span><h2>Viagens e movimentações</h2></div></div><OperationsTable rows={data?.recent?.operations} /></section>;
  if (section === "fiscal") content = <div className="tms-stack"><section className="tms-panel"><div className="tms-panel-head"><div><span>Documentos fiscais</span><h2>CT-e e MDF-e</h2></div></div><FiscalTable rows={data?.recent?.fiscal} /></section><section className="tms-panel"><div className="tms-panel-head"><div><span>ANTT</span><h2>CIOT</h2></div></div><CiotTable rows={data?.recent?.ciots} /></section></div>;
  if (section === "faturamento") content = <section className="tms-panel"><div className="tms-panel-head"><div><span>Receita operacional</span><h2>Faturamento</h2></div></div><div className="tms-billing-highlight"><CircleDollarSign size={30} /><div><strong>{data?.indicators?.billingPending || 0} item(ns) elegível(is)</strong><p>A OS concluída com POD entra na régua de faturamento já existente na Vertical. O TMS mantém o vínculo entre execução, documento fiscal e cobrança.</p></div></div></section>;
  if (section === "integracoes") content = <Integrations data={data} onReload={load} />;

  return (
    <div className="tms-portal">
      <aside className="tms-sidebar">
        <div className="tms-brand"><div className="tms-brand-mark">TDG</div><div><strong>TO DO GREEN</strong><span>Transportation Management</span></div></div>
        <nav aria-label="Navegação do TMS">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="tms-sidebar-foot"><Activity size={16} /><span>Portal operacional separado do ERP</span></div>
      </aside>
      <main className="tms-main">
        <header className="tms-topbar">
          <div><span>PORTAL TMS</span><h1>{active.label}</h1></div>
          <button type="button" className="tms-refresh" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Atualizando" : "Atualizar"}</button>
        </header>
        {error ? <div className="tms-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
        {loading && !data ? <div className="tms-loading"><RefreshCw size={22} className="spin" /><span>Carregando torre de controle...</span></div> : content}
      </main>
      {toast.msg ? <div className="tms-toast" role="status">{toast.msg}</div> : null}
    </div>
  );
}
