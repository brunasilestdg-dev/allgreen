// Apresentação comercial por e-mail. Tom de prospecção em PRIMEIRA PESSOA (quem
// assina se apresenta), personalizado pelo contexto da empresa e honesto sobre o
// histórico: nunca "retoma" um contato que não existiu. Puro e testável — a tela
// só monta o e-mail a partir daqui e envia com o PDF anexado.

export const APRESENTACAO_PDF_URL = "/apresentacao-comercial-todogreen.pdf";
export const APRESENTACAO_PDF_NOME = "Apresentacao-To-Do-Green.pdf";
export const APRESENTACAO_ASSUNTO = "To Do Green — logística 100% elétrica para a sua operação";

const POSICIONAMENTO = "a única transportadora 100% elétrica do Brasil";

// Assunto canônico da interação que o envio registra — é por ele que a tela
// sabe "para quem já mandei a apresentação".
export const ASSUNTO_APRESENTACAO_ENVIADA = "Apresentação comercial enviada";

// A partir das interações de uma conta, diz se a apresentação já foi enviada e
// quando (a mais recente). Não inventa: lê o registro que o próprio envio cria.
export const detectarApresentacaoEnviada = (interacoes = []) => {
  const lista = Array.isArray(interacoes) ? interacoes : [];
  const enviadas = lista.filter((i) =>
    i && (i.assunto === ASSUNTO_APRESENTACAO_ENVIADA
      || /apresenta[çc][aã]o.*enviad/i.test(String(i.assunto || ""))
      || /apresenta[çc][aã]o comercial.*enviad/i.test(String(i.ata || ""))),
  );
  if (!enviadas.length) return { enviada: false, em: "" };
  const em = enviadas
    .map((i) => String(i.ocorridaEm || i.criadoEm || ""))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || "";
  return { enviada: true, em };
};

const primeiroNome = (nome) => String(nome || "").trim().split(/\s+/)[0] || "";

// Distila o contexto de mercado da empresa (pesquisa/inteligência externa) em
// sinais simples que o e-mail pode CITAR sem inventar — só o que a pesquisa
// comprovou. Devolve { rfqAberta, esgRelevante, segmento, temContexto }.
export const contextoDeMercado = (report = {}, { segmento } = {}) => {
  const r = report && typeof report === "object" ? report : {};
  const rfqAberta = Array.isArray(r.openRfqs) && r.openRfqs.length > 0;
  const esgRelevante = /alt|relevan/i.test(String(r.esg?.relevance || ""));
  const setor = String(r.suggestedSegment?.value || segmento || "").trim();
  return { rfqAberta, esgRelevante, segmento: setor, temContexto: rfqAberta || esgRelevante || !!setor };
};

// Quem assina se apresenta em primeira pessoa (pedido da titular). Sem nome do
// remetente, fala em nome da equipe — nunca inventa um nome. Sem artigo de gênero
// antes do nome (não dá para inferir gênero de um nome).
const apresentacaoPessoal = (remetente, retoma) => {
  if (retoma) return remetente ? `Aqui é ${remetente}, da To Do Green.` : "Aqui é a equipe da To Do Green.";
  return remetente
    ? `Meu nome é ${remetente} e represento a To Do Green, ${POSICIONAMENTO}.`
    : `Represento a To Do Green, ${POSICIONAMENTO}.`;
};

// O gancho: o convite da mensagem, personalizado pelo contexto quando há.
// `retoma` = houve contato real; só então o texto pode "retomar".
const gancho = (contexto, conta, retoma, temperatura) => {
  const sobre = conta ? ` sobre a ${conta}` : "";
  if (contexto?.rfqAberta) {
    return retoma
      ? `Retomando nosso contato${sobre}: vi que vocês estão com cotações de transporte em aberto e a To Do Green pode participar com uma operação 100% elétrica. Deixo nossa apresentação em anexo.`
      : `Vi que a ${conta || "empresa"} está com cotações de transporte em aberto e gostaria de avaliar com você uma alternativa 100% elétrica — deixo nossa apresentação em anexo para um primeiro panorama.`;
  }
  if (contexto?.segmento) {
    const setor = ` em ${contexto.segmento}`;
    return retoma
      ? `Retomando nosso contato${sobre}: empresas${setor} têm levado a pauta ESG para a logística, e trago nossa apresentação para avançarmos.`
      : `Empresas${setor} têm buscado tirar emissão da operação logística, e gostaria de avaliar com você essa conversa — deixo nossa apresentação em anexo.`;
  }
  if (retoma) {
    return temperatura === "Quente"
      ? `Que bom seguir com a conversa${sobre}! Como combinamos, deixo nossa apresentação em anexo para você avançar internamente.`
      : `Retomando nosso contato${sobre}, deixo nossa apresentação em anexo — assim você tem o panorama completo para a próxima conversa.`;
  }
  return "Gostaria de avaliar com você a possibilidade de uma conversa para apresentarmos nossas soluções — deixo nossa apresentação em anexo para um primeiro panorama.";
};

const VALOR = [
  "O que a To Do Green entrega:",
  "• Custo competitivo — preço de frete alinhado ao mercado, com economia de diesel e menor custo por km da frota elétrica repassada na operação.",
  "• Previsibilidade de custo — sem exposição à variação do diesel; TCO por rota transparente na proposta.",
  "• Frota 100% elétrica — redução real de emissões, com relatório auditável para o seu ESG (Escopo 3).",
  "• Rastreio ao vivo e comprovante de entrega (POD) no portal do cliente.",
  "• Roteirização que entende autonomia e recarga, sem surpresa no prazo.",
  "• SLA de entrega de 99%.",
  "• Soluções personalizadas para o seu tipo de entrega.",
  "• Frota mista, da moto à carreta.",
].join("\n");

// Pergunta de fechamento (pedido da titular): convida à resposta em vez de só
// "ficar à disposição".
const CTA = "Neste momento, faz sentido buscar uma alternativa para otimizar a sua operação?";

// Monta o e-mail (assunto + corpo).
//  • `remetenteNome`: quem assina — entra em primeira pessoa na abertura e na
//    assinatura. Sem ele, assina "Equipe comercial".
//  • `houveContato`: houve interação registrada? Só então o texto pode "retomar"
//    — senão nunca afirma um contato que não existiu (pedido da titular).
//  • `contexto`: saída de contextoDeMercado — havendo contexto da empresa, a
//    abertura é personalizada; sem ele, prospecção genérica honesta.
//  • `assinatura`: bloco de assinatura da pessoa (cargo, telefone…). Quando
//    definido, fecha o e-mail com ELE, verbatim — é "a minha assinatura" que a
//    titular pediu. Sem ele, cai no fecho padrão com o primeiro nome.
export const montarEmailApresentacao = ({ contatoNome, contaNome, temperatura, houveContato = false, contexto = null, remetenteNome, assinatura } = {}) => {
  const nome = primeiroNome(contatoNome);
  const saudacao = nome ? `Olá, ${nome}.` : "Olá.";
  const conta = String(contaNome || "").trim();
  const remetente = primeiroNome(remetenteNome);
  // "Retomar" exige contato real E uma temperatura morna/quente.
  const retoma = !!houveContato && (temperatura === "Quente" || temperatura === "Morno");
  const abertura = `${apresentacaoPessoal(remetente, retoma)} ${gancho(contexto, conta, retoma, temperatura)}`;
  const assinaturaCustom = String(assinatura || "").trim();
  const fecho = assinaturaCustom
    || (remetente ? `Um abraço,\n${remetente} · To Do Green` : "Um abraço,\nEquipe comercial · To Do Green");
  const corpo = [saudacao, "", abertura, "", VALOR, "", CTA, "", fecho].join("\n");
  return { assunto: APRESENTACAO_ASSUNTO, corpo };
};

// Link de compose do Gmail (fallback quando o envio direto não está disponível):
// leva to/assunto/corpo prontos; o anexo a pessoa põe manualmente.
export const linkComposeGmail = ({ para, cc, assunto, corpo } = {}) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(para || "")}` +
  (cc ? `&cc=${encodeURIComponent(cc)}` : "") +
  `&su=${encodeURIComponent(assunto || "")}&body=${encodeURIComponent(corpo || "")}`;
