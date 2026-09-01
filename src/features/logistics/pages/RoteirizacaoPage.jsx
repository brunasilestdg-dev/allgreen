import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BatteryCharging, Plug, Plus, Route, Shuffle, Trash2 } from "lucide-react";
import {
  normalizarCarregadores,
  otimizarOrdemDeParadas,
  sugerirEnderecos,
  tracarRota,
} from "../distanciaRodoviariaDomain.js";
import "./TodoGreenPages.css";

// #81/#89/#90/#91/#92/#95: roteirização com mapa (OpenStreetMap + Leaflet),
// várias paradas, mapa preso ao Brasil, otimização da ordem (vizinho mais
// próximo), estimativa de recarga (+1h30 por parada marcada), carregadores
// elétricos no mapa (Open Charge Map via gateway) e sugestão de endereço
// enquanto digita (Nominatim) — pensado para a frota elétrica pesada.
// Marcadores são círculos numerados para não depender dos ícones-imagem do
// Leaflet (que quebram no bundle), e o mapa recalcula o tamanho quando o
// container ganha dimensão (senão nasce cinza/vazio).
const MINUTOS_RECARGA = 90; // 1h30 por recarga (frota pesada elétrica).
// Caixa do Brasil, com folga, para o mapa não sair do país.
const LIMITES_BRASIL = [[-34.9, -74.2], [5.6, -33.7]];
const RAIO_CARREGADORES_KM = 100; // busca em volta do centro da rota.

const marcador = (coord, numero, cor) =>
  L.marker(coord, {
    icon: L.divIcon({
      className: "tdg-mapa-pin",
      html: `<span style="background:${cor}">${numero}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
  });

// Pino do carregador: verde quando serve pesado (DC rápido), cinza no AC lento.
const pinoCarregador = (coord, pesados) =>
  L.marker(coord, {
    icon: L.divIcon({
      className: "tdg-mapa-pin-carregador",
      html: `<span class="${pesados ? "pesado" : "leve"}">⚡</span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
  });

const formatarTempo = (minutos) => {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
};

export default function RoteirizacaoPage({ setToast, authHeaders }) {
  const [paradas, setParadas] = useState(["", ""]);
  const [recargas, setRecargas] = useState(() => new Set());
  const [estado, setEstado] = useState({ fase: "parado" });
  const [sugestoes, setSugestoes] = useState({});
  const [carregadores, setCarregadores] = useState({ fase: "off", lista: [] });

  const containerRef = useRef(null);
  const mapaRef = useRef(null);
  const camadaRef = useRef(null);
  const camadaCarregadoresRef = useRef(null);
  const timerSugestaoRef = useRef(null);

  useEffect(() => {
    if (mapaRef.current || !containerRef.current) return undefined;
    // #89: o mapa nasce no Brasil e não sai dele (maxBounds).
    const mapa = L.map(containerRef.current, { scrollWheelZoom: true, maxBounds: LIMITES_BRASIL, maxBoundsViscosity: 0.9 })
      .setView([-15.78, -47.93], 4);
    mapa.setMinZoom(4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(mapa);
    mapaRef.current = mapa;
    const recalc = () => mapa.invalidateSize();
    requestAnimationFrame(recalc);
    const observer = new ResizeObserver(recalc);
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  useEffect(() => () => clearTimeout(timerSugestaoRef.current), []);

  const alterarParada = (indice, valor) => {
    setParadas((atual) => atual.map((p, i) => (i === indice ? valor : p)));
    // #95/#96: sugestão de endereço com atraso (o Nominatim público aceita
    // ~1 consulta/s; debounce evita disparar a cada tecla).
    clearTimeout(timerSugestaoRef.current);
    const termo = valor.trim();
    if (termo.length < 3) {
      setSugestoes((atual) => ({ ...atual, [indice]: [] }));
      return;
    }
    timerSugestaoRef.current = setTimeout(async () => {
      const lista = await sugerirEnderecos(termo);
      setSugestoes((atual) => ({ ...atual, [indice]: lista }));
    }, 350);
  };
  const adicionarParada = () => setParadas((atual) => [...atual, ""]);
  const removerParada = (indice) =>
    setParadas((atual) => (atual.length <= 2 ? atual : atual.filter((_, i) => i !== indice)));
  const alternarRecarga = (indice) =>
    setRecargas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(indice)) proximo.delete(indice); else proximo.add(indice);
      return proximo;
    });

  const desenhar = (resultado) => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (camadaRef.current) {
      mapa.removeLayer(camadaRef.current);
      camadaRef.current = null;
    }
    const grupo = L.layerGroup();
    L.polyline(resultado.pontos, { color: "#17624f", weight: 5, opacity: 0.85 }).addTo(grupo);
    resultado.paradas.forEach((parada, indice) => {
      const cor = indice === 0 ? "#0b9f8f" : indice === resultado.paradas.length - 1 ? "#b4471f" : "#2c6fb0";
      marcador(parada.coord, indice + 1, cor).bindPopup(`${indice + 1}. ${parada.rotulo}`).addTo(grupo);
    });
    grupo.addTo(mapa);
    camadaRef.current = grupo;
    mapa.fitBounds(L.polyline(resultado.pontos).getBounds(), { padding: [40, 40] });
    requestAnimationFrame(() => mapa.invalidateSize());
  };

  const desenharCarregadores = (lista) => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (camadaCarregadoresRef.current) {
      mapa.removeLayer(camadaCarregadoresRef.current);
      camadaCarregadoresRef.current = null;
    }
    if (!lista.length) return;
    const grupo = L.layerGroup();
    lista.forEach((ponto) => {
      const potencia = ponto.potenciaKw ? `${ponto.potenciaKw} kW` : "potência não informada";
      const tipos = ponto.tipos.length ? ponto.tipos.join(", ") : "conector não informado";
      pinoCarregador(ponto.coord, ponto.pesados)
        .bindPopup(`<strong>${ponto.nome}</strong><br>${ponto.cidade || ""}<br>${potencia} · ${tipos}${ponto.pesados ? "<br><b>Serve pesado (DC rápido)</b>" : ""}`)
        .addTo(grupo);
    });
    grupo.addTo(mapa);
    camadaCarregadoresRef.current = grupo;
  };

  const tracar = async (lista) => {
    setEstado({ fase: "calculando" });
    const resultado = await tracarRota({ paradas: lista });
    if (resultado.ok) {
      setEstado({ fase: "pronto", resultado: { ...resultado, enderecos: lista } });
      desenhar(resultado);
      return resultado;
    }
    setEstado({ fase: "erro", motivo: resultado.motivo });
    setToast?.(resultado.motivo);
    return null;
  };

  const calcular = async (event) => {
    event.preventDefault();
    const validas = paradas.map((p) => p.trim()).filter((p) => p.length >= 3);
    if (validas.length < 2) {
      setToast?.("Informe ao menos duas paradas (cidade e estado ajudam).");
      return;
    }
    await tracar(validas);
  };

  // #92: reordena as paradas do meio por proximidade (a origem e o destino
  // ficam fixos) e traça de novo. Usa as coordenadas já resolvidas na última
  // rota, então é instantâneo.
  const otimizar = async () => {
    const r = estado.resultado;
    if (!r?.paradas || !r.enderecos) return;
    const comCoord = r.enderecos.map((endereco, i) => ({ endereco, coord: r.paradas[i]?.coord }));
    const nova = otimizarOrdemDeParadas(comCoord);
    if (nova.join("|") === r.enderecos.join("|")) {
      setToast?.("A ordem já está otimizada.");
      return;
    }
    setParadas(nova);
    setRecargas(new Set());
    await tracar(nova);
    setToast?.("Ordem das paradas otimizada.");
  };

  // #90: carregadores elétricos no mapa. Busca no Open Charge Map (pelo
  // gateway do backend, que guarda a chave) em volta do centro da rota, com
  // foco em pesados (DC de alta potência marcado em verde). Sem chave
  // configurada, o backend responde 400 e a tela avisa — não trava nada.
  const alternarCarregadores = async () => {
    if (carregadores.fase === "on") {
      desenharCarregadores([]);
      setCarregadores({ fase: "off", lista: [] });
      return;
    }
    const mapa = mapaRef.current;
    if (!mapa) return;
    const centro = mapa.getCenter();
    setCarregadores({ fase: "buscando", lista: [] });
    try {
      const resposta = await fetch("/api/todogreen/integrations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({
          provider: "open-charge-map",
          action: "nearby",
          input: { latitude: centro.lat, longitude: centro.lng, distanceKm: RAIO_CARREGADORES_KM, limit: 60 },
        }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        setCarregadores({ fase: "off", lista: [] });
        setToast?.(dados.error || "Não foi possível buscar carregadores agora.");
        return;
      }
      const pontos = normalizarCarregadores(dados.result);
      desenharCarregadores(pontos);
      setCarregadores({ fase: "on", lista: pontos });
      setToast?.(pontos.length
        ? `${pontos.length} ponto(s) de recarga no raio de ${RAIO_CARREGADORES_KM} km.`
        : "Nenhum ponto de recarga encontrado nesse trecho.");
    } catch {
      setCarregadores({ fase: "off", lista: [] });
      setToast?.("Não foi possível buscar carregadores agora.");
    }
  };

  const r = estado.resultado;
  const qtdRecargas = r ? [...recargas].filter((i) => i < (r.enderecos?.length || 0)).length : 0;
  const minutosTotal = r ? r.minutos + qtdRecargas * MINUTOS_RECARGA : 0;
  const pesadosNoMapa = carregadores.lista.filter((c) => c.pesados).length;

  return (
    <section className="tdg-panel tdg-page tdg-roteirizacao">
      <header className="tdg-page-title">
        <div>
          <span>OPERAÇÃO · MAPA</span>
          <h2><Route size={20} /> Roteirização</h2>
          <p>Várias paradas no mapa do Brasil (OpenStreetMap), com rota, distância e tempo. Digite e escolha o endereço na sugestão, marque as paradas de recarga (soma 1h30 cada), use "Otimizar ordem" para tirar o zigue-zague e "Carregadores" para ver pontos de recarga (foco em pesados). Referência, sem trânsito.</p>
        </div>
      </header>

      <form className="tdg-roteirizacao-form" onSubmit={calcular}>
        <div className="tdg-roteirizacao-paradas">
          {paradas.map((valor, indice) => (
            <div className="tdg-roteirizacao-parada" key={indice}>
              <span className="tdg-roteirizacao-num" aria-hidden="true">{indice + 1}</span>
              <label className="tdg-roteirizacao-campo">
                <span>{indice === 0 ? "Origem" : indice === paradas.length - 1 ? "Destino" : `Parada ${indice}`}</span>
                <input
                  value={valor}
                  list={`tdg-sug-${indice}`}
                  autoComplete="off"
                  onChange={(event) => alterarParada(indice, event.target.value)}
                  placeholder={indice === 0 ? "Ex.: Santos SP" : "Ex.: Campinas SP"}
                />
                <datalist id={`tdg-sug-${indice}`}>
                  {(sugestoes[indice] || []).map((s) => (
                    <option key={s.rotulo} value={s.rotulo} />
                  ))}
                </datalist>
              </label>
              <label className={`tdg-roteirizacao-recarga${recargas.has(indice) ? " ativa" : ""}`} title="Marcar como parada de recarga (+1h30)">
                <input type="checkbox" checked={recargas.has(indice)} onChange={() => alternarRecarga(indice)} />
                <BatteryCharging size={16} />
              </label>
              {paradas.length > 2 && (
                <button type="button" className="tdg-roteirizacao-remover" onClick={() => removerParada(indice)} aria-label={`Remover parada ${indice + 1}`}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="tdg-roteirizacao-acoes">
          <button type="button" className="tdg-action tdg-action-ghost" onClick={adicionarParada}>
            <Plus size={16} /> Adicionar parada
          </button>
          {estado.fase === "pronto" && (
            <button type="button" className="tdg-action tdg-action-ghost" onClick={otimizar}>
              <Shuffle size={16} /> Otimizar ordem
            </button>
          )}
          <button
            type="button"
            className={`tdg-action tdg-action-ghost${carregadores.fase === "on" ? " ativa" : ""}`}
            onClick={alternarCarregadores}
            disabled={carregadores.fase === "buscando"}
          >
            <Plug size={16} />{carregadores.fase === "buscando" ? "Buscando…" : carregadores.fase === "on" ? "Ocultar carregadores" : "Carregadores"}
          </button>
          <button type="submit" className="tdg-action" disabled={estado.fase === "calculando"}>
            <Route size={16} />{estado.fase === "calculando" ? "Traçando…" : "Traçar rota"}
          </button>
        </div>
      </form>

      {estado.fase === "erro" && <p className="tdg-roteirizacao-erro">{estado.motivo}</p>}
      {estado.fase === "pronto" && r && (
        <div className="tdg-roteirizacao-resumo">
          <strong>{r.distanciaKm} km</strong>
          <span>
            {formatarTempo(minutosTotal)} no total
            {qtdRecargas > 0 ? ` (${formatarTempo(r.minutos)} de viagem + ${qtdRecargas} recarga(s) de 1h30)` : " de viagem"}
            , sem trânsito · {r.paradas.length} paradas
          </span>
          <small>{r.paradas.map((p) => p.rotulo.split(",")[0]).join(" → ")}</small>
          <small className="tdg-roteirizacao-fonte">{r.fonte}</small>
        </div>
      )}

      {carregadores.fase === "on" && (
        <p className="tdg-roteirizacao-carregadores-info">
          <Plug size={14} /> {carregadores.lista.length} carregador(es) no mapa · <b>{pesadosNoMapa}</b> servem pesado (DC rápido, ⚡ verde). Fonte: Open Charge Map.
        </p>
      )}

      <div className="tdg-roteirizacao-mapa" ref={containerRef} style={{ minHeight: 360 }} aria-label="Mapa da rota" />
    </section>
  );
}
