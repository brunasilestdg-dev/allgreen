// ===== Segurança operacional física (P2 · bloco 19) =====
// Camada pura. Sem GPS, sem CAN, sem SMS. Só regras.
//
// A titular colocou o texto exato da lista de proibições no material:
//   - Bloqueio permitido apenas com veículo praticamente parado
//   - Proibição de bloqueio em movimento
//   - Proibição de bloqueio em rodovia
//   - Proibição de bloqueio em túnel
//   - Proibição de bloqueio em cruzamento
//   - Dupla autorização humana para bloqueio
//   - Registro do autor, motivo e evidência
//   - Senha de coação
//
// Este módulo é a defesa contra o "clique de bloqueio errado" que mata
// gente. Toda decisão passa pelo predicado abaixo. Nenhum caminho
// alternativo. E cada tentativa registra evidência.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const now = () => new Date().toISOString();

// Contexto onde o bloqueio é proibido — o telemetria/mapa entrega isso
// para o CSMS/frota, e a decisão aqui é meramente sim/não.
export const CONTEXTOS_PROIBIDOS = Object.freeze([
  "rodovia",
  "tunel",
  "cruzamento",
  "ponte",
  "acesso-a-rodovia",
]);

// Limite prático de "praticamente parado" — 5 km/h. Um veículo a 10 km/h
// pode arrastar. Se a telemetria não confia na leitura de velocidade (fix
// GPS fraco), a `velocidadeConfiavel === false` também recusa o bloqueio.
export const LIMITE_PARADO_KMH = 5;

// Motivos legítimos de bloqueio remoto. Motivo fora dessa lista NÃO
// autoriza. É a segunda barreira além do contexto físico.
export const MOTIVOS_BLOQUEIO = Object.freeze([
  "roubo-confirmado",
  "sequestro-confirmado",
  "coacao-senha-usada",
  "mandato-judicial",
  "motorista-solicitou",
]);

// Autorização = duas pessoas diferentes (aprovadorA !== aprovadorB), cada
// uma com o papel adequado. O motorista NUNCA aparece na dupla —
// justamente para o caso do "motorista sob coação".
const PAPEIS_AUTORIZADORES = new Set(["operacao-lider", "seguranca-24x7", "gerente-frota"]);

// Predicado central: pode bloquear AGORA? Se sim, `permitido: true`; se
// não, `permitido: false` com `motivo` explícito. É a função que a torre
// chama antes de mandar o comando ao veículo.
export const podeBloquearRemoto = ({ contexto, velocidadeKmh, velocidadeConfiavel = true, autorizacoes = [], motivo }) => {
  const registro = (permitido, motivoNegacao = null) => ({
    permitido,
    motivo: motivoNegacao,
    verificacoes: {
      contexto,
      velocidadeKmh: num(velocidadeKmh),
      velocidadeConfiavel: !!velocidadeConfiavel,
      motivo,
      autorizadores: autorizacoes.length,
    },
    quando: now(),
  });

  if (!MOTIVOS_BLOQUEIO.includes(motivo)) return registro(false, "motivo-nao-autorizado");
  if (CONTEXTOS_PROIBIDOS.includes(contexto)) return registro(false, `contexto-proibido:${contexto}`);
  if (!velocidadeConfiavel) return registro(false, "velocidade-nao-confiavel");
  if (num(velocidadeKmh) > LIMITE_PARADO_KMH) return registro(false, "veiculo-em-movimento");
  const autores = autorizacoes.filter((a) => a && a.autorId && PAPEIS_AUTORIZADORES.has(a.papel));
  const ids = new Set(autores.map((a) => a.autorId));
  if (autores.length < 2 || ids.size < 2) return registro(false, "dupla-autorizacao-ausente");
  return registro(true, null);
};

// Registra a tentativa de bloqueio (permitido ou não) em auditoria.
// A auditoria é OBRIGATÓRIA: sem ela o operador que bloqueou em contexto
// proibido "não deixou rastro" — e é justamente o rastro que impede o
// mau uso da ferramenta.
export const registrarTentativaBloqueio = (log = [], decisao, contexto = {}) => {
  return [
    ...(Array.isArray(log) ? log : []),
    {
      id: `bloq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      quando: decisao?.quando || now(),
      permitido: !!decisao?.permitido,
      motivoNegacao: decisao?.motivo || null,
      verificacoes: decisao?.verificacoes || {},
      autorizacoes: (contexto.autorizacoes || []).map((a) => ({ autorId: a.autorId, papel: a.papel, quando: a.quando || now() })),
      motoristaId: contexto.motoristaId || null,
      veiculoId: contexto.veiculoId || null,
      evidencia: contexto.evidencia || null,
    },
  ];
};

// Coação: o motorista tem senha de coação. Se ele digita ESSA senha em vez
// da normal, o app AGE como se estivesse tudo bem (para o assaltante não
// perceber), mas dispara silenciosamente para a torre. `senhaNormal` e
// `senhaCoacao` são HASHES iguais em comprimento — testar em texto puro
// aqui é só para o motor; nunca guardar senha em texto.
export const detectarCoacao = ({ digitada, senhaNormalHash, senhaCoacaoHash }) => {
  if (!digitada || !senhaCoacaoHash) return { coacao: false, autenticou: false };
  if (digitada === senhaCoacaoHash) return { coacao: true, autenticou: true };
  if (digitada === senhaNormalHash) return { coacao: false, autenticou: true };
  return { coacao: false, autenticou: false };
};

// Baú: abertura fora de ponto autorizado é evento de segurança. O ponto
// autorizado é um raio em torno de uma coordenada (cliente, base, ponto
// de recarga). Sem lista de pontos, tudo é "fora do ponto".
export const abridoraForaDoPonto = ({ pontosAutorizados = [], posicao, raioMetrosPadrao = 80 }) => {
  if (!posicao) return { foraDoPonto: true, motivo: "sem-posicao" };
  const perto = (pontosAutorizados || []).find((p) => {
    if (!p || p.lat == null || p.lon == null) return false;
    const raio = num(p.raioMetros) || raioMetrosPadrao;
    return distanciaMetros(posicao, p) <= raio;
  });
  if (perto) return { foraDoPonto: false, pontoAutorizado: perto };
  return { foraDoPonto: true, motivo: "abertura-fora-de-ponto-autorizado" };
};

// haversine em METROS para o raio pequeno da abertura de baú.
const distanciaMetros = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Desvio de rota — recebe a rota planejada (polyline) e a posição atual;
// se a distância mínima até qualquer segmento passar do limite (padrão
// 400 m), reporta desvio. É o gatilho de contato automático.
export const desvioDeRota = ({ polyline = [], posicao, limiteMetros = 400 }) => {
  if (!posicao || !Array.isArray(polyline) || polyline.length < 2) {
    return { desviado: false, motivo: "sem-rota-planejada" };
  }
  let menor = Infinity;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const d = distanciaPontoSegmento(posicao, polyline[i], polyline[i + 1]);
    if (d < menor) menor = d;
  }
  return {
    desviado: menor > limiteMetros,
    distanciaMinimaMetros: Math.round(menor),
    limiteMetros,
  };
};

const distanciaPontoSegmento = (p, a, b) => {
  // Aproximação euclidiana em graus, boa para segmentos curtos (< 10 km).
  // Cada grau ≈ 111 km; multiplica por 111000 para virar metros.
  const ax = a.lon, ay = a.lat, bx = b.lon, by = b.lat, px = p.lon, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return distanciaMetros(p, a);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const ix = ax + t * dx, iy = ay + t * dy;
  return distanciaMetros(p, { lat: iy, lon: ix });
};

// Protocolo de escalonamento quando o motorista não responde: soa alarme
// no app; sem resposta em X minutos, aciona o supervisor; sem resposta em
// Y minutos, aciona a central de segurança. `agoraMs` é o relógio da
// torre.
export const escalonamentoInexecucaoContato = ({ ultimaRespostaMs, agoraMs, minutosSupervisor = 5, minutosSeguranca = 15 }) => {
  const decorridoMin = (num(agoraMs) - num(ultimaRespostaMs)) / 60000;
  if (decorridoMin < minutosSupervisor) return { nivel: "ok", decorridoMin };
  if (decorridoMin < minutosSeguranca) return { nivel: "supervisor", decorridoMin };
  return { nivel: "seguranca-central", decorridoMin };
};
