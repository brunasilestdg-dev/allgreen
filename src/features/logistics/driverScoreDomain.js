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

export const PESOS_SCORE = Object.freeze({ pontualidade: 0.4, pod: 0.3, ocorrencias: 0.3 });

export const faixaDoScore = (nota) =>
  nota >= 85 ? "excelente" : nota >= 70 ? "bom" : nota >= 50 ? "atencao" : "critico";

export const ROTULO_FAIXA = Object.freeze({
  excelente: "Excelente",
  bom: "Bom",
  atencao: "Atenção",
  critico: "Crítico",
});

// `viagens` no formato do portal (entregueEm, prometidoEm, comprovanteRegistrado,
// ocorrencias). Devolve a nota 0–100, a faixa e os componentes abertos.
export const calcularScoreMotorista = (viagens = []) => {
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

  // Monta só os componentes disponíveis e renormaliza os pesos entre eles.
  const brutos = [
    { chave: "pontualidade", rotulo: "Pontualidade", valor: pontualidade, peso: PESOS_SCORE.pontualidade },
    { chave: "pod", rotulo: "Comprovante (POD)", valor: pod, peso: PESOS_SCORE.pod },
    { chave: "ocorrencias", rotulo: "Sem ocorrências", valor: ocorrencias, peso: PESOS_SCORE.ocorrencias },
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
