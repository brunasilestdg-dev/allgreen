// ===== A Semente antes da pergunta =====
//
// Um assistente que só responde é um campo de busca com boas maneiras. O que
// separa "chat" de "assistente" é chegar com a pauta pronta: o que mudou na
// carteira, o que esfriou, o que precisa de decisão hoje.
//
// A pauta sai do índice da carteira que o servidor já monta — nenhuma
// consulta nova por conta, porque varrer a linha do tempo de 400 contas para
// abrir um painel seria caro e lento exatamente para quem tem carteira
// grande, que é quem mais precisa disto.
//
// Três regras que decidem o formato:
//
//   1) Toda pauta é acionável. "Você tem 37 contas" não é pauta; "3 contas
//      quentes estão sem próxima ação" é.
//   2) Toda pauta traz os nomes. Número sem nome obriga a pessoa a ir
//      procurar, e aí ela não usa mais.
//   3) Carteira em dia é uma resposta legítima. Inventar pendência para o
//      painel não ficar vazio é como se perde a confiança na pauta.

const texto = (valor) => String(valor ?? "").trim();
const hoje = (agora) => new Date(agora).toISOString().slice(0, 10);

export const URGENCIAS = Object.freeze({ alta: 0, media: 1, baixa: 2 });

// Quantos pontos de atenção de ALTA urgência a pauta tem — o gatilho de "falar
// primeiro": é o número que vira o selo no lançador do Todô, para o operador
// ver que algo mudou sem precisar abrir o painel. Só urgência alta conta; um
// selo que acende para tudo vira ruído e a pessoa aprende a ignorá-lo.
export function pontosDeAtencaoAltos(pauta) {
  const lista = Array.isArray(pauta?.pautas) ? pauta.pautas : [];
  return lista.filter((item) => item?.urgencia === "alta").length;
}

// ===== Aviso de pendência: só o que é NOVO (Onda 2) =====
//
// O cron avalia a pauta de alta urgência e avisa por push/e-mail — mas só
// quando surge algo que a pessoa ainda não viu. O truque é uma CHAVE estável
// por item concreto (a "Precificação da DHL", não "há pendências"): guardamos as
// chaves já avisadas e, no disparo seguinte, avisamos apenas as que não estavam
// lá. Assim a mesma pendência não bate no celular toda hora, e uma pendência
// que se resolve e volta é avisada de novo (a chave sai e reentra).
//
// Erra para o lado quieto de propósito: as chaves cobrem os nomes que a pauta
// mostra (as primeiras contas), então na dúvida avisa de menos, nunca de mais.
export function itensDePendenciaAlta(pauta) {
  const altas = (pauta?.pautas || []).filter((item) => item?.urgencia === "alta");
  const itens = [];
  for (const bloco of altas) {
    const nomes = Array.isArray(bloco.contas) && bloco.contas.length ? bloco.contas : [""];
    for (const nome of nomes) itens.push({ chave: `${bloco.id}|${nome}`, titulo: bloco.titulo });
  }
  return itens;
}

export function novidadesDePendencia(itensAtuais, chavesVistas) {
  const itens = Array.isArray(itensAtuais) ? itensAtuais : [];
  const vistas = new Set(Array.isArray(chavesVistas) ? chavesVistas : []);
  const novos = itens.filter((item) => !vistas.has(item.chave));
  const titulos = [...new Set(novos.map((item) => item.titulo))];
  return { novos, titulos, todasAsChaves: itens.map((item) => item.chave) };
}

const NOMES_NA_PAUTA = 4;

const pauta = ({ id, urgencia, titulo, porque, contas = [], pergunta }) => {
  if (!contas.length) return null;
  const mostrados = contas.slice(0, NOMES_NA_PAUTA);
  return {
    id,
    urgencia,
    titulo,
    porque,
    quantidade: contas.length,
    contas: mostrados,
    // "e mais 12" é honesto sobre o que ficou de fora; cortar em silêncio
    // faria a pessoa achar que são só quatro.
    restantes: Math.max(0, contas.length - mostrados.length),
    pergunta,
  };
};

const nomes = (itens) => itens.map((item) => texto(item.nome)).filter(Boolean);

/**
 * A pauta do dia, a partir do índice da carteira.
 *
 * `indice` é o mesmo que a Semente já usa para responder: nome, temperatura,
 * etapa, próxima ação e prazo, contatos com canal, data da pesquisa externa.
 */
export function montarPauta({ indice = [], tarefasVencidas = [], agora = new Date().toISOString() } = {}) {
  const contas = Array.isArray(indice) ? indice.filter(Boolean) : [];
  const dia = hoje(agora);

  const prazoVencido = contas.filter(
    (conta) => texto(conta.proximaAcao) && texto(conta.prazoDaProximaAcao) && conta.prazoDaProximaAcao < dia,
  );
  const quentesSemAcao = contas.filter((conta) => conta.temperatura === "Quente" && !texto(conta.proximaAcao));
  const semAcao = contas.filter((conta) => !texto(conta.proximaAcao) && conta.temperatura !== "Quente");
  const semCanal = contas.filter((conta) => Number(conta.contatosComCanal || 0) === 0);
  const semPesquisa = contas.filter((conta) => !conta.pesquisaExterna);

  const pautas = [
    pauta({
      id: "prazo-vencido",
      urgencia: "alta",
      titulo: "Próxima ação com prazo vencido",
      porque: "O prazo combinado passou e a ação continua registrada como pendente.",
      contas: nomes(prazoVencido),
      pergunta: "Quais contas estão com a próxima ação vencida e o que faço com cada uma?",
    }),
    tarefasVencidas.length
      ? {
          id: "tarefas-vencidas",
          urgencia: "alta",
          titulo: "Tarefas suas com prazo vencido",
          porque: "Estão na Central de Implantação, atribuídas a você, com prazo passado.",
          quantidade: tarefasVencidas.length,
          contas: tarefasVencidas.slice(0, NOMES_NA_PAUTA).map((item) => texto(item.titulo)),
          restantes: Math.max(0, tarefasVencidas.length - NOMES_NA_PAUTA),
          pergunta: "Quais tarefas minhas estão vencidas?",
        }
      : null,
    pauta({
      id: "quente-sem-acao",
      urgencia: "alta",
      titulo: "Conta quente sem próxima ação",
      porque: "Conta classificada como quente e sem próximo passo combinado — é onde se perde negócio pronto.",
      contas: nomes(quentesSemAcao),
      pergunta: "O que proponho como próxima ação nas contas quentes sem passo definido?",
    }),
    pauta({
      id: "sem-canal",
      urgencia: "media",
      titulo: "Conta sem nenhum contato com canal",
      porque: "Não há telefone, e-mail nem LinkedIn de ninguém — sem canal não há abordagem.",
      contas: nomes(semCanal),
      pergunta: "Quais contas estão sem contato com canal e como começo o mapeamento?",
    }),
    pauta({
      id: "sem-acao",
      urgencia: "media",
      titulo: "Conta sem próxima ação definida",
      porque: "A conta está sem próximo passo combinado.",
      contas: nomes(semAcao),
      pergunta: "Quais contas estão sem próxima ação?",
    }),
    pauta({
      id: "sem-pesquisa",
      urgencia: "baixa",
      titulo: "Conta nunca pesquisada na web",
      porque: "RFQs abertas, portal de fornecedor e metas ESG ainda são desconhecidos nessas contas.",
      contas: nomes(semPesquisa),
      pergunta: "Pesquise as contas que ainda não foram pesquisadas e me diga o que achou.",
    }),
  ].filter(Boolean);

  pautas.sort((a, b) => URGENCIAS[a.urgencia] - URGENCIAS[b.urgencia] || b.quantidade - a.quantidade);

  return {
    dia,
    carteira: contas.length,
    pautas,
    // Carteira vazia e carteira em dia são estados diferentes, e a diferença
    // muda o que a pessoa faz a seguir.
    leitura: !contas.length
      ? "Sua carteira ainda não tem contas."
      : pautas.length
        ? `${pautas.length} ponto(s) de atenção em ${contas.length} conta(s).`
        : `Carteira em dia: ${contas.length} conta(s), nenhuma pendência aberta.`,
  };
}
