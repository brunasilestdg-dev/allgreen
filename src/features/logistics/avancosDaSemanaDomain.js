// ===== Avanços da semana =====
//
// A página que a titular pediu (30/08, mockup): as oportunidades com
// MOVIMENTO CONCRETO nos últimos sete dias, ordenadas por potencial de
// receita, cada uma com o avanço escrito por gente — o comentário mais
// recente da oportunidade (ou o próximo passo registrado). No rodapé, quem
// esfriou: aberta e parada há duas semanas ou mais, candidata a follow-up.
//
// Movimento é fato registrado, não impressão: uma INTERAÇÃO registrada
// (reunião com ata, ligação, visita, tentativa de contato), um comentário novo
// ou a última interação carimbada na oportunidade. Sem registro, não há avanço —
// é a mesma régua do resto da vertical ("o CRM não cria atividades que não
// aconteceram").
//
// As três fontes entram juntas de propósito: quem registra a ata da reunião não
// deveria precisar comentar de novo para a oportunidade aparecer aqui. Vale a
// mais recente das três, e é dela que sai a frase do avanço.

import { estagioValido } from "./opportunityIntelligenceDomain.js";

const DIA = 86_400_000;
export const JANELA_DO_AVANCO_DIAS = 7;
export const DIAS_PARA_ESFRIAR = 14;

const instante = (valor) => {
  const t = Date.parse(valor ?? "");
  return Number.isFinite(t) ? t : 0;
};
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Uma interação vira avanço com a data em que ACONTECEU (não a da digitação) e
// com o assunto como frase — a ata inteira não cabe num cartão, e o assunto é o
// que a pessoa escreveu para resumir.
const doRegistro = (item) => {
  if (!item) return null;
  const ehInteracao = item.ocorridaEm !== undefined || item.assunto !== undefined;
  const quando = ehInteracao
    ? Math.max(instante(item.ocorridaEm), instante(String(item.ocorridaEm || "").slice(0, 10)))
    : instante(item.criadoEm);
  const texto = ehInteracao
    ? String(item.assunto || item.ata || "").trim()
    : String(item.comentario || "").trim();
  return quando > 0 ? { quando, texto } : null;
};

export function avancosDaSemana({ oportunidades = [], comentarios = [], interacoes = [], agora = Date.now() } = {}) {
  // O registro mais novo de cada oportunidade — comentário ou interação — é a
  // voz do avanço.
  const ultimoRegistroPor = new Map();
  const considerar = (opportunityId, candidato) => {
    if (!opportunityId || !candidato) return;
    const atual = ultimoRegistroPor.get(opportunityId);
    if (!atual || candidato.quando > atual.quando) ultimoRegistroPor.set(opportunityId, candidato);
  };
  for (const item of Array.isArray(comentarios) ? comentarios : [])
    considerar(item?.opportunityId, doRegistro(item));
  for (const item of Array.isArray(interacoes) ? interacoes : [])
    considerar(item?.opportunityId, doRegistro(item));

  const inicioDaJanela = agora - JANELA_DO_AVANCO_DIAS * DIA;
  const comMovimento = [];
  const paradas = [];

  for (const bruto of Array.isArray(oportunidades) ? oportunidades : []) {
    const estagio = estagioValido(bruto?.estagio || bruto?.stage);
    // Perdida saiu do jogo: nem avanço, nem follow-up.
    if (estagio === "Fechada perdida") continue;

    const registro = ultimoRegistroPor.get(bruto?.id);
    const ultimaInteracao = Math.max(
      instante(bruto?.lastInteractionAt || bruto?.ultimaInteracaoEm),
      registro?.quando || 0,
    );
    const valorMensal = numero(bruto?.valorMensal);
    const item = {
      id: bruto?.id || "",
      clientId: bruto?.clientId || "",
      cliente: String(bruto?.cliente || bruto?.client || "Sem conta"),
      estagio,
      valorMensal,
      valor: valorMensal || numero(bruto?.valorContrato) || numero(bruto?.value),
      nota: registro?.texto || String(bruto?.nextStep || "").trim(),
      diasParado: ultimaInteracao > 0 ? Math.floor((agora - ultimaInteracao) / DIA) : null,
    };

    if (ultimaInteracao > 0 && ultimaInteracao >= inicioDaJanela) comMovimento.push(item);
    else paradas.push(item);
  }

  comMovimento.sort((a, b) => b.valor - a.valor);

  const frios = paradas
    // Ganha parada não é problema de follow-up — já fechou.
    .filter((item) => item.estagio !== "Fechada ganha")
    .filter((item) => item.diasParado === null || item.diasParado >= DIAS_PARA_ESFRIAR)
    .sort((a, b) => (b.diasParado ?? Number.MAX_SAFE_INTEGER) - (a.diasParado ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 3);

  return {
    avancos: comMovimento,
    totalMensal: comMovimento.reduce((soma, item) => soma + item.valorMensal, 0),
    frios,
  };
}
