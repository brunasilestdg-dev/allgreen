import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BatteryCharging, Clock, Coins, GripVertical, Navigation, Plug, Plus, Route, Shuffle, Sparkles, Trash2 } from "lucide-react";
import {
  aplicarOrdemDoMeio,
  otimizarOrdemDeParadas,
  sugerirEnderecos,
  tracarRota,
} from "../distanciaRodoviariaDomain.js";
import { estimarTotalPedagios } from "../pedagiosDomain.js";
import "./TodoGreenPages.css";

const formatarReais = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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

// Move um item de `from` para `to` sem mutar o original — base do arrastar
// paradas. Usado em paradas, janelas e no espelho booleano das recargas, para
// os três andarem juntos na reordenação.
const arrayMove = (arr, from, to) => {
  const copia = arr.slice();
  const [item] = copia.splice(from, 1);
  copia.splice(to, 0, item);
  return copia;
};

// Fator de trânsito honesto e transparente: sem provedor pago, o OSRM dá tempo
// de fluxo livre. Nos horários de pico (7-9h e 17-19h) aplicamos um acréscimo
// declarado à ESTIMATIVA — não é trânsito ao vivo, é uma régua de pico. Fora do
// pico, 1.0 (sem mexer). Parte "HH:MM" ou ISO; hora inválida devolve 1.0.
const fatorDeTransito = (partidaISO) => {
  const hora = Number(String(partidaISO || "").slice(11, 13));
  if (!Number.isFinite(hora)) return 1;
  if (hora >= 7 && hora < 9) return 1.35;
  if (hora >= 17 && hora < 19) return 1.4;
  if ((hora >= 6 && hora < 7) || (hora >= 9 && hora < 10) || (hora >= 16 && hora < 17) || (hora >= 19 && hora < 20)) return 1.15;
  return 1;
};

// Soma minutos a um instante e devolve "HH:MM" (chegada estimada). Parte
// vazia devolve "".
const horaMais = (partidaISO, minutos) => {
  if (!partidaISO) return "";
  const base = new Date(partidaISO);
  if (!Number.isFinite(base.getTime())) return "";
  const fim = new Date(base.getTime() + minutos * 60000);
  return `${String(fim.getHours()).padStart(2, "0")}:${String(fim.getMinutes()).padStart(2, "0")}`;
};

export default function RoteirizacaoPage({ setToast, authHeaders }) {
  const [paradas, setParadas] = useState(["", ""]);
  const [recargas, setRecargas] = useState(() => new Set());
  // Janela de horário por parada (paralelo a `paradas`): { inicio, fim } em
  // "HH:MM". Alimenta o otimizador IA e a leitura da chegada estimada.
  const [janelas, setJanelas] = useState(() => [{ inicio: "", fim: "" }, { inicio: "", fim: "" }]);
  const [restricoes, setRestricoes] = useState("");
  const [iaEstado, setIaEstado] = useState({ fase: "idle" });
  const [estado, setEstado] = useState({ fase: "parado" });
  const [sugestoes, setSugestoes] = useState({});
  const [carregadores, setCarregadores] = useState({ fase: "off", lista: [] });
  const [pedagios, setPedagios] = useState({ fase: "idle" });
  const [tarifaMedia, setTarifaMedia] = useState("");
  // Trânsito: horário de partida + fator de pico (estimativa transparente; o
  // trânsito ao vivo real depende de provedor pago, ligado por chave depois).
  const [partida, setPartida] = useState("");
  const [considerarTransito, setConsiderarTransito] = useState(false);
  // Índice sendo arrastado (reordenar paradas ao estilo Circuit/Linx).
  const [arrastando, setArrastando] = useState(null);

  const containerRef = useRef(null);
  const mapaRef = useRef(null);
  const camadaRef = useRef(null);
  const camadaCarregadoresRef = useRef(null);
  const timerSugestaoRef = useRef(null);
  // Endereço (texto exato) → coordenada já resolvida pela sugestão escolhida.
  // Com isso a rota usa o ponto exato do endereço completo, sem depender de o
  // Nominatim reencontrar o texto livre — resolve o "só cidade x cidade".
  const coordsResolvidasRef = useRef({});

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
    const termo = valor.trim();
    // Se o valor bate com uma sugestão (a pessoa escolheu no autopreenchimento),
    // guarda a coordenada exata dela para a rota usar o endereço completo.
    const escolhida = (sugestoes[indice] || []).find((s) => s.rotulo === valor);
    if (escolhida) coordsResolvidasRef.current[termo] = [escolhida.latitude, escolhida.longitude];
    // #95/#96: sugestão de endereço com atraso (o Nominatim público aceita
    // ~1 consulta/s; debounce evita disparar a cada tecla).
    clearTimeout(timerSugestaoRef.current);
    if (termo.length < 3) {
      setSugestoes((atual) => ({ ...atual, [indice]: [] }));
      return;
    }
    timerSugestaoRef.current = setTimeout(async () => {
      const lista = await sugerirEnderecos(termo);
      setSugestoes((atual) => ({ ...atual, [indice]: lista }));
    }, 350);
  };
  const adicionarParada = () => {
    setParadas((atual) => [...atual, ""]);
    setJanelas((atual) => [...atual, { inicio: "", fim: "" }]);
  };
  const removerParada = (indice) => {
    setParadas((atual) => (atual.length <= 2 ? atual : atual.filter((_, i) => i !== indice)));
    setJanelas((atual) => (paradas.length <= 2 ? atual : atual.filter((_, i) => i !== indice)));
    setRecargas((atual) => {
      // Os índices acima de `indice` recuam um; o removido sai.
      const bool = paradas.map((_, i) => atual.has(i)).filter((_, i) => i !== indice);
      const next = new Set();
      bool.forEach((v, i) => { if (v) next.add(i); });
      return next;
    });
  };
  const alternarRecarga = (indice) =>
    setRecargas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(indice)) proximo.delete(indice); else proximo.add(indice);
      return proximo;
    });
  const alterarJanela = (indice, campo, valor) =>
    setJanelas((atual) => atual.map((j, i) => (i === indice ? { ...j, [campo]: valor } : j)));

  // Reordena as paradas (arrastar-e-soltar). Paradas, janelas e recargas andam
  // juntas; as sugestões se limpam (os índices mudaram) e as coords ficam
  // (indexadas pelo texto do endereço, não pela posição).
  const moverParada = (de, para) => {
    if (de === para || de == null || para == null) return;
    setParadas((atual) => arrayMove(atual, de, para));
    setJanelas((atual) => arrayMove(atual, de, para));
    setRecargas((atual) => {
      const bool = arrayMove(paradas.map((_, i) => atual.has(i)), de, para);
      const next = new Set();
      bool.forEach((v, i) => { if (v) next.add(i); });
      return next;
    });
    setSugestoes({});
  };

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
    setPedagios({ fase: "idle" });
    // Cada parada leva a coordenada exata quando veio do autopreenchimento;
    // senão o backend geocodifica o texto (agora tolerando endereço completo).
    const comCoords = lista.map((endereco) => ({
      endereco,
      coord: coordsResolvidasRef.current[String(endereco).trim()] || null,
    }));
    const resultado = await tracarRota({ paradas: comCoords });
    if (resultado.ok) {
      setEstado({ fase: "pronto", resultado: { ...resultado, enderecos: lista } });
      desenhar(resultado);
      return resultado;
    }
    setEstado({ fase: "erro", motivo: resultado.motivo });
    setToast?.(resultado.motivo);
    return null;
  };

  // #94 (gratuito): praças de pedágio da rota pelos dados abertos da ANTT.
  // Manda a geometria da rota (polyline já traçada) ao backend, que casa as
  // praças ATIVAS por proximidade. A ANTT não fornece a tarifa; o total é
  // estimado só quando a pessoa informa a tarifa média por praça do caminhão.
  const consultarPedagios = async () => {
    const linha = estado.resultado?.pontos;
    if (!Array.isArray(linha) || linha.length < 2) {
      setToast?.("Trace a rota antes de consultar os pedágios.");
      return;
    }
    setPedagios({ fase: "buscando" });
    try {
      const resposta = await fetch("/api/todogreen/pedagios", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ polyline: linha }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.error || "Pedágios indisponíveis agora.");
      setPedagios({ fase: "ok", dados });
    } catch (motivo) {
      setPedagios({ fase: "erro", motivo: motivo.message });
      setToast?.(motivo.message);
    }
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
    reordenarEstado(r.enderecos, nova);
    await tracar(nova);
    setToast?.("Ordem das paradas otimizada.");
  };

  // Reordena paradas + janelas + recargas para bater com `novos` (uma
  // permutação de `velhos`, por endereço, consumindo duplicatas). Base comum do
  // "Otimizar ordem" e do "Sugerir (IA)": nenhum dos dois perde a janela nem a
  // marca de recarga da parada, que agora viajam com ela.
  const reordenarEstado = (velhos, novos) => {
    const usados = new Array(velhos.length).fill(false);
    const perm = novos.map((end) => {
      const idx = velhos.findIndex((v, i) => !usados[i] && v === end);
      if (idx >= 0) usados[idx] = true;
      return idx;
    });
    setParadas(novos);
    setJanelas((atual) => perm.map((oi) => (oi >= 0 ? atual[oi] || { inicio: "", fim: "" } : { inicio: "", fim: "" })));
    setRecargas((atual) => {
      const next = new Set();
      perm.forEach((oi, ni) => { if (oi >= 0 && atual.has(oi)) next.add(ni); });
      return next;
    });
    setSugestoes({});
  };

  // #93: a IA sugere a ordem das paradas do meio a partir de restrições em texto
  // (janela de entrega, prioridade). Origem e destino ficam fixos, como no
  // otimizador geométrico. A resposta da IA é validada por aplicarOrdemDoMeio:
  // se não for uma permutação exata do meio, não mexemos em nada — a IA erra e a
  // rota não perde nem duplica parada.
  const sugerirComIA = async () => {
    const validas = paradas.map((p) => p.trim()).filter((p) => p.length >= 3);
    if (validas.length < 4) {
      setToast?.("Para a IA reordenar, informe origem, destino e ao menos duas paradas no meio.");
      return;
    }
    setIaEstado({ fase: "pensando" });
    // Janelas alinhadas às paradas válidas (mesmo filtro), para o prompt citar a
    // faixa de horário de cada parada do meio — a IA passa a ordenar por ela.
    const idxValidas = paradas.map((p, i) => ({ p: p.trim(), i })).filter((x) => x.p.length >= 3).map((x) => x.i);
    const janelasValidas = idxValidas.map((i) => janelas[i] || { inicio: "", fim: "" });
    const meio = validas.slice(1, -1).map((p, i) => {
      const j = janelasValidas[i + 1] || {};
      const faixa = j.inicio || j.fim ? ` [janela ${j.inicio || "?"}–${j.fim || "?"}]` : "";
      return `${i + 1}. ${p}${faixa}`;
    }).join("\n");
    const prompt = `Você é um roteirizador de logística de uma transportadora rodoviária 100% elétrica no Brasil. A rota tem origem e destino FIXOS; você só decide a ordem de visita das paradas do meio.

Origem: ${validas[0]}
Destino: ${validas[validas.length - 1]}

Paradas do meio (numeradas):
${meio}

Restrições do usuário: ${restricoes.trim() || "nenhuma além de reduzir distância e tempo"}

Responda SOMENTE com um objeto JSON válido, sem comentários e sem cercas de código:
{"ordem": [<números das paradas do meio na melhor sequência de visita>], "motivo": "uma frase curta em português"}

Regras:
- "ordem" deve conter TODOS os números das paradas do meio (de 1 a ${validas.length - 2}), cada um uma única vez, sem repetir nem inventar.
- Respeite as restrições (janelas de entrega, prioridade); na falta delas, minimize distância e tempo. Não invente números, prazos ou pedágios.`;
    try {
      const resposta = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ prompt, specialist: "Estrategista" }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.error || "A IA não respondeu agora.");
      const bruto = String(dados.content || "").replace(/```json|```/g, "").trim();
      const recorte = bruto.slice(bruto.indexOf("{"), bruto.lastIndexOf("}") + 1);
      const obj = JSON.parse(recorte);
      const nova = aplicarOrdemDoMeio(validas, (obj.ordem || []).map((n) => Number(n)));
      if (!nova) throw new Error("A IA devolveu uma ordem inválida. Tente de novo ou ajuste as restrições.");
      reordenarEstado(validas, nova);
      setIaEstado({ fase: "ok", motivo: String(obj.motivo || "").slice(0, 200) });
      await tracar(nova);
      setToast?.("Ordem sugerida pela IA aplicada.");
    } catch (motivo) {
      setIaEstado({ fase: "erro", motivo: motivo.message });
      setToast?.(motivo.message);
    }
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
      const resposta = await fetch("/api/todogreen/carregadores", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({
          latitude: centro.lat, longitude: centro.lng, distanceKm: RAIO_CARREGADORES_KM, limit: 60,
        }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        setCarregadores({ fase: "off", lista: [] });
        setToast?.(dados.error || "Não foi possível buscar carregadores agora.");
        return;
      }
      const pontos = Array.isArray(dados.pontos) ? dados.pontos : [];
      desenharCarregadores(pontos);
      setCarregadores({ fase: "on", lista: pontos, fonte: dados.fonte || "OpenStreetMap" });
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
  // Trânsito: só na estimativa, e só quando a pessoa marca. Aplica o fator de
  // pico ao tempo de VIAGEM (não às recargas, que são fixas de 1h30).
  const fatorTransito = considerarTransito ? fatorDeTransito(partida) : 1;
  const minutosComTransito = r ? Math.round(r.minutos * fatorTransito) + qtdRecargas * MINUTOS_RECARGA : 0;
  const chegadaEstimada = horaMais(partida, minutosComTransito);

  return (
    <section className="tdg-panel tdg-page tdg-roteirizacao">
      <header className="tdg-page-title">
        <div>
          <span>OPERAÇÃO · MAPA</span>
          <h2><Route size={20} /> Roteirização</h2>
          <p>Várias paradas no mapa do Brasil (OpenStreetMap), com rota, distância e tempo. Digite e escolha o endereço na sugestão, <strong>arraste pela alça para reordenar</strong>, marque a <strong>janela de horário</strong> de cada parada (a IA respeita), defina a saída para ver a <strong>chegada estimada</strong> (com régua de trânsito de pico), marque recargas (1h30 cada) e veja pedágios e carregadores (foco em pesados).</p>
        </div>
      </header>

      {/* Workspace de duas colunas ao estilo Circuit/Linx: controles e paradas
          à esquerda, o mapa como herói à direita (grande e fixo enquanto se
          rola a lista). No celular, empilha — mapa primeiro. */}
      <div className="tdg-rot-workspace">
        <div className="tdg-rot-esquerda">

      <form className="tdg-roteirizacao-form" onSubmit={calcular}>
        <div className="tdg-roteirizacao-paradas">
          {paradas.map((valor, indice) => {
            const papel = indice === 0 ? "origem" : indice === paradas.length - 1 ? "destino" : "meio";
            const recarga = recargas.has(indice);
            const janela = janelas[indice] || { inicio: "", fim: "" };
            return (
              <div
                className={`tdg-roteirizacao-parada ${papel}${arrastando === indice ? " arrastando" : ""}`}
                key={indice}
                onDragOver={(event) => { if (arrastando != null) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); moverParada(arrastando, indice); setArrastando(null); }}
              >
                {/* Só a alça arrasta — o campo de endereço segue selecionável. */}
                <span
                  className="tdg-roteirizacao-arrasta"
                  draggable
                  onDragStart={(event) => { setArrastando(indice); event.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setArrastando(null)}
                  title="Arraste para reordenar"
                  aria-label={`Arrastar parada ${indice + 1} para reordenar`}
                >
                  <GripVertical size={16} />
                </span>
                <span className="tdg-roteirizacao-num" aria-hidden="true">{indice + 1}</span>
                <label className="tdg-roteirizacao-campo">
                  <span>{papel === "origem" ? "Origem" : papel === "destino" ? "Destino" : `Parada ${indice}`}</span>
                  <input
                    value={valor}
                    list={`tdg-sug-${indice}`}
                    autoComplete="off"
                    onChange={(event) => alterarParada(indice, event.target.value)}
                    placeholder={indice === 0 ? "Ex.: Rua da Estação, 100, Santos SP" : "Ex.: Av. Brasil, 500, Campinas SP"}
                  />
                  <datalist id={`tdg-sug-${indice}`}>
                    {(sugestoes[indice] || []).map((s) => (
                      <option key={s.rotulo} value={s.rotulo} />
                    ))}
                  </datalist>
                </label>
                <div className="tdg-roteirizacao-janela" title="Janela de horário para esta parada (opcional)">
                  <Clock size={13} aria-hidden="true" />
                  <input type="time" aria-label={`Início da janela da parada ${indice + 1}`} value={janela.inicio} onChange={(event) => alterarJanela(indice, "inicio", event.target.value)} />
                  <span aria-hidden="true">–</span>
                  <input type="time" aria-label={`Fim da janela da parada ${indice + 1}`} value={janela.fim} onChange={(event) => alterarJanela(indice, "fim", event.target.value)} />
                </div>
                <button
                  type="button"
                  className={`tdg-roteirizacao-recarga${recarga ? " ativa" : ""}`}
                  onClick={() => alternarRecarga(indice)}
                  aria-pressed={recarga}
                  title="Marcar esta parada como recarga (soma 1h30)"
                >
                  <BatteryCharging size={15} /> Recarga
                </button>
                {paradas.length > 2 && (
                  <button type="button" className="tdg-roteirizacao-remover" onClick={() => removerParada(indice)} aria-label={`Remover parada ${indice + 1}`}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <label className="tdg-roteirizacao-restricoes">
          <span>Restrições para a IA (opcional)</span>
          <textarea
            value={restricoes}
            onChange={(event) => setRestricoes(event.target.value)}
            rows={2}
            placeholder="Ex.: entregar Campinas antes das 12h; a parada de Sorocaba é prioridade; evitar centro de SP no horário de pico."
          />
        </label>
        {/* Partida + trânsito: dá a chegada estimada. O trânsito ao vivo real
            depende de provedor pago; aqui é uma régua de pico transparente. */}
        <div className="tdg-roteirizacao-partida">
          <label>
            <span><Navigation size={13} aria-hidden="true" /> Saída</span>
            <input type="datetime-local" value={partida} onChange={(event) => setPartida(event.target.value)} />
          </label>
          <label className="tdg-roteirizacao-transito-check" title="Aplica um acréscimo de horário de pico à ESTIMATIVA (não é trânsito ao vivo)">
            <input type="checkbox" checked={considerarTransito} onChange={(event) => setConsiderarTransito(event.target.checked)} />
            <span>Considerar trânsito de pico (estimativa)</span>
          </label>
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
          {paradas.filter((p) => p.trim().length >= 3).length >= 4 && (
            <button
              type="button"
              className="tdg-action tdg-action-ghost"
              onClick={sugerirComIA}
              disabled={iaEstado.fase === "pensando"}
            >
              <Sparkles size={16} />{iaEstado.fase === "pensando" ? "Pensando…" : "Sugerir ordem (IA)"}
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
          {estado.fase === "pronto" && (
            <button
              type="button"
              className="tdg-action tdg-action-ghost"
              onClick={consultarPedagios}
              disabled={pedagios.fase === "buscando"}
            >
              <Coins size={16} />{pedagios.fase === "buscando" ? "Buscando praças…" : "Pedágios"}
            </button>
          )}
          <button type="submit" className="tdg-action" disabled={estado.fase === "calculando"}>
            <Route size={16} />{estado.fase === "calculando" ? "Traçando…" : "Traçar rota"}
          </button>
        </div>
      </form>

      {iaEstado.fase === "ok" && iaEstado.motivo && (
        <p className="tdg-roteirizacao-ia"><Sparkles size={14} /> {iaEstado.motivo}</p>
      )}
      {iaEstado.fase === "erro" && <p className="tdg-roteirizacao-erro">{iaEstado.motivo}</p>}
      {estado.fase === "erro" && <p className="tdg-roteirizacao-erro">{estado.motivo}</p>}
      {estado.fase === "pronto" && r && (
        <div className="tdg-roteirizacao-resumo">
          <strong>{r.distanciaKm} km</strong>
          <span>
            {formatarTempo(considerarTransito ? minutosComTransito : minutosTotal)} no total
            {qtdRecargas > 0 ? ` (${formatarTempo(Math.round(r.minutos * fatorTransito))} de viagem + ${qtdRecargas} recarga(s) de 1h30)` : " de viagem"}
            {considerarTransito ? ` · com trânsito de pico (+${Math.round((fatorTransito - 1) * 100)}%)` : " · sem trânsito"} · {r.paradas.length} paradas
          </span>
          {chegadaEstimada && (
            <span className="tdg-roteirizacao-chegada"><Clock size={13} aria-hidden="true" /> Chegada estimada às <strong>{chegadaEstimada}</strong></span>
          )}
          <small>{r.paradas.map((p) => p.rotulo.split(",")[0]).join(" → ")}</small>
          <small className="tdg-roteirizacao-fonte">{r.fonte}{considerarTransito ? " · trânsito de pico é estimativa (régua por horário); ao vivo depende de provedor pago" : ""}</small>
        </div>
      )}

      {carregadores.fase === "on" && (
        <p className="tdg-roteirizacao-carregadores-info">
          <Plug size={14} /> {carregadores.lista.length} carregador(es) no mapa · <b>{pesadosNoMapa}</b> servem pesado (DC rápido, ⚡ verde). Fonte: {carregadores.fonte || "OpenStreetMap"}.
        </p>
      )}

      {pedagios.fase === "ok" && pedagios.dados && (
        <div className="tdg-roteirizacao-pedagios">
          <div className="tdg-roteirizacao-pedagios-total">
            <Coins size={16} />
            <strong>{pedagios.dados.quantidade} praça(s) de pedágio</strong>
            <span>na rota (concessões federais)</span>
          </div>
          {pedagios.dados.quantidade > 0 ? (
            <>
              <ul className="tdg-roteirizacao-pedagios-lista">
                {pedagios.dados.pracas.map((p, i) => (
                  <li key={`${p.praca}-${i}`}>
                    <span className="tdg-roteirizacao-pedagio-praca">{p.praca || "Praça"}</span>
                    <span className="tdg-roteirizacao-pedagio-via">{[p.rodovia, p.km ? `km ${p.km}` : "", p.municipio && p.uf ? `${p.municipio}/${p.uf}` : p.uf, p.concessionaria].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
              <label className="tdg-roteirizacao-pedagios-tarifa">
                <span>Tarifa média por praça do seu caminhão (R$) — a ANTT não fornece o valor</span>
                <input
                  type="number"
                  min="0"
                  step="0.10"
                  inputMode="decimal"
                  value={tarifaMedia}
                  onChange={(event) => setTarifaMedia(event.target.value)}
                  placeholder="Ex.: 18,50"
                />
              </label>
              {estimarTotalPedagios(pedagios.dados.quantidade, tarifaMedia) != null && (
                <p className="tdg-roteirizacao-pedagios-estimativa">
                  Estimativa: <strong>{formatarReais(estimarTotalPedagios(pedagios.dados.quantidade, tarifaMedia))}</strong> ({pedagios.dados.quantidade} × {formatarReais(Number(String(tarifaMedia).replace(",", ".")) || 0)})
                </p>
              )}
            </>
          ) : (
            <p className="tdg-roteirizacao-pedagios-vazio">Nenhuma praça de concessão federal nesta rota.</p>
          )}
          <small className="tdg-roteirizacao-fonte">{pedagios.dados.fonte}. {pedagios.dados.cobertura}</small>
        </div>
      )}
      {pedagios.fase === "erro" && <p className="tdg-roteirizacao-erro">{pedagios.motivo}</p>}

        </div>
        <div className="tdg-rot-mapa-col">
          <div className="tdg-roteirizacao-mapa" ref={containerRef} aria-label="Mapa da rota" />
        </div>
      </div>
    </section>
  );
}
