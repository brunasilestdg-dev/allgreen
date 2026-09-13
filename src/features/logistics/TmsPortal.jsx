import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Cable,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Download,
  Eye,
  FileCheck2,
  Gauge,
  KeyRound,
  MapPinned,
  PackageSearch,
  Play,
  RefreshCw,
  Route,
  ScanLine,
  Search,
  ShieldCheck,
  Siren,
  Trash2,
  Truck,
  Waypoints,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import {
  authHeaders,
  checkTmsBillingItem,
  createTmsApiKey,
  createTmsShipmentManual,
  listTmsFleetPositions,
  listTmsManualClients,
  listTmsManualContracts,
  loadTmsPortalData,
  registerTmsPodManual,
  revokeTmsApiKey,
  scanTmsTrackId,
  transitionTmsOrder,
} from "./tmsPortalData.js";
import { SERVICE_ORDER_TRANSITIONS } from "./transactionalSpineDomain.js";
import {
  buildTmsActionQueue,
  filterTmsRecords,
  paginateTmsRecords,
  slaState,
  summarizeTms,
  tmsCsv,
} from "./tmsCommandCenterDomain.js";
import {
  ehDuplicada,
  normalizarTrackId,
  registrarRecente,
  resumoDaLeva,
} from "./tmsBipagemDomain.js";
// Os tokens do design system primeiro: é deles que a cor, o contraste e o raio
// do portal saem agora (ver o bloco .tms-portal em TmsPortal.css).
import "../../design-system/tokens.css";
import "./TmsPortal.css";
import { ACOES_TMS, linhasDeIntegracaoTms } from "./tmsIntegrationsDomain.js";
import "./TmsApiManager.css";
// Reaproveita o estilo do pino (divIcon) e do container do mapa já validados
// no RoteirizacaoPage — mesma técnica, mesma folha.
import "./pages/TodoGreenPages.css";

// Roteirização dinâmica de verdade: a mesma tela que já otimiza a ordem das
// paradas, calcula recarga, pedágio e carregadores no ERP, agora dentro do
// portal TMS (antes aqui só havia painel de vitrine). Lazy para não pesar o
// bundle de quem abre o TMS só para ver a torre de controle.
const RoteirizacaoDinamica = lazy(() => import("./pages/RoteirizacaoPage.jsx"));
// Configuração do rastreador (integração de ENTRADA: recebe posição e
// ocorrências da telemetria). A tela já existia pronta e testada, mas estava
// órfã — sem rota nem botão em lugar nenhum. Aqui ela ganha o botão que
// faltava dentro do próprio TMS. Lazy: só carrega quando a pessoa abre.
const TrackerConfig = lazy(() => import("./pages/TrackerPage.jsx"));

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

const STATUS_LABELS = {
  active: "Ativa", available: "Disponível", blocked: "Bloqueada", cancelled: "Cancelada",
  canceled: "Cancelada", checked: "Conferida", completed: "Concluída", draft: "Rascunho",
  eligible: "Elegível", failed: "Falha", in_progress: "Em execução", issued: "Emitido",
  maintenance: "Manutenção", ready: "Operacional", released: "Liberada", reserved: "Reservada",
};

const labelStatus = (value) => STATUS_LABELS[String(value || "").toLowerCase()] || String(value || "—")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const dateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const place = (value) => value?.city || value?.cidade || value?.name || value?.address || value?.endereco || "—";

const elapsed = (minutes) => {
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

const hasAccess = (access, permissions) => {
  if (["owner", "admin"].includes(access?.role)) return true;
  const grants = Array.isArray(access?.permissions) ? access.permissions : [];
  return grants.includes("*") || permissions.some((permission) => grants.includes(permission));
};

function SlaPill({ row }) {
  const sla = slaState(row);
  const complement = sla.level === "late" ? ` · ${elapsed(sla.minutes)}`
    : ["risk", "attention"].includes(sla.level) ? ` · ${elapsed(sla.minutes)}` : "";
  return <span className={`tms-sla ${sla.level}`} title={sla.deadline ? `Prazo: ${dateTime(sla.deadline)}` : "Prazo não informado"}>{sla.label}{complement}</span>;
}

const baixarCsv = (filename, columns, rows) => {
  const blob = new Blob([tmsCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

function WorkbenchToolbar({ rows, query, onQuery, status, onStatus, risk, onRisk, onExport, noun = "registros" }) {
  const statuses = [...new Set(rows.map((row) => String(row.status || "")).filter(Boolean))].sort();
  return (
    <div className="tms-workbench-toolbar">
      <label className="tms-search-field">
        <Search size={16} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`Buscar em ${noun}`} aria-label={`Buscar em ${noun}`} />
      </label>
      <label>
        <span>Situação</span>
        <select value={status} onChange={(event) => onStatus(event.target.value)}>
          <option value="">Todas</option>
          {statuses.map((item) => <option key={item} value={item}>{labelStatus(item)}</option>)}
        </select>
      </label>
      <label>
        <span>SLA</span>
        <select value={risk} onChange={(event) => onRisk(event.target.value)}>
          <option value="">Todos</option>
          <option value="late">Atrasado</option>
          <option value="risk">Risco em até 2h</option>
          <option value="attention">Vence em 24h</option>
          <option value="on_time">No prazo</option>
          <option value="no_deadline">Sem prazo</option>
          <option value="completed">Concluído</option>
        </select>
      </label>
      <button type="button" className="tms-secondary-action" onClick={onExport}><Download size={15} /> Exportar CSV</button>
    </div>
  );
}

function Pagination({ page, pages, total, onPage }) {
  if (total <= 20) return <p className="tms-result-count">{total} registro(s)</p>;
  return (
    <div className="tms-pagination">
      <span>{total} registros · página {page} de {pages}</span>
      <div>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Próxima página"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

const pathSection = () => {
  if (typeof window === "undefined") return "controle";
  const part = window.location.pathname.replace(/^\/portal-tms\/?/, "").split("/")[0];
  return SECTIONS.some((item) => item.id === part) ? part : "controle";
};

// Uma só porta de saída do portal para o ERP (a barra superior usa a mesma):
// pushState + popstate deixa o roteador do app trocar de portal sem recarregar.
const irParaOErp = (rota) => {
  window.history.pushState({}, "", rota);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

function StatusPill({ value }) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "nao_configurada") return <span className="tms-status pending">Não configurada</span>;
  if (normalized === "pendente") return <span className="tms-status pending">Falta concluir</span>;
  const tone = ["completed", "concluida", "autorizado", "issued", "closed", "ativa", "ready"].includes(normalized)
    ? "ok"
    : ["cancelled", "canceled", "cancelado", "error", "erro", "failed", "revogada"].includes(normalized)
      ? "danger"
      : "pending";
  return <span className={`tms-status ${tone}`}>{labelStatus(value)}</span>;
}

function Metric({ label, value, detail, alert = false, onClick, acao }) {
  const alertOn = alert && value != null && (typeof value === "number" ? value > 0 : String(value) !== money.format(0));
  const classe = `tms-metric ${alertOn ? "is-alert" : ""}${onClick ? " is-acao" : ""}`;
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
  const [processando, setProcessando] = useState(false);
  const [naFila, setNaFila] = useState(0);
  const [usandoCamera, setUsandoCamera] = useState(false);
  const [erroCamera, setErroCamera] = useState("");
  const [somLigado, setSomLigado] = useState(true);
  const [flash, setFlash] = useState(null); // { tipo: 'ok'|'erro'|'dup', texto }
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const controlesRef = useRef(null);
  const ultimaCameraRef = useRef({ valor: "", quando: 0 });
  const filaRef = useRef([]);
  const processandoRef = useRef(false);
  const recentesRef = useRef([]);
  const audioRef = useRef(null);
  const somRef = useRef(true);
  const eventTypeRef = useRef(eventType);
  const flashTimerRef = useRef(null);

  useEffect(() => { eventTypeRef.current = eventType; }, [eventType]);
  useEffect(() => { somRef.current = somLigado; }, [somLigado]);
  useEffect(() => { inputRef.current?.focus(); }, [usandoCamera]);
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    audioRef.current?.close?.();
  }, []);

  // Beep via WebAudio — o operador de esteira trabalha quase sem olhar a tela e
  // precisa ouvir se a leitura passou. Três tons distintos: sucesso (agudo
  // curto), repetição (dois toques médios) e erro (grave longo). Sem
  // dependência externa; se o áudio não abrir, segue sem beep.
  const beep = useCallback((tipo) => {
    if (!somRef.current) return;
    try {
      let ctx = audioRef.current;
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        audioRef.current = ctx;
      }
      if (ctx.state === "suspended") ctx.resume();
      const tocar = (freq, inicio, duracao) => {
        const osc = ctx.createOscillator();
        const ganho = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + inicio;
        ganho.gain.setValueAtTime(0.0001, t0);
        ganho.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
        ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
        osc.connect(ganho);
        ganho.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + duracao + 0.02);
      };
      if (tipo === "ok") tocar(1040, 0, 0.12);
      else if (tipo === "dup") { tocar(720, 0, 0.09); tocar(720, 0.13, 0.09); }
      else tocar(240, 0, 0.34);
    } catch {
      // ambiente sem áudio (ou bloqueado) — a bipagem continua funcionando
    }
  }, []);

  const mostrarFlash = useCallback((tipo, texto) => {
    setFlash({ tipo, texto });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 1400);
  }, []);

  // Esvazia a fila de leituras uma a uma. Nunca perde um bip: o coletor
  // físico dispara Enter rápido demais, então cada leitura só é enfileirada e
  // este laço processa em série mesmo que a rede esteja lenta.
  const processarFila = useCallback(async () => {
    if (processandoRef.current) return;
    processandoRef.current = true;
    setProcessando(true);
    try {
      while (filaRef.current.length) {
        const valor = filaRef.current.shift();
        setNaFila(filaRef.current.length);
        const agora = Date.now();
        if (ehDuplicada(valor, recentesRef.current, agora)) {
          beep("dup");
          mostrarFlash("dup", valor);
          setHistorico((atual) => [{
            ok: false, duplicada: true, trackId: valor, quando: new Date(),
            mensagem: "Volume já bipado agora há pouco — leitura repetida ignorada.",
          }, ...atual].slice(0, 40));
          continue;
        }
        recentesRef.current = registrarRecente(recentesRef.current, valor, agora);
        try {
          const resultado = await scanTmsTrackId({ trackId: valor, eventType: eventTypeRef.current });
          beep("ok");
          mostrarFlash("ok", valor);
          setHistorico((atual) => [{
            ok: true, trackId: valor, quando: new Date(),
            mensagem: `${resultado.pacote?.descricao || resultado.pacote?.trackId} — OS ${resultado.pedido?.numero}`,
          }, ...atual].slice(0, 40));
        } catch (reason) {
          beep("erro");
          mostrarFlash("erro", valor);
          setHistorico((atual) => [{
            ok: false, trackId: valor, quando: new Date(),
            mensagem: reason?.message || "Falha ao bipar.",
          }, ...atual].slice(0, 40));
        }
      }
    } finally {
      processandoRef.current = false;
      setProcessando(false);
      setNaFila(0);
      inputRef.current?.focus();
    }
  }, [beep, mostrarFlash]);

  const enfileirar = useCallback((trackId) => {
    const valor = normalizarTrackId(trackId);
    if (!valor) return;
    filaRef.current.push(valor);
    setNaFila(filaRef.current.length);
    setCodigo("");
    processarFila();
  }, [processarFila]);

  const aoTeclar = (event) => {
    if (event.key === "Enter") { event.preventDefault(); enfileirar(codigo); }
  };

  // Mantém o foco no campo: se o operador (ou o próprio coletor) tira o foco,
  // os próximos bips iriam para o vazio. Devolve o foco no próximo tick, exceto
  // quando a câmera está aberta ou o toque foi num controle de verdade.
  const aoPerderFoco = (event) => {
    if (usandoCamera) return;
    const proximo = event.relatedTarget;
    if (proximo && (proximo.tagName === "BUTTON" || proximo.tagName === "SELECT" || proximo.tagName === "A")) return;
    setTimeout(() => { if (!usandoCamera) inputRef.current?.focus(); }, 0);
  };

  useEffect(() => {
    if (!usandoCamera) return undefined;
    let cancelado = false;
    import("@zxing/browser").then(({ BrowserMultiFormatReader }) => {
      if (cancelado || !videoRef.current) return;
      const leitor = new BrowserMultiFormatReader();
      leitor.decodeFromVideoDevice(undefined, videoRef.current, (resultado) => {
        if (!resultado) return;
        // A câmera decodifica o mesmo quadro dezenas de vezes por segundo. Só
        // enfileira quando o código muda ou já passou a janela — senão o mesmo
        // volume viraria uma enxurrada de "repetido". O bip duplo do coletor
        // físico (evento discreto) continua sendo pego pela deduplicação da fila.
        const texto = normalizarTrackId(resultado.getText());
        const agora = Date.now();
        const ultima = ultimaCameraRef.current;
        if (texto === ultima.valor && agora - ultima.quando < 4000) return;
        ultimaCameraRef.current = { valor: texto, quando: agora };
        enfileirar(texto);
      }).then((controles) => { controlesRef.current = controles; })
        .catch((erro) => setErroCamera(erro?.message || "Não foi possível abrir a câmera."));
    });
    return () => { cancelado = true; controlesRef.current?.stop(); controlesRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usandoCamera]);

  const resumo = resumoDaLeva(historico);

  return (
    <section className="tms-panel">
      <div className="tms-panel-head">
        <div><span>Leitura de volume</span><h2>Bipagem</h2></div>
        <button
          type="button"
          className="tms-api-mini-button"
          onClick={() => setSomLigado((atual) => !atual)}
          title={somLigado ? "Silenciar o beep" : "Ligar o beep"}
        >
          {somLigado ? "🔊 Som ligado" : "🔇 Som mudo"}
        </button>
      </div>

      <div className="tms-bipagem-station">
        <div className={`tms-bipagem-flash ${flash ? `is-${flash.tipo}` : "is-idle"}`} aria-live="polite">
          {flash ? (
            <>
              <strong>
                {flash.tipo === "ok" ? "✓ Bipado" : flash.tipo === "dup" ? "↺ Repetido" : "✕ Falhou"}
              </strong>
              <span>{flash.texto}</span>
            </>
          ) : (
            <span className="tms-bipagem-flash-idle">Aguardando o próximo volume…</span>
          )}
        </div>

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
              ref={inputRef} className="tms-api-input tms-bipagem-input" value={codigo}
              onChange={(event) => setCodigo(event.target.value)} onKeyDown={aoTeclar} onBlur={aoPerderFoco}
              placeholder="Bipe com o leitor ou digite e pressione Enter"
              autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              inputMode="text"
            />
          </label>
          <p className="tms-bipagem-hint">
            Aponte o leitor físico (USB/Bluetooth) e bipe: o coletor digita o código e dá Enter sozinho.
            Sem leitor, use a câmera do celular ou digite à mão. Beep confirma cada leitura sem precisar olhar a tela.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="tms-api-mini-button" onClick={() => setUsandoCamera((atual) => !atual)}>
              {usandoCamera ? "Fechar câmera" : "Usar câmera do celular"}
            </button>
            {processando ? <span className="tms-bipagem-status">Registrando…{naFila > 0 ? ` (${naFila} na fila)` : ""}</span> : null}
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
        <div className="tms-bipagem-placar">
          <span className="ok">{resumo.ok} bipados</span>
          {resumo.duplicadas > 0 ? <span className="dup">{resumo.duplicadas} repetidos</span> : null}
          {resumo.erros > 0 ? <span className="erro">{resumo.erros} com erro</span> : null}
        </div>
        <h3>Últimas leituras</h3>
        {!historico.length ? <Empty>Nenhuma leitura ainda.</Empty> : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {historico.map((item, indice) => (
              <li key={`${item.trackId}-${indice}`} style={{ color: item.ok ? "var(--tms-accent, #0b9f8f)" : item.duplicada ? "#b45309" : "#dc2626", fontSize: 13 }}>
                <strong>{item.trackId}</strong> — {item.mensagem} <small>{item.quando.toLocaleTimeString("pt-BR")}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function OrdersTable({ rows = [], onOpen }) {
  if (!rows.length) return <Empty>Nenhuma ordem de serviço registrada.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>OS</th><th>Rota</th><th>Prazo</th><th>Quantidade</th><th>Valor</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.number || row.id}</strong><small>{row.clientId || "Cliente não informado"}</small></td>
            <td><strong>{place(row.origin)} <span className="tms-arrow">→</span> {place(row.destination)}</strong><small>{row.requestedAt ? `Solicitada em ${dateTime(row.requestedAt)}` : ""}</small></td>
            <td><SlaPill row={row} /></td>
            <td>{number.format(row.quantity || 0)} {row.chargeUnit || ""}</td>
            <td>{money.format(row.netAmount || 0)}</td>
            <td><StatusPill value={row.status} /></td>
            <td><button type="button" className="tms-icon-action" onClick={() => onOpen(row)} aria-label={`Abrir ${row.number || row.id}`}><Eye size={16} /></button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OperationsTable({ rows = [], onOpen }) {
  if (!rows.length) return <Empty>Nenhuma movimentação do TMS registrada.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Referência</th><th>Trecho</th><th>Prazo</th><th>Volumes</th><th>Veículo</th><th>Motorista</th><th>Status</th>{onOpen ? <th /> : null}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.reference || row.id}</strong><small>{row.invoiceNumber ? `NF ${row.invoiceNumber}` : row.serviceDate || ""}</small></td>
            <td>{row.origin || "—"} <span className="tms-arrow">→</span> {row.destination || "—"}</td>
            <td><SlaPill row={row} /></td>
            <td>{number.format(row.packages || 0)}<small>{row.weightKg ? `${number.format(row.weightKg)} kg` : ""}</small></td>
            <td>{row.vehiclePlate || "—"}</td>
            <td>{row.driverName || "—"}</td>
            <td><StatusPill value={row.status} /></td>
            {onOpen ? <td><button type="button" className="tms-icon-action" onClick={() => onOpen(row)} aria-label={`Abrir ${row.reference || row.id}`}><Eye size={16} /></button></td> : null}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const ORDER_ACTION_LABELS = {
  released: "Liberar OS",
  in_progress: "Iniciar execução",
  completed: "Concluir",
  cancelled: "Cancelar OS",
};

function OrderDetailsModal({ row, onClose, onTransition, onPod, busy, error, canPlan, canOperate }) {
  const nextStatuses = (SERVICE_ORDER_TRANSITIONS[row.status] || []).filter(() => (
    row.status === "draft" ? canPlan : canOperate
  ));
  return (
    <Modal title={`Ordem ${row.number || row.id}`} onClose={onClose} wide>
      <div className="tms-detail-grid">
        <div><span>Situação</span><StatusPill value={row.status} /></div>
        <div><span>SLA</span><SlaPill row={row} /></div>
        <div><span>Solicitada</span><strong>{dateTime(row.requestedAt)}</strong></div>
        <div><span>Prazo</span><strong>{dateTime(row.scheduledEndAt)}</strong></div>
        <div className="wide"><span>Rota</span><strong>{place(row.origin)} → {place(row.destination)}</strong></div>
        <div><span>Quantidade</span><strong>{number.format(row.quantity || 0)} {row.chargeUnit || ""}</strong></div>
        <div><span>Valor líquido</span><strong>{money.format(row.netAmount || 0)}</strong></div>
        <div><span>Cliente</span><strong>{row.clientId || "—"}</strong></div>
        <div><span>Operação</span><strong>{row.operationId || "—"}</strong></div>
      </div>
      <div className="tms-financial-strip">
        <span>Unitário <strong>{money.format(row.unitPrice || 0)}</strong></span>
        <span>Bruto <strong>{money.format(row.grossAmount || 0)}</strong></span>
        <span>Desconto <strong>{money.format(row.discountAmount || 0)}</strong></span>
        <span>Impostos <strong>{money.format(row.taxAmount || 0)}</strong></span>
      </div>
      {error ? <p className="tms-api-inline-error" role="alert">{error}</p> : null}
      <div className="tms-detail-actions">
        {nextStatuses.filter((status) => status !== "completed").map((status) => (
          <button key={status} type="button" className={status === "cancelled" ? "tms-danger-action" : "tms-primary-action"} onClick={() => onTransition(status)} disabled={busy}>
            {status === "in_progress" ? <Play size={16} /> : status === "cancelled" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            {busy ? "Salvando..." : ORDER_ACTION_LABELS[status]}
          </button>
        ))}
        {row.status === "in_progress" ? <button type="button" className="tms-primary-action" onClick={onPod} disabled={busy}><CheckCircle2 size={16} /> Registrar entrega e POD</button> : null}
        <button type="button" className="tms-secondary-action" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

function OperationDetailsModal({ row, onClose }) {
  return (
    <Modal title={`Movimentação ${row.reference || row.id}`} onClose={onClose} wide>
      <div className="tms-detail-grid">
        <div><span>Situação</span><StatusPill value={row.status} /></div>
        <div><span>SLA</span><SlaPill row={row} /></div>
        <div><span>Evento mais recente</span><strong>{dateTime(row.occurredAt)}</strong></div>
        <div><span>Prazo prometido</span><strong>{dateTime(row.promisedAt)}</strong></div>
        <div className="wide"><span>Trecho</span><strong>{row.origin || "—"} → {row.destination || "—"}</strong></div>
        <div><span>Volumes</span><strong>{number.format(row.packages || 0)}</strong></div>
        <div><span>Peso</span><strong>{number.format(row.weightKg || 0)} kg</strong></div>
        <div><span>Distância</span><strong>{number.format(row.distanceKm || 0)} km</strong></div>
        <div><span>Veículo</span><strong>{row.vehiclePlate || "—"}</strong></div>
        <div><span>Motorista</span><strong>{row.driverName || "—"}</strong></div>
        <div><span>Cliente</span><strong>{row.clientId || "Não vinculado"}</strong></div>
        <div><span>Operação</span><strong>{row.operationId || "Não projetada"}</strong></div>
        {row.occurrence ? <div className="wide"><span>Ocorrência</span><strong>{row.occurrence}</strong></div> : null}
      </div>
      <div className="tms-detail-actions"><button type="button" className="tms-secondary-action" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

function OrdersWorkbench({ rows = [], onReload, access }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [podOrder, setPodOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = useMemo(() => filterTmsRecords(rows, { query, status, risk }), [rows, query, status, risk]);
  const paged = useMemo(() => paginateTmsRecords(filtered, page, 20), [filtered, page]);

  const transition = async (nextStatus) => {
    if (!detail) return;
    if (nextStatus === "cancelled" && !window.confirm(`Cancelar a OS ${detail.number || detail.id}? O histórico será preservado.`)) return;
    setBusy(true);
    setError("");
    try {
      await transitionTmsOrder(detail.id, detail.revision, nextStatus);
      setDetail(null);
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível atualizar a ordem.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <WorkbenchToolbar
        rows={rows}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1); }}
        status={status}
        onStatus={(value) => { setStatus(value); setPage(1); }}
        risk={risk}
        onRisk={(value) => { setRisk(value); setPage(1); }}
        noun="cargas, clientes e rotas"
        onExport={() => baixarCsv("cargas-tms.csv", [
        { label: "OS", value: "number" }, { label: "Cliente", value: "clientId" },
        { label: "Origem", value: (row) => place(row.origin) }, { label: "Destino", value: (row) => place(row.destination) },
        { label: "Prazo", value: "scheduledEndAt" }, { label: "Quantidade", value: "quantity" },
        { label: "Unidade", value: "chargeUnit" }, { label: "Valor", value: "netAmount" }, { label: "Status", value: "status" },
        ], filtered)}
      />
      <OrdersTable rows={paged.rows} onOpen={setDetail} />
      <Pagination {...paged} onPage={setPage} />
      {detail ? <OrderDetailsModal
        row={detail}
        onClose={() => { setDetail(null); setError(""); }}
        onTransition={transition}
        onPod={() => { setPodOrder(detail); setDetail(null); }}
        busy={busy}
        error={error}
        canPlan={hasAccess(access, ["planning:manage", "product:manage"])}
        canOperate={hasAccess(access, ["operations:manage", "operation:manage"])}
      /> : null}
      {podOrder ? <div className="tms-workbench-pod"><PodCaptureForm pedido={podOrder} onClose={() => setPodOrder(null)} onReload={onReload} /></div> : null}
    </>
  );
}

function OperationsWorkbench({ rows = [] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const filtered = useMemo(() => filterTmsRecords(rows, { query, status, risk }), [rows, query, status, risk]);
  const paged = useMemo(() => paginateTmsRecords(filtered, page, 20), [filtered, page]);
  return (
    <>
      <WorkbenchToolbar
        rows={rows}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1); }}
        status={status}
        onStatus={(value) => { setStatus(value); setPage(1); }}
        risk={risk}
        onRisk={(value) => { setRisk(value); setPage(1); }}
        noun="viagens, NF, placas e motoristas"
        onExport={() => baixarCsv("viagens-tms.csv", [
        { label: "Referência", value: "reference" }, { label: "Cliente", value: "clientId" },
        { label: "Origem", value: "origin" }, { label: "Destino", value: "destination" },
        { label: "Prazo", value: "promisedAt" }, { label: "Volumes", value: "packages" },
        { label: "Peso kg", value: "weightKg" }, { label: "Placa", value: "vehiclePlate" },
        { label: "Motorista", value: "driverName" }, { label: "Status", value: "status" },
        ], filtered)}
      />
      <OperationsTable rows={paged.rows} onOpen={setDetail} />
      <Pagination {...paged} onPage={setPage} />
      {detail ? <OperationDetailsModal row={detail} onClose={() => setDetail(null)} /> : null}
    </>
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

function BillingSection({ data, onReload }) {
  const rows = useMemo(() => data?.all?.billing || [], [data?.all?.billing]);
  const canCheck = hasAccess(data?.access, ["finance:manage"]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return rows;
    return rows.filter((row) => Object.values(row).join(" ").toLocaleLowerCase("pt-BR").includes(term));
  }, [rows, query]);
  const paged = useMemo(() => paginateTmsRecords(filtered, page, 20), [filtered, page]);

  const check = async (row) => {
    setBusyId(row.id);
    setError("");
    try {
      await checkTmsBillingItem(row.id, row.revision, true);
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível conferir o item.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="tms-stack">
      <div className="tms-metrics tms-metrics-compact">
        <Metric label="Itens elegíveis" value={data?.indicators?.billingPending || 0} detail="com execução e POD" />
        <Metric label="Valor da fila" value={money.format(data?.indicators?.billingPendingAmount || 0)} detail="aguardando conferência" />
      </div>
      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Receita operacional</span><h2>Fila de faturamento</h2></div></div>
        <div className="tms-simple-toolbar">
          <label className="tms-search-field"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar OS, cliente ou competência" aria-label="Buscar faturamento" /></label>
          <button type="button" className="tms-secondary-action" onClick={() => baixarCsv("faturamento-tms.csv", [
            { label: "OS", value: "orderNumber" }, { label: "Cliente", value: "clientId" },
            { label: "Competência", value: "competenceDate" }, { label: "Valor", value: "amount" },
            { label: "Status", value: "status" },
          ], filtered)}><Download size={15} /> Exportar CSV</button>
        </div>
        {error ? <p className="tms-api-inline-error" role="alert">{error}</p> : null}
        {!paged.rows.length ? <Empty>Nenhum item elegível para faturamento.</Empty> : (
          <div className="tms-table-wrap">
            <table className="tms-table">
              <thead><tr><th>OS</th><th>Cliente</th><th>Competência</th><th>Valor</th><th>Status</th><th /></tr></thead>
              <tbody>{paged.rows.map((row) => <tr key={row.id}>
                <td><strong>{row.orderNumber || row.orderId || "—"}</strong></td>
                <td>{row.clientId || "—"}</td>
                <td>{row.competenceDate || "—"}</td>
                <td><strong>{money.format(row.amount || 0)}</strong></td>
                <td><StatusPill value={row.status} /></td>
                <td>{canCheck
                  ? <button type="button" className="tms-primary-action tms-table-action" onClick={() => check(row)} disabled={busyId === row.id}><CheckCircle2 size={14} /> {busyId === row.id ? "Conferindo..." : "Conferir"}</button>
                  : <span className="tms-permission-note">Somente Financeiro</span>}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        <Pagination {...paged} onPage={setPage} />
      </section>
    </div>
  );
}

function ControlTower({ data, onSection }) {
  const indicators = data?.indicators || {};
  const calculated = summarizeTms(data);
  const actions = buildTmsActionQueue(data);
  const readiness = [
    ["Roteirização", data?.readiness?.routing], ["API TMS", data?.readiness?.api],
    ["Faturamento", data?.readiness?.billing], ["Fiscal", data?.readiness?.fiscalProfile],
    ["CIOT", data?.readiness?.ciot],
  ];
  return (
    <>
      <section className="tms-command-hero">
        <div>
          <span><span className="tms-live-dot" /> OPERAÇÃO MONITORADA</span>
          <h2>Visão operacional em tempo real</h2>
          <p>Prioridade por SLA, execução, pendência fiscal e faturamento. Os indicadores consideram a operação inteira, não apenas a página visível.</p>
        </div>
        <div className="tms-command-stamp"><CalendarClock size={18} /><span>Atualizado</span><strong>{dateTime(data?.generatedAt)}</strong></div>
      </section>
      <div className="tms-metrics">
        <Metric label="OS abertas" value={indicators.ordersOpen} detail={`${data?.totals?.orders || calculated.orders} ordens no total`} acao="Gerenciar cargas →" onClick={() => onSection("cargas")} />
        <Metric label="Atrasadas" value={indicators.ordersDelayed} detail="SLA vencido" alert acao="Tratar agora →" onClick={() => onSection("cargas")} />
        <Metric label="Em risco" value={indicators.ordersAtRisk} detail="vencem em até 24h" alert acao="Priorizar →" onClick={() => onSection("cargas")} />
        <Metric label="Em trânsito" value={indicators.operationsInTransit} detail="movimentações abertas" acao="Acompanhar viagens →" onClick={() => onSection("viagens")} />
        <Metric label="Receita em risco" value={money.format(indicators.revenueAtRisk || 0)} detail="cargas atrasadas ou próximas do SLA" alert acao="Abrir fila crítica →" onClick={() => onSection("cargas")} />
        <Metric label="Pronto para faturar" value={money.format(indicators.billingPendingAmount || calculated.billingValue)} detail={`${indicators.billingPending || 0} itens elegíveis`} acao="Abrir faturamento →" onClick={() => onSection("faturamento")} />
      </div>

      <div className="tms-command-grid">
        <section className="tms-panel">
          <div className="tms-panel-head"><div><span>Fila prioritária</span><h2>O que exige ação</h2></div><strong className="tms-queue-count">{actions.length}</strong></div>
          <div className="tms-action-queue">
            {actions.map((action) => (
              <button type="button" key={action.id} className={`tms-action-item ${action.tone}`} onClick={() => onSection(action.section)}>
                <span className="tms-action-icon">{action.tone === "critical" ? <Siren size={18} /> : action.tone === "warning" ? <AlertTriangle size={18} /> : action.tone === "ok" ? <ShieldCheck size={18} /> : <CalendarClock size={18} />}</span>
                <span><strong>{action.title}</strong><small>{action.detail}</small></span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </section>
        <section className="tms-panel">
          <div className="tms-panel-head"><div><span>Saúde do ecossistema</span><h2>Serviços operacionais</h2></div></div>
          <div className="tms-system-health">
            {readiness.map(([label, ready]) => <div key={label} className={ready ? "ready" : "pending"}><span>{ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{label}</span><strong>{ready ? "Operacional" : "Configuração pendente"}</strong></div>)}
          </div>
          <button type="button" className="tms-secondary-action tms-health-link" onClick={() => onSection("integracoes")}>Ver integrações <ArrowRight size={15} /></button>
        </section>
      </div>

      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Esteira operacional</span><h2>Coleta, transferência e entrega conectadas</h2></div></div>
        <div className="tms-flow">
          {[
            ["Pedido", "Portal, arquivo ou API", ScanLine, "cargas"],
            ["Coleta inicial", "Coleta e chegada à base", MapPinned, "viagens"],
            ["Consolidação", "Agrupamento para transferência", Boxes, "fracionada"],
            ["Transferência", "Movimentação entre bases", Waypoints, "viagens"],
            ["Desconsolidação", "Separação para distribuição", Boxes, "fracionada"],
            ["Última milha", "Roteiro, entrega e comprovante", Truck, "roteirizacao"],
            ["Fiscal", "CT-e, MDF-e e CIOT", FileCheck2, "fiscal"],
            ["Faturamento", "Cobrança após execução", CircleDollarSign, "faturamento"],
          ].map(([title, detail, Icon, destino]) => <button type="button" className="tms-flow-step" key={title} onClick={() => onSection(destino)} title={`Abrir ${title}`}><div className="tms-flow-icon"><Icon size={19} /></div><div><strong>{title}</strong><small>{detail}</small></div><ArrowRight size={15} className="tms-flow-go" aria-hidden="true" /></button>)}
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
  // Sem hero próprio aqui: a RoteirizacaoPage já traz o cabeçalho completo da
  // roteirização. Antes o portal empilhava DOIS cabeçalhos de rota (o desta
  // seção + o da página) antes de o formulário aparecer — era o que mais fazia
  // a tela parecer poluída.
  return (
    <Suspense fallback={<div className="tms-loading"><RefreshCw size={22} className="spin" /><span>Abrindo roteirização...</span></div>}>
      {/* authHeaders é obrigatório: sem ele, Pedágios/Carregadores/IA chamam a
          API sem token e tomam 401 ("sessão expirada" falso). */}
      <RoteirizacaoDinamica setToast={setToast} authHeaders={authHeaders} />
    </Suspense>
  );
}

function FractionalCargo({ data, onSection }) {
  const operations = data?.all?.operations || [];
  const withVolume = operations.filter((item) => Number(item.packages) > 0 || Number(item.weightKg) > 0);
  const volumes = withVolume.reduce((sum, item) => sum + Number(item.packages || 0), 0);
  const weight = withVolume.reduce((sum, item) => sum + Number(item.weightKg || 0), 0);
  const unlinked = operations.filter((item) => !item.clientId || !item.operationId).length;
  return (
    <div className="tms-stack">
      <div className="tms-metrics tms-metrics-compact">
        <Metric label="Volumes monitorados" value={number.format(volumes)} detail="nos registros carregados" />
        <Metric label="Peso movimentado" value={`${number.format(weight)} kg`} detail="carga declarada" />
        <Metric label="Remessas fracionadas" value={withVolume.length} detail="com volume ou peso" />
        <Metric label="Sem vínculo" value={unlinked} detail="exigem reconciliação" alert onClick={() => onSection("integracoes")} acao="Tratar integração →" />
      </div>
      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Operação por volume</span><h2>Triagem e rastreabilidade</h2></div></div>
        <div className="tms-quick-actions">
          <button type="button" className="tms-primary-action" onClick={() => onSection("bipagem")}><ScanLine size={17} /> Bipar entrada, transferência ou entrega</button>
          <button type="button" className="tms-secondary-action" onClick={() => onSection("roteirizacao")}><Route size={17} /> Roteirizar última milha</button>
          <button type="button" className="tms-secondary-action" onClick={() => onSection("cargas")}><PackageSearch size={17} /> Criar nova carga</button>
        </div>
      </section>
      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Remessas reais</span><h2>Fluxo fracionado</h2></div></div>
        <OperationsWorkbench rows={withVolume} />
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
    if (!clientId) return undefined;
    let active = true;
    listTmsManualContracts(clientId)
      .then((result) => { if (active) setContratos(result?.contratos || []); })
      .catch(() => { if (active) setContratos([]); })
      .finally(() => { if (active) setCarregandoContratos(false); });
    return () => { active = false; };
  }, [clientId]);

  const selectClient = (value) => {
    setClientId(value);
    setContractId("");
    setContratos([]);
    setCarregandoContratos(Boolean(value));
  };

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
          <select className="tms-api-input" value={clientId} onChange={(event) => selectClient(event.target.value)} required>
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
  return (
    <div className="tms-stack">
      <section className="tms-panel"><div className="tms-panel-head"><div><span>Cadastro</span><h2>Nova carga</h2></div></div><NewOrderForm onReload={onReload} /></section>
      <section className="tms-panel"><div className="tms-panel-head"><div><span>Entrada operacional</span><h2>Cargas e ordens de serviço</h2></div><strong className="tms-queue-count">{data?.totals?.orders || 0}</strong></div><OrdersWorkbench rows={data?.all?.orders || []} onReload={onReload} access={data?.access} /></section>
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

function Integrations({ data, onReload, setToast }) {
  // A configuração do rastreador abre aqui mesmo, embaixo do botão — antes não
  // havia lugar nenhum para ligar a telemetria pelo TMS.
  const [configurando, setConfigurando] = useState(false);
  // As linhas (estado real, o que falta, ação que resolve) vêm do domínio
  // testado; aqui só executamos a ação que cada uma descreve.
  const rows = linhasDeIntegracaoTms(data?.integrations || {});
  const executar = (acao) => {
    if (acao.tipo === ACOES_TMS.configurarRastreador) { setConfigurando(true); return; }
    if (acao.tipo === ACOES_TMS.abrirNoErp) { irParaOErp(acao.rota); return; }
    document.getElementById("tms-api-chaves")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section className="tms-panel">
      <div className="tms-panel-head">
        <div><span>Conectividade</span><h2>Integrações do TMS</h2></div>
        <button
          type="button"
          className="tms-primary-action"
          aria-expanded={configurando}
          onClick={() => setConfigurando((atual) => !atual)}
        >
          <Cable size={16} /> {configurando ? "Fechar configuração" : "Configurar rastreador"}
        </button>
      </div>
      <div className="tms-integration-list">
        {rows.map((row) => (
          <div key={row.id}>
            <div className="tms-integration-icon"><Cable size={19} /></div>
            <span>
              <strong>{row.name}</strong>
              <small>{row.detail}</small>
              <small className="tms-integration-estado">{row.estado}</small>
            </span>
            <StatusPill value={row.status} />
            <button type="button" className="tms-secondary-action" onClick={() => executar(row.acao)}>{row.acao.rotulo}</button>
          </div>
        ))}
      </div>
      {configurando ? (
        <div className="tms-api-card" style={{ marginTop: 14 }}>
          <Suspense fallback={<div className="tms-loading"><RefreshCw size={20} className="spin" /><span>Abrindo a configuração do rastreador...</span></div>}>
            <TrackerConfig authHeaders={authHeaders} setToast={setToast} />
          </Suspense>
        </div>
      ) : null}
      <div className="tms-api-note">
        <div>
          <strong>API TMS externa {(data?.integrations?.api?.activeKeys || 0) > 0 ? "ativa" : "pronta — gere uma chave para ativar"}</strong>
          <p>Clientes e parceiros podem criar cargas, consultar pedidos, enviar rastreamento e comprovante de entrega, além de consultar CT-e, MDF-e, CIOT e faturamento sem entrar no ERP. Cada chave vale para um cliente e só libera o que você autorizar.</p>
        </div>
      </div>
      <div id="tms-api-chaves"><ApiManager api={data?.integrations?.api} onReload={onReload} /></div>
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

  useEffect(() => {
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60000);
    return () => clearInterval(id);
  }, [load]);
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

  // A Torre é um portal à parte, mas não pode ser um beco sem saída: quem entra
  // pela tela inicial do ERP só voltava editando a URL na mão. O `popstate`
  // avisa o roteador do app (ver src/routing/useRoutePath.js) para trocar de
  // portal sem recarregar a página.
  const voltarAoErp = useCallback(() => irParaOErp("/todogreen"), []);

  const active = useMemo(() => SECTIONS.find((item) => item.id === section) || SECTIONS[0], [section]);
  let content;
  if (section === "controle") content = <ControlTower data={data} onSection={navigate} />;
  if (section === "mapa") content = <FleetMap />;
  if (section === "bipagem") content = <ScanSection />;
  if (section === "cargas") content = <CargasSection data={data} onReload={load} />;
  if (section === "fracionada") content = <FractionalCargo data={data} onSection={navigate} />;
  if (section === "roteirizacao") content = <ElectricRouting setToast={mostrarToast} />;
  if (section === "viagens") content = <section className="tms-panel"><div className="tms-panel-head"><div><span>Execução</span><h2>Viagens e movimentações</h2></div><strong className="tms-queue-count">{data?.totals?.operations || 0}</strong></div><OperationsWorkbench rows={data?.all?.operations || []} /></section>;
  if (section === "fiscal") content = <div className="tms-stack"><section className="tms-panel"><div className="tms-panel-head"><div><span>Documentos fiscais</span><h2>CT-e e MDF-e</h2></div></div><FiscalTable rows={data?.recent?.fiscal} /></section><section className="tms-panel"><div className="tms-panel-head"><div><span>ANTT</span><h2>CIOT</h2></div></div><CiotTable rows={data?.recent?.ciots} /></section></div>;
  if (section === "faturamento") content = <BillingSection data={data} onReload={load} />;
  if (section === "integracoes") content = <Integrations data={data} onReload={load} setToast={mostrarToast} />;

  return (
    <div className="tms-portal">
      <aside className="tms-sidebar">
        <div className="tms-brand"><div className="tms-brand-mark">TDG</div><div><strong>TO DO GREEN</strong><span>Gestão de Transportes</span></div></div>
        <nav aria-label="Navegação do TMS">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="tms-sidebar-foot"><Activity size={16} /><span>Operação de transporte em tempo real</span></div>
      </aside>
      <main className="tms-main">
        <header className="tms-topbar">
          <div><span>PORTAL TMS · ATUALIZAÇÃO AUTOMÁTICA</span><h1>{active.label}</h1></div>
          <div className="tms-topbar-actions"><small>{data?.generatedAt ? `Última leitura ${dateTime(data.generatedAt)}` : ""}</small><button type="button" className="tms-refresh tms-voltar-erp" onClick={voltarAoErp}><ArrowLeft size={16} />Voltar ao ERP</button><button type="button" className="tms-refresh" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Atualizando" : "Atualizar"}</button></div>
        </header>
        {error ? <div className="tms-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
        {loading && !data ? <div className="tms-loading"><RefreshCw size={22} className="spin" /><span>Carregando torre de controle...</span></div> : content}
      </main>
      {toast.msg ? <div className="tms-toast" role="status">{toast.msg}</div> : null}
    </div>
  );
}
