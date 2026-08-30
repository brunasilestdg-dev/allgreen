// ===== Avanços da semana =====
//
// A página que a titular pediu (30/08, mockup): as oportunidades com
// MOVIMENTO CONCRETO nos últimos sete dias, ordenadas por potencial de
// receita, cada uma com o avanço escrito por gente — o comentário mais
// recente da oportunidade (ou o próximo passo registrado). No rodapé, quem
// esfriou: aberta e parada há duas semanas ou mais, candidata a follow-up.
//
// Movimento é fato registrado, não impressão: a última interação gravada na
// oportunidade ou um comentário novo. Sem registro, não há avanço — é a
// mesma régua do resto da vertical ("o CRM não cria atividades que não
// aconteceram").

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

export function avancosDaSemana({ oportunidades = [], comentarios = [], agora = Date.now() } = {}) {
  // O comentário mais novo de cada oportunidade é a voz do avanço.
  const ultimoComentarioPor = new Map();
  for (const item of Array.isArray(comentarios) ? comentarios : []) {
    if (!item?.opportunityId) continue;
    const atual = ultimoComentarioPor.get(item.opportunityId);
    if (!atual || instante(item.criadoEm) > instante(atual.criadoEm)) {
      ultimoComentarioPor.set(item.opportunityId, item);
    }
  }

  const inicioDaJanela = agora - JANELA_DO_AVANCO_DIAS * DIA;
  const comMovimento = [];
  const paradas = [];

  for (const bruto of Array.isArray(oportunidades) ? oportunidades : []) {
    const estagio = estagioValido(bruto?.estagio || bruto?.stage);
    // Perdida saiu do jogo: nem avanço, nem follow-up.
    if (estagio === "Fechada perdida") continue;

    const comentario = ultimoComentarioPor.get(bruto?.id);
    const ultimaInteracao = Math.max(
      instante(bruto?.lastInteractionAt || bruto?.ultimaInteracaoEm),
      instante(comentario?.criadoEm),
    );
    const valorMensal = numero(bruto?.valorMensal);
    const item = {
      id: bruto?.id || "",
      clientId: bruto?.clientId || "",
      cliente: String(bruto?.cliente || bruto?.client || "Sem conta"),
      estagio,
      valorMensal,
      valor: valorMensal || numero(bruto?.valorContrato) || numero(bruto?.value),
      nota: String(comentario?.comentario || bruto?.nextStep || "").trim(),
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
