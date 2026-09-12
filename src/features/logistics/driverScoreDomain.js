// ===== Score do motorista (bloco 03 · fatia 3) =====
// Camada pura.
//
// A nota do motorista NÃO é uma avaliação subjetiva nem um dado novo a digitar:
// ela é derivada do que a operação já registra — a pontualidade das entregas
// (entregue até o prometido), o comprovante (POD) presente, e as ocorrências.
// É o mesmo princípio do green score auditável: componentes abertos, peso
// declarado, e o número diz o que ele não é (sem entrega, o score é indisponível
// em vez de um zero que fingiria).
//
// Pesa só o que está disponível: se as viagens não têm prazo prometido, a
// pontualidade sai da conta e os pesos se renormalizam — não se pune o motorista
// por um dado que a operação não preencheu.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v, casas = 0) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};
const ms = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
};

// Cinco dimensões, todas derivadas do que a operação já registra — nunca um
// dado novo a digitar. A proporção do trio de entrega (pontualidade:pod:
// ocorrências = 4:3:3) é preservada de propósito: quando não há jornada nem
// vistoria, os dois novos componentes saem e os pesos renormalizam de volta
// para 0,4/0,3/0,3 — o motorista não é punido por um sinal que a operação
// ainda não coletou.
export const PESOS_SCORE = Object.freeze({
  pontualidade: 0.32, // no prazo
  pod: 0.24, // comprovante
  ocorrencias: 0.24, // segurança/qualidade (sem ocorrência)
  conformidade: 0.1, // jornada/fadiga (Lei do Motorista)
  cuidado: 0.1, // vistoria do veículo
});

// Penalidade por alerta de conformidade, por gravidade. Um alerta crítico
// (direção contínua acima do limite) pesa mais que um alto (interjornada curta).
const PENALIDADE_CONFORMIDADE = Object.freeze({ critica: 40, alta: 25, media: 15, baixa: 10 });

// Vistoria → nota do componente "cuidado com o veículo". Só entra quando a
// vistoria do dia foi CONCLUÍDA (incompleta não vira nota — é ausência de dado).
const NOTA_VISTORIA = Object.freeze({ aprovado: 100, ressalva: 70, reprovado: 30 });

export const faixaDoScore = (nota) =>
  nota >= 85 ? "excelente" : nota >= 70 ? "bom" : nota >= 50 ? "atencao" : "critico";

export const ROTULO_FAIXA = Object.freeze({
  excelente: "Excelente",
  bom: "Bom",
  atencao: "Atenção",
  critico: "Crítico",
});

// Nota do componente "conformidade" a partir do resultado de
// avaliarConformidadeJornada. Só é um sinal quando houve jornada (temJornada):
// sem turnos, "conforme" é vazio de informação, não mérito — devolve null.
const notaConformidade = (conformidade, temJornada) => {
  if (!conformidade || !temJornada) return null;
  const alertas = Array.isArray(conformidade.alertas) ? conformidade.alertas : [];
  const penalidade = alertas.reduce(
    (s, a) => s + (PENALIDADE_CONFORMIDADE[a?.gravidade] ?? PENALIDADE_CONFORMIDADE.media),
    0,
  );
  return Math.max(0, 100 - penalidade);
};

// Nota do componente "cuidado" a partir do resultado de avaliarChecklist. Só
// entra com a vistoria concluída — incompleta é ausência de dado, não zero.
const notaCuidado = (vistoria) => {
  if (!vistoria || !vistoria.completo) return null;
  return NOTA_VISTORIA[vistoria.status] ?? null;
};

// `viagens` no formato do portal (entregueEm, prometidoEm, comprovanteRegistrado,
// ocorrencias). `sinais` traz os dois componentes derivados de OUTROS registros
// que o motorista já faz: `conformidade` (de avaliarConformidadeJornada) com
// `temJornada`, e `vistoria` (de avaliarChecklist). Devolve a nota 0–100, a
// faixa e os componentes abertos. Sinais ausentes simplesmente não entram.
export const calcularScoreMotorista = (viagens = [], sinais = {}) => {
  const lista = Array.isArray(viagens) ? viagens : [];
  const entregues = lista.filter((v) => v && v.entregueEm);
  const totalEntregues = entregues.length;

  if (totalEntregues === 0) {
    return {
      disponivel: false,
      nota: null,
      faixa: null,
      componentes: [],
      totalEntregues: 0,
      aviso: "Ainda sem entregas concluídas: o score aparece quando você fechar a primeira.",
    };
  }

  // Pontualidade: só entra quando há prazo prometido. Entregue até o prometido
  // conta como no prazo.
  const comPrazo = entregues.filter((v) => ms(v.prometidoEm) != null);
  const noPrazo = comPrazo.filter((v) => ms(v.entregueEm) <= ms(v.prometidoEm)).length;
  const pontualidade = comPrazo.length > 0 ? (noPrazo / comPrazo.length) * 100 : null;

  // POD: entregas com comprovante registrado sobre o total de entregas.
  const comPod = entregues.filter((v) => v.comprovanteRegistrado).length;
  const pod = (comPod / totalEntregues) * 100;

  // Ocorrências: zero → 100; uma ocorrência por entrega já zera. Penalidade
  // proporcional, nunca negativa.
  const ocorrenciasTotal = lista.reduce((s, v) => s + num(v.ocorrencias), 0);
  const ocorrencias = Math.max(0, 100 - (ocorrenciasTotal / totalEntregues) * 100);

  // Componentes derivados de OUTROS registros do motorista (jornada e vistoria).
  const conformidade = notaConformidade(sinais?.conformidade, sinais?.temJornada);
  const cuidado = notaCuidado(sinais?.vistoria);

  // Monta só os componentes disponíveis e renormaliza os pesos entre eles.
  const brutos = [
    { chave: "pontualidade", rotulo: "Pontualidade", valor: pontualidade, peso: PESOS_SCORE.pontualidade },
    { chave: "pod", rotulo: "Comprovante (POD)", valor: pod, peso: PESOS_SCORE.pod },
    { chave: "ocorrencias", rotulo: "Sem ocorrências", valor: ocorrencias, peso: PESOS_SCORE.ocorrencias },
    { chave: "conformidade", rotulo: "Jornada em dia", valor: conformidade, peso: PESOS_SCORE.conformidade },
    { chave: "cuidado", rotulo: "Cuidado (vistoria)", valor: cuidado, peso: PESOS_SCORE.cuidado },
  ].filter((c) => c.valor != null);

  const somaPesos = brutos.reduce((s, c) => s + c.peso, 0) || 1;
  const componentes = brutos.map((c) => ({
    chave: c.chave,
    rotulo: c.rotulo,
    valor: arred(c.valor),
    pesoEfetivo: arred((c.peso / somaPesos) * 100),
  }));
  const nota = arred(brutos.reduce((s, c) => s + c.valor * (c.peso / somaPesos), 0));

  return {
    disponivel: true,
    nota,
    faixa: faixaDoScore(nota),
    componentes,
    totalEntregues,
    ocorrenciasTotal,
  };
};

// Comparação com os pares: onde a minha nota cai na régua do time. `outrasNotas`
// são as notas dos DEMAIS motoristas (sem a minha, sem nome — só o número). O
// servidor computa cada nota com este mesmo domínio para não haver duas contas
// diferentes de "quem está melhor". Sem base, diz que ainda não há com quem
// comparar — nunca finge um percentil.
export const compararScoreMotorista = (nota, outrasNotas = []) => {
  const minha = Number(nota);
  const base = (Array.isArray(outrasNotas) ? outrasNotas : [])
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!Number.isFinite(minha) || base.length === 0)
    return { posicao: null, total: base.length, mediana: null, melhores: null, texto: "Ainda não há outros motoristas para comparar." };

  const abaixo = base.filter((v) => v < minha).length;
  const percentil = Math.round((abaixo / base.length) * 100);
  const meio = Math.floor(base.length / 2);
  const mediana = base.length % 2 ? base[meio] : arred((base[meio - 1] + base[meio]) / 2, 1);
  // Quantos do time estão à minha frente (nota estritamente maior).
  const melhores = base.filter((v) => v > minha).length;

  return {
    posicao: percentil,
    total: base.length,
    mediana,
    melhores,
    texto: melhores === 0
      ? `Você está à frente de toda a equipe (${base.length} motorista(s)). Mediana do time: ${mediana}.`
      : `Acima de ${percentil}% do time. ${melhores} motorista(s) à sua frente; mediana ${mediana}.`,
  };
};
