// ===== Fila de ação e alertas (bloco 20 · dedicada) =====
// Camada pura. Complementa (não substitui) `tmsCommandCenterDomain`,
// `decisionCenterDomain`, `systemHealthDomain` e `taskAssignmentDomain`.
//
// Alerta na plataforma tem SEIS propriedades obrigatórias, sem as quais ele
// não é acionável: severidade, criticidade (o que acontece se ninguém agir),
// responsável, prazo (SLA), sugestão de ação e (opcional) ação executável
// pela própria plataforma. Sem essas coisas, alerta vira apenas ruído, e um
// operador afogado ignora tudo.
//
// Regras:
// 1. Falsos positivos ENVELHECEM. Se uma regra dispara 20 vezes em 24 h e
//    todos foram marcados "falso positivo", o operador precisa poder
//    desligar a regra. `falsePositiveRate` mede esse peso.
// 2. Um operador tem TETO — nunca mais que N alertas ativos simultâneos por
//    responsável (`alertsPerOperator`). Se estourar, prioridade menor sai
//    da fila (fica "aguardando"). O objetivo é atenção, não volume.
// 3. Histórico da ação é obrigatório para toda mudança de estado — quem
//    fez, quando e por quê. Ver `appendHistory`.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ms = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
};

// Severidade e criticidade. Não confunda: severidade = quão grande o problema;
// criticidade = quão rápido precisa ser resolvido (SLA em minutos).
export const SEVERIDADES = Object.freeze(["info", "atencao", "alto", "critico"]);
export const CRITICIDADES = Object.freeze({
  critico: 15,   // 15 min de SLA
  alto: 60,      // 1 h
  atencao: 240,  // 4 h
  info: 1440,    // 24 h
});

export const ESTADOS = Object.freeze(["aberto", "em-tratamento", "resolvido", "falso-positivo", "aguardando"]);

// Toma o SLA da severidade quando não veio explícito, e recusa valor negativo.
export const slaMinutosPara = (severidade, slaExplicito) => {
  if (Number.isFinite(Number(slaExplicito)) && Number(slaExplicito) > 0)
    return Math.round(Number(slaExplicito));
  return CRITICIDADES[severidade] ?? CRITICIDADES.atencao;
};

// Cria (ou preenche defaults de) um alerta. Nunca escreve "responsavel: null"
// como algo aceitável — se falta responsável, entra como "pendente-atribuir".
export const criarAlerta = (bruto = {}, agoraIso) => {
  const sev = SEVERIDADES.includes(bruto.severidade) ? bruto.severidade : "atencao";
  const criadoEm = bruto.criadoEm || agoraIso || new Date().toISOString();
  return {
    id: String(bruto.id || `alert-${criadoEm}-${Math.random().toString(36).slice(2, 8)}`),
    titulo: String(bruto.titulo || "").trim(),
    descricao: String(bruto.descricao || "").trim(),
    severidade: sev,
    slaMinutos: slaMinutosPara(sev, bruto.slaMinutos),
    responsavel: bruto.responsavel || "pendente-atribuir",
    sugestaoAcao: String(bruto.sugestaoAcao || "").trim(),
    // Se a plataforma consegue executar, `acaoAutomatica` traz o handler
    // (ex.: "open:os", "swap:vehicle", "reroute:charging"). Ler no cliente.
    acaoAutomatica: bruto.acaoAutomatica || null,
    origem: String(bruto.origem || "sistema"),
    estado: ESTADOS.includes(bruto.estado) ? bruto.estado : "aberto",
    criadoEm,
    historico: Array.isArray(bruto.historico) ? bruto.historico : [],
  };
};

// Escreve no histórico quem fez o quê. Sempre imutável (devolve novo objeto).
export const appendHistory = (alerta, evento) => {
  const linha = {
    quando: evento?.quando || new Date().toISOString(),
    autor: String(evento?.autor || "sistema"),
    acao: String(evento?.acao || "atualizacao"),
    motivo: String(evento?.motivo || ""),
    de: evento?.de ?? alerta?.estado,
    para: evento?.para ?? alerta?.estado,
  };
  return { ...alerta, historico: [...(alerta.historico || []), linha] };
};

// Transição de estado com histórico obrigatório. Bloqueia transição inválida
// (ex.: resolver alerta que nunca foi aberto).
export const transitar = (alerta, paraEstado, evento) => {
  if (!alerta) return alerta;
  if (!ESTADOS.includes(paraEstado)) return alerta;
  const novo = { ...alerta, estado: paraEstado };
  return appendHistory(novo, { ...evento, de: alerta.estado, para: paraEstado, acao: "transicao" });
};

// Tempo restante do SLA (em minutos). Negativo = já venceu.
export const slaRestanteMinutos = (alerta, agoraMs = Date.now()) => {
  const criado = ms(alerta?.criadoEm);
  if (criado == null) return null;
  const sla = num(alerta?.slaMinutos);
  const decorridoMin = (agoraMs - criado) / 60000;
  return Math.ceil(sla - decorridoMin);
};

// Ordena a fila: (1) críticos primeiro, (2) SLA restante crescente (quem vence
// antes primeiro), (3) mais antigo primeiro. Ignora resolvido e falso-positivo.
const PRIO_SEV = { critico: 0, alto: 1, atencao: 2, info: 3 };
export const priorizarFila = (alertas = [], agoraMs = Date.now()) => {
  const ativos = alertas.filter((a) => a && a.estado !== "resolvido" && a.estado !== "falso-positivo");
  return ativos.slice().sort((a, b) => {
    const bySev = (PRIO_SEV[a.severidade] ?? 9) - (PRIO_SEV[b.severidade] ?? 9);
    if (bySev) return bySev;
    const aRest = slaRestanteMinutos(a, agoraMs);
    const bRest = slaRestanteMinutos(b, agoraMs);
    if (aRest !== bRest) return num(aRest) - num(bRest);
    return (ms(a.criadoEm) || 0) - (ms(b.criadoEm) || 0);
  });
};

// Aplica teto por operador: quem passa do limite vai para `aguardando`.
// Nunca rebaixa "critico" mesmo estourando (crítico é sempre prioridade).
export const capPorOperador = (alertas = [], teto = 8, agoraMs = Date.now()) => {
  const fila = priorizarFila(alertas, agoraMs);
  const porResp = new Map();
  return fila.map((a) => {
    const chave = a.responsavel || "pendente-atribuir";
    const count = porResp.get(chave) || 0;
    porResp.set(chave, count + 1);
    if (a.severidade === "critico") return a;
    if (count >= teto) return { ...a, estado: "aguardando" };
    return a;
  });
};

// Taxa de falso positivo por regra num período. `regraChave` = campo `origem`
// ou id da regra que dispara o alerta. `janelaHoras` = tempo olhado. Um valor
// alto (ex.: >= 0.5) recomenda desligar a regra — a UI mostra isso.
export const falsePositiveRate = (alertas = [], regraChave, janelaHoras = 24, agoraMs = Date.now()) => {
  const desde = agoraMs - janelaHoras * 3600000;
  const daRegra = alertas.filter((a) => {
    if (a?.origem !== regraChave) return false;
    const c = ms(a?.criadoEm);
    return c != null && c >= desde;
  });
  if (!daRegra.length) return null;
  const fp = daRegra.filter((a) => a.estado === "falso-positivo").length;
  const total = daRegra.length;
  const taxa = fp / total;
  return {
    regra: String(regraChave || ""),
    janelaHoras,
    total,
    falsosPositivos: fp,
    taxa: Math.round(taxa * 100) / 100,
    recomendaDesligar: taxa >= 0.5,
  };
};
