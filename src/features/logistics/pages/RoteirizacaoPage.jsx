import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Plus, Route, Trash2 } from "lucide-react";
import { tracarRota } from "../distanciaRodoviariaDomain.js";
import "./TodoGreenPages.css";

// #81: roteirização com mapa. A titular pediu "roteirização com mapa" e vários
// endereços. O motor de rota já existia (Nominatim + OSRM, sem chave); aqui ele
// ganha o mapa e passa a aceitar quantas paradas você quiser. Marcadores são
// círculos numerados para não depender dos ícones-imagem do Leaflet (que
// quebram no bundle), e o mapa é forçado a recalcular o tamanho quando o
// container ganha dimensão — sem isso, um container que nasce com altura zero
// (tela carregada sob demanda) mostrava um mapa cinza/vazio.
const marcador = (coord, numero, cor) =>
  L.marker(coord, {
    icon: L.divIcon({
      className: "tdg-mapa-pin",
      html: `<span style="background:${cor}">${numero}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
  });

export default function RoteirizacaoPage({ setToast }) {
  const [paradas, setParadas] = useState(["", ""]);
  const [estado, setEstado] = useState({ fase: "parado" });

  const containerRef = useRef(null);
  const mapaRef = useRef(null);
  const camadaRef = useRef(null);

  // Cria o mapa uma vez e o mantém do tamanho certo mesmo que o container só
  // ganhe dimensão depois (Suspense/lazy). ResizeObserver + rAF resolvem o
  // clássico "mapa cinza" do Leaflet.
  useEffect(() => {
    if (mapaRef.current || !containerRef.current) return undefined;
    const mapa = L.map(containerRef.current, { scrollWheelZoom: true }).setView([-15.78, -47.93], 4);
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

  const alterarParada = (indice, valor) =>
    setParadas((atual) => atual.map((p, i) => (i === indice ? valor : p)));
  const adicionarParada = () => setParadas((atual) => [...atual, ""]);
  const removerParada = (indice) =>
    setParadas((atual) => (atual.length <= 2 ? atual : atual.filter((_, i) => i !== indice)));

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

  const calcular = async (event) => {
    event.preventDefault();
    const validas = paradas.map((p) => p.trim()).filter((p) => p.length >= 3);
    if (validas.length < 2) {
      setToast?.("Informe ao menos duas paradas (cidade e estado ajudam).");
      return;
    }
    setEstado({ fase: "calculando" });
    const resultado = await tracarRota({ paradas: validas });
    if (resultado.ok) {
      setEstado({ fase: "pronto", resultado });
      desenhar(resultado);
    } else {
      setEstado({ fase: "erro", motivo: resultado.motivo });
      setToast?.(resultado.motivo);
    }
  };

  const r = estado.resultado;
  const tempo = r ? (() => {
    const h = Math.floor(r.minutos / 60);
    const m = r.minutos % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
  })() : "";

  return (
    <section className="tdg-panel tdg-page tdg-roteirizacao">
      <header className="tdg-page-title">
        <div>
          <span>OPERAÇÃO · MAPA</span>
          <h2><Route size={20} /> Roteirização</h2>
          <p>Adicione quantas paradas quiser: cada endereço vira um ponto no mapa do OpenStreetMap, com a rota, a distância e o tempo total — sem chave e sem custo. A rota é referência (sem trânsito).</p>
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
                  onChange={(event) => alterarParada(indice, event.target.value)}
                  placeholder={indice === 0 ? "Ex.: Santos SP" : "Ex.: Campinas SP"}
                />
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
          <button type="submit" className="tdg-action" disabled={estado.fase === "calculando"}>
            <Route size={16} />{estado.fase === "calculando" ? "Traçando…" : "Traçar rota"}
          </button>
        </div>
      </form>

      {estado.fase === "erro" && <p className="tdg-roteirizacao-erro">{estado.motivo}</p>}
      {estado.fase === "pronto" && r && (
        <div className="tdg-roteirizacao-resumo">
          <strong>{r.distanciaKm} km</strong>
          <span>{tempo} de viagem, sem trânsito · {r.paradas.length} paradas</span>
          <small>{r.paradas.map((p) => p.rotulo.split(",")[0]).join(" → ")}</small>
          <small className="tdg-roteirizacao-fonte">{r.fonte}</small>
        </div>
      )}

      <div className="tdg-roteirizacao-mapa" ref={containerRef} style={{ minHeight: 360 }} aria-label="Mapa da rota" />
    </section>
  );
}
