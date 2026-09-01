import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Route, Navigation } from "lucide-react";
import { tracarRota } from "../distanciaRodoviariaDomain.js";
import "./TodoGreenPages.css";

// #81: roteirização com mapa. A titular pediu "roteirização com mapa" e
// escolheu o OpenStreetMap. O motor de rota já existia (Nominatim + OSRM, sem
// chave); aqui ele ganha o mapa: origem e destino viram uma linha desenhada
// sobre os tiles do OSM, com distância e tempo. Marcadores são círculos para
// não depender dos ícones-imagem do Leaflet (que quebram no bundle).
export default function RoteirizacaoPage({ setToast }) {
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [estado, setEstado] = useState({ fase: "parado" });

  const containerRef = useRef(null);
  const mapaRef = useRef(null);
  const camadaRotaRef = useRef(null);

  // Cria o mapa uma vez, centrado no Brasil.
  useEffect(() => {
    if (mapaRef.current || !containerRef.current) return undefined;
    const mapa = L.map(containerRef.current, { scrollWheelZoom: true }).setView([-15.78, -47.93], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(mapa);
    mapaRef.current = mapa;
    // O container começa escondido em telas lazy; um invalidate garante o
    // tamanho correto assim que ele aparece.
    setTimeout(() => mapa.invalidateSize(), 0);
    return () => {
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  const desenhar = (resultado) => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (camadaRotaRef.current) {
      mapa.removeLayer(camadaRotaRef.current);
      camadaRotaRef.current = null;
    }
    const grupo = L.layerGroup();
    L.polyline(resultado.pontos, { color: "#17624f", weight: 5, opacity: 0.85 }).addTo(grupo);
    L.circleMarker(resultado.origem.coord, { radius: 8, color: "#0b9f8f", fillColor: "#0b9f8f", fillOpacity: 1 })
      .bindPopup(`Origem: ${resultado.origem.rotulo}`)
      .addTo(grupo);
    L.circleMarker(resultado.destino.coord, { radius: 8, color: "#b4471f", fillColor: "#b4471f", fillOpacity: 1 })
      .bindPopup(`Destino: ${resultado.destino.rotulo}`)
      .addTo(grupo);
    grupo.addTo(mapa);
    camadaRotaRef.current = grupo;
    mapa.fitBounds(L.polyline(resultado.pontos).getBounds(), { padding: [40, 40] });
  };

  const calcular = async (event) => {
    event.preventDefault();
    if (String(origem).trim().length < 3 || String(destino).trim().length < 3) {
      setToast?.("Informe origem e destino (cidade e estado ajudam).");
      return;
    }
    setEstado({ fase: "calculando" });
    const resultado = await tracarRota({ origem, destino });
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
          <p>Origem e destino no mapa do OpenStreetMap, com a rota rodoviária, distância e tempo — sem chave e sem custo. A rota é referência (sem trânsito).</p>
        </div>
      </header>

      <form className="tdg-roteirizacao-form" onSubmit={calcular}>
        <label><span><MapPin size={14} /> Origem</span>
          <input value={origem} onChange={(event) => setOrigem(event.target.value)} placeholder="Ex.: Santos SP" required />
        </label>
        <label><span><Navigation size={14} /> Destino</span>
          <input value={destino} onChange={(event) => setDestino(event.target.value)} placeholder="Ex.: Campinas SP" required />
        </label>
        <button type="submit" className="tdg-action" disabled={estado.fase === "calculando"}>
          <Route size={16} />{estado.fase === "calculando" ? "Traçando…" : "Traçar rota"}
        </button>
      </form>

      {estado.fase === "erro" && <p className="tdg-roteirizacao-erro">{estado.motivo}</p>}
      {estado.fase === "pronto" && r && (
        <div className="tdg-roteirizacao-resumo">
          <strong>{r.distanciaKm} km</strong>
          <span>{tempo} de viagem, sem trânsito</span>
          <small>{r.origem.rotulo} → {r.destino.rotulo}</small>
          <small className="tdg-roteirizacao-fonte">{r.fonte}</small>
        </div>
      )}

      <div className="tdg-roteirizacao-mapa" ref={containerRef} aria-label="Mapa da rota" />
    </section>
  );
}
