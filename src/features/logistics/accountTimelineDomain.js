// ===== Linha do tempo da conta =====
//
// Tudo o que aconteceu com um cliente, em uma linha só.
//
// A vertical já registrava eventos — só que em sete tabelas separadas, uma
// por módulo: work_item_events, deal_desk_events, client_operation_events,
// client_portal_events, opportunities, proposals, contracts. Cada tela
// mostrava a sua fatia, e ninguém conseguia ler a conta inteira. Quem entra
// numa reunião não quer sete abas: quer saber o que aconteceu, em ordem.
//
// Por isso a linha do tempo NÃO é uma tabela nova com dual-write. É leitura:
// o servidor consulta as fontes que já existem e este módulo as funde. Duas
// consequências importantes:
//
//   1) ela nasce cheia — o histórico que já está no banco aparece hoje, sem
//      migração e sem backfill;
//   2) não existe o risco clássico de log paralelo, em que o evento é gravado
//      num lugar e esquecido no outro, e a timeline passa a mentir.
//
// Quando entrarem fontes que ainda não têm casa (cadência, inbox), elas
// ganham a sua tabela e são unidas aqui do mesmo jeito.

const texto = (valor) => String(valor ?? "").trim();

// O tipo decide o ícone, a cor e o filtro. Ficam aqui, e não na tela, porque
// a Semente também lê a linha do tempo — e as duas precisam chamar a mesma
// coisa pelo mesmo nome.
export const TIPOS_DE_EVENTO = Object.freeze({
  oportunidade: { rotulo: "Oportunidade", cor: "comercial" },
  proposta: { rotulo: "Proposta", cor: "comercial" },
  contrato: { rotulo: "Contrato", cor: "comercial" },
  aprovacao: { rotulo: "Aprovação comercial", cor: "aprovacao" },
  tarefa: { rotulo: "Tarefa", cor: "trabalho" },
  operacao: { rotulo: "Operação", cor: "operacao" },
  solicitacao: { rotulo: "Solicitação", cor: "operacao" },
  portal: { rotulo: "Portal do cliente", cor: "cliente" },
  pesquisa: { rotulo: "Plantû", cor: "inteligencia" },
});

export const TIPOS = Object.freeze(Object.keys(TIPOS_DE_EVENTO));

// Data sempre comparável e sempre presente. Um evento sem data é um evento
// que não entra: numa linha do tempo, "quando" não é opcional.
const instante = (valor) => {
  const data = new Date(texto(valor));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
};

export const criarEvento = ({ id, tipo, quando, titulo, detalhe, autor, referencia, valor } = {}) => {
  const momento = instante(quando);
  if (!momento || !TIPOS_DE_EVENTO[tipo] || !texto(titulo)) return null;
  return {
    id: texto(id) || `${tipo}-${momento}`,
    tipo,
    quando: momento,
    dia: momento.slice(0, 10),
    titulo: texto(titulo).slice(0, 240),
    detalhe: texto(detalhe).slice(0, 600) || null,
    autor: texto(autor).slice(0, 160) || null,
    referencia: texto(referencia).slice(0, 120) || null,
    valor: Number.isFinite(Number(valor)) && Number(valor) !== 0 ? Number(valor) : null,
  };
};

// Mais recente primeiro: é como se lê antes de uma reunião. O desempate por
// id existe para a ordem não dançar entre dois carregamentos quando dois
// eventos caem no mesmo segundo — lista que se reordena sozinha faz a pessoa
// achar que perdeu alguma coisa.
const maisRecentePrimeiro = (a, b) =>
  b.quando.localeCompare(a.quando) || String(a.id).localeCompare(String(b.id));

export function montarLinhaDoTempo(eventos = [], { tipos, desde, ate, limite = 300 } = {}) {
  const filtroDeTipo = Array.isArray(tipos) && tipos.length ? new Set(tipos) : null;
  const vistos = new Set();
  const limpos = [];
  for (const evento of Array.isArray(eventos) ? eventos : []) {
    if (!evento || !evento.quando || !TIPOS_DE_EVENTO[evento.tipo]) continue;
    if (filtroDeTipo && !filtroDeTipo.has(evento.tipo)) continue;
    if (desde && evento.quando < desde) continue;
    if (ate && evento.quando > ate) continue;
    // A mesma coisa pode chegar por duas fontes (a proposta enviada aparece
    // como proposta e como evento de portal). Uma vez basta.
    const chave = `${evento.tipo}|${evento.id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    limpos.push(evento);
  }
  limpos.sort(maisRecentePrimeiro);
  return limpos.slice(0, Math.max(1, limite));
}

// Agrupado por dia, porque é assim que a pessoa lê: "no dia 10 aconteceram
// três coisas", não "aconteceram trinta coisas".
export function agruparPorDia(eventos = []) {
  const dias = new Map();
  for (const evento of eventos) {
    if (!dias.has(evento.dia)) dias.set(evento.dia, []);
    dias.get(evento.dia).push(evento);
  }
  return [...dias.entries()].map(([dia, itens]) => ({ dia, eventos: itens }));
}

// O que a conta virou, lido da própria linha do tempo. Serve para a Semente
// responder "essa conta está parada há quanto tempo?" sem uma segunda
// consulta, e para a tela mostrar o resumo sem recalcular no navegador.
export function resumirLinhaDoTempo(eventos = [], agora = new Date().toISOString()) {
  const total = eventos.length;
  if (!total) {
    return {
      total: 0,
      ultimoEvento: null,
      diasSemAtividade: null,
      porTipo: {},
      // Sem evento nenhum não se conclui "conta parada": pode ser conta nova.
      // A diferença importa para quem vai decidir o que fazer com ela.
      leitura: "Nenhum registro nesta conta ainda.",
    };
  }
  const ultimo = eventos.reduce((maior, item) => (item.quando > maior.quando ? item : maior));
  const porTipo = {};
  for (const evento of eventos) porTipo[evento.tipo] = (porTipo[evento.tipo] || 0) + 1;
  const dias = Math.max(
    0,
    Math.floor((Date.parse(agora) - Date.parse(ultimo.quando)) / 86400000),
  );
  return {
    total,
    ultimoEvento: ultimo,
    diasSemAtividade: dias,
    porTipo,
    leitura:
      dias === 0
        ? "Houve atividade hoje."
        : dias === 1
          ? "Última atividade ontem."
          : `Última atividade há ${dias} dias.`,
  };
}
